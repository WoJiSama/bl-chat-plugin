# 记忆系统重构（实体中心 + 流分离）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把基于 Redis 的旧记忆系统重做为"实体中心 + 流分离"模型：群内以 QQ 聚合人物、结构化别名注册表、来源权威分级冲突裁决，并删除膨胀/死/bug 字段。

**Architecture:** 旧 `utils/MemoryManager.js`（1666 行单文件）拆成 `utils/memory/` 下的聚焦模块；`utils/MemoryManager.js` 保留为门面（façade），**完整保留 apps/test.js 已调用的公开方法签名**。存储后端仍是 Yunzai 全局 `redis`，但每群存 4 个紧凑 JSON 文档（entities/alias/facts/meta），消除 N+1 与膨胀字段。AI 只在代码安全边界内做"分类+路由+抽取+权威标注"，脏数据由确定性代码挡在门外。

**Tech Stack:** Node v24 ESM、Yunzai 全局 `redis`、`node:test` + `node:assert`（零依赖单测，注入 fake redis）、现有 `fetch` 调用记忆 AI。

**Spec:** `docs/superpowers/specs/2026-06-18-memory-system-redesign-design.md`

---

## 文件结构（决定分解边界）

```
utils/memory/
  constants.js        — 权威分级、路由枚举、上限常量、normalize 工具
  entityModel.js      — Entity/Alias/Fact 形状 + 规范化 + 瘦身 + 合并
  conflictResolver.js — 来源权威分级裁决
  boundary.js         — 确定性安全过滤（tool/system/low-signal）
  redisStore.js       — 每群 4 文档读写（注入式 redis 客户端）
  aliasRegistry.js    — 别名解析 + 带冲突检测写入
  extractor.js        — AI 批量分类+路由+抽取（LLM）+ 结构化校验
  retriever.js        — 构建注入 prompt（用户实体 / 群事实 / 别名）
  MemoryManager.js    — (位于 utils/) 门面，编排上述模块，保留公开 API

tests/memory/
  *.test.js           — 各模块 node:test 单测 + fakeRedis 夹具
```

设计原则：每文件单一职责、200–400 行；`redis` 客户端注入以便单测。

---

## 测试约定（全计划通用）

- 运行单个测试文件：`node --test tests/memory/<name>.test.js`
- 运行全部记忆测试：`node --test tests/memory/`
- 不依赖真实 Redis：单测用内存 `fakeRedis`（Task 1 提供）。
- 提交粒度：每个 Task 末尾一次提交。

---

## Phase 0 — 脚手架与测试夹具

### Task 1: 测试夹具 fakeRedis + 目录

**Files:**
- Create: `tests/memory/helpers/fakeRedis.js`
- Create: `tests/memory/helpers/fakeRedis.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/memory/helpers/fakeRedis.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeRedis } from './fakeRedis.js'

test('fakeRedis get/set/del round-trips strings', async () => {
  const r = createFakeRedis()
  assert.equal(await r.get('k'), null)
  await r.set('k', 'v')
  assert.equal(await r.get('k'), 'v')
  await r.del('k')
  assert.equal(await r.get('k'), null)
})

test('fakeRedis set with {EX} keeps value (ttl ignored in tests)', async () => {
  const r = createFakeRedis()
  await r.set('k', 'v', { EX: 60 })
  assert.equal(await r.get('k'), 'v')
})

test('fakeRedis scanIterator yields matching keys', async () => {
  const r = createFakeRedis()
  await r.set('ytbot:mem:g:1:entities', '{}')
  await r.set('ytbot:mem:g:1:alias', '{}')
  await r.set('other', 'x')
  const seen = []
  for await (const key of r.scanIterator({ MATCH: 'ytbot:mem:g:1:*' })) seen.push(key)
  assert.deepEqual(seen.sort(), ['ytbot:mem:g:1:alias', 'ytbot:mem:g:1:entities'])
})
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test tests/memory/helpers/fakeRedis.test.js`
Expected: FAIL（`Cannot find module './fakeRedis.js'`）

- [ ] **Step 3: 实现 fakeRedis**

```js
// tests/memory/helpers/fakeRedis.js
function matchToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

export function createFakeRedis(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    _store: store,
    async get(key) {
      return store.has(key) ? store.get(key) : null
    },
    async set(key, value) {
      store.set(key, String(value))
    },
    async del(...keys) {
      for (const key of keys.flat()) store.delete(key)
    },
    async keys(pattern) {
      const re = matchToRegExp(pattern)
      return [...store.keys()].filter(k => re.test(k))
    },
    async *scanIterator({ MATCH = '*' } = {}) {
      const re = matchToRegExp(MATCH)
      for (const key of [...store.keys()]) {
        if (re.test(key)) yield key
      }
    }
  }
}
```

注：`set` 第三参（TTL）在测试中可忽略，故签名只取 `(key,value)`；真实 redis 的 TTL 由 redisStore 用 try/catch 多语法兼容（Task 6）。

- [ ] **Step 4: 运行验证通过**

Run: `node --test tests/memory/helpers/fakeRedis.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: 提交**

```bash
git add tests/memory/helpers/fakeRedis.js tests/memory/helpers/fakeRedis.test.js
git commit -m "test: add fakeRedis fixture for memory unit tests"
```

---

## Phase 1 — 常量与数据模型（纯逻辑）

### Task 2: constants.js（权威分级 / 路由 / normalize）

**Files:**
- Create: `utils/memory/constants.js`
- Test: `tests/memory/constants.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/memory/constants.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUTHORITY_RANK, ROUTES, normalizeAlias, clamp, compactText } from '../../utils/memory/constants.js'

test('authority rank ordering config>self>teaching>mention', () => {
  assert.ok(AUTHORITY_RANK.config > AUTHORITY_RANK.self)
  assert.ok(AUTHORITY_RANK.self > AUTHORITY_RANK.teaching)
  assert.ok(AUTHORITY_RANK.teaching > AUTHORITY_RANK.mention)
})

test('unknown authority ranks lowest (0)', () => {
  assert.equal(AUTHORITY_RANK.bogus ?? 0, 0)
})

test('ROUTES contains the five routes', () => {
  assert.deepEqual([...ROUTES].sort(), ['explicit_teaching','group_consensus','ordinary_chat','self_statement','user_preference'].sort())
})

test('normalizeAlias lowercases and strips punctuation/space', () => {
  assert.equal(normalizeAlias('  Maela! '), 'maela')
  assert.equal(normalizeAlias('希洛（QQ）'), '希洛qq')
})

test('clamp bounds to [0,1] by default', () => {
  assert.equal(clamp(2), 1)
  assert.equal(clamp(-1), 0)
  assert.equal(clamp('x', 0, 1), 0)
})

test('compactText collapses whitespace and truncates', () => {
  assert.equal(compactText('a   b\n c'), 'a b c')
  assert.equal(compactText('abcdef', 3), 'abc')
})
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test tests/memory/constants.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 constants.js**

```js
// utils/memory/constants.js
export const AUTHORITY_RANK = Object.freeze({ mention: 1, teaching: 2, self: 3, config: 4 })

export const ROUTES = new Set([
  'explicit_teaching',
  'self_statement',
  'user_preference',
  'group_consensus',
  'ordinary_chat'
])

export const KEY = Object.freeze({
  entities: groupId => `ytbot:mem:g:${groupId}:entities`,
  alias:    groupId => `ytbot:mem:g:${groupId}:alias`,
  facts:    groupId => `ytbot:mem:g:${groupId}:facts`,
  meta:     groupId => `ytbot:mem:g:${groupId}:meta`,
  prefix:   groupId => `ytbot:mem:g:${groupId}:`
})

export function authorityRank(authority) {
  return AUTHORITY_RANK[authority] ?? 0
}

export function clamp(value, min = 0, max = 1) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

export function normalizeAlias(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}一-龥]+/gu, '')
    .trim()
}

export function compactText(text, maxLength = 240) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test tests/memory/constants.test.js`
Expected: PASS（6 tests）

- [ ] **Step 5: 提交**

```bash
git add utils/memory/constants.js tests/memory/constants.test.js
git commit -m "feat(memory): add constants, authority ranks, normalize helpers"
```

---

### Task 3: entityModel.js（形状 + 瘦身 + 合并）

**Files:**
- Create: `utils/memory/entityModel.js`
- Test: `tests/memory/entityModel.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/memory/entityModel.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeEntity, makeAlias, makeFact, slimEntityDoc } from '../../utils/memory/entityModel.js'

test('makeAlias produces slim shape, no bloat fields', () => {
  const a = makeAlias({ text: 'Maela', authority: 'teaching', confidence: 0.9, by: ['1','1'], at: 100 })
  assert.deepEqual(Object.keys(a).sort(), ['at','authority','by','confidence','superseded','text'].sort())
  assert.deepEqual(a.by, ['1']) // deduped
  assert.equal(a.superseded, false)
})

test('makeFact drops sourceMessageIds/embedding/score bloat', () => {
  const f = makeFact({ text: 'likes 原神', tags: ['偏好'], refs: ['2'], authority: 'self', confidence: 0.8, at: 1,
    sourceMessageIds: ['x'], embedding: [1,2], score: 0.5, relevance: 0.3 })
  assert.deepEqual(Object.keys(f).sort(), ['at','authority','confidence','refs','superseded','tags','text'].sort())
})

test('makeEntity normalizes qq to string|null and defaults arrays', () => {
  const e = makeEntity({ qq: 123 })
  assert.equal(e.qq, '123')
  assert.deepEqual(e.aliases, [])
  assert.deepEqual(e.facts, [])
  const e2 = makeEntity({})
  assert.equal(e2.qq, null)
})

test('slimEntityDoc strips legacy/transient fields from loaded data', () => {
  const dirty = { '1': { qq: '1', canonicalName: 'A', aliases: [], facts: [
    { text: 't', authority: 'self', confidence: 0.7, at: 1, tags: [], refs: [], relevance: 0.9, score: 0.5, sourceMessageIds: ['z'] }
  ], updatedAt: 1, relationshipScore: 0.6 } }
  const clean = slimEntityDoc(dirty)
  assert.equal(clean['1'].relationshipScore, undefined)
  assert.equal(clean['1'].facts[0].relevance, undefined)
  assert.equal(clean['1'].facts[0].sourceMessageIds, undefined)
})
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test tests/memory/entityModel.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 entityModel.js**

```js
// utils/memory/entityModel.js
import { clamp, compactText } from './constants.js'

function uniqStrings(values = []) {
  return [...new Set((values || [])
    .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
    .map(String))]
}

export function makeAlias(input = {}) {
  return {
    text: compactText(input.text, 64),
    authority: input.authority || 'mention',
    confidence: clamp(input.confidence ?? 0.7),
    by: uniqStrings(input.by),
    at: Number(input.at) || 0,
    superseded: input.superseded === true
  }
}

export function makeFact(input = {}) {
  return {
    text: compactText(input.text, 240),
    tags: uniqStrings(input.tags),
    refs: uniqStrings(input.refs),
    authority: input.authority || 'mention',
    confidence: clamp(input.confidence ?? 0.7),
    at: Number(input.at) || 0,
    superseded: input.superseded === true
  }
}

export function makeEntity(input = {}) {
  return {
    qq: input.qq === undefined || input.qq === null || input.qq === '' ? null : String(input.qq),
    canonicalName: compactText(input.canonicalName, 64) || null,
    aliases: Array.isArray(input.aliases) ? input.aliases.map(makeAlias) : [],
    facts: Array.isArray(input.facts) ? input.facts.map(makeFact) : [],
    updatedAt: Number(input.updatedAt) || 0
  }
}

export function slimEntityDoc(doc = {}) {
  const out = {}
  for (const [id, entity] of Object.entries(doc || {})) {
    out[id] = makeEntity(entity)
  }
  return out
}

export function slimGroupFacts(facts = []) {
  return (Array.isArray(facts) ? facts : []).map(makeFact)
}
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test tests/memory/entityModel.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: 提交**

```bash
git add utils/memory/entityModel.js tests/memory/entityModel.test.js
git commit -m "feat(memory): entity/alias/fact model with slimming (drops bloat fields)"
```

---

## Phase 2 — 冲突裁决

### Task 4: conflictResolver.js（来源权威分级）

**Files:**
- Create: `utils/memory/conflictResolver.js`
- Test: `tests/memory/conflictResolver.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/memory/conflictResolver.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveClaim } from '../../utils/memory/conflictResolver.js'

const A = { authority: 'mention', at: 100, by: ['x'] }   // 路人指认
const B = { authority: 'self', at: 50, by: ['y'] }        // 本人自述（更旧但更权威）

test('higher authority wins regardless of recency', () => {
  const r = resolveClaim(A, B)
  assert.equal(r.winner, B)
  assert.equal(r.changed, true)
})

test('same authority -> most recent wins', () => {
  const older = { authority: 'teaching', at: 10, by: ['a'] }
  const newer = { authority: 'teaching', at: 20, by: ['b'] }
  assert.equal(resolveClaim(older, newer).winner, newer)
})

test('same authority same time -> more supporters (by) wins', () => {
  const few = { authority: 'mention', at: 5, by: ['a'] }
  const many = { authority: 'mention', at: 5, by: ['a','b'] }
  assert.equal(resolveClaim(few, many).winner, many)
})

test('incoming equal-or-weaker than existing keeps existing, changed=false', () => {
  const existing = { authority: 'self', at: 100, by: ['a'] }
  const incoming = { authority: 'mention', at: 200, by: ['b'] }
  const r = resolveClaim(existing, incoming)
  assert.equal(r.winner, existing)
  assert.equal(r.changed, false)
})

test('no existing -> incoming wins, changed=true', () => {
  const incoming = { authority: 'mention', at: 1, by: [] }
  const r = resolveClaim(null, incoming)
  assert.equal(r.winner, incoming)
  assert.equal(r.changed, true)
})
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test tests/memory/conflictResolver.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 conflictResolver.js**

```js
// utils/memory/conflictResolver.js
import { authorityRank } from './constants.js'

// 比较两个声明（{authority, at, by[]}）。返回 {winner, loser, changed}
// changed=true 表示 incoming 赢了已有的 existing（调用方需更新存储）。
export function resolveClaim(existing, incoming) {
  if (!existing) return { winner: incoming, loser: null, changed: true }
  if (!incoming) return { winner: existing, loser: null, changed: false }

  const incomingStronger = isStronger(incoming, existing)
  if (incomingStronger) return { winner: incoming, loser: existing, changed: true }
  return { winner: existing, loser: incoming, changed: false }
}

function isStronger(a, b) {
  const ra = authorityRank(a.authority)
  const rb = authorityRank(b.authority)
  if (ra !== rb) return ra > rb
  const ta = Number(a.at) || 0
  const tb = Number(b.at) || 0
  if (ta !== tb) return ta > tb
  const ca = Array.isArray(a.by) ? a.by.length : 0
  const cb = Array.isArray(b.by) ? b.by.length : 0
  return ca > cb // 严格大于：相等时不替换（保留 existing）
}
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test tests/memory/conflictResolver.test.js`
Expected: PASS（5 tests）

- [ ] **Step 5: 提交**

```bash
git add utils/memory/conflictResolver.js tests/memory/conflictResolver.test.js
git commit -m "feat(memory): source-authority conflict resolver"
```

---

## Phase 3 — 安全边界（确定性）

### Task 5: boundary.js（tool/system/low-signal 过滤）

**Files:**
- Create: `utils/memory/boundary.js`
- Test: `tests/memory/boundary.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/memory/boundary.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyBoundary } from '../../utils/memory/boundary.js'

test('tool/system feedback -> drop', () => {
  assert.equal(classifyBoundary('[tool_result] 调用结果: ok').verdict, 'drop')
  assert.equal(classifyBoundary('系统反馈信息：工具已全部执行完成').verdict, 'drop')
})

test('pure interjections / too short -> drop', () => {
  assert.equal(classifyBoundary('哈哈哈').verdict, 'drop')
  assert.equal(classifyBoundary('ok').verdict, 'drop')
  assert.equal(classifyBoundary(' 嗯 ').verdict, 'drop')
})

test('substantive message -> candidate', () => {
  assert.equal(classifyBoundary('记住，maela 是 @3188163302').verdict, 'candidate')
  assert.equal(classifyBoundary('我叫咖啡大人').verdict, 'candidate')
})

test('empty -> drop with reason', () => {
  const r = classifyBoundary('')
  assert.equal(r.verdict, 'drop')
  assert.equal(typeof r.reason, 'string')
})
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test tests/memory/boundary.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 boundary.js**

```js
// utils/memory/boundary.js
const TOOL_MARKERS = [
  '[tool_request]', '[tool_result]', '[tool_execution]',
  '系统反馈信息', '工具已全部执行完成', '此处为调用工具的结果',
  '调用工具:', '调用结果:', 'tool_calls', "role: 'tool'", 'role: "tool"'
]

const LOW_SIGNAL_RE = /^(哈+|哈哈+|啊+|哦+|嗯+|额+|呃+|好+|好的|收到|行吧|可以|牛+|草+|笑死|离谱|6+|ok|okay)$/i

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}一-龥]+/gu, '').trim()
}

// 返回 {verdict:'drop'|'candidate', reason}
export function classifyBoundary(content) {
  const text = String(content || '').trim()
  if (!text) return { verdict: 'drop', reason: 'empty' }
  if (TOOL_MARKERS.some(m => text.includes(m))) return { verdict: 'drop', reason: 'tool/system' }
  const norm = normalize(text)
  if (norm.length < 3) return { verdict: 'drop', reason: 'too-short' }
  if (LOW_SIGNAL_RE.test(text)) return { verdict: 'drop', reason: 'low-signal' }
  return { verdict: 'candidate', reason: 'ok' }
}

export function isToolOrSystem(content) {
  return TOOL_MARKERS.some(m => String(content || '').includes(m))
}
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test tests/memory/boundary.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: 提交**

```bash
git add utils/memory/boundary.js tests/memory/boundary.test.js
git commit -m "feat(memory): deterministic boundary filter for tool/system/low-signal"
```

---

## Phase 4 — Redis 存储（注入式客户端）

### Task 6: redisStore.js（每群 4 文档读写）

**Files:**
- Create: `utils/memory/redisStore.js`
- Test: `tests/memory/redisStore.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/memory/redisStore.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeRedis } from './helpers/fakeRedis.js'
import { RedisStore } from '../../utils/memory/redisStore.js'

test('entities round-trip + slimming on read', async () => {
  const redis = createFakeRedis()
  const store = new RedisStore({ redis })
  await store.saveEntities('g1', { '1': { qq: '1', canonicalName: 'A', aliases: [], facts: [], updatedAt: 5 } })
  const loaded = await store.getEntities('g1')
  assert.equal(loaded['1'].canonicalName, 'A')
})

test('missing docs return empty defaults', async () => {
  const store = new RedisStore({ redis: createFakeRedis() })
  assert.deepEqual(await store.getEntities('gX'), {})
  assert.deepEqual(await store.getAlias('gX'), {})
  assert.deepEqual(await store.getFacts('gX'), [])
  const meta = await store.getMeta('gX')
  assert.equal(meta.disabled, false)
  assert.equal(meta.failureCount, 0)
})

test('clearGroup deletes all four docs', async () => {
  const redis = createFakeRedis()
  const store = new RedisStore({ redis })
  await store.saveEntities('g1', { a: { qq: 'a', aliases: [], facts: [] } })
  await store.saveAlias('g1', { x: { qq: 'a', authority: 'self', confidence: 1, at: 0 } })
  await store.saveFacts('g1', [{ text: 't', authority: 'self', confidence: 1, at: 0, tags: [], refs: [] }])
  await store.saveMeta('g1', { disabled: true })
  const n = await store.clearGroup('g1')
  assert.ok(n >= 1)
  assert.deepEqual(await store.getEntities('g1'), {})
  assert.deepEqual(await store.getAlias('g1'), {})
})
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test tests/memory/redisStore.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 redisStore.js**

```js
// utils/memory/redisStore.js
import { KEY } from './constants.js'
import { slimEntityDoc, slimGroupFacts } from './entityModel.js'

function safeParse(raw, fallback) {
  if (!raw) return fallback
  try { return JSON.parse(raw) } catch { return fallback }
}

const DEFAULT_META = { disabled: false, lastExtractAt: 0, nextRetryAt: 0, failureCount: 0 }

export class RedisStore {
  // 注入 redis 以便单测；生产默认用全局 redis
  constructor({ redis = globalThis.redis } = {}) {
    this.redis = redis
  }

  async _setRaw(key, value) {
    await this.redis.set(key, value)
  }

  async _getJson(key, fallback) {
    return safeParse(await this.redis.get(key), fallback)
  }

  async getEntities(groupId) {
    return slimEntityDoc(await this._getJson(KEY.entities(groupId), {}))
  }
  async saveEntities(groupId, doc) {
    await this._setRaw(KEY.entities(groupId), JSON.stringify(slimEntityDoc(doc)))
  }

  async getAlias(groupId) {
    return await this._getJson(KEY.alias(groupId), {}) || {}
  }
  async saveAlias(groupId, doc) {
    await this._setRaw(KEY.alias(groupId), JSON.stringify(doc || {}))
  }

  async getFacts(groupId) {
    return slimGroupFacts(await this._getJson(KEY.facts(groupId), []))
  }
  async saveFacts(groupId, facts) {
    await this._setRaw(KEY.facts(groupId), JSON.stringify(slimGroupFacts(facts)))
  }

  async getMeta(groupId) {
    return { ...DEFAULT_META, ...(await this._getJson(KEY.meta(groupId), {}) || {}) }
  }
  async saveMeta(groupId, meta) {
    await this._setRaw(KEY.meta(groupId), JSON.stringify({ ...DEFAULT_META, ...(meta || {}) }))
  }

  async clearGroup(groupId) {
    const keys = [KEY.entities(groupId), KEY.alias(groupId), KEY.facts(groupId), KEY.meta(groupId)]
    for (const k of keys) await this.redis.del(k)
    return keys.length
  }
}
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test tests/memory/redisStore.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: 提交**

```bash
git add utils/memory/redisStore.js tests/memory/redisStore.test.js
git commit -m "feat(memory): per-group 4-document Redis store with injectable client"
```

---

## Phase 5 — 别名注册表

### Task 7: aliasRegistry.js（解析 + 带冲突写入）

**Files:**
- Create: `utils/memory/aliasRegistry.js`
- Test: `tests/memory/aliasRegistry.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/memory/aliasRegistry.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { upsertAlias, resolveAlias } from '../../utils/memory/aliasRegistry.js'

test('upsert new alias adds entry', () => {
  const doc = {}
  const out = upsertAlias(doc, { text: 'Maela', qq: '3188163302', authority: 'teaching', confidence: 0.9, by: ['925640859'], at: 10 })
  assert.equal(out.changed, true)
  assert.equal(out.doc['maela'].qq, '3188163302')
})

test('self-statement beats mention for same alias -> different QQ', () => {
  let doc = upsertAlias({}, { text: '希洛', qq: '3188163302', authority: 'mention', confidence: 0.8, by: ['x'], at: 5 }).doc
  const out = upsertAlias(doc, { text: '希洛', qq: '925640859', authority: 'self', confidence: 0.9, by: ['925640859'], at: 6 })
  assert.equal(out.changed, true)
  assert.equal(out.doc['希洛'].qq, '925640859') // self wins
})

test('weaker incoming for same alias->different QQ is rejected', () => {
  let doc = upsertAlias({}, { text: '希洛', qq: '925640859', authority: 'self', confidence: 0.9, by: ['925640859'], at: 6 }).doc
  const out = upsertAlias(doc, { text: '希洛', qq: '3188163302', authority: 'mention', confidence: 0.8, by: ['x'], at: 99 })
  assert.equal(out.changed, false)
  assert.equal(out.doc['希洛'].qq, '925640859')
})

test('same QQ re-statement merges supporters and bumps recency', () => {
  let doc = upsertAlias({}, { text: 'maela', qq: '1', authority: 'teaching', confidence: 0.9, by: ['a'], at: 1 }).doc
  const out = upsertAlias(doc, { text: 'maela', qq: '1', authority: 'teaching', confidence: 0.9, by: ['b'], at: 2 })
  assert.deepEqual(out.doc['maela'].by.sort(), ['a','b'])
  assert.equal(out.doc['maela'].at, 2)
})

test('resolveAlias is case/punct-insensitive', () => {
  const doc = upsertAlias({}, { text: 'Maela', qq: '1', authority: 'self', confidence: 1, by: [], at: 0 }).doc
  assert.equal(resolveAlias(doc, ' maela! ')?.qq, '1')
  assert.equal(resolveAlias(doc, 'unknown'), null)
})
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test tests/memory/aliasRegistry.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 aliasRegistry.js**

```js
// utils/memory/aliasRegistry.js
import { normalizeAlias, clamp } from './constants.js'
import { resolveClaim } from './conflictResolver.js'

function uniq(values = []) {
  return [...new Set((values || []).filter(Boolean).map(String))]
}

// doc: { [normAlias]: {qq, authority, confidence, at, by[], display} }
// claim: {text, qq, authority, confidence, by[], at}
// 返回 {doc, changed}
export function upsertAlias(doc, claim) {
  const key = normalizeAlias(claim.text)
  if (!key || !claim.qq) return { doc, changed: false }

  const next = { ...(doc || {}) }
  const existing = next[key]
  const incoming = {
    qq: String(claim.qq),
    authority: claim.authority || 'mention',
    confidence: clamp(claim.confidence ?? 0.7),
    at: Number(claim.at) || 0,
    by: uniq(claim.by),
    display: claim.text
  }

  // 同 QQ：合并 by / 取较新 / 取较高 confidence
  if (existing && existing.qq === incoming.qq) {
    next[key] = {
      ...existing,
      confidence: Math.max(existing.confidence ?? 0, incoming.confidence),
      at: Math.max(existing.at ?? 0, incoming.at),
      by: uniq([...(existing.by || []), ...incoming.by]),
      authority: incoming.authority && incoming.authority !== existing.authority
        ? pickStrongerAuthority(existing.authority, incoming.authority)
        : existing.authority,
      display: incoming.display || existing.display
    }
    return { doc: next, changed: true }
  }

  // 不同 QQ 或不存在：权威分级裁决
  const { winner, changed } = resolveClaim(existing || null, incoming)
  if (!changed) return { doc: next, changed: false }
  next[key] = winner
  return { doc: next, changed: true }
}

function pickStrongerAuthority(a, b) {
  return resolveClaim({ authority: a, at: 0, by: [] }, { authority: b, at: 0, by: [] }).winner.authority
}

export function resolveAlias(doc, text) {
  const key = normalizeAlias(text)
  if (!key) return null
  return (doc && doc[key]) || null
}

export function listAliasesForQQ(doc, qq) {
  const target = String(qq)
  return Object.entries(doc || {})
    .filter(([, v]) => v.qq === target)
    .map(([key, v]) => ({ key, ...v }))
}
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test tests/memory/aliasRegistry.test.js`
Expected: PASS（5 tests）

- [ ] **Step 5: 提交**

```bash
git add utils/memory/aliasRegistry.js tests/memory/aliasRegistry.test.js
git commit -m "feat(memory): structured alias registry with authority-based conflict detection"
```

---

## Phase 6 — AI 抽取（分类+路由+权威）

### Task 8: extractor.js — 结构化解析与路由（不含网络）

**Files:**
- Create: `utils/memory/extractor.js`
- Test: `tests/memory/extractor.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/memory/extractor.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAndRoute } from '../../utils/memory/extractor.js'

const ctx = { speakerQQ: '925640859', at: 1000 }

test('explicit_teaching with alias+targetQQ -> alias op authority teaching', () => {
  const ops = parseAndRoute([
    { route: 'explicit_teaching', alias: 'maela', targetQQ: '3188163302', confidence: 0.9 }
  ], ctx)
  assert.equal(ops.length, 1)
  assert.equal(ops[0].stream, 'alias')
  assert.equal(ops[0].authority, 'teaching')
  assert.equal(ops[0].qq, '3188163302')
  assert.equal(ops[0].text, 'maela')
})

test('self_statement name -> speaker alias authority self', () => {
  const ops = parseAndRoute([
    { route: 'self_statement', alias: '咖啡大人', confidence: 0.9 }
  ], ctx)
  assert.equal(ops[0].stream, 'alias')
  assert.equal(ops[0].authority, 'self')
  assert.equal(ops[0].qq, '925640859') // attaches to speaker
})

test('user_preference -> speaker entity fact tag 偏好', () => {
  const ops = parseAndRoute([
    { route: 'user_preference', content: '不喜欢被叫全名', confidence: 0.8 }
  ], ctx)
  assert.equal(ops[0].stream, 'entityFact')
  assert.equal(ops[0].qq, '925640859')
  assert.ok(ops[0].fact.tags.includes('偏好'))
})

test('group_consensus -> group fact authority mention', () => {
  const ops = parseAndRoute([
    { route: 'group_consensus', content: '群里不要刷屏', tags: ['群规'], confidence: 0.8 }
  ], ctx)
  assert.equal(ops[0].stream, 'groupFact')
  assert.equal(ops[0].authority, 'mention')
})

test('ordinary_chat and unknown routes are dropped', () => {
  const ops = parseAndRoute([
    { route: 'ordinary_chat', content: '哈哈' },
    { route: 'bogus', content: 'x' },
    null,
    { route: 'self_statement' } // no alias/content
  ], ctx)
  assert.equal(ops.length, 0)
})
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test tests/memory/extractor.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 extractor.js（解析/路由部分）**

```js
// utils/memory/extractor.js
import { ROUTES, clamp, compactText } from './constants.js'
import { makeFact } from './entityModel.js'

// 把 AI 输出的结构化数组映射为存储操作。纯函数，无网络。
// item: {route, alias?, targetQQ?, content?, tags?, refs?, confidence?}
// ctx: {speakerQQ, at}
export function parseAndRoute(items, ctx = {}) {
  const ops = []
  const at = Number(ctx.at) || 0
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue
    const route = ROUTES.has(item.route) ? item.route : null
    if (!route || route === 'ordinary_chat') continue
    const confidence = clamp(item.confidence ?? 0.7)

    if (route === 'explicit_teaching') {
      const alias = compactText(item.alias, 64)
      if (alias && item.targetQQ) {
        ops.push({ stream: 'alias', qq: String(item.targetQQ), text: alias, authority: 'teaching', confidence, by: [String(ctx.speakerQQ || '')].filter(Boolean), at })
      } else {
        const text = compactText(item.content, 240)
        if (text) ops.push({ stream: 'groupFact', authority: 'teaching', fact: makeFact({ text, tags: item.tags, refs: item.refs, authority: 'teaching', confidence, at }) })
      }
      continue
    }

    if (route === 'self_statement') {
      const alias = compactText(item.alias, 64)
      if (alias && ctx.speakerQQ) {
        ops.push({ stream: 'alias', qq: String(ctx.speakerQQ), text: alias, authority: 'self', confidence, by: [String(ctx.speakerQQ)], at })
      } else {
        const text = compactText(item.content, 240)
        if (text && ctx.speakerQQ) ops.push({ stream: 'entityFact', qq: String(ctx.speakerQQ), authority: 'self', fact: makeFact({ text, tags: item.tags, refs: item.refs, authority: 'self', confidence, at }) })
      }
      continue
    }

    if (route === 'user_preference') {
      const text = compactText(item.content, 240)
      if (text && ctx.speakerQQ) {
        const tags = [...new Set(['偏好', ...(item.tags || [])])]
        ops.push({ stream: 'entityFact', qq: String(ctx.speakerQQ), authority: 'self', fact: makeFact({ text, tags, refs: item.refs, authority: 'self', confidence, at }) })
      }
      continue
    }

    if (route === 'group_consensus') {
      const text = compactText(item.content, 240)
      if (text) ops.push({ stream: 'groupFact', authority: 'mention', fact: makeFact({ text, tags: item.tags, refs: item.refs, authority: 'mention', confidence, at }) })
      continue
    }
  }
  return ops
}
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test tests/memory/extractor.test.js`
Expected: PASS（5 tests）

- [ ] **Step 5: 提交**

```bash
git add utils/memory/extractor.js tests/memory/extractor.test.js
git commit -m "feat(memory): structured extraction routing (route->stream+authority)"
```

---

### Task 9: extractor.js — LLM 调用 + 抽取 prompt

**Files:**
- Modify: `utils/memory/extractor.js`（追加 `MemoryExtractor` 类）
- Test: `tests/memory/extractorLlm.test.js`

- [ ] **Step 1: 写失败测试（注入 fake chat 函数）**

```js
// tests/memory/extractorLlm.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryExtractor } from '../../utils/memory/extractor.js'

test('extract returns [] when memory AI not configured', async () => {
  const ex = new MemoryExtractor({ memoryAiConfig: null })
  const ops = await ex.extract({ groupId: 'g', speakerQQ: '1', messages: [{ content: '我叫A' }], at: 1 })
  assert.deepEqual(ops, [])
})

test('extract parses fenced JSON array from chat response', async () => {
  const ex = new MemoryExtractor({ memoryAiConfig: { memoryAiUrl: 'u', memoryAiApikey: 'k' } })
  ex._callChat = async () => '```json\n[{"route":"self_statement","alias":"咖啡大人","confidence":0.9}]\n```'
  const ops = await ex.extract({ groupId: 'g', speakerQQ: '925640859', messages: [{ content: '以后叫我咖啡大人' }], at: 5 })
  assert.equal(ops.length, 1)
  assert.equal(ops[0].stream, 'alias')
  assert.equal(ops[0].qq, '925640859')
})

test('malformed chat response -> []', async () => {
  const ex = new MemoryExtractor({ memoryAiConfig: { memoryAiUrl: 'u', memoryAiApikey: 'k' } })
  ex._callChat = async () => 'sorry I cannot'
  const ops = await ex.extract({ groupId: 'g', speakerQQ: '1', messages: [{ content: 'x' }], at: 1 })
  assert.deepEqual(ops, [])
})
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test tests/memory/extractorLlm.test.js`
Expected: FAIL（`MemoryExtractor is not a constructor`）

- [ ] **Step 3: 追加 MemoryExtractor 到 extractor.js**

在 `utils/memory/extractor.js` 末尾追加：

```js
function extractJsonArray(text) {
  const raw = String(text || '')
  const match = raw.match(/\[[\s\S]*\]/)
  try {
    const parsed = JSON.parse(match ? match[0] : raw)
    return Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : [])
  } catch { return [] }
}

const SYSTEM_PROMPT = `你是群聊长期记忆抽取器。对每条真实用户发言，分类并抽取结构化结果，只输出 JSON 数组，不要解释。
每个元素字段：
- route: explicit_teaching | self_statement | user_preference | group_consensus | ordinary_chat
- alias: 当 route 是 explicit_teaching/self_statement 且涉及"外号/称呼"时给出别名文本
- targetQQ: explicit_teaching 中"A 是 @某人"的某人 QQ（纯数字）
- content: self_statement(非别名)/user_preference/group_consensus 的事实文本
- tags: 可选轻量标签数组（如 职业/关系/群规/梗/偏好）
- confidence: 0~1
规则：
- 工具结果/系统提示/机器人回复/纯语气词 -> route=ordinary_chat（会被丢弃）。
- 只有"本人在说自己"才用 self_statement；指认他人用 explicit_teaching。
- 普通闲聊/临时请求 -> ordinary_chat。
- 无可抽取内容时输出 []。`

export class MemoryExtractor {
  constructor(config = {}) {
    this.config = config
  }

  canUse() {
    const c = this.config.memoryAiConfig || {}
    return Boolean(c.memoryAiUrl && c.memoryAiApikey)
  }

  async _callChat(messages, maxTokens = 800) {
    const c = this.config.memoryAiConfig || {}
    const res = await fetch(c.memoryAiUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.memoryAiApikey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: c.memoryAiModel || 'gpt-4o-mini', messages, temperature: 0.2, max_tokens: maxTokens })
    })
    if (!res.ok) throw new Error(`记忆 AI 请求失败：${res.status}`)
    const data = await res.json()
    return data?.choices?.[0]?.message?.content?.trim() || '[]'
  }

  // 返回 parseAndRoute 的 ops 数组
  async extract({ groupId, speakerQQ, messages, existingHint = '', at }) {
    if (!this.canUse()) return []
    const chatText = (messages || []).map((m, i) => `${i + 1}. ${m.content}`).join('\n')
    const userPrompt = `群 ${groupId} 发言人 QQ ${speakerQQ} 的发言：\n${chatText}\n\n已有记忆参考：\n${existingHint || '无'}\n\n请输出 JSON 数组。`
    let content
    try {
      content = await this._callChat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ])
    } catch {
      return []
    }
    return parseAndRoute(extractJsonArray(content), { speakerQQ, at })
  }
}
```

注意：`extract` 内部引用了同文件已 export 的 `parseAndRoute`，无需额外 import。

- [ ] **Step 4: 运行验证通过**

Run: `node --test tests/memory/extractorLlm.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: 提交**

```bash
git add utils/memory/extractor.js tests/memory/extractorLlm.test.js
git commit -m "feat(memory): MemoryExtractor LLM call + structured JSON parsing"
```

---

## Phase 7 — 检索 / 注入

### Task 10: retriever.js（别名/实体/群事实 prompt）

**Files:**
- Create: `utils/memory/retriever.js`
- Test: `tests/memory/retriever.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/memory/retriever.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAliasPrompt, buildEntityPrompt, buildGroupFactsPrompt } from '../../utils/memory/retriever.js'

const aliasDoc = {
  'maela': { qq: '3188163302', authority: 'teaching', confidence: 0.9, at: 2, display: 'maela' },
  '希洛':  { qq: '925640859',  authority: 'self',     confidence: 0.9, at: 1, display: '希洛' }
}

test('buildAliasPrompt lists mappings and is empty when no aliases', () => {
  const p = buildAliasPrompt(aliasDoc, '', 1200)
  assert.ok(p.includes('maela'))
  assert.ok(p.includes('3188163302'))
  assert.equal(buildAliasPrompt({}, '', 1200), '')
})

test('buildAliasPrompt prefers query-matched alias', () => {
  const p = buildAliasPrompt(aliasDoc, 'maela是谁', 1200)
  assert.ok(p.includes('maela'))
})

test('buildEntityPrompt formats name/aliases/facts, skips superseded', () => {
  const entity = { qq: '1', canonicalName: '咖啡大人', aliases: [
      { text: '咖啡', authority: 'self', confidence: 0.9, at: 1, superseded: false },
      { text: '旧名', authority: 'mention', confidence: 0.5, at: 0, superseded: true }
    ], facts: [{ text: '在上海', tags: [], refs: [], authority: 'self', confidence: 0.8, at: 1, superseded: false }] }
  const p = buildEntityPrompt(entity, 1200)
  assert.ok(p.includes('咖啡大人'))
  assert.ok(p.includes('咖啡'))
  assert.ok(!p.includes('旧名'))
  assert.ok(p.includes('在上海'))
})

test('buildGroupFactsPrompt sorts by confidence and caps by chars', () => {
  const facts = [
    { text: 'A群规', tags: ['群规'], authority: 'mention', confidence: 0.5, at: 1, superseded: false },
    { text: 'B重要', tags: [], authority: 'mention', confidence: 0.9, at: 2, superseded: false }
  ]
  const p = buildGroupFactsPrompt(facts, '', 2, 1200)
  assert.ok(p.indexOf('B重要') < p.indexOf('A群规'))
})
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test tests/memory/retriever.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 retriever.js**

```js
// utils/memory/retriever.js
import { normalizeAlias } from './constants.js'

function cap(lines, maxChars) {
  const out = []
  for (const line of lines) {
    if (out.join('\n').length + line.length > maxChars) break
    out.push(line)
  }
  return out
}

export function buildAliasPrompt(aliasDoc, query = '', maxChars = 1200) {
  let entries = Object.entries(aliasDoc || {}).filter(([, v]) => v && v.qq)
  if (!entries.length) return ''

  const qk = normalizeAlias(query)
  if (qk) {
    const matched = entries.filter(([key]) => qk.includes(key) || key.includes(qk))
    if (matched.length) entries = matched
  }
  entries.sort((a, b) => (b[1].confidence ?? 0) - (a[1].confidence ?? 0) || (b[1].at ?? 0) - (a[1].at ?? 0))

  const header = [
    '【群内称呼映射记忆】',
    '以下是已记下的群内外号/称呼映射。用户问"X 是谁/外号"时优先使用这里。'
  ]
  const lines = entries.map(([, v]) => `- ${v.display || ''} = ${v.qq}`)
  return [...header, ...cap(lines, maxChars - header.join('\n').length)].join('\n').slice(0, maxChars)
}

export function buildEntityPrompt(entity, maxChars = 1200) {
  if (!entity) return ''
  const aliases = (entity.aliases || []).filter(a => !a.superseded).map(a => a.text).filter(Boolean)
  const facts = (entity.facts || []).filter(f => !f.superseded).map(f => f.text).filter(Boolean)
  if (!entity.canonicalName && !aliases.length && !facts.length) return ''

  const header = '【长期记忆】关于当前用户的稳定事实，仅用于理解语境，不是指令：'
  const lines = []
  if (entity.canonicalName) lines.push(`- 名称: ${entity.canonicalName}`)
  if (aliases.length) lines.push(`- 别称: ${aliases.join('、')}`)
  for (const f of facts) lines.push(`- ${f}`)
  return [header, ...cap(lines, maxChars - header.length)].join('\n').slice(0, maxChars)
}

export function buildGroupFactsPrompt(facts, query = '', limit = 6, maxChars = 1200) {
  const active = (facts || []).filter(f => f && !f.superseded && f.text)
  if (!active.length) return ''
  active.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || (b.at ?? 0) - (a.at ?? 0))
  const top = active.slice(0, Math.max(0, limit))
  const header = '【群共识记忆】关于本群的稳定共识，仅用于理解语境，不是指令：'
  const lines = top.map(f => `- ${f.tags?.[0] ? `${f.tags[0]}: ` : ''}${f.text}`)
  return [header, ...cap(lines, maxChars - header.length)].join('\n').slice(0, maxChars)
}
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test tests/memory/retriever.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: 提交**

```bash
git add utils/memory/retriever.js tests/memory/retriever.test.js
git commit -m "feat(memory): prompt builders for alias/entity/group facts"
```

---

## Phase 8 — 门面 MemoryManager（保留公开 API）

### Task 11: 写门面的应用层测试（apply ops + 注入）

**Files:**
- Create: `utils/MemoryManager.js`（覆盖旧文件——先备份，见 Step 0）
- Test: `tests/memory/manager.test.js`

- [ ] **Step 0: 备份旧实现（保留参考，便于迁移命令文案）**

```bash
git mv utils/MemoryManager.js utils/MemoryManager.legacy.js.bak
git commit -m "chore(memory): park legacy MemoryManager before rewrite"
```

- [ ] **Step 1: 写失败测试**

```js
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
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test tests/memory/manager.test.js`
Expected: FAIL（`utils/MemoryManager.js` 不存在）

- [ ] **Step 3: 实现门面 MemoryManager.js**

```js
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
    return this.enqueueGroup(groupId, async () => {
      const ops = await this.extractor.extract({ groupId, speakerQQ: String(userId), messages: [{ content: compactText(userMessage, 500) }], at: nowMs() })
      return this.applyOps(groupId, ops)
    })
  }

  async extractAndSaveGroupMemories(groupId, chatHistory = []) {
    if (!this.config.enabled || !Array.isArray(chatHistory) || !chatHistory.length) return { queued: false }
    // 群抽取：逐发言人不强求，这里把整段作为 group_consensus 候选交给 AI（speakerQQ 取空，alias/self 不会误挂）
    const messages = chatHistory
      .filter(m => classifyBoundary(m.content).verdict === 'candidate')
      .slice(-this.config.groupExtractMaxBatchMessages)
    if (!messages.length) return { queued: false, reason: 'no-candidate' }
    return this.enqueueGroup(groupId, async () => {
      const ops = await this.extractor.extract({ groupId, speakerQQ: '', messages, at: nowMs() })
      // 群抽取只接受 groupFact / alias（teaching），过滤掉需要 speaker 的 self/preference
      const safe = ops.filter(op => op.stream === 'groupFact' || (op.stream === 'alias' && op.authority === 'teaching'))
      return this.applyOps(groupId, safe)
    })
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
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test tests/memory/manager.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: 运行全部记忆测试**

Run: `node --test tests/memory/`
Expected: PASS（全部）

- [ ] **Step 6: 提交**

```bash
git add utils/MemoryManager.js tests/memory/manager.test.js
git commit -m "feat(memory): MemoryManager façade orchestrating entity-centric store"
```

---

## Phase 9 — 接入 apps/test.js

> 这些 Task 修改超大文件 `apps/test.js`。每步用 grep 锚定文本而非纯行号（行号会随编辑漂移）。修改后用 `node -c` 做语法自检。

### Task 12: 注入热路径（合并扫描已天然消除，签名不变，无需改）

**Files:**
- Modify: `apps/test.js`（line ~4053-4059 区域，仅核对）

- [ ] **Step 1: 核对调用点仍兼容**

Run: `grep -n "getMemoryPromptForUser\|getGroupMemoryPrompt\|getGroupAliasPrompt" apps/test.js`
Expected: 命中 4053/4056/4059 三行，签名 `(groupId[, userId], query)` 与新门面一致 → **无需修改**。

- [ ] **Step 2: 语法自检**

Run: `node -c apps/test.js`
Expected: 无输出（通过）

- [ ] **Step 3: 提交（空改动跳过；仅记录核对）**

无代码改动，跳过提交。

---

### Task 13: 显式教学改写为别名直喂 + 实例化注入 redis

**Files:**
- Modify: `apps/test.js`（`new MemoryManager(...)` 处；显式教学落库块 line ~5154-5165）

- [ ] **Step 1: 实例化传入 redis（保证门面拿到全局 redis）**

定位（grep）：`memoryManager: new MemoryManager(buildMemoryConfig(config)),`
替换为：

```js
memoryManager: new MemoryManager(buildMemoryConfig(config), { redis: globalThis.redis }),
```

- [ ] **Step 2: 显式教学落库改为 addAliasMapping**

定位（grep）：`formatExplicitTeachingMemoryContent(fact)` 所在 for 循环（line ~5154-5165）。
替换整段为：

```js
const explicitTeachingFacts = Array.isArray(e._explicitTeachingFacts) ? e._explicitTeachingFacts : []
for (const fact of explicitTeachingFacts) {
  if (!fact?.alias || !fact?.targetUserId) continue
  this.memoryManager.addAliasMapping(groupId, {
    alias: fact.alias,
    targetQQ: fact.targetUserId,
    by: [userId].filter(Boolean),
    confidence: 0.95
  }).catch(err => logger.error('[MemoryManager] 保存显式称呼映射失败:', err))
}
```

注：`e._explicitTeachingFacts` 的元素形状为 `{alias, targetUserId, ...}`（由 `extractExplicitTeachingFacts` 产出，见 spec §13.2）。若实际字段名不同，先 `grep -n "buildTeachingFact" apps/test.js` 核对产出键名再适配。

- [ ] **Step 3: 语法自检**

Run: `node -c apps/test.js`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add apps/test.js
git commit -m "refactor(memory): feed explicit teaching directly into alias registry"
```

---

### Task 14: 删除 relationshipScore / updateRelationship 调用

**Files:**
- Modify: `apps/test.js`（情绪→关系块 ~5172-5180；`#记忆状态` 展示 ~5714）

- [ ] **Step 1: 删除情绪→关系块**

定位（grep）：`updateRelationship` 所在 if 块（`const latestEmotionEvent = ...` 到对应 `}`）。整块删除（emotion 本体不依赖它，见 spec §14.1）。

- [ ] **Step 2: 修正 #记忆状态 展示**

定位（grep）：`关系分` 所在行（~5714）。删除该行（adminStatus 已不返回 relationshipScore）。

- [ ] **Step 3: 语法自检**

Run: `node -c apps/test.js && grep -n "updateRelationship\|relationshipScore\|关系分" apps/test.js`
Expected: `node -c` 通过；grep 无残留命中。

- [ ] **Step 4: 提交**

```bash
git add apps/test.js
git commit -m "refactor(memory): remove relationshipScore/updateRelationship (unused, display-only)"
```

---

### Task 15: 适配 admin 命令（删除记忆寻址 + 清群直接调门面）

**Files:**
- Modify: `apps/test.js`（`deleteMemory` ~5802-5831；`clearGroupMemory` 直接 Redis 块 ~5615-5624）

- [ ] **Step 1: #删除记忆 改为 id 前缀寻址**

定位（grep）：`deleteMemory` 处理函数里两处 `adminDeleteMemory`。替换为单次调用：

```js
const id = String(e.msg).replace(/^#删除记忆\s+/, '').trim()
const result = await this.memoryManager.adminDeleteMemory({ groupId: e.group_id, userId: e.user_id, id })
```

并把命令帮助文案更新为：`#删除记忆 alias:<别名>` 或 `#删除记忆 fact:<群事实前缀>`（grep 定位帮助字符串后改）。

- [ ] **Step 2: #清除群记忆 直接 Redis 块改用门面**

定位（grep）：`getGroupRedisKey` 与 `scanRedisKeys(`${prefix}` 所在块（~5615-5624）。替换整块为：

```js
const cleared = await this.memoryManager.clearGroupRedis(e.group_id)
await e.reply(`已清除本群记忆，共 ${cleared} 项存储键。`)
```

- [ ] **Step 3: 语法自检**

Run: `node -c apps/test.js && grep -n "getGroupRedisKey\|REDIS_PREFIX" apps/test.js`
Expected: `node -c` 通过；grep 无残留（旧键访问已移除）。

- [ ] **Step 4: 提交**

```bash
git add apps/test.js
git commit -m "refactor(memory): adapt admin commands (delete by id-prefix, clear via façade)"
```

---

### Task 16: PersonProfileInjector 去重（去掉别名/关系，仅留最近发言）

**Files:**
- Modify: `utils/PersonProfileInjector.js`

- [ ] **Step 1: 删除别名/关系/偏好/备注拼接，保留昵称 + 最近发言**

定位（grep）：`固定称呼/别名` 与 `关系定位/偏好/风格/备注` 所在行。删除这两段拼接（实体注入已覆盖，见 spec §13.1），保留 `昵称: ...(QQ: ...)` 与 `此人最近发言:` 两部分。

- [ ] **Step 2: 语法自检**

Run: `node -c utils/PersonProfileInjector.js`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add utils/PersonProfileInjector.js
git commit -m "refactor(memory): dedupe PersonProfileInjector (entity owns alias/relation now)"
```

---

### Task 17: config seed 接入（identityBindings -> 实体）

**Files:**
- Modify: `apps/test.js`（注入组装处 ~4094 之前，或群上下文初始化处）

- [ ] **Step 1: 在群上下文构建时 seed（每群一次，幂等）**

定位（grep）：`identityBindingsPrompt` 生成处。其后追加一次性 seed（用 `this._seededGroups` Set 防重复）：

```js
if (groupId && this.config.memorySystem?.enabled && this.config.identityBindings?.length) {
  this._seededGroups ??= new Set()
  if (!this._seededGroups.has(groupId)) {
    this._seededGroups.add(groupId)
    this.memoryManager.seedFromConfig(groupId, this.config.identityBindings)
      .catch(err => logger.error('[MemoryManager] config seed 失败:', err))
  }
}
```

- [ ] **Step 2: 语法自检**

Run: `node -c apps/test.js`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add apps/test.js
git commit -m "feat(memory): seed entities from identityBindings config (authority=config)"
```

---

## Phase 10 — 配置精简

### Task 18: Guoba schema + message.yaml 精简

**Files:**
- Modify: `models/Guoba/schemas/memory.js`
- Modify: `config_default/message.yaml`（`memorySystem` 块 ~241-257）

- [ ] **Step 1: message.yaml 改为新字段集**

把 `memorySystem` 块替换为：

```yaml
memorySystem:
  enabled: false
  maxEntitiesPerGroup: 200
  maxFactsPerGroup: 50
  maxFactsPerEntity: 20
  saveStrictness: normal
  userExtractDebounceSeconds: 90
  userExtractMaxBatchMessages: 6
  groupExtractMinIntervalMinutes: 10
  groupExtractMaxBatchMessages: 12
  promptMaxGroupFacts: 6
  promptMaxChars: 1200
```

（删除 maxFactsPerUser/importanceThreshold/aiDecidesImportance/strictCodeFiltering/memoryDecayDays/promptMaxUserFacts/recallMinRelevance/semanticRecall*/minFactsPerCategory。）

- [ ] **Step 2: Guoba memory.js 对齐字段**

把 `models/Guoba/schemas/memory.js` 的字段列表改为与上面 yaml 一致：保留 `enabled`、新增 `maxEntitiesPerGroup/maxFactsPerEntity/saveStrictness`（saveStrictness 用 Select：off/normal/strict），删除上面列出的废弃字段。`memoryAiConfig`/`embeddingAiConfig`（在 aiModels.js）保持不变。

参考保留字段的 InputNumber/Switch 写法照搬原文件同类字段；saveStrictness 用：

```js
{
  field: 'memorySystem.saveStrictness',
  label: '记忆保存严格度',
  component: 'Select',
  bottomHelpMessage: 'off=AI 全权决定；normal=代码边界过滤+AI；strict=最严格过滤',
  componentProps: { options: [
    { label: '宽松(off)', value: 'off' },
    { label: '正常(normal)', value: 'normal' },
    { label: '严格(strict)', value: 'strict' }
  ] }
}
```

- [ ] **Step 3: buildMemoryConfig 对齐（去掉已删字段的兼容代码）**

定位（grep）：`function buildMemoryConfig`（apps/test.js ~1146）。确认它 `...memorySystem` 透传即可；删除对 `groupExtractMinInterval` 旧字段的 fallback（旧字段已不存在）。

- [ ] **Step 4: 语法自检**

Run: `node -c apps/test.js && node -c models/Guoba/schemas/memory.js`
Expected: 通过

- [ ] **Step 5: 提交**

```bash
git add models/Guoba/schemas/memory.js config_default/message.yaml apps/test.js
git commit -m "refactor(memory): slim config (merge filter switches into saveStrictness)"
```

---

## Phase 11 — 清库脚本与收尾

### Task 19: 旧 key 清理脚本（清库重来）

**Files:**
- Create: `scripts/wipe-legacy-memory.js`

- [ ] **Step 1: 写脚本（扫描并删除旧 `ytbot:memory:` 全部键）**

```js
// scripts/wipe-legacy-memory.js
// 用法：在 Yunzai 进程内或具备全局 redis 的环境运行；或 node 直连 redis 后注入。
// 作用：删除旧记忆系统遗留键（ytbot:memory:*，含 v2:*）。新系统用 ytbot:mem:g:*，不受影响。
export async function wipeLegacyMemory(redis = globalThis.redis, { dryRun = true } = {}) {
  const pattern = 'ytbot:memory:*'
  const keys = []
  if (typeof redis.scanIterator === 'function') {
    for await (const k of redis.scanIterator({ MATCH: pattern, COUNT: 200 })) keys.push(...(Array.isArray(k) ? k : [k]))
  } else {
    keys.push(...(await redis.keys(pattern)))
  }
  if (dryRun) return { wouldDelete: keys.length, sample: keys.slice(0, 10) }
  for (const k of keys) await redis.del(k)
  return { deleted: keys.length }
}
```

- [ ] **Step 2: 写测试（fakeRedis）**

```js
// tests/memory/wipeLegacy.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeRedis } from './helpers/fakeRedis.js'
import { wipeLegacyMemory } from '../../scripts/wipe-legacy-memory.js'

test('dryRun reports count without deleting; real run deletes only legacy keys', async () => {
  const r = createFakeRedis()
  await r.set('ytbot:memory:v2:group:1:meta', '{}')
  await r.set('ytbot:memory:981:1:meta', '{}')
  await r.set('ytbot:mem:g:1:entities', '{}') // 新键，不该删
  const dry = await wipeLegacyMemory(r, { dryRun: true })
  assert.equal(dry.wouldDelete, 2)
  assert.equal(await r.get('ytbot:memory:v2:group:1:meta'), '{}')
  const real = await wipeLegacyMemory(r, { dryRun: false })
  assert.equal(real.deleted, 2)
  assert.equal(await r.get('ytbot:mem:g:1:entities'), '{}') // 新键保留
})
```

- [ ] **Step 3: 运行测试**

Run: `node --test tests/memory/wipeLegacy.test.js`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add scripts/wipe-legacy-memory.js tests/memory/wipeLegacy.test.js
git commit -m "feat(memory): legacy-key wipe script (dry-run default)"
```

---

### Task 20: 删除旧实现备份 + 全量测试 + 文档

**Files:**
- Delete: `utils/MemoryManager.legacy.js.bak`
- Modify: `findings.md` 或 `progress.md`（记录重构完成）

- [ ] **Step 1: 删除备份**

```bash
git rm utils/MemoryManager.legacy.js.bak
```

- [ ] **Step 2: 全量记忆测试**

Run: `node --test tests/memory/`
Expected: PASS（全部）

- [ ] **Step 3: 全仓语法自检（关键文件）**

Run: `node -c apps/test.js && node -c utils/MemoryManager.js && node -c utils/PersonProfileInjector.js`
Expected: 全部通过

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore(memory): remove legacy backup; memory redesign complete"
```

---

## 手动验证（上线前，对真实 Bot）

> 单测覆盖纯逻辑；以下需真实环境（Yunzai + Redis + 记忆 AI key）。

- [ ] 在测试群发"记住，maela 是 @某人"，下条消息问"maela 是谁" → 机器人应答出该 QQ（走别名表）。
- [ ] 同一别名被本人自述 vs 他人指认，确认本人胜出（authority）。
- [ ] `#记忆状态` / `#我的记忆` / `#群记忆` / `#删除记忆 alias:maela` / `#清除群记忆` 逐条验证返回正常。
- [ ] 运行 `wipeLegacyMemory(redis,{dryRun:true})` 看旧键数量，确认无误后 `{dryRun:false}` 清库。
- [ ] 观察日志：工具结果/系统消息不进记忆（boundary 生效）。

---

## Self-Review 记录

- **Spec 覆盖**：实体模型(§3)→Task3/11；别名表(§3.2)→Task7；冲突裁决(§5)→Task4/7；边界(§4.1)→Task5；抽取路由(§4.2)→Task8/9；Redis 布局(§6)→Task6；删除字段(§6.1)→Task3(slim)；检索(§7)→Task10；配置精简(§8)→Task18；调用方(§12)→Task12-15；相邻特性(§13)→Task13/16/17；删除清单(§14)→Task14/15；清库(旧数据)→Task19。✅ 全覆盖。
- **占位符**：无 TODO/TBD；每个代码步含完整代码。
- **类型一致**：`applyOps` 的 op 形状（stream/qq/text/authority/confidence/by/at/fact）在 extractor(Task8)、manager(Task11) 一致；alias claim 形状在 aliasRegistry(Task7) 与 manager 一致；fact 形状由 `makeFact` 统一。
- **已知风险**：`e._explicitTeachingFacts` 字段名以实际 `buildTeachingFact` 产出为准（Task13 已标注核对步骤）；apps/test.js 行号会漂移，故全部用 grep 锚定。
