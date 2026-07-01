export const DEFAULT_GROUP_MODERATION_CONFIG = {
  enabled: false,
  enabledGroups: [],
  globalAdmins: [],
  groupAdmins: [],
  minActiveLevel: 5,
  inspectLowLevelOnly: true,
  publicReportEnabled: true,
  forwardEvidenceToAdmins: true,
  evidenceMaxChars: 1200,
  modelReviewEnabled: false,
  modelThreshold: 0.55,
  thresholds: {
    report: 0.7,
    recall: 0.85,
    mute: 0.9,
    kick: 0.97
  },
  actions: {
    recallEnabled: false,
    muteEnabled: false,
    kickEnabled: false,
    muteSeconds: 600
  },
  reportTemplate: "群管检测：命中规则{rules},置信度:{confidence}。{actionText}{evidenceText}"
}

const RULE_DEFINITIONS = [
  {
    name: "包含外链",
    weight: 0.22,
    test: text => /(https?:\/\/|www\.|t\.cn\/|u\.jd\.com|tb\.cn|m.tb.cn|dwz\.cn|url\.cn|bit\.ly|tinyurl\.com)/i.test(text)
  },
  {
    name: "包含群邀请",
    weight: 0.18,
    test: text => /(加群|群号|QQ群|qq\s*群|邀请.*群|进群|群聊).{0,16}(\d{6,12}|链接|二维码)/i.test(text)
  },
  {
    name: "疑似招募话术",
    weight: 0.2,
    test: text => /(招募|招人|收人|拉人|推广|地推|代理|兼职|日结|周结|躺赚|副业|宝妈|学生党|长期有效|免费带|带你赚|名额有限|私聊|加[我vV]|加微信|薇信)/i.test(text)
  },
  {
    name: "包含联系方式",
    weight: 0.16,
    test: text => /(微信|VX|vx|v信|薇信|企鹅|QQ|电话|手机号|联系).{0,12}([a-zA-Z][-_a-zA-Z0-9]{4,}|\d{6,12})/i.test(text)
  },
  {
    name: "疑似违规交易",
    weight: 0.22,
    test: text => /(博彩|棋牌|投注|返钱|返利|佣金|包赔|色情|约炮|裸聊|外挂|脚本|代打|代练|黑号|洗钱|跑分|卖课|课程代理)/i.test(text)
  },
  {
    name: "疑似图片广告",
    weight: 0.12,
    test: (_text, context) => Number(context.imageCount || 0) > 0 && context.textLength <= 20
  },
  {
    name: "频繁艾特",
    weight: 0.12,
    test: (_text, context) => Number(context.atCount || 0) >= 3
  }
]

export function normalizeStringList(value) {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item).trim()).filter(Boolean)
}

function normalizeNumber(value, fallback, min, max) {
  const number = Number(value)
  const normalized = Number.isFinite(number) ? number : fallback
  return Math.min(max, Math.max(min, normalized))
}

function normalizeGroupAdmins(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (!item || typeof item !== "object") return null
      const groupId = String(item.groupId ?? item.group_id ?? item.group ?? "").trim()
      const admins = normalizeStringList(item.admins ?? item.users ?? item.userIds)
      if (!groupId || !admins.length) return null
      return { groupId, admins }
    })
    .filter(Boolean)
}

export function normalizeGroupModerationConfig(raw = {}) {
  const thresholds = { ...DEFAULT_GROUP_MODERATION_CONFIG.thresholds, ...(raw?.thresholds || {}) }
  const actions = { ...DEFAULT_GROUP_MODERATION_CONFIG.actions, ...(raw?.actions || {}) }
  const config = {
    ...DEFAULT_GROUP_MODERATION_CONFIG,
    ...(raw || {}),
    thresholds,
    actions
  }

  config.enabledGroups = normalizeStringList(config.enabledGroups)
  config.globalAdmins = normalizeStringList(config.globalAdmins)
  config.groupAdmins = normalizeGroupAdmins(config.groupAdmins)
  config.minActiveLevel = normalizeNumber(config.minActiveLevel, DEFAULT_GROUP_MODERATION_CONFIG.minActiveLevel, 0, 100)
  config.evidenceMaxChars = Math.floor(normalizeNumber(config.evidenceMaxChars, DEFAULT_GROUP_MODERATION_CONFIG.evidenceMaxChars, 200, 5000))
  config.modelThreshold = normalizeNumber(config.modelThreshold, DEFAULT_GROUP_MODERATION_CONFIG.modelThreshold, 0, 1)
  config.thresholds.report = normalizeNumber(config.thresholds.report, 0.7, 0, 1)
  config.thresholds.recall = normalizeNumber(config.thresholds.recall, 0.85, 0, 1)
  config.thresholds.mute = normalizeNumber(config.thresholds.mute, 0.9, 0, 1)
  config.thresholds.kick = normalizeNumber(config.thresholds.kick, 0.97, 0, 1)
  config.actions.muteSeconds = Math.floor(normalizeNumber(config.actions.muteSeconds, 600, 60, 2592000))
  return config
}

export function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0))
}

export function formatActionName(action) {
  const map = {
    report: "提醒",
    recall: "撤回",
    mute: "禁言",
    kick: "踢出"
  }
  return map[action] || action
}

export function buildModerationReport(result, config = DEFAULT_GROUP_MODERATION_CONFIG) {
  const rules = `[${(result.rules || []).map(rule => JSON.stringify(String(rule))).join(", ")}]`
  const confidence = clamp01(result.confidence).toFixed(2)
  const actionText = result.action && result.action !== "report"
    ? `处理动作:${formatActionName(result.action)}。`
    : ""
  const evidenceText = result.evidenceForwarded ? "证据已转发到群管理员私聊" : ""
  const template = config.reportTemplate || DEFAULT_GROUP_MODERATION_CONFIG.reportTemplate
  return template
    .replaceAll("{rules}", rules)
    .replaceAll("{confidence}", confidence)
    .replaceAll("{action}", result.action || "report")
    .replaceAll("{actionText}", actionText)
    .replaceAll("{evidenceText}", evidenceText)
    .trim()
}

export function analyzeModerationRules({ text = "", memberLevel, imageCount = 0, atCount = 0 } = {}, config = DEFAULT_GROUP_MODERATION_CONFIG) {
  const rules = []
  let confidence = 0
  const levelNumber = Number(memberLevel)
  if (Number.isFinite(levelNumber) && levelNumber <= Number(config.minActiveLevel)) {
    rules.push("低活跃等级")
    confidence += 0.24
  }

  const context = {
    imageCount,
    atCount,
    textLength: String(text || "").trim().length
  }

  for (const rule of RULE_DEFINITIONS) {
    if (rule.test(String(text || ""), context)) {
      rules.push(rule.name)
      confidence += rule.weight
    }
  }

  if (rules.includes("低活跃等级") && rules.length >= 3) confidence += 0.12
  if (rules.includes("包含外链") && rules.includes("疑似招募话术")) confidence += 0.1
  return {
    rules: [...new Set(rules)],
    confidence: clamp01(confidence)
  }
}
