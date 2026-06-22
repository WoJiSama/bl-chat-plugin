# 记忆系统 P0 修复 + P1 增强 设计

- 日期：2026-06-22
- 背景：实体中心记忆系统重构上线后，审计发现 admin 命令层未随新 fact 模型更新（P0 现存 bug），以及若干高 ROI 召回/健壮性增强（P1）。
- 现 fact 模型（entityModel.makeFact）字段：`text/tags/refs/authority/confidence/at/superseded/embedding/eventAt/origin`（无 id/category/importance/score/content）。
- 权威分级：`config>self>teaching>mention`。每群 4 文档 `ytbot:mem:g:<群>:entities/alias/facts/meta`，纯群隔离。

## 0. 共享契约（所有实现必须一致遵守）

### 0.1 稳定短 id —— entityModel.js 新增并 export
```
export function factShortId(text)   // = sha256(text).slice(0,8)，用于展示与按 id 删除
```
用 `node:crypto` 的 createHash。展示与删除引用同一短 id，保证"看到的 id"能删。

### 0.2 per-user opt-out —— 存在群 meta
- meta 增字段 `optedOut: string[]`（QQ 列表，RedisStore.getMeta 的 DEFAULT_META 加 `optedOut: []`）。
- 写入侧：`extractAndSaveMemories` 入口若 `String(userId)` 在 optedOut → 直接 return `{queued:false, reason:'opted-out'}`，不缓冲不抽取。
- 读取侧：`getContextualMemoryPrompt` 组装时，若 speaker 在 optedOut → speakerEntity 视为 null（不注入该用户自己的记忆）。被提及人不受影响（opt-out 只关"对我的记忆"）。
- `adminSetUserMemoryEnabled({groupId, userId, enabled})`：enabled=false → 把 userId 加入 meta.optedOut；enabled=true → 移除。返回 `{enabled: <是否在记>}`。经 enqueueGroup 串行写 meta。

### 0.3 轻量统计 —— 新建 utils/memory/stats.js
```
export const memStats = {
  inc(key, n = 1),            // 计数 +n
  observe(key, ms),           // 记录一次耗时(累加 sum + count)
  snapshot()                  // 返回 { counters:{...}, timings:{key:{count,sumMs,avgMs}} }
}
```
进程内对象（重启归零），零依赖。约定计数键：
`embed.hit / embed.miss / embed.fail`、`llm.extract.call / llm.extract.fail`、`llm.reflect.call / llm.reflect.fail`、`extract.user.flushed / extract.user.buffered / extract.user.optedOut / extract.group.run / extract.group.throttled / extract.boundary.drop`。
耗时键：`embed.ms / llm.extract.ms / llm.reflect.ms`。

### 0.4 实体事实排序 —— MemoryManager 新增 `_rankEntityFacts(facts, query, queryEmb)`
- 入参 facts=某实体 active facts；queryEmb=已算好的 query 向量(可空)。
- queryEmb 且 facts 有 embedding → 按 cosine 排序；否则按 confidence desc, at desc。
- **身份锚点保护**：排序后，强制把"最高 authority 的 1 条事实"提到最前（避免语义排序把身份事实挤掉）。
- 取前 `config.promptMaxEntityFacts`（默认 6）。
- getContextualMemoryPrompt 对 speakerEntity 与每个 mentionedEntity 的 facts 都用它预排序后，传给 buildContextualPrompt（retriever 的 entity 段改为消费"已排序好的 facts"，不再自己遍历全量）。
- query embedding 只算一次（_rankGroupFacts 与实体排序共用，避免重复 embed）。

### 0.5 fetch 超时 —— 所有外部调用加 AbortSignal.timeout
extractor `_callChat`、reflector `_callChat`、embeddings `_callEmbed` 的 fetch 加 `signal: AbortSignal.timeout(ms)`（chat 8000、embed 8000）。超时即抛错 → 现有 catch 静默降级。

---

## 1. P0 修复（现存 bug，最高优先）

### P0-1 `#清空我的记忆` 误清整群（数据丢失 + 越权）
- 现状：apps/test.js `clearMyMemory` 调 `adminClearMemories({scope:'user',...})`，门面忽略 scope → `clearGroup` 删全群。
- 修：`clearMyMemory` 改调 `this.memoryManager.clearUserMemory(e.group_id, e.user_id)`（门面已有该方法，只删该用户 entity）。
- 顺手：`#清空群记忆`（clearGroupMemory）加二次确认（如"再发一次 #清空群记忆 确认"，进程内记 pending + 30s 过期），防误清。

### P0-2 `#禁用我的记忆` 空操作却谎报成功（隐私）
- 现状：`adminSetUserMemoryEnabled()` 是 `return {enabled:true}` 空 stub，UI 却回"已禁用"。
- 修：按 §0.2 真正实现 opt-out。`disableMyMemory`/`enableMyMemory` 调用后按真实结果回文案。

### P0-3 记忆列表/搜索/状态渲染全 undefined
- 现状：`formatMemoryFactLines` 读 `fact.id/category/content/score`（新模型无）；`#搜索记忆` 不过滤；`#删除记忆` 删不到 entityFact；`#记忆状态` 读 adminStatus 不返回的字段。
- 修：
  - `formatMemoryFactLines` 改读真实字段：`factShortId(fact.text)` 作 id、`fact.tags?.[0]` 作分类、`fact.text`、`fact.confidence`、authority 映射中文来源（本人说/群里教/提及推断）、eventAt 存在附"(待回扣)"。删除引导文案改为 `#删除记忆 my:<id>`（删自己事实）或 `alias:<别名>` / `fact:<群事实前缀>`。
  - `adminListMemories({query})`：用户态/群态都按 `f.text.includes(query) || (f.tags||[]).some(t=>t.includes(query))` 真过滤后再截断。
  - `adminDeleteMemory` 增分支 `my:<shortid>`：在当前 userId 的 entity.facts 里找 `factShortId(text)===id` 的，标 superseded（软删）。保留 alias:/fact:。
  - `adminStatus`：返回真实字段——`user:{factCount,aliasCount,optedOut}`、`group:{entityCount,factCount,aliasCount,disabled,lastExtractAt,failureCount}`、`config:{saveStrictness,semanticRecallEnabled,proactiveCallback,maxEntitiesPerGroup,maxFactsPerGroup}`。`memoryStatus`(apps/test.js)改读这些字段（去掉 importanceThreshold/lastAttemptAt 等不存在的）。
  - meta 增 `lastExtractAt`/`failureCount`：在 `_flushUserBuffer`/`extractAndSaveGroupMemories`/`_runReflection` 成功时写 `meta.lastExtractAt=now`、清零 failureCount；LLM 失败时 failureCount++（经 enqueueGroup 串行）。

---

## 2. P1 增强（高 ROI）

### P1-1 实体个人事实按 query 语义排序（当前最大召回浪费）
按 §0.4 实现 `_rankEntityFacts` 并接入 getContextualMemoryPrompt + retriever entity 段。config 加 `promptMaxEntityFacts:6`（DEFAULT_CONFIG + message.yaml + Guoba memory.js）。embeddings 关时回退 confidence/recency，行为与现状一致。

### P1-2 激活 refs 多跳（【关联信息】段当前是哑的）
- extractor `SYSTEM_PROMPT` 增加 refs 字段说明：`refs: 该事实涉及的其他人 QQ 数组(纯数字),如"我和@QQ:123是同事"→refs:["123"];无则省略`，并在 self_statement/group_consensus 规则点一句"提到他人填 refs"。
- parseAndRoute：把 item.refs 过滤为纯数字字符串数组（防幻觉非数字）。无需校验存在性（_collectRefsFacts 本就只匹配真实 relevantQQs，幻觉 QQ 自然不命中）。不做多跳（1 跳足够）。

### P1-3 热路径超时隔离（记忆故障不拖垮回复）
- apps/test.js 调 `getContextualMemoryPrompt` 处用 `Promise.race([call, timeout(1500ms→'')])` + catch，超时/异常退化为 `''`，回复照常。
- 三处 fetch 加 §0.5 的 AbortSignal.timeout。

### P1-4 结构化日志 + 调用计数
- 新建 §0.3 的 stats 模块。在 embeddings/extractor/reflector/MemoryManager 关键路径打点（命中/失败/节流/flush 等计数 + LLM/embed 耗时）。
- 失败处由静默 `catch{}` 升级为 `catch(e){ globalThis.logger?.warn?.(...) }`（只记状态/计数，**不记 fact 全文**，避免隐私+刷屏）。
- apps/test.js 加 `#记忆统计`（主人/管理员）：`memStats.snapshot()` 汇总输出（调用数/失败率/缓存命中/节流命中/平均延迟）。

---

## 3. 测试与验证
- 新增/更新 node:test：
  - opt-out：optedOut 用户的 extractAndSaveMemories 返回 opted-out 且不写；getContextualMemoryPrompt 不注入其自身实体。
  - factShortId 稳定性；adminDeleteMemory `my:<id>` 软删自己事实。
  - adminListMemories query 真过滤。
  - _rankEntityFacts：有 embedding 按 cosine、无则 confidence/recency、身份锚点置顶。
  - parseAndRoute refs 纯数字过滤。
  - stats.inc/observe/snapshot。
- `npm test`（`node --test "tests/memory/**/*.test.js"`）全绿；`node -c` apps/test.js 及所有改动模块。

## 4. 非目标
- 不做跨群身份合并、召回自评、多观察者可信度、向量库化、通用衰减（审计判定过度设计）。
- P2/P3（Redis 错误边界、embedding 外置、自然语言入口、#改记忆 等）本次不做，留作后续。
