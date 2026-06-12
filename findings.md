# 记忆稳定性发现

## 当前结论
- 知识库已有命令管理，真实数据在 `database/knowledge-db.ndjson`。
- 长期记忆已有命令管理，核心逻辑在 `utils/MemoryManager.js`。
- Guoba 当前标准集成是配置 schema，适合开关/阈值，不适合直接做真实数据 CRUD。
- 本轮改进重点转为：抽取质量、召回质量、注入稳定性。

## 2026-06-12 代码链路
- `apps/test.js` 在回复前调用 `memoryManager.getMemoryPromptForUser()`、`getGroupMemoryPrompt()`、`getGroupAliasPrompt()`，再调用 `personProfileInjector.build()`。
- `utils/MemoryManager.js` 的 `MemoryRetriever.retrieve()` 会对所有 fact 打分；当前带 query 时，即使 relevance 为 0，高 importance/recency/confidence 的旧记忆仍可能被选入。
- `normalizeConfig()` 里 `promptMaxUserFacts`、`promptMaxGroupFacts` 使用 `Math.max(1, ...)`，和 Guoba schema 的 min 0 不一致。
- `PersonProfileInjector` 只注入固定画像和最近发言，没有统一长度预算，也没有显式避免与长期记忆重复。
