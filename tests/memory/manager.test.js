// tests/memory/manager.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeRedis } from './helpers/fakeRedis.js'
import { MemoryManager } from '../../utils/MemoryManager.js'

function mgr(redis) {
  const m = new MemoryManager({ enabled: true }, { redis })
  return m
}

test('applyOps writes alias and entity, retrievable via prompts', async () => {
  const redis = createFakeRedis()
  const m = mgr(redis)
  await m.applyOps('981339693', [
    { stream: 'alias', qq: '3188163302', text: 'maela', authority: 'teaching', confidence: 0.9, by: ['925640859'], at: 1 },
    { stream: 'entityFact', qq: '925640859', authority: 'self', fact: { text: '在上海', tags: [], refs: [], authority: 'self', confidence: 0.8, at: 1, superseded: false } }
  ])
  const alias = await m.getGroupAliasPrompt('981339693', 'maela 是谁')
  assert.ok(alias.includes('maela'))
  assert.ok(alias.includes('3188163302'))
  const userPrompt = await m.getMemoryPromptForUser('981339693', '925640859', '')
  assert.ok(userPrompt.includes('在上海'))
})

test('conflicting alias resolves by authority across applyOps calls', async () => {
  const m = mgr(createFakeRedis())
  await m.applyOps('g', [{ stream: 'alias', qq: '3188163302', text: '希洛', authority: 'mention', confidence: 0.8, by: ['x'], at: 1 }])
  await m.applyOps('g', [{ stream: 'alias', qq: '925640859', text: '希洛', authority: 'self', confidence: 0.9, by: ['925640859'], at: 2 }])
  const doc = await m.store.getAlias('g')
  assert.equal(doc['希洛'].qq, '925640859')
})

test('disabled group blocks writes and prompts', async () => {
  const m = mgr(createFakeRedis())
  await m.adminSetGroupMemoryEnabled({ groupId: 'g', enabled: false })
  await m.applyOps('g', [{ stream: 'groupFact', authority: 'mention', fact: { text: 'x', tags: [], refs: [], authority: 'mention', confidence: 0.8, at: 1, superseded: false } }])
  assert.equal(await m.getGroupMemoryPrompt('g', ''), '')
})

test('adminClearMemories wipes the group', async () => {
  const m = mgr(createFakeRedis())
  await m.applyOps('g', [{ stream: 'groupFact', authority: 'mention', fact: { text: 'x', tags: [], refs: [], authority: 'mention', confidence: 0.8, at: 1, superseded: false } }])
  const r = await m.adminClearMemories({ scope: 'group', groupId: 'g' })
  assert.ok(r.cleared >= 1)
  assert.equal(await m.getGroupMemoryPrompt('g', ''), '')
})

// Regression: extract paths must not deadlock (no nested same-key enqueue).
// { timeout } makes a regression fail fast instead of hanging.
// 用户抽取带防抖+批量缓冲:maxBatch=1 时首条即 flush。
test('extractAndSaveMemories flushes on batch full and persists', { timeout: 5000 }, async () => {
  const m = mgr(createFakeRedis())
  m.config.userExtractMaxBatchMessages = 1
  m.extractor.extract = async () => ([
    { stream: 'alias', qq: '925640859', text: '咖啡大人', authority: 'self', confidence: 0.9, by: ['925640859'], at: 1 }
  ])
  const result = await m.extractAndSaveMemories('981339693', '925640859', '以后叫我咖啡大人')
  assert.equal(result.written, 1)
  const alias = await m.getGroupAliasPrompt('981339693', '咖啡大人是谁')
  assert.ok(alias.includes('咖啡大人'))
})

// 防抖:未达 batch 上限时只缓冲不抽取;攒满后一次性把全部消息交给 extractor。
test('extractAndSaveMemories buffers until batch full, then extracts the whole batch', { timeout: 5000 }, async () => {
  const m = mgr(createFakeRedis())
  m.config.userExtractMaxBatchMessages = 3
  m.config.userExtractDebounceSeconds = 90 // 不靠定时器,靠 batch 满触发
  let seenBatch = 0
  m.extractor.extract = async ({ messages }) => { seenBatch = messages.length; return [] }

  const r1 = m.extractAndSaveMemories('g', '111', '消息一')
  assert.equal(r1.queued, true)
  assert.equal(r1.buffered, 1)
  assert.equal(seenBatch, 0) // 还没抽取
  m.extractAndSaveMemories('g', '111', '消息二')
  const r3 = await m.extractAndSaveMemories('g', '111', '消息三') // 第3条达上限 → flush
  assert.equal(seenBatch, 3) // 三条一起抽取
  assert.ok(r3) // flush 返回 applyOps 结果
})

// 群抽取最小间隔节流:间隔内的第二次调用被跳过。
test('extractAndSaveGroupMemories persists then throttles within min interval', { timeout: 5000 }, async () => {
  const m = mgr(createFakeRedis())
  m.config.groupExtractMinIntervalMinutes = 10
  m.extractor.extract = async () => ([
    { stream: 'groupFact', authority: 'mention', fact: { text: '群里不要刷屏', tags: ['群规'], refs: [], authority: 'mention', confidence: 0.8, at: 1, superseded: false } }
  ])
  const first = await m.extractAndSaveGroupMemories('981339693', [{ content: '大家注意群里不要刷屏好吗' }])
  assert.equal(first.written, 1)
  assert.ok((await m.getGroupMemoryPrompt('981339693', '')).includes('群里不要刷屏'))

  const second = await m.extractAndSaveGroupMemories('981339693', [{ content: '再说一遍不要刷屏' }])
  assert.equal(second.queued, false)
  assert.equal(second.reason, 'throttled') // 10 分钟内不再重复抽取
})

// ---- getContextualMemoryPrompt 端到端：说话人 + 被提及 + refs + pending ----
test('getContextualMemoryPrompt assembles speaker, mentioned, refs and pending sections', async () => {
  const m = mgr(createFakeRedis())
  const now = 1_000_000_000_000
  await m.applyOps('g', [
    // 说话人事实
    { stream: 'entityFact', qq: '111', authority: 'self', fact: { text: '在上海做后端', authority: 'self', confidence: 0.9, at: now } },
    // 被提及人的别名 + 事实
    { stream: 'alias', qq: '222', text: '希洛', authority: 'teaching', confidence: 0.95, by: ['111'], at: now },
    { stream: 'entityFact', qq: '222', authority: 'teaching', fact: { text: '喜欢猫', authority: 'teaching', confidence: 0.8, at: now } },
    // 第三方实体里 refs 命中说话人的 fact（关联信息）
    { stream: 'entityFact', qq: '333', authority: 'mention', fact: { text: '和 111 是同事', refs: ['111'], authority: 'mention', confidence: 0.7, at: now } },
    // 说话人时间相关事实：未来 2 天内（落在回扣窗口）
    { stream: 'entityFact', qq: '111', authority: 'self', fact: { text: '下周有考试', authority: 'self', confidence: 0.9, at: now, eventAt: now + 2 * 86400000 } }
  ])

  const prompt = await m.getContextualMemoryPrompt('g', '111', '希洛最近怎么样', now)

  assert.ok(prompt.includes('【长期记忆】'))
  assert.ok(prompt.includes('在上海做后端'))
  assert.ok(prompt.includes('【相关的人】'))
  assert.ok(prompt.includes('喜欢猫'))
  assert.ok(prompt.includes('【关联信息】'))
  assert.ok(prompt.includes('和 111 是同事'))
  assert.ok(prompt.includes('【可自然提起】'))
  assert.ok(prompt.includes('下周有考试'))
})

test('getContextualMemoryPrompt returns empty for disabled group', async () => {
  const m = mgr(createFakeRedis())
  await m.applyOps('g', [{ stream: 'entityFact', qq: '111', authority: 'self', fact: { text: '在上海', authority: 'self', confidence: 0.9, at: 1 } }])
  await m.adminSetGroupMemoryEnabled({ groupId: 'g', enabled: false })
  assert.equal(await m.getContextualMemoryPrompt('g', '111', 'hi', 1), '')
})

// ---- 反思触发不死锁：阈值越过后 fire-and-forget enqueue，覆写 reflector._callChat ----
test('applyOps triggers entity reflection without deadlocking', { timeout: 5000 }, async () => {
  const m = mgr(createFakeRedis())
  m.config.reflectEntityThreshold = 2
  // 让 reflector 可用并覆写 _callChat 返回固定合并结果。
  m.reflector.config = { ...m.config, memoryAiConfig: { memoryAiUrl: 'u', memoryAiApikey: 'k' } }
  let reflectCalls = 0
  m.reflector._callChat = async () => { reflectCalls += 1; return '[{"text":"巩固后的事实","sources":[1,2,3]}]' }

  await m.applyOps('g', [
    { stream: 'entityFact', qq: '111', authority: 'self', fact: { text: '事实A', authority: 'self', confidence: 0.8, at: 1 } },
    { stream: 'entityFact', qq: '111', authority: 'self', fact: { text: '事实B', authority: 'self', confidence: 0.8, at: 2 } },
    { stream: 'entityFact', qq: '111', authority: 'self', fact: { text: '事实C', authority: 'self', confidence: 0.8, at: 3 } }
  ])

  // 反思是独立 enqueue 的 fire-and-forget；用同 key 的下一个 enqueue 等它跑完（若死锁则 timeout 失败）。
  await m.enqueueGroup('g', async () => {})

  assert.equal(reflectCalls, 1)
  const entities = await m.store.getEntities('g')
  assert.ok(entities['111'].facts.some(f => f.origin === 'reflection' && f.text === '巩固后的事实'))
})

test('applyOps skips reflection when reflector unconfigured', { timeout: 5000 }, async () => {
  const m = mgr(createFakeRedis())
  m.config.reflectEntityThreshold = 1
  let reflectCalls = 0
  m.reflector._callChat = async () => { reflectCalls += 1; return '[]' }

  await m.applyOps('g', [
    { stream: 'entityFact', qq: '111', authority: 'self', fact: { text: 'x', authority: 'self', confidence: 0.8, at: 1 } },
    { stream: 'entityFact', qq: '111', authority: 'self', fact: { text: 'y', authority: 'self', confidence: 0.8, at: 2 } }
  ])
  await m.enqueueGroup('g', async () => {})
  assert.equal(reflectCalls, 0) // reflector.canUse() 为假 → 不触发
})

// ---- 语义去重：注入假 embeddings，cosine≥阈值视为同一事实，按权威 resolveClaim ----
test('semantic dedup merges near-duplicate entity facts via injected embeddings', async () => {
  const m = mgr(createFakeRedis())
  m.config.semanticRecallEnabled = true
  m.config.semanticDupCosine = 0.88
  m.embeddings.config = m.config
  // 强制 canUse()，并按文本映射到固定向量：相近文本 → 近乎平行向量。
  m.embeddings.canUse = () => true
  m.embeddings.embed = async (text) => {
    if (String(text).includes('上海')) return [1, 0]      // 两条"上海"事实向量相同 → cosine=1
    return [0, 1]
  }

  await m.applyOps('g', [
    { stream: 'entityFact', qq: '111', authority: 'mention', fact: { text: '他在上海', authority: 'mention', confidence: 0.6, at: 1 } }
  ])
  await m.applyOps('g', [
    { stream: 'entityFact', qq: '111', authority: 'self', fact: { text: '在上海工作', authority: 'self', confidence: 0.9, at: 2 } }
  ])

  const entities = await m.store.getEntities('g')
  const facts = entities['111'].facts
  // 语义去重：两条"上海"事实合并为一条，self 权威胜出。
  assert.equal(facts.length, 1)
  assert.equal(facts[0].text, '在上海工作')
  assert.equal(facts[0].authority, 'self')
})

test('semantic dedup keeps distinct facts when below cosine threshold', async () => {
  const m = mgr(createFakeRedis())
  m.config.semanticRecallEnabled = true
  m.config.semanticDupCosine = 0.88
  m.embeddings.config = m.config
  m.embeddings.canUse = () => true
  m.embeddings.embed = async (text) => (String(text).includes('上海') ? [1, 0] : [0, 1])

  await m.applyOps('g', [
    { stream: 'entityFact', qq: '111', authority: 'self', fact: { text: '在上海', authority: 'self', confidence: 0.9, at: 1 } }
  ])
  await m.applyOps('g', [
    { stream: 'entityFact', qq: '111', authority: 'self', fact: { text: '喜欢咖啡', authority: 'self', confidence: 0.9, at: 2 } }
  ])

  const entities = await m.store.getEntities('g')
  assert.equal(entities['111'].facts.length, 2) // 正交向量 cosine=0 < 0.88 → 不合并
})
