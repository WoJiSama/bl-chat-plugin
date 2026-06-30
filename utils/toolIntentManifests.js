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
      /今日密码|每日密码/
    ],
    disclosure: [
      "【deltaForceTool 详细用法】",
      "用途：查询三角洲行动相关接口数据。",
      "不要被“今天的/最新的/发一下”干扰，先看用户真正要查的子功能。",
      "operation 选择规则：",
      "- 改枪码、改枪方案、方案码、枪码 -> operation=solution_list",
      "- 物品价值、价格、多少钱、值多少 -> operation=object_value",
      "- 特勤处利润、制造利润 -> operation=place_profit",
      "- 利润排行、利润榜 -> operation=profit_rank",
      "- 今日密码、每日密码、口令 -> operation=daily_keyword",
      "keyword 抽取规则：",
      "- “我要和277有关的”“关于 H70 的”“查 M4A1 相关”里的 277/H70/M4A1 是 keyword。",
      "- “名字有 非洲 的物品价格”“名称包含 非洲 的物品价值”里的 非洲 是 keyword；不要把“名字有/物品/价格”放进 keyword。",
      "- 对 solution_list，keyword 可选但有关键词就必须填写。",
      "- 对 object_value，keyword 必填；缺关键词时不要乱填，应选择 chat 追问。",
      "等价例子：",
      "- “希洛发一下今天的三角洲的改枪码，我要和277有关的” -> {\"operation\":\"solution_list\",\"keyword\":\"277\"}",
      "- “三角洲 H70 现在多少钱” -> {\"operation\":\"object_value\",\"keyword\":\"H70\"}",
      "- “希洛告诉我今天的三角洲的名字有 非洲 的物品的价格” -> {\"operation\":\"object_value\",\"keyword\":\"非洲\"}",
      "- “看下三角洲工作台利润排行前5” -> {\"operation\":\"profit_rank\",\"place\":\"工作台\",\"limit\":5}",
      "- “三角洲今日密码” -> {\"operation\":\"daily_keyword\"}"
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
  return candidates
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
