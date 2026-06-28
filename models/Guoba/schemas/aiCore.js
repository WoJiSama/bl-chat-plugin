export default [
  {
    field: "systemContent",
    label: "系统提示词（人设）",
    component: "InputTextArea",
    bottomHelpMessage: "定义 AI 的个性、行为准则和回答风格。这是决定 bot 性格的核心字段",
    componentProps: { rows: 8, placeholder: "你的名字叫哈基米..." }
  },
  {
    field: "useTools",
    label: "工具调用开关",
    component: "Switch",
    bottomHelpMessage: "是否启用扩展功能工具（搜索、点赞、戳一戳、表情包等）"
  },
  {
    field: "maxToolRounds",
    label: "最大工具调用轮次",
    component: "InputNumber",
    bottomHelpMessage: "单次对话中允许 LLM 连续调用工具的最大轮数，防止死循环",
    componentProps: { min: 1, max: 20, placeholder: "2" }
  },
  {
    component: "Divider",
    label: "理解增强"
  },
  {
    field: "understandingEnhancement.enabled",
    label: "理解增强开关",
    component: "Switch",
    bottomHelpMessage: "遇到引用、合并转发、图片、长上下文或指代词时，注入结构化理解卡片，减少漏看和答偏；不会额外调用模型"
  },
  {
    field: "understandingEnhancement.maxChars",
    label: "理解卡片字符上限",
    component: "InputNumber",
    bottomHelpMessage: "限制理解卡片占用的上下文长度，过大可能挤占聊天历史",
    componentProps: { min: 600, max: 3000, step: 100, placeholder: "1400" }
  },
  {
    field: "understandingEnhancement.includeRecentContext",
    label: "带少量近期上下文",
    component: "Switch",
    bottomHelpMessage: "在理解卡片中加入少量近期对话，帮助理解“这个/刚才/里面”等指代"
  }
]
