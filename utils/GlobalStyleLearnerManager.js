import fs from "fs"
import path from "path"
import { safeTruncateUnicode } from "./unicodeText.js"
import { buildExpressionObservation } from "./expressionSequence.js"

const DEFAULT_CONFIG = {
  enabled: true,
  promptInjectionEnabled: true,
  baseDir: "data/global_style_learning",
  maxPromptRules: 6,
  minSamplesForPrompt: 80,
  flushIntervalMs: 60000,
  maxRecentSignals: 80,
  aiSummaryEnabled: true,
  summarySampleLimit: 40,
  maxAiRules: 6,
  summaryTimeoutMs: 30000,
  autoSummaryEnabled: true,
  autoSummaryMinNewSamples: 300,
  autoSummaryCooldownHours: 12,
  autoSummaryMinTotalSamples: 120,
  sequenceWindowMs: 20000,
  maxSequenceTurns: 3,
  semanticRecallEnabled: true,
  semanticSampleLimit: 240,
  semanticMinSamples: 24,
  semanticPromptExamples: 2,
  semanticSimilarityThreshold: 0.68,
  semanticEmbedTimeoutMs: 1200,
  semanticQueryCacheMinutes: 10
}

const TONE_WORDS = ["草", "笑死", "绷", "啊？", "诶", "确实", "离谱", "好吧", "不是", "哈哈", "呃", "唔"]

const ESSENCE_RULES = [
  {
    key: "short_first",
    label: "先短后补",
    rule: "回复先给短句结论，再按需要补一句，不要上来铺太长。",
    pattern: text => [...text].length <= 28 && !/[。！？!?]\s*.*[。！？!?]\s*.*[。！？!?]/.test(text)
  },
  {
    key: "catch_emotion",
    label: "先接情绪",
    rule: "用户带情绪或玩笑时，先接住情绪，再回答实际内容。",
    pattern: text => /草|笑死|绷|离谱|啊？|真的假的|无语|麻了/.test(text)
  },
  {
    key: "direct_question",
    label: "问题直答",
    rule: "遇到明确问题先直接回答，不要先讲一堆背景。",
    pattern: text => /[?？]|怎么|为什么|咋|如何|能不能|可以吗|是不是/.test(text) && [...text].length <= 80
  },
  {
    key: "soft_boundary",
    label: "边界柔和",
    rule: "需要拒绝或设边界时，不要冷冰冰说不能；先承认意图，再给替代方向。",
    pattern: text => /不行|不能|别|不要|算了|换个|可以换|不太适合/.test(text)
  },
  {
    key: "light_humor",
    label: "轻微接梗",
    rule: "可以轻轻接梗，但不要把攻击性、阴阳怪气学成希洛的稳定语气。",
    pattern: text => /哈哈|笑死|乐|绷|草/.test(text) && !/(你妈|傻逼|弱智|死|爹|滚)/.test(text)
  },
  {
    key: "explain_compact",
    label: "解释收紧",
    rule: "解释复杂事情时按“结论-原因-下一步”组织，少用首先其次总结。",
    pattern: text => /结论|原因|所以|因为|简单说|换句话/.test(text)
  },
  {
    key: "multi_message_rhythm",
    label: "整轮消息节奏",
    rule: "学习整轮而非单句：默认一条；短反应加独立补话可分两条；表情包只占一个有明确作用的位置，不要每轮都拆分。",
    pattern: text => /\[下一条\]|\[表情包\]/.test(text)
  }
]

const DROSS_RULES = [
  {
    key: "aggressive_attack",
    label: "攻击性表达",
    rule: "不要吸收人身攻击、辱骂、带节奏话术。",
    pattern: /你妈|傻逼|弱智|死装|爹妈|滚|废物|脑残/
  },
  {
    key: "customer_tone",
    label: "客服腔",
    rule: "避免客服腔、汇报腔、说明书腔。",
    pattern: /很抱歉|请您|建议您|感谢您的|为您服务|我来为您/
  },
  {
    key: "hard_refusal",
    label: "强硬拒绝",
    rule: "不要直接甩“我不能/无法协助”，先接意图再给替代。",
    pattern: /我不能|我无法|无法协助|不能满足|拒绝请求/
  },
  {
    key: "self_doubt",
    label: "自我怀疑尾巴",
    rule: "不要在结尾自我评价“我是不是太啰嗦/说多了”。",
    pattern: /是不是太啰嗦|说多了|扯远了|有点话多/
  },
  {
    key: "preachy",
    label: "讲大道理",
    rule: "避免无请求时突然讲大道理或长篇说教。",
    pattern: /我们应该|大家都要|从本质上来说|这告诉我们|综上所述/
  },
  {
    key: "antagonistic_flirting",
    label: "批评时顶嘴调情",
    rule: "用户在批评、纠正或表达不舒服时，不要顶嘴、抬杠、调情或用挑衅表情。",
    pattern: /你别教我做事|别气嘛|不跟你犟|你舍得嘛|凭啥|想得美|😋|❤/
  }
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
  const normalized = {
    ...DEFAULT_CONFIG,
    ...config,
    enabled: config.enabled !== false,
    promptInjectionEnabled: config.promptInjectionEnabled !== false,
    maxPromptRules: safeNumber(config.maxPromptRules, DEFAULT_CONFIG.maxPromptRules, 1, 12),
    minSamplesForPrompt: safeNumber(config.minSamplesForPrompt, DEFAULT_CONFIG.minSamplesForPrompt, 10, 100000),
    flushIntervalMs: safeNumber(config.flushIntervalMs, DEFAULT_CONFIG.flushIntervalMs, 5000, 600000),
    maxRecentSignals: safeNumber(config.maxRecentSignals, DEFAULT_CONFIG.maxRecentSignals, 10, 500),
    aiSummaryEnabled: config.aiSummaryEnabled !== false,
    summarySampleLimit: safeNumber(config.summarySampleLimit, DEFAULT_CONFIG.summarySampleLimit, 10, 120),
    maxAiRules: safeNumber(config.maxAiRules, DEFAULT_CONFIG.maxAiRules, 1, 12),
    summaryTimeoutMs: safeNumber(config.summaryTimeoutMs, DEFAULT_CONFIG.summaryTimeoutMs, 5000, 120000),
    autoSummaryEnabled: config.autoSummaryEnabled !== false,
    autoSummaryMinNewSamples: safeNumber(config.autoSummaryMinNewSamples, DEFAULT_CONFIG.autoSummaryMinNewSamples, 20, 100000),
    autoSummaryCooldownHours: safeNumber(config.autoSummaryCooldownHours, DEFAULT_CONFIG.autoSummaryCooldownHours, 1, 720),
    autoSummaryMinTotalSamples: safeNumber(config.autoSummaryMinTotalSamples, DEFAULT_CONFIG.autoSummaryMinTotalSamples, 10, 100000),
    sequenceWindowMs: safeNumber(config.sequenceWindowMs, DEFAULT_CONFIG.sequenceWindowMs, 3000, 120000),
    maxSequenceTurns: safeNumber(config.maxSequenceTurns, DEFAULT_CONFIG.maxSequenceTurns, 2, 5),
    semanticRecallEnabled: config.semanticRecallEnabled !== false,
    semanticSampleLimit: safeNumber(config.semanticSampleLimit, DEFAULT_CONFIG.semanticSampleLimit, 30, 500),
    semanticMinSamples: safeNumber(config.semanticMinSamples, DEFAULT_CONFIG.semanticMinSamples, 2, 500),
    semanticPromptExamples: safeNumber(config.semanticPromptExamples, DEFAULT_CONFIG.semanticPromptExamples, 1, 4),
    semanticSimilarityThreshold: safeNumber(config.semanticSimilarityThreshold, DEFAULT_CONFIG.semanticSimilarityThreshold, 0.4, 0.95),
    semanticEmbedTimeoutMs: safeNumber(config.semanticEmbedTimeoutMs, DEFAULT_CONFIG.semanticEmbedTimeoutMs, 200, 5000),
    semanticQueryCacheMinutes: safeNumber(config.semanticQueryCacheMinutes, DEFAULT_CONFIG.semanticQueryCacheMinutes, 1, 60),
    baseDir: config.baseDir || DEFAULT_CONFIG.baseDir
  }
  normalized.semanticMinSamples = Math.min(normalized.semanticSampleLimit, normalized.semanticMinSamples)
  return normalized
}

function cleanText(text = "") {
  return String(text || "")
    .replace(/\[CQ:[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function sanitizeSample(text = "") {
  return safeTruncateUnicode(cleanText(text)
    .replace(/https?:\/\/\S+/gi, "[链接]")
    .replace(/www\.\S+/gi, "[链接]")
    .replace(/@\S{1,24}/g, "@某人")
    .replace(/\b\d{5,12}\b/g, "[数字]")
    .replace(/\s+/g, " ")
    .trim(), 140)
}

function sanitizeSequenceSample(items = []) {
  return safeTruncateUnicode(items
    .map(item => item === "[表情包]" ? item : sanitizeSample(item))
    .filter(Boolean)
    .join(" [下一条] "), 280)
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index += 1) {
    const left = Number(a[index])
    const right = Number(b[index])
    if (!Number.isFinite(left) || !Number.isFinite(right)) return 0
    dot += left * right
    normA += left * left
    normB += right * right
  }
  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0
}

function deriveSemanticPatterns(text = "", { sequence = false } = {}) {
  const sample = cleanText(text)
  if (!sample || DROSS_RULES.some(item => item.pattern.test(sample))) return []
  const patterns = []
  if (sequence || /\[下一条\]|\[表情包\]/.test(sample)) {
    patterns.push("短反应和补充内容都独立时才分两条；表情包只放在确实承担情绪作用的位置。")
  }
  if (/草|笑死|绷|离谱|啊？|真的假的|无语|麻了|哈哈|乐/.test(sample)) {
    patterns.push("先用一句自然短反应接住情绪，再进入实际回应；保持友好，不阴阳怪气。")
  }
  if (/[?？]|怎么|为什么|咋|如何|能不能|可以吗|是不是/.test(sample)) {
    patterns.push("遇到明确问题先给直接答案或判断，再补必要的原因和下一步。")
  }
  if (/报错|失败|卡住|卡了|装不上|不行|怎么办|为什么.*(没|不)/.test(sample)) {
    patterns.push("排查问题时先说已确认的现象，再说明原因或下一步；没有证据时明确说还没查到。")
  }
  if ([...sample].length <= 28) {
    patterns.push("简短聊天优先用自然口语短句，不为凑完整格式而铺背景。")
  }
  if (/因为|所以|结论|原因|简单说|换句话/.test(sample)) {
    patterns.push("解释复杂事情时按结论、原因、下一步收束，避免客服式铺陈。")
  }
  return [...new Set(patterns)].slice(0, 3)
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

function featureLabel(key = "") {
  const labels = {
    short: "短句",
    medium: "中等长度",
    long: "长消息",
    question: "提问",
    exclamation: "感叹",
    ellipsis: "停顿/省略",
    wave: "波浪尾音"
  }
  return labels[key] || key
}

function confidenceLabel(weight = 0, total = 1) {
  const ratio = total > 0 ? Number(weight) / total : 0
  if (ratio >= 0.45) return "很稳定"
  if (ratio >= 0.18) return "比较明显"
  if (ratio >= 0.06) return "有一点"
  return "少量信号"
}

function createEmptyMemory() {
  return {
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    totalSamples: 0,
    groupCount: {},
    featureCount: {},
    essence: {},
    dross: {},
    toneWords: {},
    recentSignals: [],
    samplePool: [],
    semanticSamples: [],
    aiRules: {
      absorb: [],
      avoid: []
    },
    aiSummary: {
      lastAt: "",
      lastAutoAt: "",
      count: 0,
      autoCount: 0,
      lastSamples: 0,
      lastTotalSamples: 0
    }
  }
}

function ensureMemoryShape(memory = {}) {
  const base = createEmptyMemory()
  return {
    ...base,
    ...memory,
    groupCount: memory.groupCount || {},
    featureCount: memory.featureCount || {},
    essence: memory.essence || {},
    dross: memory.dross || {},
    toneWords: memory.toneWords || {},
    recentSignals: Array.isArray(memory.recentSignals) ? memory.recentSignals : [],
    samplePool: Array.isArray(memory.samplePool) ? memory.samplePool : [],
    semanticSamples: Array.isArray(memory.semanticSamples) ? memory.semanticSamples : [],
    aiRules: {
      absorb: Array.isArray(memory.aiRules?.absorb) ? memory.aiRules.absorb : [],
      avoid: Array.isArray(memory.aiRules?.avoid) ? memory.aiRules.avoid : []
    },
    aiSummary: {
      ...base.aiSummary,
      ...(memory.aiSummary || {})
    }
  }
}

function normalizeRuleKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。、“”‘’：:；;（）()【】\[\].,!?！？]/g, "")
    .slice(0, 80)
}

function clampConfidence(value, fallback = 0.6) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(0.99, Math.max(0.1, num))
}

function extractJsonObject(text = "") {
  const raw = String(text || "").trim()
  if (!raw) throw new Error("模型没有返回内容")
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : raw
  try {
    return JSON.parse(candidate)
  } catch (error) {
    const start = candidate.indexOf("{")
    const end = candidate.lastIndexOf("}")
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1))
    throw error
  }
}

function findMatchingBracket(text = "", start = 0, open = "[", close = "]") {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === "\"") {
        inString = false
      }
      continue
    }
    if (char === "\"") {
      inString = true
      continue
    }
    if (char === open) depth += 1
    if (char === close) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function extractArrayBody(text = "", key = "") {
  const keyIndex = text.indexOf(`"${key}"`)
  if (keyIndex < 0) return ""
  const arrayStart = text.indexOf("[", keyIndex)
  if (arrayStart < 0) return ""
  const arrayEnd = findMatchingBracket(text, arrayStart, "[", "]")
  if (arrayEnd < 0) return text.slice(arrayStart + 1)
  return text.slice(arrayStart + 1, arrayEnd)
}

function extractObjectLiterals(text = "") {
  const objects = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === "\"") {
        inString = false
      }
      continue
    }
    if (char === "\"") {
      inString = true
      continue
    }
    if (char === "{") {
      if (depth === 0) start = i
      depth += 1
    } else if (char === "}") {
      depth -= 1
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }
  return objects
}

function repairJsonText(text = "") {
  return String(text || "")
    .replace(/，/g, ",")
    .replace(/：/g, ":")
    .replace(/“|”/g, "\"")
    .replace(/‘|’/g, "\"")
    .replace(/,\s*([}\]])/g, "$1")
}

function parseLooseRuleArray(text = "") {
  return extractObjectLiterals(text)
    .map(item => {
      try {
        return JSON.parse(repairJsonText(item))
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function parseSummaryResult(text = "") {
  try {
    return extractJsonObject(text)
  } catch (strictError) {
    const raw = String(text || "").trim()
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const candidate = repairJsonText(fenced ? fenced[1].trim() : raw)
    const absorb = parseLooseRuleArray(extractArrayBody(candidate, "absorb"))
    const avoid = parseLooseRuleArray(extractArrayBody(candidate, "avoid"))
    if (absorb.length || avoid.length) return { absorb, avoid }
    const preview = candidate.replace(/\s+/g, " ").slice(0, 120)
    throw new Error(`模型返回不是可解析的规则 JSON：${strictError.message}；片段：${preview}`)
  }
}

export class GlobalStyleLearnerManager {
  constructor({ cwd = process.cwd(), logger = globalThis.logger, fetchFn = globalThis.fetch } = {}) {
    this.cwd = cwd
    this.logger = logger
    this.memory = null
    this.dirty = false
    this.flushTimer = null
    this.autoSummaryRunning = false
    this.recentSpeakerSequences = new Map()
    this.lastGroupSequenceSpeaker = new Map()
    this.fetchFn = fetchFn
    this.semanticQueue = []
    this.semanticQueueRunning = 0
    this.semanticPendingHashes = new Set()
    this.semanticQueryCache = new Map()
    this.semanticQueryInFlight = new Map()
    this.semanticFailureUntil = 0
    this.semanticBackfillScheduled = false
  }

  getDataDir(config = {}) {
    const cfg = normalizeConfig(config)
    return path.isAbsolute(cfg.baseDir)
      ? cfg.baseDir
      : path.join(this.cwd, "plugins/bl-chat-plugin", cfg.baseDir)
  }

  getMemoryPath(config = {}) {
    return path.join(this.getDataDir(config), "style_memory.json")
  }

  readMemory(config = {}) {
    if (this.memory) return this.memory
    const file = this.getMemoryPath(config)
    try {
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, "utf8"))
        this.memory = data && typeof data === "object" ? ensureMemoryShape(data) : createEmptyMemory()
        return this.memory
      }
    } catch (error) {
      this.logger?.warn?.(`[全局表达学习] 读取失败: ${error.message}`)
    }
    this.memory = createEmptyMemory()
    return this.memory
  }

  writeMemory(config = {}) {
    if (!this.memory) return
    try {
      const file = this.getMemoryPath(config)
      ensureDir(path.dirname(file))
      fs.writeFileSync(file, JSON.stringify(this.memory, null, 2), "utf8")
      this.dirty = false
    } catch (error) {
      this.logger?.warn?.(`[全局表达学习] 写入失败: ${error.message}`)
    }
  }

  scheduleFlush(config = {}) {
    this.dirty = true
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      if (this.dirty) this.writeMemory(config)
    }, normalizeConfig(config).flushIntervalMs)
    this.flushTimer.unref?.()
  }

  observeMessage(e, config = {}, embeddingConfig = {}) {
    const cfg = normalizeConfig(config)
    if (!cfg.enabled) return
    const text = cleanText(e?.msg || e?.raw_message || "")
    const sequenceText = buildExpressionObservation(e?.msg || e?.raw_message || "", {
      userId: e?.user_id,
      messageId: e?.message_id,
      message: e?.message
    })?.sample || ""
    if ((!text || text.length < 2) && !sequenceText) return
    if (/^[#＃.。]\S+/.test(text)) return
    if (String(e?.user_id || "") === String(globalThis.Bot?.uin || "")) return

    const memory = this.readMemory(cfg)
    this.scheduleSemanticBackfill(memory, cfg, embeddingConfig)
    const groupId = String(e?.group_id || "private")
    const sequenceRecorded = this.observeSpeakerSequence(e, sequenceText, cfg, memory, embeddingConfig)
    if (!text || text.length < 2) {
      if (sequenceRecorded) {
        memory.updatedAt = nowIso()
        this.scheduleFlush(cfg)
      }
      return
    }
    const length = [...text].length
    memory.totalSamples += 1
    inc(memory.groupCount, groupId)
    inc(memory.featureCount, length <= 12 ? "short" : length >= 80 ? "long" : "medium")
    if (/[?？]/.test(text)) inc(memory.featureCount, "question")
    if (/[!！]/.test(text)) inc(memory.featureCount, "exclamation")
    if (/…|\.{3,}|。{3,}/.test(text)) inc(memory.featureCount, "ellipsis")
    if (/[~～]/.test(text)) inc(memory.featureCount, "wave")

    for (const word of TONE_WORDS) {
      if (text.includes(word)) inc(memory.toneWords, word)
    }

    const essenceKeys = []
    const drossKeys = []
    for (const item of ESSENCE_RULES) {
      if (item.pattern(text)) {
        inc(memory.essence, item.key)
        essenceKeys.push(item.key)
      }
    }
    for (const item of DROSS_RULES) {
      if (item.pattern.test(text)) {
        inc(memory.dross, item.key)
        drossKeys.push(item.key)
      }
    }

    if (essenceKeys.length || drossKeys.length) {
      const sample = sanitizeSample(text)
      memory.recentSignals = [
        {
          at: nowIso(),
          groupId,
          essence: essenceKeys,
          dross: drossKeys,
          hash: this.hashText(text)
        },
        ...(memory.recentSignals || [])
      ].slice(0, cfg.maxRecentSignals)
      if (sample && sample.length >= 2) {
        memory.samplePool = [
          {
            at: nowIso(),
            groupId,
            text: sample,
            essence: essenceKeys,
            dross: drossKeys
          },
          ...(memory.samplePool || [])
        ].slice(0, cfg.summarySampleLimit * 3)
      }
    }
    const semanticSample = sanitizeSample(text)
    const semanticPatterns = deriveSemanticPatterns(semanticSample)
    if (semanticSample && semanticPatterns.length) {
      this.enqueueSemanticSample({
        hash: this.hashText(semanticSample),
        text: semanticSample,
        patterns: semanticPatterns,
        sequence: false
      }, cfg, embeddingConfig)
    }
    memory.updatedAt = nowIso()
    this.scheduleFlush(cfg)
  }

  observeSpeakerSequence(e, text = "", cfg = normalizeConfig(), memory = this.readMemory(cfg), embeddingConfig = {}) {
    const content = String(text || "").trim()
    if (!content) return false
    const groupId = String(e?.group_id || "private")
    const userId = String(e?.user_id || "")
    if (!userId) return false
    const key = `${groupId}:${userId}`
    const lastSpeaker = this.lastGroupSequenceSpeaker.get(groupId)
    if (lastSpeaker && lastSpeaker !== userId) this.recentSpeakerSequences.delete(key)
    this.lastGroupSequenceSpeaker.set(groupId, userId)
    const now = Date.now()
    const previous = this.recentSpeakerSequences.get(key)
    const messageId = String(e?.message_id || "")
    const withinWindow = previous && now - previous.at <= cfg.sequenceWindowMs
    const differentMessage = !messageId || !previous?.messageId || messageId !== previous.messageId
    const items = withinWindow && differentMessage
      ? [...previous.items, content].slice(-cfg.maxSequenceTurns)
      : [content]
    this.recentSpeakerSequences.set(key, { at: now, messageId, items })

    if (this.recentSpeakerSequences.size > 300) {
      for (const [entryKey, entry] of this.recentSpeakerSequences) {
        if (now - entry.at > cfg.sequenceWindowMs * 2) this.recentSpeakerSequences.delete(entryKey)
      }
    }
    if (items.length < 2) return false

    const sample = sanitizeSequenceSample(items)
    if (!sample) return false
    memory.totalSequenceSamples = (Number(memory.totalSequenceSamples) || 0) + 1
    inc(memory.featureCount, "multi_message_sequence")
    inc(memory.essence, "multi_message_rhythm")
    if (items.includes("[表情包]") || items.some(item => item.includes("[表情包]"))) {
      inc(memory.featureCount, "emoji_interleave_sequence")
    }
    memory.recentSignals = [
      {
        at: nowIso(),
        groupId,
        essence: ["multi_message_rhythm"],
        dross: [],
        hash: this.hashText(sample),
        sequence: true
      },
      ...(memory.recentSignals || [])
    ].slice(0, cfg.maxRecentSignals)
    memory.samplePool = [
      {
        at: nowIso(),
        groupId,
        text: sample,
        essence: ["multi_message_rhythm"],
        dross: [],
        sequence: true
      },
      ...(memory.samplePool || [])
    ].slice(0, cfg.summarySampleLimit * 3)
    const semanticPatterns = deriveSemanticPatterns(sample, { sequence: true })
    if (semanticPatterns.length) {
      this.enqueueSemanticSample({
        hash: this.hashText(sample),
        text: sample,
        patterns: semanticPatterns,
        sequence: true
      }, cfg, embeddingConfig)
    }
    return true
  }

  hashText(text = "") {
    let hash = 2166136261
    for (const char of String(text)) {
      hash ^= char.charCodeAt(0)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16)
  }

  canUseSemanticRecall(cfg, embeddingConfig = {}) {
    return Boolean(
      cfg.semanticRecallEnabled &&
      embeddingConfig?.embeddingApiUrl &&
      embeddingConfig?.embeddingApiKey &&
      !String(embeddingConfig.embeddingApiKey).includes("sk-xxx") &&
      Date.now() >= this.semanticFailureUntil &&
      typeof this.fetchFn === "function"
    )
  }

  async embedSemanticText(text, cfg, embeddingConfig = {}) {
    if (!this.canUseSemanticRecall(cfg, embeddingConfig)) return null
    const input = String(text || "").trim()
    if (!input) return null
    const timeoutSignal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(cfg.semanticEmbedTimeoutMs)
      : undefined
    const response = await this.fetchFn(embeddingConfig.embeddingApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${embeddingConfig.embeddingApiKey}`
      },
      body: JSON.stringify({
        model: embeddingConfig.embeddingApiModel || "text-embedding-3-small",
        input
      }),
      signal: timeoutSignal
    })
    if (!response?.ok) throw new Error(`embedding API 请求失败：${response?.status || "unknown"}`)
    const vector = (await response.json())?.data?.[0]?.embedding
    return Array.isArray(vector) && vector.length && vector.every(value => Number.isFinite(Number(value)))
      ? vector.map(Number)
      : null
  }

  enqueueSemanticSample(sample, cfg, embeddingConfig = {}) {
    const normalizedCfg = normalizeConfig(cfg)
    if (!this.canUseSemanticRecall(normalizedCfg, embeddingConfig) || !sample?.hash || !sample?.text || !sample?.patterns?.length) return
    const memory = this.readMemory(normalizedCfg)
    if (memory.semanticSamples?.some(item => item.hash === sample.hash) || this.semanticPendingHashes.has(sample.hash)) return
    if (this.semanticQueue.length >= 64) return
    this.semanticPendingHashes.add(sample.hash)
    this.semanticQueue.push({ sample, cfg: normalizedCfg, embeddingConfig })
    this.drainSemanticQueue()
  }

  scheduleSemanticBackfill(memory, cfg, embeddingConfig = {}) {
    if (this.semanticBackfillScheduled || !this.canUseSemanticRecall(cfg, embeddingConfig)) return
    const existing = Array.isArray(memory?.semanticSamples) ? memory.semanticSamples.length : 0
    const legacySamples = Array.isArray(memory?.samplePool) ? memory.samplePool : []
    if (existing >= cfg.semanticMinSamples || !legacySamples.length) return
    this.semanticBackfillScheduled = true
    for (const legacy of legacySamples.slice(0, cfg.semanticSampleLimit)) {
      const text = legacy?.text || ""
      const patterns = deriveSemanticPatterns(text, { sequence: Boolean(legacy?.sequence) })
      if (!patterns.length) continue
      this.enqueueSemanticSample({
        hash: this.hashText(text),
        text,
        patterns,
        sequence: Boolean(legacy?.sequence)
      }, cfg, embeddingConfig)
    }
  }

  drainSemanticQueue() {
    while (this.semanticQueueRunning < 2 && this.semanticQueue.length) {
      const task = this.semanticQueue.shift()
      this.semanticQueueRunning += 1
      this.storeSemanticSample(task).catch(error => {
        this.semanticFailureUntil = Date.now() + 60000
        this.logger?.warn?.(`[全局表达学习] 语义样本向量化失败: ${error.message}`)
      }).finally(() => {
        this.semanticPendingHashes.delete(task.sample.hash)
        this.semanticQueueRunning -= 1
        this.drainSemanticQueue()
      })
    }
  }

  async storeSemanticSample({ sample, cfg, embeddingConfig }) {
    const embedding = await this.embedSemanticText(sample.text, cfg, embeddingConfig)
    if (!embedding) return
    const memory = this.readMemory(cfg)
    if (memory.semanticSamples.some(item => item.hash === sample.hash)) return
    // 只落盘向量和抽象句式，原始/脱敏文本均不作为可召回 prompt 内容保存。
    memory.semanticSamples = [
      {
        hash: sample.hash,
        embedding,
        patterns: sample.patterns,
        sequence: Boolean(sample.sequence),
        at: nowIso()
      },
      ...memory.semanticSamples
    ].slice(0, cfg.semanticSampleLimit)
    memory.updatedAt = nowIso()
    this.scheduleFlush(cfg)
  }

  async buildRelevantPrompt(config = {}, { query = "", embeddingConfig = {} } = {}) {
    const cfg = normalizeConfig(config)
    if (!cfg.enabled || !cfg.promptInjectionEnabled || !this.canUseSemanticRecall(cfg, embeddingConfig)) return ""
    const memory = this.readMemory(cfg)
    const candidates = (memory.semanticSamples || []).filter(item => Array.isArray(item.embedding) && Array.isArray(item.patterns) && item.patterns.length)
    if (candidates.length < cfg.semanticMinSamples) return ""
    const normalizedQuery = sanitizeSample(query)
    if (!normalizedQuery) return ""
    const cacheKey = `${embeddingConfig.embeddingApiModel || "text-embedding-3-small"}:${this.hashText(normalizedQuery)}`
    const cached = this.semanticQueryCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.prompt
    if (this.semanticQueryInFlight.has(cacheKey)) return this.semanticQueryInFlight.get(cacheKey)

    const task = (async () => {
      try {
        const queryEmbedding = await this.embedSemanticText(normalizedQuery, cfg, embeddingConfig)
        if (!queryEmbedding) return ""
        const matched = candidates
          .map(item => ({ item, score: cosineSimilarity(queryEmbedding, item.embedding) }))
          .filter(item => item.score >= cfg.semanticSimilarityThreshold)
          .sort((left, right) => right.score - left.score)
          .slice(0, cfg.semanticPromptExamples)
        const patterns = [...new Set(matched.flatMap(item => item.item.patterns || []))].slice(0, cfg.semanticPromptExamples)
        if (!patterns.length) return ""
        const prompt = [
          "【希洛当前话题的表达提示】",
          "这是由语义相近样本提炼出的匿名句式和节奏，不含任何群友原话；只在自然契合时采用，不要解释来源。",
          ...patterns.map(pattern => `- ${pattern}`)
        ].join("\n")
        this.semanticQueryCache.set(cacheKey, {
          expiresAt: Date.now() + cfg.semanticQueryCacheMinutes * 60 * 1000,
          prompt
        })
        if (this.semanticQueryCache.size > 128) {
          const oldest = this.semanticQueryCache.keys().next().value
          this.semanticQueryCache.delete(oldest)
        }
        return prompt
      } catch (error) {
        this.semanticFailureUntil = Date.now() + 60000
        this.logger?.warn?.(`[全局表达学习] 语义召回失败: ${error.message}`)
        return ""
      } finally {
        this.semanticQueryInFlight.delete(cacheKey)
      }
    })()
    this.semanticQueryInFlight.set(cacheKey, task)
    return task
  }

  getEssenceRules(memory = this.readMemory(), limit = 6) {
    const drossPressure = Object.values(memory.dross || {}).reduce((sum, value) => sum + Number(value || 0), 0)
    return ESSENCE_RULES
      .map(item => ({ ...item, weight: Number(memory.essence?.[item.key]) || 0 }))
      .filter(item => item.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit)
      .map(item => {
        if (item.key === "light_humor" && drossPressure > 0) {
          return { ...item, rule: `${item.rule} 明确避开辱骂、阴阳怪气和群内私梗过拟合。` }
        }
        return item
      })
  }

  getDrossRules(memory = this.readMemory(), limit = 4) {
    return DROSS_RULES
      .map(item => ({ ...item, weight: Number(memory.dross?.[item.key]) || 0 }))
      .filter(item => item.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit)
  }

  getAiRules(memory = this.readMemory(), limit = 6) {
    const sortRules = rules => (Array.isArray(rules) ? rules : [])
      .filter(item => item?.rule)
      .sort((a, b) => {
        const scoreA = (Number(a.weight) || 1) * clampConfidence(a.confidence)
        const scoreB = (Number(b.weight) || 1) * clampConfidence(b.confidence)
        return scoreB - scoreA
      })
      .slice(0, limit)
    return {
      absorb: sortRules(memory.aiRules?.absorb),
      avoid: sortRules(memory.aiRules?.avoid)
    }
  }

  mergeAiRules(memory, result = {}, cfg = normalizeConfig()) {
    const mergeList = (side, incoming) => {
      if (!Array.isArray(incoming)) return 0
      const list = Array.isArray(memory.aiRules?.[side]) ? memory.aiRules[side] : []
      let changed = 0
      for (const raw of incoming.slice(0, cfg.maxAiRules)) {
        const label = cleanText(raw?.label || "").slice(0, 18)
        const rule = cleanText(raw?.rule || "").slice(0, 120)
        if (!rule || rule.length < 4) continue
        const confidence = clampConfidence(raw?.confidence)
        const reason = cleanText(raw?.reason || "").slice(0, 80)
        const key = normalizeRuleKey(rule || label)
        if (!key) continue
        const existing = list.find(item => item.key === key || normalizeRuleKey(item.rule) === key)
        if (existing) {
          existing.label = label || existing.label
          existing.rule = rule
          existing.confidence = Math.max(clampConfidence(existing.confidence), confidence)
          existing.reason = reason || existing.reason
          existing.weight = (Number(existing.weight) || 1) + 1
          existing.lastSeen = nowIso()
        } else {
          list.push({
            key,
            label: label || (side === "absorb" ? "可吸收表达" : "应避开表达"),
            rule,
            confidence,
            reason,
            weight: 1,
            createdAt: nowIso(),
            lastSeen: nowIso()
          })
        }
        changed += 1
      }
      memory.aiRules[side] = list
        .sort((a, b) => ((Number(b.weight) || 1) * clampConfidence(b.confidence)) - ((Number(a.weight) || 1) * clampConfidence(a.confidence)))
        .slice(0, cfg.maxAiRules * 3)
      return changed
    }

    const absorbChanged = mergeList("absorb", result.absorb)
    const avoidChanged = mergeList("avoid", result.avoid)
    memory.aiSummary = {
      ...(memory.aiSummary || {}),
      lastAt: nowIso(),
      count: (Number(memory.aiSummary?.count) || 0) + 1,
      lastSamples: Array.isArray(memory.samplePool) ? Math.min(memory.samplePool.length, cfg.summarySampleLimit) : 0
    }
    memory.updatedAt = nowIso()
    return { absorbChanged, avoidChanged }
  }

  buildSummaryMessages(memory, cfg) {
    const essence = this.getEssenceRules(memory, 8)
    const dross = this.getDrossRules(memory, 8)
    const ai = this.getAiRules(memory, cfg.maxAiRules)
    const samples = (memory.samplePool || []).slice(0, cfg.summarySampleLimit).map((item, index) => ({
      id: index + 1,
      text: item.text,
      essence: item.essence || [],
      dross: item.dross || []
    }))
    return [
      {
        role: "system",
        content: [
          "你是聊天机器人希洛的全局表达学习总结器。",
          "任务是从跨群样本里取其精华、去其糟粕，生成可长期注入的表达准则。",
          "样本中的 [下一条] 表示同一群友短时间内继续发下一条，[表情包] 表示该位置发了表情包；学习整轮节奏和位置，不要照抄具体内容。",
          "不要模仿具体群友，不要吸收人身攻击、歧视、隐私、群内私梗、阴阳怪气和客服腔。",
          "只输出严格 JSON，不要 Markdown。"
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "总结表达规则",
          outputSchema: {
            absorb: [{ label: "短标签", rule: "可吸收的表达策略", confidence: 0.75, reason: "依据" }],
            avoid: [{ label: "短标签", rule: "应该避开的表达倾向", confidence: 0.75, reason: "依据" }]
          },
          limits: {
            maxAbsorb: cfg.maxAiRules,
            maxAvoid: cfg.maxAiRules,
            ruleLength: "每条 rule 不超过 45 个中文字"
          },
          codeStats: {
            totalSamples: memory.totalSamples,
            features: topEntries(memory.featureCount, 10),
            toneWords: topEntries(memory.toneWords, 12),
            essence: essence.map(item => ({ label: item.label, rule: item.rule, weight: item.weight })),
            dross: dross.map(item => ({ label: item.label, rule: item.rule, weight: item.weight }))
          },
          existingAiRules: ai,
          sanitizedSamples: samples
        }, null, 2)
      }
    ]
  }

  getAutoSummaryState(config = {}) {
    const cfg = normalizeConfig(config)
    const memory = this.readMemory(cfg)
    const totalSamples = Number(memory.totalSamples) || 0
    const lastTotalSamples = Number(memory.aiSummary?.lastTotalSamples) || 0
    const newSamples = Math.max(0, totalSamples - lastTotalSamples)
    const lastAutoAt = memory.aiSummary?.lastAutoAt || memory.aiSummary?.lastAt || ""
    const lastAutoMs = lastAutoAt ? new Date(lastAutoAt).getTime() : 0
    const cooldownMs = cfg.autoSummaryCooldownHours * 60 * 60 * 1000
    const cooldownReady = !lastAutoMs || !Number.isFinite(lastAutoMs) || Date.now() - lastAutoMs >= cooldownMs
    const enoughTotal = totalSamples >= cfg.autoSummaryMinTotalSamples
    const enoughNew = newSamples >= cfg.autoSummaryMinNewSamples
    return {
      enabled: cfg.enabled && cfg.aiSummaryEnabled && cfg.autoSummaryEnabled,
      totalSamples,
      lastTotalSamples,
      newSamples,
      enoughTotal,
      enoughNew,
      cooldownReady,
      lastAutoAt
    }
  }

  shouldAutoSummarize(config = {}) {
    const state = this.getAutoSummaryState(config)
    return state.enabled && state.enoughTotal && state.enoughNew && state.cooldownReady
  }

  async maybeAutoSummarize(config = {}, memoryAiConfig = {}) {
    const cfg = normalizeConfig(config)
    if (this.autoSummaryRunning || !this.shouldAutoSummarize(cfg)) return { triggered: false }
    if (!memoryAiConfig?.memoryAiUrl || !memoryAiConfig?.memoryAiApikey) {
      return { triggered: false, reason: "missing_memory_ai_config" }
    }
    this.autoSummaryRunning = true
    try {
      const result = await this.summarizeWithAI(cfg, memoryAiConfig, { source: "auto" })
      this.logger?.info?.(`[全局表达学习] 自动总结完成: absorb=${result.absorbChanged}, avoid=${result.avoidChanged}, samples=${result.sampleCount}`)
      return { triggered: true, result }
    } catch (error) {
      this.logger?.warn?.(`[全局表达学习] 自动总结失败: ${error.message}`)
      return { triggered: false, error }
    } finally {
      this.autoSummaryRunning = false
    }
  }

  async summarizeWithAI(config = {}, memoryAiConfig = {}, options = {}) {
    const cfg = normalizeConfig(config)
    if (!cfg.enabled) throw new Error("全局表达学习未开启")
    if (!cfg.aiSummaryEnabled) throw new Error("模型总结未开启")
    const aiConfig = memoryAiConfig || {}
    if (!aiConfig.memoryAiUrl || !aiConfig.memoryAiApikey) throw new Error("未配置 memoryAiConfig，无法调用模型总结")

    const memory = this.readMemory(cfg)
    if (!Array.isArray(memory.samplePool) || !memory.samplePool.length) {
      throw new Error("还没有可用于总结的脱敏样本")
    }

    const res = await fetch(aiConfig.memoryAiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiConfig.memoryAiApikey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: aiConfig.memoryAiModel || "gpt-4o-mini",
        messages: this.buildSummaryMessages(memory, cfg),
        temperature: 0.2,
        max_tokens: 900
      }),
      signal: AbortSignal.timeout(cfg.summaryTimeoutMs)
    })
    if (!res.ok) throw new Error(`模型总结请求失败：${res.status}`)
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content?.trim() || ""
    const parsed = parseSummaryResult(content)
    const changed = this.mergeAiRules(memory, parsed, cfg)
    memory.aiSummary = {
      ...(memory.aiSummary || {}),
      lastTotalSamples: Number(memory.totalSamples) || 0
    }
    if (options.source === "auto") {
      memory.aiSummary.lastAutoAt = nowIso()
      memory.aiSummary.autoCount = (Number(memory.aiSummary.autoCount) || 0) + 1
    }
    this.writeMemory(cfg)
    return {
      ...changed,
      totalAbsorb: memory.aiRules.absorb.length,
      totalAvoid: memory.aiRules.avoid.length,
      sampleCount: Math.min(memory.samplePool.length, cfg.summarySampleLimit)
    }
  }

  buildPrompt(config = {}) {
    const cfg = normalizeConfig(config)
    if (!cfg.enabled || !cfg.promptInjectionEnabled) return ""
    const memory = this.readMemory(cfg)
    if ((Number(memory.totalSamples) || 0) < cfg.minSamplesForPrompt) return ""
    const essence = this.getEssenceRules(memory, cfg.maxPromptRules)
    const dross = this.getDrossRules(memory, Math.min(4, cfg.maxPromptRules))
    const aiRules = this.getAiRules(memory, cfg.maxAiRules)
    if (!essence.length && !dross.length && !aiRules.absorb.length && !aiRules.avoid.length) return ""

    const lines = [
      "【希洛全局表达学习】",
      "这是从多个群的离散特征里沉淀出的表达策略，不是模仿任何具体群友。回复时自然吸收精华、避开糟粕，不要提到学习过程。"
    ]
    let used = 0
    for (const item of aiRules.absorb) {
      if (used >= cfg.maxPromptRules) break
      lines.push(`- 可吸收：${item.rule}`)
      used += 1
    }
    for (const item of essence) {
      if (used >= cfg.maxPromptRules) break
      lines.push(`- 可吸收：${item.rule}`)
      used += 1
    }
    for (const item of aiRules.avoid.slice(0, 3)) lines.push(`- 避免：${item.rule}`)
    for (const item of dross.slice(0, 3)) lines.push(`- 避免：${item.rule}`)
    return lines.join("\n")
  }

  buildStatus(config = {}) {
    const cfg = normalizeConfig(config)
    const memory = this.readMemory(cfg)
    const samples = Number(memory.totalSamples) || 0
    const enough = samples >= cfg.minSamplesForPrompt
    const essenceCount = this.getEssenceRules(memory, cfg.maxPromptRules).length
    const drossCount = this.getDrossRules(memory, Math.min(4, cfg.maxPromptRules)).length
    const aiRules = this.getAiRules(memory, cfg.maxAiRules)
    const autoState = this.getAutoSummaryState(cfg)
    return [
      "全局表达学习状态：",
      `学习：${cfg.enabled ? "开启" : "关闭"}`,
      `注入：${cfg.promptInjectionEnabled ? (enough ? "开启，已生效" : "开启，但样本还不够") : "关闭"}`,
      `模型总结：${cfg.aiSummaryEnabled ? "可手动触发" : "关闭"}${memory.aiSummary?.lastAt ? `；上次 ${memory.aiSummary.lastAt}` : ""}`,
      `自动总结：${autoState.enabled ? "开启" : "关闭"}；新增样本 ${autoState.newSamples}/${cfg.autoSummaryMinNewSamples}；冷却 ${autoState.cooldownReady ? "已满足" : "未满足"}`,
      `样本：${samples}/${cfg.minSamplesForPrompt}`,
      `语义召回：${cfg.semanticRecallEnabled ? `开启；样本 ${memory.semanticSamples.length}/${cfg.semanticMinSamples}` : "关闭"}`,
      `规则侧策略：${essenceCount} 条；规则侧避坑：${drossCount} 条`,
      `模型侧策略：${aiRules.absorb.length} 条；模型侧避坑：${aiRules.avoid.length} 条`,
      enough
        ? "现在会把少量高权重表达策略注入回复。"
        : "现在只做离散统计，还不会影响回复。"
    ].join("\n")
  }

  buildMemoryView(config = {}) {
    const cfg = normalizeConfig(config)
    const memory = this.readMemory(cfg)
    const samples = Number(memory.totalSamples) || 0
    const essence = this.getEssenceRules(memory, cfg.maxPromptRules)
    const dross = this.getDrossRules(memory, Math.min(4, cfg.maxPromptRules))
    const aiRules = this.getAiRules(memory, cfg.maxAiRules)
    const lines = [
      "希洛当前表达记忆：",
      samples < cfg.minSamplesForPrompt
        ? `样本还不够稳定：${samples}/${cfg.minSamplesForPrompt}。下面只是候选，不会注入。`
        : `这些会少量注入回复，帮助希洛优化语言逻辑。`
    ]

    if (aiRules.absorb.length || aiRules.avoid.length) {
      lines.push("模型总结：")
      aiRules.absorb.forEach((item, index) => {
        lines.push(`${index + 1}. 可吸收/${item.label}：${item.rule}（置信度 ${Math.round(clampConfidence(item.confidence) * 100)}%）`)
      })
      aiRules.avoid.forEach((item, index) => {
        lines.push(`${index + 1}. 避开/${item.label}：${item.rule}（置信度 ${Math.round(clampConfidence(item.confidence) * 100)}%）`)
      })
    } else {
      lines.push("模型总结：暂无；可以用“.表达学习 总结”手动沉淀一次。")
    }

    if (essence.length) {
      lines.push("规则统计可吸收：")
      essence.forEach((item, index) => {
        lines.push(`${index + 1}. ${item.label}：${item.rule}（${confidenceLabel(item.weight, samples)}）`)
      })
    } else {
      lines.push("规则统计可吸收：暂无稳定信号")
    }

    if (dross.length) {
      lines.push("规则统计要避开：")
      dross.forEach((item, index) => {
        lines.push(`${index + 1}. ${item.label}：${item.rule}（${confidenceLabel(item.weight, samples)}）`)
      })
    } else {
      lines.push("规则统计要避开：暂无明显糟粕信号")
    }

    return lines.join("\n")
  }

  buildReport(config = {}) {
    const cfg = normalizeConfig(config)
    const memory = this.readMemory(cfg)
    const essence = this.getEssenceRules(memory, 8)
    const dross = this.getDrossRules(memory, 6)
    const aiRules = this.getAiRules(memory, cfg.maxAiRules)
    const groups = topEntries(memory.groupCount, 8)
    const features = topEntries(memory.featureCount, 8)
    const tones = topEntries(memory.toneWords, 10)

    const samples = Number(memory.totalSamples) || 0
    const autoState = this.getAutoSummaryState(cfg)
    const groupSummary = groups.length
      ? `${groups.length} 个主要来源群，${groups.map(([k, v]) => `${k}：${v}条`).join("、")}`
      : "暂无"
    return [
      "全局表达学习报告：",
      `样本：${samples} 条；覆盖：${Object.keys(memory.groupCount || {}).length} 个群；注入：${cfg.promptInjectionEnabled ? "开启" : "关闭"}`,
      `脱敏样本池：${Array.isArray(memory.samplePool) ? memory.samplePool.length : 0} 条；模型总结：${memory.aiSummary?.count || 0} 次，自动 ${memory.aiSummary?.autoCount || 0} 次`,
      `语义样本：${Array.isArray(memory.semanticSamples) ? memory.semanticSamples.length : 0}/${cfg.semanticMinSamples}；语义召回：${cfg.semanticRecallEnabled ? "开启" : "关闭"}`,
      `自动总结：${autoState.enabled ? "开启" : "关闭"}；总样本门槛 ${autoState.totalSamples}/${cfg.autoSummaryMinTotalSamples}；新增样本 ${autoState.newSamples}/${cfg.autoSummaryMinNewSamples}；冷却 ${autoState.cooldownReady ? "已满足" : "未满足"}`,
      `主要来源：${groupSummary}`,
      features.length ? `离散特征：${features.map(([k, v]) => `${featureLabel(k)} ${v}`).join("、")}` : "离散特征：暂无",
      tones.length ? `常见语气信号：${tones.map(([k, v]) => `${k} ${v}`).join("、")}` : "常见语气信号：暂无",
      aiRules.absorb.length || aiRules.avoid.length
        ? `模型总结规则：\n${[
          ...aiRules.absorb.map((item, index) => `${index + 1}. 可吸收/${item.label}：${item.rule}`),
          ...aiRules.avoid.map((item, index) => `${index + 1}. 避开/${item.label}：${item.rule}`)
        ].join("\n")}`
        : "模型总结规则：暂无",
      essence.length ? `学习到的表达倾向：\n${essence.map((item, index) => `${index + 1}. ${item.label}：${confidenceLabel(item.weight, samples)}。${item.rule}`).join("\n")}` : "学习到的表达倾向：暂无",
      dross.length ? `过滤掉的坏倾向：\n${dross.map((item, index) => `${index + 1}. ${item.label}：${confidenceLabel(item.weight, samples)}。${item.rule}`).join("\n")}` : "过滤掉的坏倾向：暂无明显信号",
      (Number(memory.totalSamples) || 0) < cfg.minSamplesForPrompt
        ? `提示：少于 ${cfg.minSamplesForPrompt} 条样本，暂不注入回复 prompt。`
        : `提示：真正注入的内容请看“.表达学习 记忆”。`
    ].join("\n")
  }

  clear(config = {}) {
    this.memory = createEmptyMemory()
    this.writeMemory(config)
  }
}

export const globalStyleLearnerManager = new GlobalStyleLearnerManager()
