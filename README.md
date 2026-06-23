# 希洛用 bl-chat-plugin 改造版

> 本项目借鉴并基于 [Cat-bl/bl-chat-plugin](https://github.com/Cat-bl/bl-chat-plugin) 做二次改造。
>
> 这里不是上游项目的官方文档，也不是通用发行版说明；这个仓库主要记录我在原项目基础上为自己的 TRSS Yunzai + NapCat 环境做了哪些增强、重构和定制。

## 项目定位

这个仓库的目标不是只做一个“能接 AI 的 QQ 机器人插件”，而是把它改造成一个更像群里长期存在的角色：

- 能持续跟踪会话，而不是每句话都像新对话。
- 能记住用户、群共识和称呼关系，但尽量不把工具输出、系统提示、临时噪声写进长期记忆。
- 能保持“希洛”的说话方式，少一些机器人报错和流程话。
- 能处理生图、修图、识图、长文本转图、表情包和工具调用，并且在耗时任务期间不把群聊堵住。
- 配置尽量能在锅巴里调，不要求每次都手改 yaml。

当前只按我的环境维护：

- TRSS Yunzai
- NapCat
- Node.js 插件环境
- OpenAI 兼容接口 / Gemini / 火山 Ark 等模型服务按配置接入

其他 Yunzai 分支、适配器或部署方式没有保证。

## 和上游的关系

上游 [Cat-bl/bl-chat-plugin](https://github.com/Cat-bl/bl-chat-plugin) 提供了这个插件的主要基础，包括 Yunzai 插件结构、OneAPI/工具调用框架、基础配置和一批本地工具。

本仓库在此基础上继续做了大量个人化改造。README 下面的重点不是复述上游原本已有能力，而是说明这个仓库主要新增、重构或强化了什么。

如果你想找更通用的原版说明，请优先看上游项目。

## 我主要做了什么

以下内容根据本仓库 git 记录整理，包括 `memory`、`smart`、`TextImageTool`、表情包、锅巴配置、图像工具和提示词相关提交。

### 1. 长期记忆系统重构

把早期“把聊天内容塞进记忆”的思路，重构成更可控的记忆管线。

主要改造：

- 新增实体中心的记忆模型，把用户、别名、事实、群共识拆开存。
- 支持用户记忆和群记忆分层注入 prompt。
- 支持别名解析、@ 提及解析、同一用户多称呼合并。
- 支持语义召回，接入 `embeddingAiConfig` 后可以按相似度召回相关记忆。
- 支持记忆反思和压缩，把重复、过期、冲突信息整理成更稳定的事实。
- 支持时间信息提取，比如“几天后”“上周”“某天”这类内容可以进入记忆字段。
- 加入提取防抖、批处理、群记忆最小整理间隔，避免群里刷屏时频繁调用记忆模型。
- 加入低信号过滤，普通语气词、工具结果、系统提示、机器人输出不进入长期记忆。
- 管理指令支持查看、搜索、删除、清空、禁用自己的记忆。
- 增加 fakeRedis 单测和记忆模块测试，避免重构时把记忆写坏。

相关配置块：

- `memorySystem`
- `memoryAiConfig`
- `embeddingAiConfig`
- `personProfileInjection`

### 2. smart 模式和会话追踪

我把触发逻辑拆成 strict / smart 两类，让机器人不只依赖关键词硬触发。

主要改造：

- `strict` 模式：通过 @ 或触发词开启会话追踪，在追踪窗口内继续理解用户是不是还在跟 bot 说话。
- `smart` 模式：引入 Gate 子代理，按概率和上下文判断是否应该主动接话。
- 支持 `talkValue` 频率控制，降低每条消息都跑 Gate 的 token 消耗。
- 支持 FOCUS / FADING / COLD 这类会话焦点状态，避免刚聊完立刻断线，也避免冷群乱插话。
- 支持 waitTool，让 bot 在 smart 模式下可以“稍后再补一句”，更像真实聊天节奏。
- 加入 bot 速率硬上限、防刷屏、Deferred Timer、本地预筛。
- 优化复读、接话、追问、普通闲聊之间的判断。
- 给工具中的长任务加入状态感知，用户问“好了没”“是不是卡了”时能按任务状态回答。

相关配置块：

- `chatTriggerMode`
- `smartTrigger`
- `trackAiConfig`
- `conversationTracking`

### 3. 希洛人设和最终回复清理

这个仓库重点维护的是“希洛”的群聊表现，不是一个通用助手口吻。

主要改造：

- 系统提示词强化角色边界，避免“我是 AI”“作为助手”这类出戏表达。
- 对最终回复做清理，去掉伪工具调用、内部状态、CQ 码、流程说明和机器报错。
- 失败回复改成角色化表达，例如画图失败、审核拦截、上游超时、发送失败时不直接甩 API 错误。
- 保持“有一点话痨但是又害羞”的风格，不把拟人化简单压缩成短句。
- 图片生成、修图、识图开始前会先在群里说一句自然的话，避免用户不知道是不是卡住。
- 长任务放到后台跑，避免生图/修图期间整段会话被阻塞。

相关文件：

- `apps/test.js`
- `functions/functions_tools/BananaTool.js`
- `functions/functions_tools/GoogleImageEditTool.js`
- `functions/functions_tools/GoogleAnalysisTool.js`

### 4. 生图、修图和识图链路

围绕群聊里的真实用法，重点修了“上下文不进图”“承诺画图但没调用工具”“图片任务卡住不说话”等问题。

主要改造：

- 文生图走 `bananaTool`。
- 图生图 / 修图走 `googleImageEditTool`。
- 识图 / 截图分析走 `googleImageAnalysisTool`。
- 生图和修图都支持从引用消息、回复内容、近期相关对话里补上下文。
- 用户说“把这个画出来”“根据上面的内容画”“把这张改成...”时，会尽量把“这个/上面/刚才”的指代展开。
- 修图时明确要求保留参考图主体、构图关系和可识别特征，减少跑题。
- 对敏感或过直白的绘图需求，不是简单拒绝，而是尽量改写成含蓄、全年龄、能过审的表达。
- 图片生成任务支持队列、去重、后台执行、进度提示和状态查询。
- 支持火山 Ark / Seedream 这类 OpenAI 兼容或 images endpoint 形式的接入。
- 图像编辑接口兼容 chat completions 返回图片，也兼容 `/images/edits` form-data 风格。

相关配置块：

- `imageEditAiConfig`
- `analysisAiConfig`
- `toolsAiConfig`
- `oneapi_tools`

### 5. 长文本转图片和羊皮纸样式

为了避免 QQ 长文本刷屏，也为了让截图分析、代码解释这类回复更好看，我强化了 `textImageTool`。

主要改造：

- 普通聊天气泡样式：适合短代码、Markdown、普通长回复。
- 羊皮纸样式：适合截图分析、学习讲解、代码原因说明、长结构化解答。
- 羊皮纸支持短、中、长三种尺寸。
- 中长内容自动生成“先看结论”总览区，首屏更完整。
- 支持 Markdown 标题、列表、引用、代码块。
- 代码块支持基础高亮。
- 能把“正文解答”和“最后一句口头补充”拆开：主体进图，类似“交作业来得及呀”这种聊天味补充留在外面发文字。

相关文件：

- `functions/functions_tools/TextImageTool.js`
- `apps/test.js`

### 6. 本地表情包系统

我把表情包能力做成了比较完整的本地系统，而不是简单随机发图。

主要改造：

- 引用图片导入表情包。
- 支持列表、预览、删除、封禁、解封、重新打标、统计、重载、巡检。
- 图片本体和元数据分离存储。
- 支持 VLM 自动打标。
- 支持 embedding 召回，让文字语境能匹配合适表情。
- 支持最近发送过滤，减少重复刷同一张图。
- 支持软限流和发送节奏控制。
- 支持文件一致性巡检，标记缺文件或补登记孤立文件。

相关配置块：

- `emojiSystem`
- `analysisAiConfig`
- `embeddingAiConfig`

### 7. 知识库和工具体系

在原有工具体系上，我继续补了工具管理、知识库、MCP 和一批本地工具的稳定性。

主要改造：

- 本地知识库支持 embedding 语义检索。
- 支持批量导入知识文本。
- 支持 MCP 服务重载、状态查看、工具列表和手动测试。
- 支持自定义本地工具目录，避免更新时覆盖自己写的工具。
- 工具调用结果会被清理成自然回复，不直接暴露函数名和内部结构。
- 工具结果不会进入长期记忆，避免污染画像。
- 长任务工具支持 `(dedupe)` 防重复调用。

常见工具：

- `bananaTool`：文生图
- `googleImageEditTool`：修图 / 图生图
- `googleImageAnalysisTool`：识图 / 截图分析
- `textImageTool`：文字 / Markdown / 代码转图
- `searchInformationTool`：联网搜索
- `webParserTool`：网页解析
- `reminderTool`：定时提醒
- `sendLocalEmojiTool`：本地表情包
- `reactionTool`：贴表情
- `recallTool`：撤回消息
- `memberInfoTool`：群成员信息
- `sendGiftTool`：送礼物

### 8. 锅巴配置和热更新

配置项很多，所以我把大部分配置整理到了锅巴面板里。

主要改造：

- 适配 [Guoba-Plugin](https://github.com/guoba-yunzai/guoba-plugin)。
- 配置按模块分组：基础设置、权限、触发、会话追踪、AI 核心、记忆、表达学习、知识库、表情包、模型配置、工具等。
- 保存时尽量保留 yaml 注释。
- 配置写回后触发热更新，很多设置不用重启。
- 对 Guoba schema 做过精简，避免无效字段和过时字段干扰。

## 快速安装

在 Yunzai 根目录执行：

```bash
git clone --depth=1 https://github.com/WoJiSama/bl-chat-plugin plugins/bl-chat-plugin
cd plugins/bl-chat-plugin
pnpm install
```

如果你想安装上游原版，请使用：

```bash
git clone --depth=1 https://github.com/Cat-bl/bl-chat-plugin plugins/bl-chat-plugin
```

首次启动会自动创建 `config` 文件夹。

不要删除：

- `config_default/`
- `config_default/message.yaml`
- `config_default/mcp-servers.yaml`

运行时主要改：

- `config/message.yaml`
- `config/mcp-servers.yaml`

## 推荐安装锅巴

本仓库配置项很多，强烈建议用锅巴改配置。

在 Yunzai 根目录执行：

```bash
git clone --depth=1 https://gitee.com/guoba-yunzai/guoba-plugin.git ./plugins/Guoba-Plugin/
pnpm install --filter=guoba-plugin
```

重启 Yunzai 后，发送：

```text
#锅巴登录
```

打开锅巴面板后，可以在 Web UI 里管理本插件的大部分配置。

## 常用指令

### 插件管理

```text
#bl更新
#bl强制更新
#对话插件更新
#对话插件强制更新
#全局方案添加白名单群组 <群号>
#全局方案删除白名单群组 <群号>
#清除群聊记录
```

### MCP 管理

```text
#mcp 重载
#mcp 状态
#mcp 列表
#mcp 测试 <工具名> <JSON参数>
```

### 记忆管理

```text
#记忆状态
#我的记忆
#群记忆
#搜索记忆 <关键词>
#删除记忆 <记忆ID>
#清空我的记忆
#清空群记忆
#禁用我的记忆
#启用我的记忆
```

### 知识库管理

```text
#知识库添加 <知识内容>
#知识库删除 <关键词>
#知识库列表 [页码]
#知识库搜索 <文本>
#知识库清空
#知识库统计
```

### 表情包管理

```text
#表情包导入
#表情包列表 [页码]
#表情包预览 [hash前缀]
#表情包删除 [hash前缀]
#表情包封禁 [hash前缀]
#表情包解封 [hash前缀]
#表情包打标 [hash前缀]
#表情包统计
#表情包重载
#表情包巡检
#表情包清空 [确认]
```

## 关键配置入口

### 基础对话

```yaml
pluginSettings:
  enable: true
  allowedGroups: []
  chatTriggerMode: strict
  triggerPrefixes:
    - 希洛
```

### 模型配置

常用模型配置块：

```yaml
trackAiConfig:        # 会话跟踪 / smart Gate
toolsAiConfig:        # 工具调用模型
chatAiConfig:         # 普通聊天模型
imageEditAiConfig:    # 修图 / 图生图
analysisAiConfig:     # 识图 / 截图分析
searchAiConfig:       # 联网搜索总结
memoryAiConfig:       # 记忆提取
embeddingAiConfig:    # 知识库和语义记忆召回
```

### 工具列表

`oneapi_tools` 控制暴露给模型的工具。

执行时间长的工具可以加 `(dedupe)`：

```yaml
oneapi_tools:
  - bananaTool(dedupe)
  - googleImageEditTool(dedupe)
  - videoAnalysisTool(dedupe)
  - textImageTool
  - googleImageAnalysisTool
  - searchInformationTool
  - webParserTool
```

`(dedupe)` 只用于防止同一用户重复触发同一个长任务，模型看到的工具名仍然是不带后缀的原名。

### smart 模式

```yaml
chatTriggerMode: smart
smartTrigger:
  enabled: true
  talkValue: 0.15
  waitToolEnabled: true
```

`talkValue` 控制 Gate 子代理触发频率：

- `1`：每条消息都判断，最敏感，也最耗 token。
- `0.15`：大约每 7 条消息判断一次，比较折中。
- `0.1`：大约每 10 条消息判断一次。

smart 模式依赖 `trackAiConfig`。如果没有配置 Gate 模型，bot 基本不会主动接话。

### 长期记忆

```yaml
memorySystem:
  enabled: true
  semanticRecallEnabled: true
  promptMaxChars: 1200
```

开启长期记忆至少需要配置：

- `memoryAiConfig`

如果要用语义召回，还需要配置：

- `embeddingAiConfig`

### 图片生成 / 修图 / 识图

```yaml
imageEditAiConfig:
  imageEditApiUrl: ""
  imageEditApiKey: ""
  imageEditApiModel: ""

analysisAiConfig:
  analysisApiUrl: ""
  analysisApiKey: ""
  analysisApiModel: ""
```

图像相关工具会根据消息自动选择：

- 文字画图：`bananaTool`
- 修图 / 图生图：`googleImageEditTool`
- 看图 / 分析截图：`googleImageAnalysisTool`

## 自定义本地工具

不要直接改 `functions/functions_tools` 里的自带工具。自定义工具放这里：

```text
plugins/bl-chat-plugin/custom_tools/
```

步骤：

1. 复制 `custom_tools/exampleTool.js.example`。
2. 修改类名、`this.name`、`description`、`parameters`。
3. 实现 `func()`。
4. 在 `config/message.yaml` 的 `oneapi_tools` 里加入工具名。
5. 重启，或修改一次配置触发热更新。

## 项目内文件速查

```text
apps/test.js
  主对话入口、触发逻辑、工具选择、最终回复清理、会话追踪。

functions/functions_tools/
  本地工具目录。生图、修图、识图、文字转图、搜索、提醒等都在这里。

utils/MemoryManager.js
  记忆系统门面，负责提取、保存、召回和 prompt 组装。

utils/memory/
  记忆重构后的核心模块。

models/Guoba/schemas/
  锅巴配置 schema。

config_default/message.yaml
  默认配置模板。

config_default/mcp-servers.yaml
  MCP 服务默认配置模板。
```

## 使用建议

- 先把 `chatAiConfig` 和 `toolsAiConfig` 配好，再开工具。
- smart 模式一定要配 `trackAiConfig`，否则主动接话会很弱。
- 记忆系统先用小模型跑稳定，再考虑打开 embedding 语义召回。
- 生图、修图、识图建议分别配适合的模型，不要所有任务共用一个慢模型。
- 长任务工具建议加 `(dedupe)`，防止群里连续刷同一个请求。
- 如果你只想要原版插件，建议直接使用上游 [Cat-bl/bl-chat-plugin](https://github.com/Cat-bl/bl-chat-plugin)。

## 维护说明

这个 README 主要面向我自己的改造版，内容会优先描述本仓库的设计目标和改造主线。

详细参数最终以 `config_default/message.yaml`、锅巴 schema 和实际代码为准。上游功能如果发生变化，本仓库不保证同步更新说明。
