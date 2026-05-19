export default [
  {
    component: "SOFT_GROUP_BEGIN",
    label: "表情包系统 (emojiSystem) - 主开关与路径"
  },
  {
    field: "emojiSystem.enabled",
    label: "表情包系统主开关",
    component: "Switch",
    bottomHelpMessage: "关闭时 sendLocalEmojiTool 不暴露给 LLM、autoCollect 不工作、维护循环不启动"
  },
  {
    field: "emojiSystem.dbPath",
    label: "元数据 ndjson 路径",
    component: "Input",
    bottomHelpMessage: "相对路径相对 Yunzai 根目录",
    componentProps: { placeholder: "plugins/bl-chat-plugin/database/emoji-packs.ndjson" }
  },
  {
    field: "emojiSystem.storeDir",
    label: "表情包图片目录",
    component: "Input",
    bottomHelpMessage: "表情包图片本体存放目录，相对路径相对 Yunzai 根目录",
    componentProps: { placeholder: "plugins/bl-chat-plugin/database/emoji_files" }
  },
  {
    field: "emojiSystem.maxItems",
    label: "最大存储数量",
    component: "InputNumber",
    bottomHelpMessage: "超过后新表情包不能入库（除非启用 doReplace）",
    componentProps: { min: 10, max: 2000, placeholder: "200" }
  },

  {
    component: "SOFT_GROUP_BEGIN",
    label: "表情包系统 - 自动收集与打标"
  },
  {
    field: "emojiSystem.autoCollect",
    label: "自动收集",
    component: "Switch",
    bottomHelpMessage: "是否自动收集群里图片入库。默认关，开启建议同时开 contentFiltration"
  },
  {
    field: "emojiSystem.visionTagOnAdd",
    label: "VLM 自动打标",
    component: "Switch",
    bottomHelpMessage: "入库时调 VLM 打 3-5 个情绪标签 + 一句描述。依赖 analysisAiConfig"
  },
  {
    field: "emojiSystem.contentFiltration",
    label: "内容审查",
    component: "Switch",
    bottomHelpMessage: "入库前调 VLM 判断是否适合作表情包，挡风景照/截图/广告。每张图多 1 次 VLM 调用"
  },

  {
    component: "SOFT_GROUP_BEGIN",
    label: "表情包系统 - 选图与召回"
  },
  {
    field: "emojiSystem.useEmbedding",
    label: "Embedding 召回",
    component: "Switch",
    bottomHelpMessage: "给表情生成向量用于 L1 语义召回。依赖 embeddingAiConfig"
  },
  {
    field: "emojiSystem.selectionTopK",
    label: "Top-K 召回数",
    component: "InputNumber",
    bottomHelpMessage: "embedding 召回取相似度 top-K，再从中随机一张",
    componentProps: { min: 1, max: 50, placeholder: "5" }
  },
  {
    field: "emojiSystem.embeddingThreshold",
    label: "相似度阈值",
    component: "InputNumber",
    bottomHelpMessage: "低于此值不进候选。0.3 太宽，0.5 太严，0.35 小库友好",
    componentProps: { min: 0, max: 1, step: 0.05, placeholder: "0.35" }
  },

  {
    component: "SOFT_GROUP_BEGIN",
    label: "表情包系统 - 满额替换与维护"
  },
  {
    field: "emojiSystem.doReplace",
    label: "满额 LLM 替换",
    component: "Switch",
    bottomHelpMessage: "库满时让 LLM 决策删一张旧的腾位置。依赖 toolsAiConfig"
  },
  {
    field: "emojiSystem.enableMaintenance",
    label: "周期文件巡检",
    component: "Switch",
    bottomHelpMessage: "后台定时巡检文件↔记录双向对账"
  },
  {
    field: "emojiSystem.checkIntervalMinutes",
    label: "巡检间隔（分钟）",
    component: "InputNumber",
    bottomHelpMessage: "周期巡检的间隔，仅 enableMaintenance 开启时生效",
    componentProps: { min: 1, max: 1440, placeholder: "10" }
  },

  {
    component: "SOFT_GROUP_BEGIN",
    label: "表情包系统 - 反重复挑图"
  },
  {
    field: "emojiSystem.avoidRecentEnabled",
    label: "反重复开关",
    component: "Switch",
    bottomHelpMessage: "避免短时间发同一张图或同一种情绪标签"
  },
  {
    field: "emojiSystem.avoidRecentCount",
    label: "记忆最近 N 次",
    component: "InputNumber",
    bottomHelpMessage: "每群记忆最近 N 次发过的表情用于过滤",
    componentProps: { min: 1, max: 50, placeholder: "5" }
  },
  {
    field: "emojiSystem.avoidRecentTtlMinutes",
    label: "最近发送 TTL（分钟）",
    component: "InputNumber",
    bottomHelpMessage: "超过 N 分钟后最近发送记录失效，可重新被选",
    componentProps: { min: 1, max: 120, placeholder: "5" }
  },

  {
    component: "SOFT_GROUP_BEGIN",
    label: "表情包系统 - 文字+表情节奏"
  },
  {
    field: "emojiSystem.followUpDelayMinMs",
    label: "节奏延迟最小值（毫秒）",
    component: "InputNumber",
    bottomHelpMessage: "LLM 传 followUpText 时，文字发出后等待的最小毫秒数",
    componentProps: { min: 0, max: 5000, placeholder: "300" }
  },
  {
    field: "emojiSystem.followUpDelayMaxMs",
    label: "节奏延迟最大值（毫秒）",
    component: "InputNumber",
    bottomHelpMessage: "实际取 min-max 随机，模拟人类敲字间隔",
    componentProps: { min: 0, max: 10000, placeholder: "1200" }
  },

  {
    component: "SOFT_GROUP_BEGIN",
    label: "表情包系统 - 软限流防刷屏"
  },
  {
    field: "emojiSystem.rateLimitEnabled",
    label: "软限流开关",
    component: "Switch",
    bottomHelpMessage: "超额时工具返回 error，LLM 自然改用文字"
  },
  {
    field: "emojiSystem.rateLimitWindowMinutes",
    label: "限流窗口（分钟）",
    component: "InputNumber",
    bottomHelpMessage: "统计该群在过去 N 分钟内发了多少个表情",
    componentProps: { min: 1, max: 60, placeholder: "1" }
  },
  {
    field: "emojiSystem.rateLimitMaxPerWindow",
    label: "窗口内最大发送次数",
    component: "InputNumber",
    bottomHelpMessage: "设 0 视为不限",
    componentProps: { min: 0, max: 100, placeholder: "3" }
  }
]
