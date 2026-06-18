# 记忆系统重构设计（实体中心 + 流分离）

- 日期：2026-06-18
- 范围：`utils/MemoryManager.js` 全量重做，配套调整 `apps/test.js` 调用点、`models/Guoba/schemas/memory.js` 配置、`config_default/message.yaml` 默认值
- 决策基线（已确认）：
  1. **彻底重做**（非轻量补丁）
  2. 存储后端：**Redis + 重设布局**（沿用 Yunzai 全局 `redis`，零新依赖）
  3. 数据模型：**实体中心**（群内以 QQ 聚合人物）
  4. 隔离边界：**纯群隔离**，群内按 QQ；不跨群共享（QQ 留作主键，未来可加全局层）
  5. 冲突裁决：**来源权威分级**（self > teaching > mention）
  6. 旧数据：**清库重来**（不写迁移代码）
  7. 自由事实：**精简分类**（结构化别名 + 自由文本事实 + 轻量 tag，砍掉空桶）

---

## 1. 背景与诊断（来自线上真实数据，群 981339693）

旧系统把每条记忆拆成 `meta`（`factIds[]` 索引）+ 每条 `fact` 独立 key，读一次记忆 = meta → 循环 GET 每条 fact（N+1）。

线上实测问题：

- **空壳元数据**：群内 10 个 user meta，仅 3 个真有 fact；全局 67 个 user meta 同样大量为空。
- **字段膨胀**：一条 27 字的别名事实挂了 24 个 64 位 SHA `sourceMessageIds`（≈1.5KB），正文仅 ~50 字节。
- **持久化 bug**：检索临时字段 `relevance/recency/score` 被 `retrieve()` 写回 Redis，污染存储（`120cb73f`、`ad396325`、用户 `d5e37041` 等可见）。
- **死字段**：`nickname` 永远 null；`embedding/embeddingHash` 永远 null；`relationshipScore` 只在一个状态命令里打印、从不影响行为。
- **冗余字段**：fact 内 `scope/scopeId/groupId/userId` 全能从 key 推出。
- **准确性问题**：
  - 跨 scope 矛盾：群别名 `希洛 = 今宵(3188163302)` 与用户 `925640859` 的 identity `名字是希洛` 指向两个不同的人。
  - 同一别名映射到两个值：`绘梨衣 = 星野的主任` vs `绘梨衣 = 星野的小对象的网名`。
  - 格式不统一（有的带 QQ、有的不带、有的 QQ 塞在左边、有的带垃圾占位昵称）→ `extractGroupAliasKey` 正则去重失效，越积越多。

**规模事实**：全库 5132 key，但记忆 fact 全局仅 42 条、user meta 67 个。结论：**性能/N+1 不是真痛点；准确性 + 字段膨胀 + 称呼映射混乱才是**。重构优先级压在这三点。

---

## 2. 架构支柱：六条流彻底分开

每类信息走独立 key 空间，互不污染。核心收益："maela 是谁"只查别名注册表，不会被群公告、工具日志、旧回答、脏聊天缓存干扰。

| 流 | 存什么 | key | 本次是否改动 |
|---|---|---|---|
| 短期对话缓存 | 最近聊天 | `ytbot:messages:*`（已存在） | 不动 |
| 别名注册表 | 外号 → QQ | `ytbot:mem:g:<群>:alias` | 新建 |
| 实体（人物） | QQ → 名/别名/个人事实 | `ytbot:mem:g:<群>:entities` | 新建 |
| 群事实 | 群规/梗/事件（非人物） | `ytbot:mem:g:<群>:facts` | 新建 |
| 表达习惯 | 风格样本 | ExpressionLearner（已存在） | 仅标接口点，不动 |
| 工具/系统状态 | 工具结果/报错/日志 | 短期 task/log | **永不进记忆** |

设计原则（采纳外部建议）：**代码做安全分类与边界，AI 在边界内判断"值不值得记"**。脏数据用确定性代码挡在门外，AI 只在干净输入里判断长期价值。

---

## 3. 数据模型

### 3.1 实体（每群一张人物表，QQ 主键）

```jsonc
{
  "qq": "3188163302",            // 主锚点；null = 暂未知 QQ（如"星野的小对象"），日后可合并
  "canonicalName": "今宵是飘逸的自我主义者",
  "aliases": [
    { "text": "maela", "authority": "teaching", "confidence": 0.9, "by": ["925640859"], "at": 1781162888727 }
  ],
  "facts": [
    { "text": "是星野的主任", "tags": ["关系"], "refs": ["3906061530"],
      "authority": "mention", "confidence": 0.85, "at": 1781707516126, "superseded": false }
  ],
  "updatedAt": 1781708137974
}
```

- 没有任何 fact/alias 的人**不建实体**（消灭空壳）。
- `refs`：事实里引用到的其他人 QQ，用于反向检索（问星野 → 带出"谁是星野的主任"），但**不建正式图谱**（避免过度设计）。

### 3.2 别名注册表（治"X 是谁"）

```jsonc
{
  "希洛":   { "qq": "925640859",  "authority": "self",     "confidence": 0.9,  "at": 0 },
  "maela":  { "qq": "3188163302", "authority": "teaching", "confidence": 0.9,  "at": 0 }
}
```

- key 为 normalize 后的别名；查询 O(1)，写入即可检测一对多冲突。
- 替代旧的"在自由文本 `member` fact 里塞 `A = B` 再正则反解析"的脆弱做法。

### 3.3 群事实（非人物）

```jsonc
[
  { "text": "群里不要刷屏", "tags": ["群规"], "authority": "mention",
    "confidence": 0.8, "at": 0, "superseded": false }
]
```

### 3.4 分类策略

- **外号必须结构化**（去重 / 回答"X 是谁" / 冲突裁决）。
- **"他相关的事" / "各种东西"保持自由文本 + 轻量 tag**。tag 由 AI 顺手打（如 `职业/关系/群规/梗`），仅作检索提示与弱过滤，**不是固定枚举**——保证"各种东西"永远塞得下，又不留空桶。
- 不再保留 `likes/dislikes/relationship/habits/skills/experience` 与 `topic/rule/meme/event` 这些零数据硬分类。

---

## 4. 写入管线（router + 边界）

```
消息 ──▶ [代码边界:确定性] ──▶ [AI 批量:分类+路由+抽取+权威] ──▶ [冲突裁决] ──▶ 落库
            │ 丢弃                 │ 每条输出                          │ self>teaching>mention
            ▼                      ▼ {route,targetQQ,authority,        ▼
       tool/system/internal        content,tags,confidence}      写入对应流
       纯语气词/过短/无信号闲聊
```

### 4.1 代码边界（确定性，先跑）

- 丢弃：工具结果/调用/报错/system prompt/图片返回/机器人自身回复（沿用并整理现有 `TOOL_FEEDBACK_MARKERS`、`isRealUserSource`、`containsToolFeedback`）。
- 丢弃：纯语气词、过短、低信号文本（沿用 `isLowSignalMemoryContent`）。
- 通过边界的"候选"才进 AI；纯闲聊只进短期缓存。

### 4.2 AI 批量调用（一次结构化调用完成分类+路由+抽取+权威标注）

不为每条消息单独调用 AI（成本考虑）；沿用现有 90s 防抖 + 批量机制，对一批候选消息一次性结构化抽取。

路由表（route label 即权威 tier）：

| route | 触发 | 落到 | authority |
|---|---|---|---|
| `explicit_teaching` | "记住/以后/下次/X 是 @某人" | 别名注册表（人）或群事实 | teaching |
| `self_statement` | 发言人在说自己（"我叫…/以后叫我…"） | 说话人实体 aliases/facts | self |
| `user_preference` | 本人稳定偏好（"我不喜欢被叫全名"） | 说话人实体 facts `tag=偏好` | self |
| `group_consensus` | 群规/梗/多人共识/群事件 | 群事实 | mention（多人加权）|
| `ordinary_chat` | 闲聊/临时/玩笑/问答 | 只进短期缓存 | 不入库 |

要点：群里"自报身份"也挂到**说话人 QQ 实体**，不另立用户库 —— 保证单一真相。

---

## 5. 冲突裁决引擎

写别名/事实时若与已有冲突（别名一对多、身份被改写）：

1. **比 authority**：`config`（管理员策展的 identityBindings/userProfiles）> `self` > `teaching` > `mention`，高者胜。
2. **同级**：取最新 + 被多人提及加权。
3. **败者不删**：标 `superseded:true`（可回溯），不再注入 prompt。

示例：925640859 自述"我叫希洛"(`self`) vs 别人"希洛=今宵"(`mention`) → 别名 `希洛` 判给 925640859。
注：`config` 层来自管理员手工配置（见 §13.3），权威性最高，作为实体 seed。

---

## 6. Redis 键布局

量小，按群存少数 JSON 文档，一次读完，废弃"每条 fact 一个 key + meta.factIds 循环"。

```
ytbot:mem:g:<群>:entities   → { "<qq>": {entity}, ... }
ytbot:mem:g:<群>:alias      → { "<norm别名>": {qq,authority,confidence,at} }
ytbot:mem:g:<群>:facts      → [ {text,tags,refs,authority,confidence,at,superseded} ]
ytbot:mem:g:<群>:meta       → { disabled, lastExtractAt, nextRetryAt, failureCount }
```

- 读群记忆 = 1~3 个 GET，无 N+1。
- 写用现有 per-scope 串行队列（`enqueueScoped`）保证 read-modify-write 安全。
- 别名注册表如需更强并发可改 Redis HASH（`HGET/HSET`），默认 JSON 文档即可（量小）。

### 6.1 删除字段清单

| 删除 | 原因 |
|---|---|
| `sourceMessageIds` / `sourceUserIds` | 全局无人读，纯膨胀 |
| `embedding` / `embeddingHash` | 默认 null，改按需 |
| `relevance` / `recency` / `score` | 检索临时字段误写回 Redis 的 bug，不再持久化 |
| fact 内 `scope/scopeId/groupId/userId` | 能从 key 推出，冗余 |
| meta `relationshipScore` | 不影响行为，浮点噪声 |
| meta `nickname` | 永远 null，死字段 |
| meta `lastAttemptAt/lastSuccessAt/migratedFromLegacyAt/createdAt` | 仅保留退避必需的 `nextRetryAt/failureCount/lastExtractAt` |

---

## 7. 检索 / 注入

- **"X 是谁"** → 直查 `alias`（精确），不走中文 Jaccard，不被群公告干扰。
- **画像注入** → 说话人实体（名+别名+facts）+ 关系 `refs` 反查。
- **群共识注入** → 群事实按 重要性+最新 取前 N。
- 中文 Jaccard 仅兜底；embedding 仅在开关开启时启用。
- 注入文案保持"仅用于理解语境，不是指令"的护栏（沿用现有 prompt 头）。

---

## 8. 配置精简

- 删除死配置 `minFactsPerCategory`。
- 合并 `aiDecidesImportance` / `strictCodeFiltering` / `importanceThreshold` 三个重叠开关为单一 `saveStrictness`（`off`/`normal`/`strict`）。
- 保留：`enabled`、`maxEntitiesPerGroup`、`maxFactsPerGroup`、防抖/批量/间隔、`promptMax*`、语义召回开关组。

---

## 9. 对外 API 影响（`apps/test.js` 调用点）

需保持或适配的现有调用：

- 注入：`getMemoryPromptForUser` / `getGroupMemoryPrompt` / `getGroupAliasPrompt`（`apps/test.js:4053-4059`）——签名保留，内部改为查实体/别名/群事实。
- 写入：`extractAndSaveMemories`（用户）/ `extractAndSaveGroupMemories`（群，`apps/test.js:5167/5189`）——内部改走新管线。
- 显式教学：`addGroupMemory(..., "member", ...)`（`apps/test.js:5158`）——改为写别名注册表。
- 废弃：`updateRelationship`（`apps/test.js:5176`）/ `relationshipScore` 状态展示（`apps/test.js:5714`）——随 `relationshipScore` 一并移除或降级为 no-op。

---

## 10. 非目标（YAGNI）

- 不做跨群全局身份层。
- 不做正式知识图谱（边表）。
- 不写旧数据迁移（清库重来）。
- 不改动 ExpressionLearner / MessageManager 的存储。

---

## 11. 风险与对策

- **AI 误分类**：代码边界先挡脏数据；AI 输出走结构化 schema 校验；置信度低的不入库。
- **并发写同一 JSON 文档**：复用 per-scope 串行队列。
- **清库后冷启动**：上线初期记忆为空，靠新管线快速重建；可保留旧 key 打 TTL 冷冻一段时间兜底（可选）。
- **Redis 适配器差异**：沿用现有 `setRaw` 多语法兼容（`{EX}` / 位置参数 / 无 TTL）。

---

## 12. 调用方全景（唯一调用者 apps/test.js）

排查确认：记忆系统**唯一调用者是 `apps/test.js`**，无其他文件直接碰 `ytbot:memory:` 键（除一处 admin 清理，见 §14）。

### 12.1 实例化与配置
- 构造：`new MemoryManager(buildMemoryConfig(config))`（`apps/test.js:1208`）。
- 配置映射：`buildMemoryConfig`（`apps/test.js:1146-1155`）= 展开 `config.memorySystem` + 注入 `memoryAiConfig`/`embeddingAiConfig`（来自 config 根）+ 兼容旧字段 `groupExtractMinInterval`。
- 热重载：chokidar 监听 `config/message.yaml`（`apps/test.js:3243-3267`，500ms 防抖）→ `initializeSharedState` → `memoryManager.updateConfig(buildMemoryConfig(config))`（`apps/test.js:1169`）。**新实现必须保留 `updateConfig` 签名与热重载语义。**

### 12.2 热路径注入（每条消息，line 4053/4056/4059）
旧：3 次调用，其中 `getGroupMemoryPrompt`+`getGroupAliasPrompt` 扫同一批 fact 两次。
新：按群 1~3 个 GET 读完文档，天然消除重复扫描。保留三个方法签名（`getMemoryPromptForUser`/`getGroupMemoryPrompt`/`getGroupAliasPrompt`），内部改查实体/别名/群事实。

### 12.3 后台写入（line 5158/5167/5176/5189，fire-and-forget）
- `addGroupMemory(..., "member", ...)`（显式教学落库）→ 改为写**别名注册表**（见 §13.2）。
- `extractAndSaveMemories` / `extractAndSaveGroupMemories` → 内部改走新管线（§4）。
- `updateRelationship` → **废弃**（§14）。

### 12.4 Admin 聊天命令（9 条，全部需适配新模型）
`#记忆状态`(5708) `#我的记忆`(5730) `#群记忆`(5753) `#搜索记忆`(5776/5784) `#删除记忆 <id>`(5810/5818) `#清空我的记忆`(5835) `#清空群记忆`/`#清除群记忆`(5859) `#禁用我的记忆`(5873) `#启用我的记忆`(5888)。
- 返回结构契约：`adminListMemories` → `{facts:[...]}`、`adminDeleteMemory` → `{deleted}`、`adminClearMemories` → `{cleared}`、`adminStatus` → `{user,group,config}`。新实现保留这些形状，但内容改为实体/别名/群事实视图。
- `#删除记忆 <id>`：旧靠 fact UUID；新模型改为 **QQ + 条目寻址**（如 `QQ:别名` 或 `QQ#factIndex`），命令文案与解析需同步更新。
- `#我的记忆`：展示"我"的实体（别名+facts）；`#群记忆`：群事实 + 别名表概览。

---

## 13. 相邻"身份/称呼"特性归并

这是本次排查最重要的发现：多个相邻特性在重复处理同一类身份/别名数据，重构应顺手收敛。

### 13.1 PersonProfileInjector（`utils/PersonProfileInjector.js`，`apps/test.js:4082`）
- 现状：注入【当前对话者画像】= 昵称 + **固定称呼/别名**（来自 `config.userProfiles[qq].aliases`）+ **关系定位/偏好/风格/备注** + 最近发言（来自 MessageManager）。
- 问题：别名/关系/偏好与实体表**高度重复**。
- 归并：实体注入成为身份/别名/关系/偏好的**单一来源**；PersonProfileInjector **只保留**"最近发言片段"（短期上下文，本就不属记忆）。其原本读取的 `config.userProfiles` 改为 §13.3 的 config seed 流入实体，不再在注入处二次拼接。

### 13.2 显式教学 → 别名注册表（直喂，省掉往返）
- 现状链路：`extractExplicitTeachingFacts`（`apps/test.js:614-697`，正则解析"记住 A 是 @某人"）产出**结构化** `{alias, targetUserId}` → `formatExplicitTeachingMemoryContent` **拍平成自由文本** `群内称呼映射：A=B` → `addGroupMemory(...,"member")` → 下次 `getGroupAliasPrompt` 用 `extractGroupAliasKey` **正则反解析**。
- 重构：教学抽取产出的结构化 `{alias, targetUserId, authority:"teaching"}` **直接写入别名注册表**，删除"拍平 + 反解析"两段脆弱代码。当条消息的最高优先级教学 prompt（`explicitTeachingPrompt`）保留。

### 13.3 identityBindings / userProfiles 作为 config seed
- 现状：`config.identityBindings`（`{qq,name,aliases,relationToBot,notes,style}`）与 `config.userProfiles` 由管理员在 Guoba 配置，经 `formatIdentityBindingsPrompt` 注入。
- 重构：启动/热重载时把这些**以 `authority:"config"` seed 进实体表**（最高优先级，§5）。注入时统一从实体输出，避免与学习数据各拼一段。

### 13.4 "X 是谁"三源优先级
用户问"X是谁/外号"时，按以下顺序解析（高者优先，对应权威层）：
1. **当条消息显式教学**（`explicitTeachingPrompt`，最高，覆盖一切）
2. **别名注册表**（已学习的群内外号 → QQ）
3. **实时群花名册**（`memberLookupPrompt`，`group.getMemberMap()` 名片/昵称匹配）

`memberLookupPrompt` 保留为实时兜底（花名册会变），别名注册表补充花名册查不到的群内梗外号。

---

## 14. 删除 / 改造清单（relationshipScore 与外部键访问）

### 14.1 删除 relationshipScore / updateRelationship（确认安全：EmotionManager 单向耦合）
- `utils/MemoryManager.js`：`createMeta`(353) / `normalizeMeta`(376) / 迁移(600,1153) / `getUserMemory` 返回(1119) / `updateRelationship` 方法(1190-1197) / `adminStatus` 返回(1638) —— 全部移除（新实现不含该概念）。
- `apps/test.js`：删除情绪→关系块(5172-5180)；`#记忆状态` 展示去掉关系分(5714)。
- EmotionManager / 其 prompt **不受影响**（仅单向写入）。

### 14.2 外部直接 Redis 访问（唯一一处）
- `apps/test.js:5615-5624` admin"清除本群记忆"用 `memoryManager.REDIS_PREFIX` + `getGroupRedisKey(groupId)` + `scanRedisKeys('<prefix><群>:*')` 直接删键，假设**旧 key 格式** → 必须改用新 key 布局（`ytbot:mem:g:<群>:*`）。提供新公开方法 `clearGroupRedis(groupId)` 或在 `adminClearMemories` 内部完成，外部不再拼键。

### 14.3 配置精简联动 Guoba/yaml
- `models/Guoba/schemas/memory.js`（17 字段）与 `config_default/message.yaml:241-257` 同步：删 `minFactsPerCategory`（仅在 DEFAULT_CONFIG，UI 无）；合并 `aiDecidesImportance`/`strictCodeFiltering`/`importanceThreshold` → `saveStrictness`。
- `memoryAiConfig`/`embeddingAiConfig`（`models/Guoba/schemas/aiModels.js:114-121`）**保持不变**。

---

## 15. 兄弟系统耦合结论（无阻塞）

| 子系统 | 与记忆耦合 | 重构影响 |
|---|---|---|
| EmotionManager | 单向（情绪→updateRelationship） | 仅删调用块，本体不动 |
| MessageManager | 零（独立 `ytbot:messages:`，TTL 1天） | 不动；其消息对象 schema 供抽取器消费 |
| ExpressionLearner | 零（独立 `ytbot:expression:`） | 不动；router 可喂干净闲聊（接口点，非本次范围） |
| GroupNotice / Knowledge / MCP | 零 | 不动 |

MessageManager 消息对象关键字段（抽取器输入）：`sender.{user_id,nickname,role,title,level,identity}`、`content`、`message_id`、`source`、`time`、`group_id`。
