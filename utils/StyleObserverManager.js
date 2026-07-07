import fs from "fs"
import path from "path"

const DEFAULT_CONFIG = {
  enabled: true,
  baseDir: "data/style_observer",
  minReportMessages: 50,
  flushIntervalMs: 60000,
  disabledGroups: [],
  maxToneWords: 18
}

const TONE_WORDS = [
  "草", "笑死", "绷", "啊", "啊？", "诶", "欸", "嗯", "哦", "好吧", "确实", "对啊",
  "不是", "真的假的", "牛", "离谱", "乐", "哈", "哈哈", "哈哈哈", "呃", "唔", "嘛", "吧", "呢", "呀"
]

const INTERACTION_RULES = [
  { key: "吐槽", pattern: /草|笑死|绷|离谱|逆天|什么鬼|无语|蚌埠|乐/ },
  { key: "求助", pattern: /帮|求|问一下|有没有|怎么|咋|如何|能不能|可以不|有人知道/ },
  { key: "讨论", pattern: /觉得|感觉|是不是|为什么|因为|所以|但是|不过|如果|应该/ },
  { key: "玩梗", pattern: /梗|典|急|孝|乐|绷|赢|麻了|神人|抽象/ },
  { key: "命令", pattern: /^[#＃.。]|帮我|给我|发一下|查一下|画|生成|看看/ }
]

const NEGATIVE_BOT_FEEDBACK = [
  "太啰嗦", "话多", "别废话", "不像人", "客服", "机器人", "别这样", "太硬", "不自然", "看不懂"
]

function nowIso() {
  return new Date().toISOString()
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function safeNumber(value, fallback, min, max) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

function normalizeConfig(config = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    enabled: config.enabled !== false,
    minReportMessages: safeNumber(config.minReportMessages, DEFAULT_CONFIG.minReportMessages, 10, 10000),
    flushIntervalMs: safeNumber(config.flushIntervalMs, DEFAULT_CONFIG.flushIntervalMs, 5000, 600000),
    disabledGroups: Array.isArray(config.disabledGroups) ? config.disabledGroups.map(String) : [],
    maxToneWords: safeNumber(config.maxToneWords, DEFAULT_CONFIG.maxToneWords, 5, 50)
  }
}

function cleanText(text = "") {
  return String(text || "")
    .replace(/\[CQ:[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function createEmptyStats(groupId) {
  return {
    groupId: String(groupId || ""),
    enabled: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    totalMessages: 0,
    totalChars: 0,
    shortMessages: 0,
    longMessages: 0,
    questionMarks: 0,
    exclamationMarks: 0,
    ellipses: 0,
    waves: 0,
    emojiLike: 0,
    toneWords: {},
    interactions: {},
    negativeBotFeedback: {},
    speakerCount: {},
    recentSamples: []
  }
}

function inc(map, key, amount = 1) {
  if (!key) return
  map[key] = (Number(map[key]) || 0) + amount
}

function topEntries(map = {}, limit = 8) {
  return Object.entries(map)
    .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
    .slice(0, limit)
}

export class StyleObserverManager {
  constructor({ cwd = process.cwd(), logger = globalThis.logger } = {}) {
    this.cwd = cwd
    this.logger = logger
    this.cache = new Map()
    this.dirtyGroups = new Set()
    this.flushTimer = null
  }

  getDataDir(config = {}) {
    const cfg = normalizeConfig(config)
    return path.isAbsolute(cfg.baseDir)
      ? cfg.baseDir
      : path.join(this.cwd, "plugins/bl-chat-plugin", cfg.baseDir)
  }

  getGroupPath(groupId, config = {}) {
    return path.join(this.getDataDir(config), `${String(groupId || "")}.json`)
  }

  isGroupEnabled(groupId, config = {}) {
    const cfg = normalizeConfig(config)
    if (!cfg.enabled) return false
    if (cfg.disabledGroups.includes(String(groupId || ""))) return false
    return this.getStats(groupId, cfg).enabled !== false
  }

  getStats(groupId, config = {}) {
    const key = String(groupId || "")
    if (this.cache.has(key)) return this.cache.get(key)

    const file = this.getGroupPath(key, config)
    let stats = null
    try {
      if (fs.existsSync(file)) stats = JSON.parse(fs.readFileSync(file, "utf8"))
    } catch (error) {
      this.logger?.warn?.(`[群风格观察] 读取失败 group=${key}: ${error.message}`)
    }
    if (!stats || typeof stats !== "object") stats = createEmptyStats(key)
    stats.groupId = key
    this.cache.set(key, stats)
    return stats
  }

  observeMessage(e, config = {}) {
    const groupId = e?.group_id ? String(e.group_id) : ""
    if (!groupId || !this.isGroupEnabled(groupId, config)) return

    const text = cleanText(e?.msg || e?.raw_message || "")
    if (!text || text.length < 2) return
    if (/^[#＃.。]\S+/.test(text)) return

    const cfg = normalizeConfig(config)
    const stats = this.getStats(groupId, cfg)
    const length = [...text].length
    stats.totalMessages += 1
    stats.totalChars += length
    if (length <= 12) stats.shortMessages += 1
    if (length >= 80) stats.longMessages += 1
    stats.questionMarks += (text.match(/[?？]/g) || []).length
    stats.exclamationMarks += (text.match(/[!！]/g) || []).length
    stats.ellipses += (text.match(/…|\.{3,}|。{3,}/g) || []).length
    stats.waves += (text.match(/[~～]/g) || []).length
    stats.emojiLike += (text.match(/\[[^\]]{1,12}\]|[（）()][^（）()]{1,8}[）)]/g) || []).length

    for (const word of TONE_WORDS) {
      if (text.includes(word)) inc(stats.toneWords, word)
    }
    for (const rule of INTERACTION_RULES) {
      if (rule.pattern.test(text)) inc(stats.interactions, rule.key)
    }
    for (const word of NEGATIVE_BOT_FEEDBACK) {
      if (text.includes(word)) inc(stats.negativeBotFeedback, word)
    }

    const userId = e?.user_id ? String(e.user_id) : ""
    if (userId) inc(stats.speakerCount, userId)
    stats.recentSamples = [{ at: nowIso(), text: text.slice(0, 120) }, ...(stats.recentSamples || [])].slice(0, 20)
    stats.updatedAt = nowIso()

    this.markDirty(groupId, cfg)
  }

  markDirty(groupId, config = {}) {
    this.dirtyGroups.add(String(groupId || ""))
    if (this.flushTimer) return
    const delay = normalizeConfig(config).flushIntervalMs
    this.flushTimer = setTimeout(() => {
      this.flushDirty(config)
    }, delay)
    this.flushTimer.unref?.()
  }

  flushDirty(config = {}) {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    for (const groupId of [...this.dirtyGroups]) {
      this.writeGroup(groupId, config)
      this.dirtyGroups.delete(groupId)
    }
  }

  writeGroup(groupId, config = {}) {
    const stats = this.cache.get(String(groupId || ""))
    if (!stats) return
    try {
      const file = this.getGroupPath(groupId, config)
      ensureDir(path.dirname(file))
      fs.writeFileSync(file, JSON.stringify(stats, null, 2), "utf8")
    } catch (error) {
      this.logger?.warn?.(`[群风格观察] 写入失败 group=${groupId}: ${error.message}`)
    }
  }

  setGroupEnabled(groupId, enabled, config = {}) {
    const stats = this.getStats(groupId, config)
    stats.enabled = Boolean(enabled)
    stats.updatedAt = nowIso()
    this.cache.set(String(groupId || ""), stats)
    this.writeGroup(groupId, config)
  }

  buildReport(groupId, config = {}) {
    const cfg = normalizeConfig(config)
    const stats = this.getStats(groupId, cfg)
    const total = Number(stats.totalMessages) || 0
    if (!total) {
      return [
        "群风格观察报告：",
        `状态：${this.isGroupEnabled(groupId, cfg) ? "观察中" : "已关闭"}`,
        "样本：0 条，还没有可分析的数据。"
      ].join("\n")
    }

    const avg = (Number(stats.totalChars) || 0) / total
    const shortRate = stats.shortMessages / total
    const longRate = stats.longMessages / total
    const activeSpeakers = Object.keys(stats.speakerCount || {}).length
    const tone = topEntries(stats.toneWords, cfg.maxToneWords)
    const interactions = topEntries(stats.interactions, 6)
    const negatives = topEntries(stats.negativeBotFeedback, 6)
    const hints = this.buildHeuristicHints(stats, cfg)

    return [
      "群风格观察报告：",
      `状态：${this.isGroupEnabled(groupId, cfg) ? "观察中" : "已关闭"}；样本：${total} 条；发言人数：${activeSpeakers}`,
      `平均长度：${avg.toFixed(1)} 字；短句：${Math.round(shortRate * 100)}%；长消息：${Math.round(longRate * 100)}%`,
      `标点倾向：问号 ${stats.questionMarks || 0} / 感叹号 ${stats.exclamationMarks || 0} / 省略 ${stats.ellipses || 0} / 波浪 ${stats.waves || 0}`,
      tone.length ? `常见语气词：${tone.map(([k, v]) => `${k}(${v})`).join("、")}` : "常见语气词：暂不明显",
      interactions.length ? `互动类型：${interactions.map(([k, v]) => `${k}(${v})`).join("、")}` : "互动类型：暂不明显",
      negatives.length ? `负面反馈信号：${negatives.map(([k, v]) => `${k}(${v})`).join("、")}` : "负面反馈信号：暂无明显记录",
      hints.length ? `初步观察：${hints.join("；")}` : "初步观察：样本还少，先继续观察。",
      total < cfg.minReportMessages ? `提示：当前少于 ${cfg.minReportMessages} 条，只能当粗略参考。` : "提示：这只是观察统计，不会自动改变希洛说话方式。"
    ].join("\n")
  }

  buildHeuristicHints(stats, config = {}) {
    const total = Math.max(1, Number(stats.totalMessages) || 0)
    const hints = []
    if (stats.shortMessages / total >= 0.55) hints.push("这个群短句比例高，后续候选规则可偏短回复")
    if (stats.longMessages / total >= 0.18) hints.push("这个群也会出现长讨论，解释类内容不宜过度压缩")
    if ((stats.questionMarks || 0) / total >= 0.35) hints.push("问句较多，求助/讨论气氛明显")
    if ((stats.exclamationMarks || 0) / total >= 0.25) hints.push("情绪表达偏强，回复可以更有反应感")
    if (topEntries(stats.negativeBotFeedback, 1).length) hints.push("出现过对机器人语气的负面反馈，后续要谨慎微雕")
    if ((stats.interactions?.吐槽 || 0) / total >= 0.18) hints.push("吐槽和玩笑密度较高，但不应直接学攻击性语气")
    return hints.slice(0, 5)
  }
}

export const styleObserverManager = new StyleObserverManager()
