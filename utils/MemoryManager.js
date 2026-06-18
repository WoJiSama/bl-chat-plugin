// utils/MemoryManager.js
import { RedisStore } from './memory/redisStore.js'
import { MemoryExtractor } from './memory/extractor.js'
import { upsertAlias, resolveAlias, listAliasesForQQ } from './memory/aliasRegistry.js'
import { makeEntity, makeFact, slimGroupFacts } from './memory/entityModel.js'
import { resolveClaim } from './memory/conflictResolver.js'
import { classifyBoundary } from './memory/boundary.js'
import { buildAliasPrompt, buildEntityPrompt, buildGroupFactsPrompt } from './memory/retriever.js'
import { clamp, compactText } from './memory/constants.js'

const DEFAULT_CONFIG = {
  enabled: true,
  maxEntitiesPerGroup: 200,
  maxFactsPerGroup: 50,
  maxFactsPerEntity: 20,
  saveStrictness: 'normal',          // off | normal | strict
  userExtractDebounceSeconds: 90,
  userExtractMaxBatchMessages: 6,
  groupExtractMinIntervalMinutes: 10,
  groupExtractMaxBatchMessages: 12,
  promptMaxGroupFacts: 6,
  promptMaxChars: 1200,
  memoryAiConfig: null,
  embeddingAiConfig: null
}

function nowMs() { return Date.now() }

export class MemoryManager {
  constructor(config = {}, { redis } = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.store = new RedisStore({ redis })
    this.extractor = new MemoryExtractor(this.config)
    this.REDIS_PREFIX = 'ytbot:mem:g:'
    this.userBuffers = new Map()
    this.groupBuffers = new Map()
    this.scopeQueues = new Map()
  }

  setAiConfig(aiConfig) { this.config.memoryAiConfig = aiConfig; this.extractor.config = this.config }
  updateConfig(config = {}) { this.config = { ...this.config, ...config }; this.extractor.config = this.config }

  // ---- 串行队列（每群一个，保证 read-modify-write 安全）----
  enqueueGroup(groupId, task) {
    const prev = this.scopeQueues.get(groupId) || Promise.resolve()
    const next = prev.catch(() => {}).then(task).finally(() => {
      if (this.scopeQueues.get(groupId) === next) this.scopeQueues.delete(groupId)
    })
    this.scopeQueues.set(groupId, next)
    return next
  }

  // ---- 写入：把 parseAndRoute 的 ops 落库 ----
  async applyOps(groupId, ops = []) {
    if (!ops.length) return { written: 0 }
    return this.enqueueGroup(groupId, async () => {
      const meta = await this.store.getMeta(groupId)
      if (meta.disabled) return { written: 0 }

      let entities = await this.store.getEntities(groupId)
      let aliasDoc = await this.store.getAlias(groupId)
      let facts = await this.store.getFacts(groupId)
      let written = 0

      for (const op of ops) {
        if (op.stream === 'alias') {
          const res = upsertAlias(aliasDoc, { text: op.text, qq: op.qq, authority: op.authority, confidence: op.confidence, by: op.by, at: op.at })
          if (res.changed) {
            aliasDoc = res.doc
            entities = this._ensureEntityAlias(entities, op)
            written++
          }
        } else if (op.stream === 'entityFact') {
          entities = this._addEntityFact(entities, op)
          written++
        } else if (op.stream === 'groupFact') {
          facts = this._addGroupFact(facts, op.fact)
          written++
        }
      }

      await this.store.saveEntities(groupId, this._trimEntities(entities))
      await this.store.saveAlias(groupId, aliasDoc)
      await this.store.saveFacts(groupId, this._trimFacts(facts))
      return { written }
    })
  }

  _ensureEntityAlias(entities, op) {
    const next = { ...entities }
    const e = makeEntity(next[op.qq] || { qq: op.qq })
    if (!e.aliases.some(a => a.text === op.text && !a.superseded)) {
      e.aliases = [...e.aliases, { text: op.text, authority: op.authority, confidence: op.confidence, by: op.by || [], at: op.at, superseded: false }]
    }
    e.updatedAt = nowMs()
    next[op.qq] = e
    return next
  }

  _addEntityFact(entities, op) {
    const next = { ...entities }
    const e = makeEntity(next[op.qq] || { qq: op.qq })
    const incoming = makeFact(op.fact)
    const dupIdx = e.facts.findIndex(f => f.text === incoming.text)
    if (dupIdx >= 0) {
      const { winner } = resolveClaim(e.facts[dupIdx], incoming)
      e.facts = e.facts.map((f, i) => (i === dupIdx ? winner : f))
    } else {
      e.facts = [...e.facts, incoming]
    }
    e.updatedAt = nowMs()
    next[op.qq] = e
    return next
  }

  _addGroupFact(facts, fact) {
    const incoming = makeFact(fact)
    const dupIdx = facts.findIndex(f => f.text === incoming.text)
    if (dupIdx >= 0) {
      const { winner } = resolveClaim(facts[dupIdx], incoming)
      return facts.map((f, i) => (i === dupIdx ? winner : f))
    }
    return [...facts, incoming]
  }

  _trimEntities(entities) {
    const ids = Object.keys(entities)
    if (ids.length <= this.config.maxEntitiesPerGroup) {
      for (const id of ids) entities[id].facts = this._capFacts(entities[id].facts, this.config.maxFactsPerEntity)
      return entities
    }
    const sorted = ids.sort((a, b) => (entities[b].updatedAt || 0) - (entities[a].updatedAt || 0))
    const keep = sorted.slice(0, this.config.maxEntitiesPerGroup)
    const out = {}
    for (const id of keep) { out[id] = entities[id]; out[id].facts = this._capFacts(out[id].facts, this.config.maxFactsPerEntity) }
    return out
  }

  _capFacts(facts, max) {
    const active = (facts || []).filter(f => !f.superseded)
    if (active.length <= max) return facts
    active.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || (b.at ?? 0) - (a.at ?? 0))
    return active.slice(0, max)
  }

  _trimFacts(facts) {
    return this._capFacts(slimGroupFacts(facts), this.config.maxFactsPerGroup)
  }

  // ---- 注入（保留旧签名）----
  async getMemoryPromptForUser(groupId, userId, query = '') {
    if (!this.config.enabled) return ''
    const meta = await this.store.getMeta(groupId)
    if (meta.disabled) return ''
    const entities = await this.store.getEntities(groupId)
    return buildEntityPrompt(entities[String(userId)], this.config.promptMaxChars)
  }

  async getGroupMemoryPrompt(groupId, query = '') {
    if (!this.config.enabled) return ''
    const meta = await this.store.getMeta(groupId)
    if (meta.disabled) return ''
    const facts = await this.store.getFacts(groupId)
    return buildGroupFactsPrompt(facts, query, this.config.promptMaxGroupFacts, this.config.promptMaxChars)
  }

  async getGroupAliasPrompt(groupId, query = '') {
    if (!this.config.enabled) return ''
    const meta = await this.store.getMeta(groupId)
    if (meta.disabled) return ''
    const aliasDoc = await this.store.getAlias(groupId)
    return buildAliasPrompt(aliasDoc, query, this.config.promptMaxChars)
  }

  // ---- 显式教学直喂别名表（替代旧 addGroupMemory(...,"member")）----
  async addAliasMapping(groupId, { alias, targetQQ, by, confidence = 0.95 }) {
    if (!alias || !targetQQ) return { written: 0 }
    return this.applyOps(groupId, [{ stream: 'alias', qq: String(targetQQ), text: compactText(alias, 64), authority: 'teaching', confidence: clamp(confidence), by: (by || []).map(String), at: nowMs() }])
  }

  // ---- config seed（identityBindings / userProfiles -> 实体）----
  async seedFromConfig(groupId, bindings = []) {
    const ops = []
    for (const b of bindings) {
      if (!b?.qq) continue
      for (const alias of [b.name, ...(b.aliases || [])].filter(Boolean)) {
        ops.push({ stream: 'alias', qq: String(b.qq), text: compactText(alias, 64), authority: 'config', confidence: 1, by: [], at: nowMs() })
      }
      if (b.notes) ops.push({ stream: 'entityFact', qq: String(b.qq), authority: 'config', fact: makeFact({ text: b.notes, tags: ['备注'], authority: 'config', confidence: 1, at: nowMs() }) })
    }
    return this.applyOps(groupId, ops)
  }

  // ---- 抽取入口（用户 + 群，后台 fire-and-forget）----
  async extractAndSaveMemories(groupId, userId, userMessage, _botReply = '', meta = {}) {
    if (!this.config.enabled) return { queued: false }
    if (classifyBoundary(userMessage).verdict === 'drop') return { queued: false, reason: 'boundary' }
    // 抽取(只读 LLM 调用)不需要 per-group 写锁;只有 applyOps 的 read-modify-write 需要,
    // 它会自行 enqueueGroup。这里若再包一层同 key 的 enqueueGroup 会与内层互相等待造成死锁。
    const ops = await this.extractor.extract({ groupId, speakerQQ: String(userId), messages: [{ content: compactText(userMessage, 500) }], at: nowMs() })
    return this.applyOps(groupId, ops)
  }

  async extractAndSaveGroupMemories(groupId, chatHistory = []) {
    if (!this.config.enabled || !Array.isArray(chatHistory) || !chatHistory.length) return { queued: false }
    // 群抽取：逐发言人不强求，这里把整段作为 group_consensus 候选交给 AI（speakerQQ 取空，alias/self 不会误挂）
    const messages = chatHistory
      .filter(m => classifyBoundary(m.content).verdict === 'candidate')
      .slice(-this.config.groupExtractMaxBatchMessages)
    if (!messages.length) return { queued: false, reason: 'no-candidate' }
    // 同 extractAndSaveMemories:抽取在锁外,applyOps 自行加锁,避免同 key 嵌套 enqueue 死锁。
    const ops = await this.extractor.extract({ groupId, speakerQQ: '', messages, at: nowMs() })
    // 群抽取只接受 groupFact / alias（teaching），过滤掉需要 speaker 的 self/preference
    const safe = ops.filter(op => op.stream === 'groupFact' || (op.stream === 'alias' && op.authority === 'teaching'))
    return this.applyOps(groupId, safe)
  }

  // ---- admin 命令（保留返回契约）----
  async adminStatus({ groupId, userId } = {}) {
    const meta = await this.store.getMeta(groupId)
    const entities = await this.store.getEntities(groupId)
    const facts = await this.store.getFacts(groupId)
    const aliasDoc = await this.store.getAlias(groupId)
    const userEntity = userId ? entities[String(userId)] : null
    return {
      enabled: this.config.enabled,
      user: userEntity ? { disabled: meta.disabled, factCount: (userEntity.facts || []).length, aliasCount: (userEntity.aliases || []).length } : null,
      group: { disabled: meta.disabled, entityCount: Object.keys(entities).length, factCount: facts.length, aliasCount: Object.keys(aliasDoc).length },
      config: { maxEntitiesPerGroup: this.config.maxEntitiesPerGroup, maxFactsPerGroup: this.config.maxFactsPerGroup, saveStrictness: this.config.saveStrictness }
    }
  }

  async adminListMemories({ scope = 'user', groupId, userId = null, query = '', limit = 30 } = {}) {
    const entities = await this.store.getEntities(groupId)
    if (scope === 'user') {
      const e = entities[String(userId)]
      const facts = e ? (e.facts || []).filter(f => !f.superseded) : []
      return { facts: facts.slice(0, limit), total: facts.length, entity: e || null }
    }
    const facts = (await this.store.getFacts(groupId)).filter(f => !f.superseded)
    const aliasDoc = await this.store.getAlias(groupId)
    return { facts: facts.slice(0, limit), total: facts.length, aliases: Object.entries(aliasDoc).map(([k, v]) => ({ alias: v.display || k, qq: v.qq })) }
  }

  async adminDeleteMemory({ scope = null, groupId, userId = null, id } = {}) {
    // id 形如 "alias:<别名>" 或 "fact:<群事实文本前缀>" 或 "<QQ>#<别名>"
    if (!id) return { deleted: false, reason: 'missing-id' }
    return this.enqueueGroup(groupId, async () => {
      const aliasDoc = await this.store.getAlias(groupId)
      if (id.startsWith('alias:')) {
        const key = id.slice('alias:'.length).trim()
        const hit = resolveAlias(aliasDoc, key)
        if (hit) { const k = Object.keys(aliasDoc).find(kk => aliasDoc[kk] === hit); delete aliasDoc[k]; await this.store.saveAlias(groupId, aliasDoc); return { deleted: true, scope: 'alias', id: k } }
      }
      const facts = await this.store.getFacts(groupId)
      const idx = facts.findIndex(f => f.text.startsWith(id.replace(/^fact:/, '')))
      if (idx >= 0) { const removed = facts.splice(idx, 1); await this.store.saveFacts(groupId, facts); return { deleted: true, scope: 'group', id: removed[0].text } }
      return { deleted: false, reason: 'not-found' }
    })
  }

  async adminClearMemories({ groupId } = {}) {
    const n = await this.store.clearGroup(groupId)
    return { cleared: n, groupId }
  }

  async adminSetUserMemoryEnabled() { return { enabled: true } } // 用户级开关在实体模型下退化为群级
  async adminSetGroupMemoryEnabled({ groupId, enabled }) {
    const meta = await this.store.getMeta(groupId)
    meta.disabled = !enabled
    await this.store.saveMeta(groupId, meta)
    return { enabled: !meta.disabled }
  }

  async clearGroupMemory(groupId) { return this.adminClearMemories({ groupId }) }
  async clearUserMemory(groupId, userId) {
    return this.enqueueGroup(groupId, async () => {
      const entities = await this.store.getEntities(groupId)
      delete entities[String(userId)]
      await this.store.saveEntities(groupId, entities)
      return { cleared: 1, scope: 'user', userId }
    })
  }

  // 兼容旧外部直接清键调用（apps/test.js admin）
  async clearGroupRedis(groupId) { return this.store.clearGroup(groupId) }
}
