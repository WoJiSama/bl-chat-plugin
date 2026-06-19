// utils/MemoryManager.js
import { RedisStore } from './memory/redisStore.js'
import { MemoryExtractor } from './memory/extractor.js'
import { upsertAlias, resolveAlias, listAliasesForQQ } from './memory/aliasRegistry.js'
import { makeEntity, makeFact, slimGroupFacts } from './memory/entityModel.js'
import { resolveClaim } from './memory/conflictResolver.js'
import { classifyBoundary } from './memory/boundary.js'
import { buildAliasPrompt, buildEntityPrompt, buildGroupFactsPrompt, buildContextualPrompt } from './memory/retriever.js'
import { resolveMentions } from './memory/mentionResolver.js'
import { Embeddings, cosineSimilarity } from './memory/embeddings.js'
import { Reflector } from './memory/reflector.js'
import { clamp, compactText } from './memory/constants.js'

const DAY_MS = 86400000

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
  embeddingAiConfig: null,
  semanticRecallEnabled: false,
  reflectEntityThreshold: 15,
  reflectGroupThreshold: 30,
  proactiveCallback: true,
  recallMaxMentionedEntities: 3,
  proactiveWindowDaysBefore: 3,
  proactiveWindowDaysAfter: 7,
  semanticDupCosine: 0.88
}

function nowMs() { return Date.now() }

export class MemoryManager {
  constructor(config = {}, { redis } = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.store = new RedisStore({ redis })
    this.extractor = new MemoryExtractor(this.config)
    this.embeddings = new Embeddings(this.config)
    this.reflector = new Reflector(this.config)
    this.REDIS_PREFIX = 'ytbot:mem:g:'
    this.userBuffers = new Map()
    this.groupBuffers = new Map()
    this.lastGroupExtractAt = new Map()
    this.scopeQueues = new Map()
  }

  setAiConfig(aiConfig) {
    this.config.memoryAiConfig = aiConfig
    this.extractor.config = this.config
    this.reflector.config = this.config
  }

  updateConfig(config = {}) {
    this.config = { ...this.config, ...config }
    this.extractor.config = this.config
    this.embeddings.config = this.config
    this.reflector.config = this.config
  }

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
    const result = await this.enqueueGroup(groupId, async () => {
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
          entities = await this._addEntityFact(entities, op)
          written++
        } else if (op.stream === 'groupFact') {
          facts = await this._addGroupFact(facts, op.fact)
          written++
        }
      }

      entities = this._trimEntities(entities)
      facts = this._trimFacts(facts)
      await this.store.saveEntities(groupId, entities)
      await this.store.saveAlias(groupId, aliasDoc)
      await this.store.saveFacts(groupId, facts)
      // 反思目标在锁内计算，但反思本身在锁外独立 enqueue（见 _maybeReflect）。
      const reflectTargets = this._collectReflectTargets(ops, entities, facts)
      return { written, reflectTargets }
    })

    // 复刻已修死锁的教训：反思绝不嵌套在 applyOps 自身的 enqueue task 内，
    // 必须新起一次 enqueueGroup。fire-and-forget，失败仅 log。
    this._maybeReflect(groupId, result.reflectTargets)
    return { written: result.written }
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

  async _addEntityFact(entities, op) {
    const next = { ...entities }
    const e = makeEntity(next[op.qq] || { qq: op.qq })
    const incoming = await this._withEmbedding(makeFact(op.fact))
    const dupIdx = this._findDupFactIndex(e.facts, incoming)
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

  async _addGroupFact(facts, fact) {
    const incoming = await this._withEmbedding(makeFact(fact))
    const dupIdx = this._findDupFactIndex(facts, incoming)
    if (dupIdx >= 0) {
      const { winner } = resolveClaim(facts[dupIdx], incoming)
      return facts.map((f, i) => (i === dupIdx ? winner : f))
    }
    return [...facts, incoming]
  }

  // semanticRecall 开启时为 fact 补 embedding（失败/未启用 → 原样返回，embedding 保持 null）。
  async _withEmbedding(fact) {
    if (!this.embeddings.canUse()) return fact
    const vector = await this.embeddings.embed(fact.text)
    return vector ? { ...fact, embedding: vector } : fact
  }

  // 去重定位：完全同文本永远算同一事实；embedding 都在且 cosine≥semanticDupCosine 也算同一。
  _findDupFactIndex(facts, incoming) {
    const list = facts || []
    const exact = list.findIndex(f => f.text === incoming.text)
    if (exact >= 0) return exact
    if (!this.embeddings.canUse() || !Array.isArray(incoming.embedding)) return -1
    const threshold = Number.isFinite(this.config.semanticDupCosine) ? this.config.semanticDupCosine : 0.88
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      if (f.superseded || !Array.isArray(f.embedding)) continue
      if (cosineSimilarity(incoming.embedding, f.embedding) >= threshold) return i
    }
    return -1
  }

  // ---- 反思触发（阈值，锁外独立 enqueue，fire-and-forget）----
  // 收集本次写入后越过阈值的反思目标：受影响的实体 QQ 集合 + 群是否越阈。
  _collectReflectTargets(ops, entities, facts) {
    if (!this.reflector.canUse()) return null
    const entityThreshold = Number.isFinite(this.config.reflectEntityThreshold) ? this.config.reflectEntityThreshold : 15
    const groupThreshold = Number.isFinite(this.config.reflectGroupThreshold) ? this.config.reflectGroupThreshold : 30

    const touchedQQs = new Set()
    for (const op of ops || []) {
      if ((op.stream === 'entityFact' || op.stream === 'alias') && op.qq) touchedQQs.add(String(op.qq))
    }
    const entityQQs = []
    for (const qq of touchedQQs) {
      const e = entities[qq]
      const activeCount = (e?.facts || []).filter(f => !f.superseded).length
      if (activeCount > entityThreshold) entityQQs.push(qq)
    }
    const activeGroupFacts = (facts || []).filter(f => !f.superseded).length
    const groupOverThreshold = activeGroupFacts > groupThreshold

    if (!entityQQs.length && !groupOverThreshold) return null
    return { entityQQs, groupOverThreshold }
  }

  // 新起一次 enqueueGroup（绝不嵌套在 applyOps 的 task 内）。失败仅 log，不阻塞主流程。
  _maybeReflect(groupId, targets) {
    if (!targets || !this.reflector.canUse()) return
    this.enqueueGroup(groupId, () => this._runReflection(groupId, targets))
      .catch(err => globalThis.logger?.error?.(`[Memory] 反思失败 group=${groupId}: ${err?.message || err}`))
  }

  // 锁内只做 read → consolidate/reflect → store.save*，绝不再调 applyOps。
  async _runReflection(groupId, targets) {
    const meta = await this.store.getMeta(groupId)
    if (meta.disabled) return

    if (targets.entityQQs?.length) {
      const entities = await this.store.getEntities(groupId)
      let changedAny = false
      for (const qq of targets.entityQQs) {
        const entity = entities[qq]
        if (!entity) continue
        const { facts, changed } = await this.reflector.consolidateEntity(entity)
        if (changed) {
          entities[qq] = { ...entity, facts, updatedAt: nowMs() }
          changedAny = true
        }
      }
      if (changedAny) await this.store.saveEntities(groupId, this._trimEntities(entities))
    }

    if (targets.groupOverThreshold) {
      const facts = await this.store.getFacts(groupId)
      const recentTexts = facts.filter(f => !f.superseded).slice(-this.config.groupExtractMaxBatchMessages).map(f => f.text)
      const { insights } = await this.reflector.reflectGroup({ groupId, facts, recentTexts })
      if (insights.length) {
        let merged = facts
        for (const insight of insights) merged = await this._addGroupFact(merged, insight)
        await this.store.saveFacts(groupId, this._trimFacts(merged))
      }
    }
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

  // ---- 语境化注入（mention 感知 / 语义召回 / refs 反查 / 时间回扣）----
  // 一次性读 entities/alias/facts，解析提及，组装六段语境提示。disabled 群返回 ''。
  async getContextualMemoryPrompt(groupId, speakerQQ, message, now = Date.now()) {
    if (!this.config.enabled) return ''
    const meta = await this.store.getMeta(groupId)
    if (meta.disabled) return ''

    const [entities, aliasDoc, facts] = await Promise.all([
      this.store.getEntities(groupId),
      this.store.getAlias(groupId),
      this.store.getFacts(groupId)
    ])

    const speaker = String(speakerQQ)
    const query = String(message || '')

    const { qqs: mentionedQQs } = resolveMentions(query, {
      aliasDoc,
      entities,
      speakerQQ: speaker,
      max: this.config.recallMaxMentionedEntities
    })

    const speakerEntity = entities[speaker] || null
    const mentionedEntities = mentionedQQs.map(qq => entities[qq]).filter(Boolean)

    const relevantQQs = new Set([speaker, ...mentionedQQs])
    const refsFacts = this._collectRefsFacts(entities, relevantQQs)
    const groupFacts = await this._rankGroupFacts(facts, query)
    const pendingFacts = this._collectPendingFacts([speakerEntity, ...mentionedEntities], now)

    return buildContextualPrompt({
      speakerEntity,
      mentionedEntities,
      refsFacts,
      groupFacts,
      aliasDoc,
      pendingFacts,
      query,
      config: this.config
    })
  }

  // 遍历所有实体的 facts，收集 refs 命中说话人/被提及人的活跃 fact（排除目标实体自身的 fact）。
  _collectRefsFacts(entities, relevantQQs) {
    const out = []
    for (const [qq, entity] of Object.entries(entities || {})) {
      if (relevantQQs.has(qq)) continue
      for (const f of entity.facts || []) {
        if (f.superseded) continue
        if ((f.refs || []).some(ref => relevantQQs.has(String(ref)))) out.push(f)
      }
    }
    return out
  }

  // 群事实排序：embeddings 可用且有 query → cosine(queryEmb, fact.embedding) 排序取前 N；否则交给 retriever 现有排序。
  async _rankGroupFacts(facts, query) {
    const active = (facts || []).filter(f => f && !f.superseded && f.text)
    if (!this.embeddings.canUse() || !query.trim()) return active
    const queryEmb = await this.embeddings.embed(query)
    if (!Array.isArray(queryEmb)) return active
    const limit = Number.isFinite(this.config.promptMaxGroupFacts) ? this.config.promptMaxGroupFacts : 6
    return [...active]
      .map(f => ({ f, score: Array.isArray(f.embedding) ? cosineSimilarity(queryEmb, f.embedding) : -1 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, limit))
      .map(({ f }) => f)
  }

  // 收集 eventAt 落在 [now - after*天, now + before*天] 的活跃 fact（仅 proactiveCallback 开启时）。
  _collectPendingFacts(entityList, now) {
    if (!this.config.proactiveCallback) return []
    const before = (Number.isFinite(this.config.proactiveWindowDaysBefore) ? this.config.proactiveWindowDaysBefore : 3) * DAY_MS
    const after = (Number.isFinite(this.config.proactiveWindowDaysAfter) ? this.config.proactiveWindowDaysAfter : 7) * DAY_MS
    const lo = now - after
    const hi = now + before
    const out = []
    for (const entity of entityList) {
      for (const f of entity?.facts || []) {
        if (f.superseded || !Number.isFinite(f.eventAt)) continue
        if (f.eventAt >= lo && f.eventAt <= hi) out.push(f)
      }
    }
    return out
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
  // 用户记忆抽取:防抖 + 批量缓冲。同一用户的连续发言先攒到 buffer,
  // 静默 userExtractDebounceSeconds 后或攒满 userExtractMaxBatchMessages 时,一次性抽取,
  // 避免每条消息都打一次 LLM。
  extractAndSaveMemories(groupId, userId, userMessage, _botReply = '', meta = {}) {
    if (!this.config.enabled) return { queued: false }
    if (classifyBoundary(userMessage).verdict === 'drop') return { queued: false, reason: 'boundary' }

    const key = `${groupId}:${userId}`
    const buf = this.userBuffers.get(key) || { groupId, userId, messages: [], timer: null }
    buf.messages.push(compactText(userMessage, 500))
    this.userBuffers.set(key, buf)

    const maxBatch = Math.max(1, Number(this.config.userExtractMaxBatchMessages) || 6)
    if (buf.messages.length >= maxBatch) {
      return this._flushUserBuffer(key)
    }

    if (buf.timer) clearTimeout(buf.timer)
    const debounceMs = Math.max(0, Number(this.config.userExtractDebounceSeconds) || 0) * 1000
    if (debounceMs > 0) {
      buf.timer = setTimeout(() => {
        this._flushUserBuffer(key).catch(err => globalThis.logger?.error?.('[MemoryManager] 用户记忆抽取失败:', err))
      }, debounceMs)
      buf.timer.unref?.()
    } else {
      // 防抖关闭 → 退化为即时抽取
      return this._flushUserBuffer(key)
    }
    return { queued: true, buffered: buf.messages.length }
  }

  async _flushUserBuffer(key) {
    const buf = this.userBuffers.get(key)
    if (!buf || !buf.messages.length) return { written: 0 }
    this.userBuffers.delete(key)
    if (buf.timer) clearTimeout(buf.timer)
    // 抽取在锁外,applyOps 自行加锁(避免同 key 嵌套 enqueue 死锁)。
    const ops = await this.extractor.extract({
      groupId: buf.groupId,
      speakerQQ: String(buf.userId),
      messages: buf.messages.map(content => ({ content })),
      at: nowMs()
    })
    return this.applyOps(buf.groupId, ops)
  }

  // 群记忆抽取:最小间隔节流。距上次该群抽取不足 groupExtractMinIntervalMinutes 则跳过,
  // 避免每次回复都整理一遍群记忆。
  async extractAndSaveGroupMemories(groupId, chatHistory = []) {
    if (!this.config.enabled || !Array.isArray(chatHistory) || !chatHistory.length) return { queued: false }

    const intervalMs = Math.max(0, Number(this.config.groupExtractMinIntervalMinutes) || 0) * 60000
    const last = this.lastGroupExtractAt.get(groupId) || 0
    if (intervalMs > 0 && nowMs() - last < intervalMs) return { queued: false, reason: 'throttled' }

    const messages = chatHistory
      .filter(m => classifyBoundary(m.content).verdict === 'candidate')
      .slice(-this.config.groupExtractMaxBatchMessages)
    if (!messages.length) return { queued: false, reason: 'no-candidate' }

    this.lastGroupExtractAt.set(groupId, nowMs())
    // 抽取在锁外,applyOps 自行加锁。
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
