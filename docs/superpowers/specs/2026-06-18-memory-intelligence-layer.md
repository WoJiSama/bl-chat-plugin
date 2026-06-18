# 记忆智能层设计（mention 感知 / 语义召回 / 反思巩固 / 时间回扣）

- 日期：2026-06-18
- 前置：实体中心记忆系统已上线（`utils/memory/*` + `utils/MemoryManager.js` 门面，每群 4 个 JSON 文档 entities/alias/facts/meta）。
- 决策基线（已确认）：
  1. **全部 8 个特性都做**
  2. embedding **做成可选，接了即生效**（默认关，无 key 自动降级）
  3. 反思 **阈值触发**
  4. 主动性 = **回复内自然回扣**（绝不主动发消息）
  5. 反思阈值默认 实体 15 / 群 30；`proactiveCallback` 默认 true（措辞克制）；`recallMaxMentionedEntities` 默认 3
- 记忆 LLM：DeepSeek V4 Flash（已配 `memoryAiConfig`）；embedding：`embeddingAiConfig`（URL/model 已填，key 待补）。

本层是对既有模块的**增量**，所有新行为默认安全、可降级，不破坏现有 47+2 测试。

---

## 0. 契约（所有并行实现必须严格遵守的接口/字段）

### 0.1 fact 字段扩展（`utils/memory/entityModel.js` 的 makeFact）
在现有 `{text,tags,refs,authority,confidence,at,superseded}` 基础上新增三个**可选**字段，缺省安全：
```jsonc
{
  // ...现有字段...
  "embedding": null,          // number[] | null（仅 semanticRecall 开且算出时存）
  "eventAt": null,            // number(epoch ms) | null（时间相关事件，如"下周考试"）
  "origin": "extract"         // 'extract' | 'reflection' | 'config'，默认 'extract'
}
```
- makeFact 必须接受并归一化这三个字段（embedding：Array 才保留否则 null；eventAt：有限数字否则 null；origin：白名单否则 'extract'）。
- alias 条目**不**加这些字段。

### 0.2 config 默认值（`utils/MemoryManager.js` DEFAULT_CONFIG + constants）
```
semanticRecallEnabled: false
reflectEntityThreshold: 15
reflectGroupThreshold: 30
proactiveCallback: true
recallMaxMentionedEntities: 3
proactiveWindowDaysBefore: 3     // eventAt 在未来 3 天内可回扣
proactiveWindowDaysAfter: 7      // eventAt 过去 7 天内可回扣("考得咋样")
semanticDupCosine: 0.88          // 写入时语义去重阈值
```

### 0.3 权威分级不变：`config > self > teaching > mention`
- 反思产出的**实体合并 fact**：保留被合并 fact 的最高 authority；`origin:'reflection'`。
- 反思产出的**群洞察 fact**：`authority:'mention'`, `confidence:0.6`, `tags` 含 `'洞察'`, `origin:'reflection'`。
- 反思**禁止删除/改写** `authority:'config'` 或 `origin:'config'` 的 fact。

---

## 1. #1 提及感知 + #3 refs 反查 + #8 置信度表达

### 1.1 新模块 `utils/memory/mentionResolver.js`（纯函数，可单测）
```
// 解析消息中被提及的人 → QQ 集合
resolveMentions(message, { aliasDoc, entities, speakerQQ, max }) -> { qqs: string[] }
```
- 来源：① 文本中的 `@QQ:数字` / `QQ:数字` 显式号；② 别名命中（normalizeAlias(token) 命中 aliasDoc → qq）；③ 实体 canonicalName/aliases 子串命中。
- 去重；排除 speakerQQ（说话人单独处理）；上限 `max`（默认 config.recallMaxMentionedEntities）。
- 纯函数，不读 Redis；entities/aliasDoc 由调用方传入。

### 1.2 retriever 新增语境化构建（`utils/memory/retriever.js`，纯函数）
```
buildContextualPrompt({
  speakerEntity, mentionedEntities, refsFacts, groupFacts, aliasDoc,
  pendingFacts, query, config
}) -> string
```
拼装顺序与小标题：
- `【长期记忆】关于当前用户…`：speakerEntity（名/别名/facts），措辞分级（见 1.3）。
- `【相关的人】`：每个 mentionedEntity 一段（名/别名/facts）。
- `【关联信息】`：refsFacts（其他实体里 refs 命中说话人或被提及人的 fact）。
- `【群内称呼映射记忆】`：复用现有 buildAliasPrompt 逻辑（保留）。
- `【群共识记忆】`：groupFacts（复用现有 buildGroupFactsPrompt 排序+截断）。
- `【可自然提起】`：pendingFacts（见 #6/#7），带提示"可自然问候，不要生硬，别提'系统记录'"。
- 全程 superseded 跳过；总长度受 config.promptMaxChars 硬截断；空段不输出。

### 1.3 #8 置信度措辞（在上述构建里）
- `authority:'self'|'config'` 或 confidence≥0.8 → 直接陈述：`- 在上海工作`
- `authority:'teaching'` → `- (据群里教学) X=Y`
- `authority:'mention'` 或 confidence<0.6 → 加不确定限定：`- 好像…/据群里说…`

---

## 2. #2 语义召回（gated）

### 2.1 新模块 `utils/memory/embeddings.js`
```
class Embeddings {
  constructor(config)         // 读 config.embeddingAiConfig + semanticRecallEnabled
  canUse(): boolean           // semanticRecallEnabled && url && key
  async embed(text): number[]|null   // 失败/未启用 → null；带进程内 LRU 缓存(key=sha256(model+text))
}
export function cosineSimilarity(a, b): number   // 复用旧实现语义
```
- `_callEmbed` 用 fetch 调 embeddingApiUrl（OpenAI 兼容）；可被测试覆写。
- 测试：未配置 → embed 返回 null；配置 + 覆写 `_callEmbed` → 返回向量并命中缓存；cosine 数学正确。

### 2.2 写入侧（MemoryManager._addEntityFact / _addGroupFact）
- 若 `embeddings.canUse()`：写 fact 前 `fact.embedding = await embeddings.embed(fact.text)`。
- **语义去重(#5)**：新 entityFact 与该实体已有 fact 若 cosine ≥ `semanticDupCosine` → 视为同一事实，按权威+时间 resolveClaim 决定 supersede/更新，而非新增。embedding 关时退化为现有"完全同文本"去重。

### 2.3 检索侧（getContextualMemoryPrompt）
- 群事实排序：embeddings.canUse() 且有 query → 用 cosine(queryEmb, fact.embedding) 排序取前 N；否则现有 confidence+recency。
- query embedding 每条消息至多算一次，缓存命中即免。

---

## 3. #4 反思巩固 + #5 演化（阈值触发，DeepSeek Flash）

### 3.1 新模块 `utils/memory/reflector.js`
```
class Reflector {
  constructor(config)
  canUse(): boolean                 // 同 extractor，需 memoryAiConfig
  async consolidateEntity(entity): { facts: fact[], changed: boolean }
  async reflectGroup({ groupId, facts, recentTexts }): { insights: fact[] }
  _callChat(messages, maxTokens)    // 可被测试覆写
}
```
- `consolidateEntity`：把 entity.facts（排除 origin:'config'）交给 LLM 合并去冗余解矛盾，返回更紧凑的 fact 列表（每条标 origin:'reflection'，保留合理 authority/confidence）。LLM 失败 → 原样返回 changed:false。条数未超阈值不调用。
- `reflectGroup`：基于群 facts + 最近文本，产出 0-3 条高层洞察 fact（tags:['洞察'], origin:'reflection', authority:'mention', confidence:0.6）。
- 测试：覆写 `_callChat` 返回固定 JSON，断言合并/洞察结果形状；未配置 → 不调用、changed:false。

### 3.2 触发（MemoryManager）
- 在 `applyOps` 写完**之后**，若某实体活跃 facts > `reflectEntityThreshold` 或群 facts > `reflectGroupThreshold`：
  - **独立**调用 `this.enqueueGroup(groupId, () => this._runReflection(groupId, targets))`（**新的一次 enqueue，不嵌套在 applyOps 的 task 内** —— 复刻已修死锁的教训：抽取/反思在锁外触发，锁内只做 read-modify-write）。
  - `_runReflection` 读 → consolidate/reflect → 写回 store（直接 store.saveEntities/saveFacts，不再调 applyOps）。
- 反思是 fire-and-forget，失败仅 log，不影响主流程。

---

## 4. #6 时间记忆 + #7 主动回扣（仅回复内）

### 4.1 抽取（extractor）
- SYSTEM_PROMPT 增加：对时间相关事实，可附 `eventInDays`（整数，相对今天的天数，未来正/过去负；无则省略）。
- parseAndRoute：ctx.now 存在且 item.eventInDays 有限 → `fact.eventAt = ctx.now + eventInDays*86400000`。

### 4.2 回扣（getContextualMemoryPrompt + retriever）
- 收集 speaker/mentioned 实体里 eventAt 落在 `[now - after*天, now + before*天]` 的 fact → `pendingFacts`。
- 仅当 `config.proactiveCallback` 为真时注入 `【可自然提起】` 段，提示 LLM 可自然问候，**不得**主动发消息、不得说"系统/记录"。
- 无主动发送逻辑、无定时器。

---

## 5. 门面整合（`utils/MemoryManager.js`）

新增/改：
- `getContextualMemoryPrompt(groupId, speakerQQ, message, now = Date.now())`：
  1. 读 entities/alias/facts（一次）。
  2. `resolveMentions(message, {aliasDoc, entities, speakerQQ, max})` → mentioned qqs。
  3. 组装 speakerEntity、mentionedEntities、refsFacts（遍历 entities 找 refs 命中 speaker/mentioned 的 fact）、groupFacts（语义或常规排序）、pendingFacts。
  4. `buildContextualPrompt(...)`。
- 保留旧 `getMemoryPromptForUser/getGroupMemoryPrompt/getGroupAliasPrompt`（向后兼容，可内部委托新逻辑或保留），但 apps 改为调用 `getContextualMemoryPrompt`。
- 构造函数实例化 `Embeddings`、`Reflector`，并把 embeddings 传入写入/检索路径。
- `_addEntityFact` 加语义去重；`applyOps` 末尾加反思触发（独立 enqueue）。

## 6. 接入 `apps/test.js`
- 热路径（约 4053-4059）：把 `getMemoryPromptForUser` + `getGroupMemoryPrompt` + `getGroupAliasPrompt` 三次调用，替换为**一次** `getContextualMemoryPrompt(groupId, userId, e.msg || '', Date.now())`，其余注入拼装不变。
- 用 grep 锚定，改后 `node -c`。

## 7. 配置（message.yaml + Guoba memory.js）
- 新增 §0.2 的字段；Guoba 加对应表单项（semanticRecallEnabled Switch；阈值/窗口 InputNumber；proactiveCallback Switch）。
- `embeddingAiConfig` 不变（key 由用户补）。

## 8. 测试
- 新模块各自 node:test：mentionResolver（解析/去重/上限/排除说话人）、embeddings（gated/缓存/cosine）、reflector（覆写 _callChat、阈值、不动 config fact）、retriever 语境化（分级措辞、refs、pending 窗口、superseded 跳过）。
- manager 集成测试：getContextualMemoryPrompt 端到端（注入说话人+被提及+refs+pending）；反思触发不死锁（带 timeout，覆写 reflector._callChat）；语义去重（注入假 embeddings）。
- 全量 `npm test`（`node --test "tests/memory/**/*.test.js"`）保持全绿。

## 9. 非目标 / 风险
- 不做主动发消息、不做定时器（YAGNI + 防打扰）。
- 反思 LLM 失败必须静默降级，绝不阻塞回复。
- 热路径只增 mention 解析（内存）+ 至多一次 query embedding（gated+缓存）；保持回复延迟可接受。
- embedding 字段会让 facts 文档变大——仅在 semanticRecall 开时存，默认关即无膨胀。
