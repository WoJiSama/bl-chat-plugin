import fs from "fs"
import path from "path"

const DEFAULT_BAD_PATTERNS = [
  "我是不是太啰嗦",
  "是不是说多了",
  "好像有点啰嗦",
  "扯远了",
  "作为AI",
  "作为一个AI",
  "我是AI",
  "我是一个AI",
  "很抱歉",
  "抱歉，我不能",
  "我无法满足",
  "我不能满足",
  "我不能帮你",
  "无法协助"
]

const FEEDBACK_TAG_RULES = [
  { key: "too_hard", label: "拒绝太硬", pattern: /太硬|强硬|拒绝|不该拒绝|别拒绝|不要这样拒绝/ },
  { key: "too_verbose", label: "太啰嗦", pattern: /啰嗦|话多|太长|废话|太多|少说/ },
  { key: "too_customer", label: "客服腔", pattern: /客服|官方|模板|机器人|说明书|不自然/ },
  { key: "good_tone", label: "语气好", pattern: /不错|很好|挺好|语气好|这个好|这样好|喜欢/ },
  { key: "bad_tone", label: "语气不对", pattern: /语气不对|怪|别这样|不喜欢|不对劲|阴阳怪气/ }
]

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function nowIso() {
  return new Date().toISOString()
}

function compactText(text = "", max = 900) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max)
}

function normalizeConfig(config = {}) {
  return {
    enabled: config.enabled !== false,
    rewriteHardRefusal: config.rewriteHardRefusal !== false,
    stripSelfDoubt: config.stripSelfDoubt !== false,
    stripCustomerTone: config.stripCustomerTone !== false,
    maxPromptItems: Math.max(0, Math.min(8, Number(config.maxPromptItems) || 4)),
    badPatterns: Array.isArray(config.badPatterns) && config.badPatterns.length
      ? config.badPatterns
      : DEFAULT_BAD_PATTERNS
  }
}

export class PersonaFeedbackManager {
  constructor({ cwd = process.cwd(), logger = globalThis.logger } = {}) {
    this.cwd = cwd
    this.logger = logger
    this.lastReplies = new Map()
  }

  getDataDir() {
    return path.join(this.cwd, "plugins/bl-chat-plugin/data/persona_feedback")
  }

  getFeedbackPath() {
    return path.join(this.getDataDir(), "feedback.jsonl")
  }

  getSummaryPath() {
    return path.join(this.getDataDir(), "summary.json")
  }

  rememberBotReply(e, output = "") {
    const groupId = String(e?.group_id || "private")
    const key = this.getConversationKey(e)
    const record = {
      groupId,
      userId: String(e?.user_id || ""),
      messageId: e?.message_id ? String(e.message_id) : "",
      text: compactText(output, 1600),
      at: Date.now()
    }
    this.lastReplies.set(key, record)
    if (groupId !== "private") this.lastReplies.set(`group:${groupId}`, record)
  }

  getConversationKey(e) {
    return `${String(e?.group_id || "private")}:${String(e?.user_id || "")}`
  }

  getRecentBotReply(e) {
    const direct = this.lastReplies.get(this.getConversationKey(e))
    if (direct) return direct
    const groupId = String(e?.group_id || "private")
    return this.lastReplies.get(`group:${groupId}`) || null
  }

  classifyFeedback(text = "") {
    const content = String(text || "")
    const tags = FEEDBACK_TAG_RULES
      .filter(rule => rule.pattern.test(content))
      .map(rule => ({ key: rule.key, label: rule.label }))
    return tags.length ? tags : [{ key: "note", label: "其他反馈" }]
  }

  parseFeedbackText(msg = "") {
    return String(msg || "")
      .replace(/^[#＃.。]\s*希洛反馈\s*/u, "")
      .trim()
  }

  async recordFeedback(e, msg = "") {
    if (!e?.isMaster) return "只有主人可以记录希洛反馈。"
    const feedback = this.parseFeedbackText(msg)
    if (!feedback) return "格式：.希洛反馈 太硬了 / 太啰嗦 / 这个语气好"

    const reply = this.getRecentBotReply(e)
    const tags = this.classifyFeedback(feedback)
    const record = {
      at: nowIso(),
      groupId: e?.group_id ? String(e.group_id) : "",
      userId: e?.user_id ? String(e.user_id) : "",
      feedback,
      tags: tags.map(tag => tag.key),
      tagLabels: tags.map(tag => tag.label),
      botReply: reply?.text || "",
      botMessageId: reply?.messageId || "",
      sourceMessageId: e?.message_id ? String(e.message_id) : ""
    }

    ensureDir(this.getDataDir())
    fs.appendFileSync(this.getFeedbackPath(), `${JSON.stringify(record)}\n`, "utf8")
    this.updateSummary(tags, feedback)
    return `记下来了：${tags.map(tag => tag.label).join("、")}`
  }

  readSummary() {
    try {
      const file = this.getSummaryPath()
      if (!fs.existsSync(file)) return { tags: {}, recent: [] }
      const data = JSON.parse(fs.readFileSync(file, "utf8"))
      return data && typeof data === "object" ? { tags: data.tags || {}, recent: data.recent || [] } : { tags: {}, recent: [] }
    } catch (error) {
      this.logger?.warn?.(`[希洛反馈] 读取摘要失败: ${error.message}`)
      return { tags: {}, recent: [] }
    }
  }

  updateSummary(tags = [], feedback = "") {
    const summary = this.readSummary()
    for (const tag of tags) {
      const item = summary.tags[tag.key] || { key: tag.key, label: tag.label, count: 0 }
      item.label = tag.label
      item.count = (Number(item.count) || 0) + 1
      summary.tags[tag.key] = item
    }
    summary.recent = [
      { at: nowIso(), feedback: compactText(feedback, 160), tags: tags.map(tag => tag.key) },
      ...(summary.recent || [])
    ].slice(0, 30)
    ensureDir(this.getDataDir())
    fs.writeFileSync(this.getSummaryPath(), JSON.stringify(summary, null, 2), "utf8")
  }

  buildFeedbackPrompt(config = {}) {
    const guard = normalizeConfig(config)
    if (!guard.enabled || guard.maxPromptItems <= 0) return ""
    const summary = this.readSummary()
    const sorted = Object.values(summary.tags || {})
      .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
      .slice(0, guard.maxPromptItems)
    if (!sorted.length) return ""

    const lines = [
      "【希洛近期微雕反馈】",
      "这些是主人对希洛回复风格的长期修正，回复时自然遵守，不要提到这些规则本身。"
    ]
    for (const item of sorted) {
      if (item.key === "too_hard") lines.push(`- ${item.label}：拒绝时别冷冰冰，不要直接甩“不能/无法”；先接住意图，再给替代做法。`)
      else if (item.key === "too_verbose") lines.push(`- ${item.label}：少铺垫，能短就短，别在结尾自我评价啰嗦。`)
      else if (item.key === "too_customer") lines.push(`- ${item.label}：不要客服腔、汇报腔、说明书腔，像熟人自然说。`)
      else if (item.key === "good_tone") lines.push(`- ${item.label}：保持最近被认可的自然、熟人感表达。`)
      else if (item.key === "bad_tone") lines.push(`- ${item.label}：语气要更贴近希洛，不要突然生硬或阴阳怪气。`)
      else lines.push(`- ${item.label}：参考主人最近反馈，优先自然和有用。`)
    }
    return lines.join("\n")
  }

  guardReply(text = "", config = {}) {
    const guard = normalizeConfig(config)
    if (!guard.enabled) return String(text || "")
    let output = String(text || "").trim()
    if (!output) return ""

    if (guard.stripSelfDoubt) {
      output = output
        .replace(/(?:唔|呜|嗯|诶|欸|啊|呃|哎呀?|嘛|那个)?[，,、\s]*(?:我)?(?:是不是|好像|感觉)?(?:说(?:得|的)?有点多了|说多了|讲多了|说太多了|有点啰嗦|太啰嗦了?|有点话多|太话多了?|扯远了|跑题了)[。！？!?~～…\s]*/g, "")
        .trim()
    }

    if (guard.stripCustomerTone) {
      output = output
        .replace(/作为(?:一个)?(?:AI|人工智能|机器人|助手)[，,、\s]*/gi, "")
        .replace(/很抱歉[，,、\s]*/g, "")
        .replace(/抱歉[，,、\s]*/g, "")
        .replace(/请您/g, "你")
        .replace(/建议您/g, "可以")
        .replace(/希望(?:以上|这些|这).*?(?:帮到你|有帮助)[。.!！]*/g, "")
        .trim()
    }

    if (guard.rewriteHardRefusal) {
      output = output
        .replace(/我(?:不能|无法|不可以|没办法)(?:帮你|为你|替你)?(?:直接)?(?:完成|提供|满足|处理|执行|做)?(?:这个|这件事|该请求|你的请求)?[。.!！]?/g, "这个我不太适合直接这样做。")
        .replace(/(?:无法|不能)协助(?:你)?(?:完成|处理)?(?:这个|这件事|该请求)?[。.!！]?/g, "这个我不太适合直接这样做。")
        .replace(/我(?:必须|需要)拒绝(?:这个|该请求|你的请求)?[。.!！]?/g, "这个我不太适合直接这样做。")
        .replace(/这个我不太适合直接这样做。\s*这个我不太适合直接这样做。/g, "这个我不太适合直接这样做。")
        .trim()
    }

    for (const pattern of guard.badPatterns) {
      const needle = String(pattern || "").trim()
      if (!needle) continue
      if (output.includes(needle)) {
        output = output.split(needle).join("")
      }
    }

    return output.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  }
}

export const personaFeedbackManager = new PersonaFeedbackManager()
