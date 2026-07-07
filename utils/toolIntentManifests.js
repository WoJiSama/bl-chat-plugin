function normalizeText(text = "") {
  return String(text || "")
    .replace(/\[CQ:[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const TOOL_INTENT_MANIFESTS = {
  deltaForceTool: {
    triggers: [
      /三角洲/,
      /改枪码|改枪方案|方案码|枪码/,
      /特勤处|制造利润|利润排行/,
      /价格历史|历史价格|价格走势|折线图|趋势图/,
      /今日密码|每日密码/
    ],
    disclosure: [
      "【deltaForceTool 详细用法】",
      "用途：查询三角洲行动相关接口数据。",
      "不要被“今天的/最新的/发一下”干扰，先看用户真正要查的子功能。",
      "operation 选择规则：",
      "- 改枪码、改枪方案、方案码、枪码 -> operation=solution_list",
      "- 价格历史、历史价格、价格走势、价格曲线、折线图、趋势图 -> operation=price_history",
      "- 物品价值、价格、多少钱、值多少 -> operation=object_value",
      "- 特勤处利润、制造利润 -> operation=place_profit",
      "- 利润排行、利润榜 -> operation=profit_rank",
      "- 今日密码、每日密码、口令 -> operation=daily_keyword",
      "keyword 抽取规则：",
      "- “我要和277有关的”“关于 H70 的”“查 M4A1 相关”里的 277/H70/M4A1 是 keyword。",
      "- “名字有 非洲 的物品价格”“名称包含 非洲 的物品价值”里的 非洲 是 keyword；不要把“名字有/物品/价格”放进 keyword。",
      "- 对 solution_list，keyword 可选但有关键词就必须填写。",
      "- 对 object_value，keyword 必填；缺关键词时不要乱填，应选择 chat 追问。",
      "- 对 price_history，keyword 必填；days 默认 30；limit 表示要给几个匹配物品画图，默认 5。",
      "等价例子：",
      "- “希洛发一下今天的三角洲的改枪码，我要和277有关的” -> {\"operation\":\"solution_list\",\"keyword\":\"277\"}",
      "- “三角洲 H70 现在多少钱” -> {\"operation\":\"object_value\",\"keyword\":\"H70\"}",
      "- “三角洲显卡最近价格走势折线图” -> {\"operation\":\"price_history\",\"keyword\":\"显卡\"}",
      "- “希洛告诉我今天的三角洲的名字有 非洲 的物品的价格” -> {\"operation\":\"object_value\",\"keyword\":\"非洲\"}",
      "- “看下三角洲工作台利润排行前5” -> {\"operation\":\"profit_rank\",\"place\":\"工作台\",\"limit\":5}",
      "- “三角洲今日密码” -> {\"operation\":\"daily_keyword\"}"
    ].join("\n")
  },
  reminderTool: {
    triggers: [
      /提醒我|叫我|到点|定个?闹钟|设个?提醒|别忘了|待会儿|过\d+秒|过\d+分钟|过\d+小时|\d+点.*提醒/
    ],
    disclosure: [
      "【reminderTool 详细用法】",
      "用途：创建、查看、取消定时提醒。",
      "operation/action 选择规则：",
      "- 用户说“提醒我/叫我/到点告诉我/定个提醒” -> action=create",
      "- 用户说“我的提醒/提醒列表/有哪些提醒” -> action=list",
      "- 用户说“取消提醒/删掉提醒” -> action=cancel；没有 reminder_id 时选 chat 追问。",
      "时间抽取规则：",
      "- 相对时间必须根据当前北京时间换算成 ISO 8601，并带 +08:00。",
      "- “10分钟后提醒我喝水” -> reminder_time 为当前时间 +10 分钟，content=喝水。",
      "- reminder_message 要像群友自然提醒，不要写成正式系统通知。",
      "等价例子：",
      "- “半小时后提醒我收菜” -> {\"action\":\"create\",\"content\":\"收菜\",\"reminder_message\":\"该收菜啦\",\"reminder_time\":\"按当前北京时间+30分钟\"}",
      "- “看看我的提醒” -> {\"action\":\"list\"}"
    ].join("\n")
  },
  searchMusicTool: {
    triggers: [
      /点歌|放首|听歌|来首|唱一首|播放.+歌|想听|随机.*歌/
    ],
    disclosure: [
      "【searchMusicTool 详细用法】",
      "用途：搜索并发送 QQ 音乐卡片。",
      "keyword 抽取规则：",
      "- 指定歌曲时 keyword=歌曲名或 歌曲名+歌手。",
      "- 只给歌手名或“来首周杰伦的歌”时 isArtistOnly=true，keyword=歌手名。",
      "- 不要把“放首/点歌/想听”等动词放入 keyword。",
      "等价例子：",
      "- “希洛点一首晴天” -> {\"keyword\":\"晴天\",\"isArtistOnly\":false}",
      "- “来首周杰伦的” -> {\"keyword\":\"周杰伦\",\"isArtistOnly\":true}"
    ].join("\n")
  },
  voiceTool: {
    triggers: [
      /语音|发条语音|用语音|念出来|读出来|说给我听|录一段/
    ],
    disclosure: [
      "【voiceTool 详细用法】",
      "用途：发送短 QQ 语音。",
      "调用边界：",
      "- 只有用户明确要求语音/念出来/读出来时调用。",
      "- 不要用它读长文、代码、列表、搜索结果或工具结果。",
      "参数规则：",
      "- text 必须是短句、纯口播文字，不要 Markdown、代码或动作描写。",
      "- style 可选 normal/shy/tease/serious/sleepy；不确定就省略。",
      "等价例子：",
      "- “希洛用语音说晚安” -> {\"text\":\"晚安，早点睡哦\",\"style\":\"sleepy\"}"
    ].join("\n")
  },
  sendLocalEmojiTool: {
    triggers: [
      /表情包|斗图|来.*表情|发.*表情|找.*表情|搜.*表情|配.*表情|来.*图|发.*图/
    ],
    disclosure: [
      "【sendLocalEmojiTool 详细用法】",
      "用途：从本地表情包库挑一张合适的表情包发送。",
      "调用边界：",
      "- 用户明确要表情包/斗图/发个表情时优先调用。",
      "- 闲聊中需要轻微接梗、无语、笑死、害羞、得意等情绪反应时也可以少量调用。",
      "- 严肃问答、技术排查、长说明、工具结果汇报时不要调用。",
      "参数规则：",
      "- query 要写成 10-30 字的情境描述，不要只写“开心/无语”两个字。",
      "- followUpText 可选，用来先发一句短文字再发表情；用户只要表情时可以不填。",
      "- 一次只发一张，别连发刷屏。",
      "等价例子：",
      "- “来个无语表情包” -> {\"query\":\"听到离谱发言后无语又绷不住的表情\"}",
      "- “希洛发个笑死的图” -> {\"query\":\"看到群友翻车想笑死接梗的表情\",\"followUpText\":\"笑死\"}"
    ].join("\n")
  },
  emojiSearchTool: {
    triggers: [
      /搜.*表情包|网上.*表情包|堆糖.*表情/
    ],
    disclosure: [
      "【emojiSearchTool 详细用法】",
      "用途：从远程网站按关键词搜索表情包。只有用户明确要网上搜索表情包时使用；普通发图优先 sendLocalEmojiTool。",
      "参数规则：",
      "- keyword 是表情主题，如 猫猫、无语、开心、抱抱。",
      "- count 默认 1；范围 1-10。"
    ].join("\n")
  },
  searchInformationTool: {
    triggers: [
      /搜索|查一下|搜一下|最新|今天.*新闻|现在.*(?:价格|天气|政策|消息)|实时|资料|百科/
    ],
    disclosure: [
      "【searchInformationTool 详细用法】",
      "用途：需要实时信息、外部资料、新闻、政策、当前价格、搜索结果时调用。",
      "调用边界：",
      "- 普通知识、闲聊、已有上下文能回答时不要调用。",
      "- 用户给了具体网页 URL 并要解析网页内容，优先 webParserTool。",
      "- 用户给了 GitHub 仓库链接并问仓库信息，优先 githubRepoTool。",
      "参数规则：",
      "- query 写完整搜索词，保留关键限定词，如日期、地区、产品名。",
      "等价例子：",
      "- “查一下今天 OpenAI 有什么新闻” -> {\"query\":\"今天 OpenAI 新闻\"}"
    ].join("\n")
  },
  webParserTool: {
    triggers: [
      /https?:\/\/\S+|www\.\S+|解析.*网页|总结.*链接|看看.*链接|这个网址/
    ],
    disclosure: [
      "【webParserTool 详细用法】",
      "用途：解析用户给出的网页链接内容并提取关键信息。",
      "调用边界：",
      "- 用户只给搜索需求但没有 URL 时不要调用，改用 searchInformationTool。",
      "- GitHub 仓库 URL 且用户问仓库信息时优先 githubRepoTool。",
      "参数规则：",
      "- url 只填写单个网页 URL；如果用户给多个链接，优先处理最相关的一个或选 chat 追问。",
      "等价例子：",
      "- “帮我总结 https://example.com 这个页面” -> {\"url\":\"https://example.com\"}"
    ].join("\n")
  },
  githubRepoTool: {
    triggers: [
      /github\.com\/[^/\s]+\/[^/\s]+|GitHub.*仓库|仓库.*star|repo/
    ],
    disclosure: [
      "【githubRepoTool 详细用法】",
      "用途：获取 GitHub 仓库基本信息、提交、issue、PR、贡献者等。",
      "调用边界：",
      "- 只有明确是 GitHub 仓库 URL 或询问仓库信息时调用。",
      "- 普通网页链接不要调用，改用 webParserTool。",
      "参数规则：",
      "- repoUrl 必须是 GitHub 仓库 URL，不要填 issue、release、文件路径以外的普通网页。",
      "等价例子：",
      "- “看看 https://github.com/user/repo 这个仓库怎么样” -> {\"repoUrl\":\"https://github.com/user/repo\"}"
    ].join("\n")
  },
  aiMindMapTool: {
    triggers: [
      /思维导图|脑图|mind ?map|整理成导图|生成导图|知识结构图/
    ],
    disclosure: [
      "【aiMindMapTool 详细用法】",
      "用途：把主题、材料或说明整理成 Markmap 思维导图图片。",
      "参数规则：",
      "- prompt 写要整理成导图的主题和内容。",
      "- 不确定尺寸时不要填 width/height。",
      "- 用户只是要普通总结/列表，不要调用；明确要导图/脑图才调用。",
      "等价例子：",
      "- “把这段 Java 学习路线做成思维导图” -> {\"prompt\":\"Java 学习路线...\"}"
    ].join("\n")
  },
  textImageTool: {
    triggers: [
      /转成图片|生成图片版|长图|发成图|做成图|代码.*图片|Markdown.*图片|避免刷屏/
    ],
    disclosure: [
      "【textImageTool 详细用法】",
      "用途：把文字、Markdown、代码、长篇讲解渲染成图片发送。",
      "调用边界：",
      "- 用户要求写代码、Markdown 文档、长篇结构化内容时，适合调用。",
      "- 普通短回复不要调用。",
      "参数规则：",
      "- text 放完整要渲染的内容。",
      "- template: 短聊天气泡用 chat；长文、讲解、代码、Markdown 用 document。",
      "等价例子：",
      "- “把这段代码发成图片” -> {\"text\":\"完整代码\",\"template\":\"document\"}"
    ].join("\n")
  },
  pokeTool: {
    triggers: [
      /戳一戳|戳戳|戳一下|poke/
    ],
    disclosure: [
      "【pokeTool 详细用法】",
      "用途：对群成员发送戳一戳。",
      "参数规则：",
      "- target 是 QQ 号、群名片或昵称数组；被 @ 时优先用被 @ 人。",
      "- times 默认 1，最大 10。",
      "- 用户说随机戳人时 random=true。",
      "等价例子：",
      "- “戳一下小明” -> {\"target\":[\"小明\"],\"times\":1}"
    ].join("\n")
  },
  likeTool: {
    triggers: [
      /点赞|给.*赞|赞一下|QQ赞|名片赞/
    ],
    disclosure: [
      "【likeTool 详细用法】",
      "用途：给 QQ 用户点赞。",
      "参数规则：",
      "- qq 留空时默认给发送者或 @ 对象点赞。",
      "- count 默认 10，最多 20。",
      "- 随机点赞时 random=true。",
      "等价例子：",
      "- “给我点20个赞” -> {\"count\":20}"
    ].join("\n")
  },
  changeCardTool: {
    triggers: [
      /改群名片|改名片|改昵称|群昵称|把.*名字改成|改.*群名/
    ],
    disclosure: [
      "【changeCardTool 详细用法】",
      "用途：修改群名片/群昵称。",
      "参数规则：",
      "- target 是目标用户；“把我改成X”时 target 填发送者/我。",
      "- cardName 是要改成的新群名片。",
      "- senderRole 按当前发送者身份 owner/admin/member 填写。",
      "等价例子：",
      "- “把我群名片改成小希” -> {\"target\":\"我\",\"cardName\":\"小希\",\"senderRole\":\"按发送者身份\"}"
    ].join("\n")
  },
  jinyanTool: {
    triggers: [
      /禁言|闭嘴|解除禁言|解禁|mute|全体禁言/
    ],
    disclosure: [
      "【jinyanTool 详细用法】",
      "用途：群禁言/解禁，属于权限敏感操作。",
      "调用边界：",
      "- 用户明确要求禁言/解禁，或明显违规且需要自主处理时才调用。",
      "- 不要因为普通玩笑、争论或轻微情绪就自主禁言。",
      "参数规则：",
      "- target 是目标 QQ/昵称数组；不要把时间词混进 target。",
      "- time 单位秒；解除禁言 time=0。",
      "- 被用户要求执行时 selfDecision=false；机器人自主处理违规时 selfDecision=true。",
      "- 全体禁言必须有明确请求和 confirm=true。",
      "等价例子：",
      "- “禁言小明一分钟” -> {\"target\":[\"小明\"],\"time\":60,\"selfDecision\":false}",
      "- “解除小明禁言” -> {\"target\":[\"小明\"],\"time\":0,\"selfDecision\":false}"
    ].join("\n")
  }
}

export function selectToolIntentCandidates(text = "", availableToolNames = []) {
  const content = normalizeText(text)
  if (!content) return []
  const available = new Set(availableToolNames)
  const candidates = []
  for (const [toolName, manifest] of Object.entries(TOOL_INTENT_MANIFESTS)) {
    if (!available.has(toolName)) continue
    if (manifest.triggers.some(pattern => pattern.test(content))) candidates.push(toolName)
  }
  return resolveCandidateConflicts(candidates, content)
}

function resolveCandidateConflicts(candidates = [], content = "") {
  let resolved = [...candidates]

  if (resolved.includes("githubRepoTool")) {
    resolved = resolved.filter(name => name !== "webParserTool" && name !== "searchInformationTool")
  }

  const specificTools = resolved.filter(name => !["searchInformationTool", "webParserTool"].includes(name))
  if (specificTools.length) {
    resolved = resolved.filter(name => name !== "searchInformationTool")
  }

  return resolved
}

export function buildToolIntentDisclosure(toolNames = []) {
  const parts = []
  for (const name of toolNames) {
    const text = TOOL_INTENT_MANIFESTS[name]?.disclosure
    if (text) parts.push(text)
  }
  return parts.join("\n\n")
}

export function hasToolIntentManifest(toolName = "") {
  return Boolean(TOOL_INTENT_MANIFESTS[toolName])
}
