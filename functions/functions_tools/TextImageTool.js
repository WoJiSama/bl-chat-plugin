import fs from "fs"
import path from "path"
import sharp from "sharp"
import { AbstractTool } from "./AbstractTool.js"

const AVATAR_SIZE = 64
const CHAT_MAX_TEXT_LENGTH = 1800
const PARCHMENT_MAX_TEXT_LENGTH = 12000
const DELETE_RETRY_DELAYS_MS = [0, 200, 1000]

const TEXT_FONT_SIZE = 28
const TEXT_LINE_HEIGHT = 42
const HEADING_FONT_SIZE = 32
const HEADING_LINE_HEIGHT = 46
const QUOTE_FONT_SIZE = 25
const QUOTE_LINE_HEIGHT = 36
const CODE_FONT_SIZE = 20
const CODE_LINE_HEIGHT = 30
const PARCHMENT_TEXT_FONT_SIZE = 30
const PARCHMENT_TEXT_LINE_HEIGHT = 48
const PARCHMENT_HEADING_FONT_SIZE = 38
const PARCHMENT_HEADING_LINE_HEIGHT = 56
const PARCHMENT_QUOTE_FONT_SIZE = 28
const PARCHMENT_QUOTE_LINE_HEIGHT = 44
const PARCHMENT_VARIANTS = {
  short: {
    name: "short",
    paperX: 44,
    paperY: 38,
    paperWidth: 760,
    paperPaddingX: 58,
    paperPaddingY: 48,
    minHeight: 300,
    blockGap: 12,
    paragraphMaxUnits: 34,
    headingMaxUnits: 28,
    quoteMaxUnits: 34,
    textFontSize: 29,
    textLineHeight: 44,
    headingFontSize: 35,
    headingLineHeight: 50,
    quoteFontSize: 27,
    quoteLineHeight: 40
  },
  medium: {
    name: "medium",
    paperX: 54,
    paperY: 46,
    paperWidth: 940,
    paperPaddingX: 76,
    paperPaddingY: 70,
    minHeight: 420,
    blockGap: 16,
    paragraphMaxUnits: 42,
    headingMaxUnits: 34,
    quoteMaxUnits: 42,
    textFontSize: PARCHMENT_TEXT_FONT_SIZE,
    textLineHeight: PARCHMENT_TEXT_LINE_HEIGHT,
    headingFontSize: PARCHMENT_HEADING_FONT_SIZE,
    headingLineHeight: PARCHMENT_HEADING_LINE_HEIGHT,
    quoteFontSize: PARCHMENT_QUOTE_FONT_SIZE,
    quoteLineHeight: PARCHMENT_QUOTE_LINE_HEIGHT
  },
  long: {
    name: "long",
    paperX: 42,
    paperY: 38,
    paperWidth: 1040,
    paperPaddingX: 82,
    paperPaddingY: 62,
    minHeight: 560,
    blockGap: 13,
    paragraphMaxUnits: 50,
    headingMaxUnits: 42,
    quoteMaxUnits: 50,
    textFontSize: 28,
    textLineHeight: 43,
    headingFontSize: 36,
    headingLineHeight: 52,
    quoteFontSize: 26,
    quoteLineHeight: 40
  }
}
const CODE_COLORS = {
  default: "#e5e7eb",
  keyword: "#c084fc",
  string: "#86efac",
  number: "#fbbf24",
  comment: "#7dd3fc",
  literal: "#f472b6",
  function: "#93c5fd",
  operator: "#f9a8d4",
  punctuation: "#94a3b8"
}

const KEYWORDS = {
  python: new Set([
    "and",
    "as",
    "assert",
    "async",
    "await",
    "break",
    "class",
    "continue",
    "def",
    "del",
    "elif",
    "else",
    "except",
    "finally",
    "for",
    "from",
    "global",
    "if",
    "import",
    "in",
    "is",
    "lambda",
    "nonlocal",
    "not",
    "or",
    "pass",
    "raise",
    "return",
    "try",
    "while",
    "with",
    "yield"
  ]),
  javascript: new Set([
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "let",
    "new",
    "of",
    "return",
    "switch",
    "this",
    "throw",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "yield"
  ]),
  bash: new Set([
    "case",
    "do",
    "done",
    "elif",
    "else",
    "esac",
    "fi",
    "for",
    "function",
    "if",
    "in",
    "select",
    "then",
    "until",
    "while"
  ])
}

const LITERALS = new Set([
  "false",
  "null",
  "none",
  "true",
  "undefined",
  "False",
  "None",
  "True",
  "NaN",
  "Infinity"
])

function escapeXml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function stripInlineMarkdown(text = "") {
  return String(text)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
}

function charUnits(char) {
  return /[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef]/.test(char) ? 2 : 1
}

function measureTextWidth(text, fontSize, monospace = false) {
  // monospace 字体下中文同样占两个等宽字符宽度（与 wrapText 的 charUnits 保持一致）
  if (monospace) return [...String(text)].reduce((sum, char) => sum + charUnits(char) * fontSize * 0.62, 0)
  return [...String(text)].reduce((sum, char) => sum + charUnits(char) * fontSize * 0.52, 0)
}

function wrapText(text, maxUnits) {
  const lines = []
  const source = String(text || "")

  if (!source) return [""]

  for (const paragraph of source.split(/\r?\n/)) {
    let line = ""
    let units = 0

    for (const char of paragraph) {
      const width = charUnits(char)
      if (line && units + width > maxUnits) {
        if (/^[，。！？；：、,.!?;:)]$/.test(char)) {
          line += char
          lines.push(line)
          line = ""
          units = 0
          continue
        }
        lines.push(line)
        line = char
        units = width
      } else {
        line += char
        units += width
      }
    }

    lines.push(line)
  }

  return lines.length ? lines : [""]
}

function normalizeLanguage(language = "") {
  const lang = String(language).trim().toLowerCase()
  if (["py", "python3"].includes(lang)) return "python"
  if (["js", "jsx", "node", "mjs", "cjs"].includes(lang)) return "javascript"
  if (["ts", "tsx", "typescript"].includes(lang)) return "javascript"
  if (["sh", "shell", "zsh", "powershell", "ps1"].includes(lang)) return "bash"
  if (["yml", "yaml"].includes(lang)) return "yaml"
  if (lang === "json") return "json"
  return lang
}

function isIdentifierStart(char) {
  return /[A-Za-z_$]/.test(char)
}

function isIdentifierPart(char) {
  return /[A-Za-z0-9_$]/.test(char)
}

function readStringToken(line, start) {
  const quote = line[start]
  let index = start + 1
  let escaped = false

  while (index < line.length) {
    const char = line[index]
    if (escaped) {
      escaped = false
      index++
      continue
    }
    if (char === "\\") {
      escaped = true
      index++
      continue
    }
    index++
    if (char === quote) break
  }

  return line.slice(start, index)
}

function pushToken(tokens, text, type = "default") {
  if (!text) return
  const last = tokens.at(-1)
  if (last?.type === type) {
    last.text += text
    return
  }
  tokens.push({ text, type })
}

function highlightCodeLine(line, language = "") {
  const lang = normalizeLanguage(language)
  const keywords = KEYWORDS[lang] || (lang ? new Set() : KEYWORDS.javascript)
  const tokens = []
  let index = 0

  while (index < line.length) {
    const rest = line.slice(index)
    const char = line[index]

    if (/\s/.test(char)) {
      const match = rest.match(/^\s+/)[0]
      pushToken(tokens, match)
      index += match.length
      continue
    }

    if ((lang === "python" || lang === "yaml" || lang === "bash") && char === "#") {
      pushToken(tokens, rest, "comment")
      break
    }

    if ((lang === "javascript" || lang === "json") && rest.startsWith("//")) {
      pushToken(tokens, rest, "comment")
      break
    }

    if (lang === "javascript" && rest.startsWith("/*")) {
      const end = line.indexOf("*/", index + 2)
      const comment = end === -1 ? rest : line.slice(index, end + 2)
      pushToken(tokens, comment, "comment")
      index += comment.length
      continue
    }

    if (["'", "\"", "`"].includes(char)) {
      if (char === "`" && !["javascript", "bash"].includes(lang)) {
        pushToken(tokens, char, "punctuation")
        index++
        continue
      }

      const token = readStringToken(line, index)
      pushToken(tokens, token, "string")
      index += token.length
      continue
    }

    const numberMatch = rest.match(/^(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)/)
    if (numberMatch) {
      pushToken(tokens, numberMatch[0], "number")
      index += numberMatch[0].length
      continue
    }

    if (isIdentifierStart(char)) {
      let end = index + 1
      while (end < line.length && isIdentifierPart(line[end])) end++

      const word = line.slice(index, end)
      const nextChar = line.slice(end).trimStart()[0]
      if (keywords.has(word)) pushToken(tokens, word, "keyword")
      else if (LITERALS.has(word)) pushToken(tokens, word, "literal")
      else if (nextChar === "(") pushToken(tokens, word, "function")
      else pushToken(tokens, word)

      index = end
      continue
    }

    if (/[-+*/%=!<>|&^~?:.]/.test(char)) {
      const match = rest.match(/^[-+*/%=!<>|&^~?:.]+/)[0]
      pushToken(tokens, match, "operator")
      index += match.length
      continue
    }

    pushToken(tokens, char, "punctuation")
    index++
  }

  return tokens
}

function renderHighlightedCodeLine(line, language, x, y) {
  const tokens = highlightCodeLine(line, language)
    .map(token => `<tspan fill="${CODE_COLORS[token.type] || CODE_COLORS.default}">${escapeXml(token.text)}</tspan>`)
    .join("")

  return `<text x="${x}" y="${y}" font-size="${CODE_FONT_SIZE}" fill="${CODE_COLORS.default}" font-family="Consolas, Cascadia Mono, monospace" xml:space="preserve">${tokens || " "}</text>`
}

function createTextBlock(type, text, options = {}) {
  const fontSize = options.fontSize || TEXT_FONT_SIZE
  const maxUnits = options.maxUnits || 36
  const lines = wrapText(stripInlineMarkdown(text), maxUnits)

  return {
    type,
    text: String(text || ""),
    lines,
    fontSize,
    lineHeight: options.lineHeight || TEXT_LINE_HEIGHT,
    fill: options.fill || "#1f2937",
    fontWeight: options.fontWeight || "400",
    prefix: options.prefix || "",
    height: lines.length * (options.lineHeight || TEXT_LINE_HEIGHT)
  }
}

function createCodeBlock(lines, language = "") {
  const wrappedLines = []

  // 58 units 对应 bubbleWidth 上限 820 时的 code 区有效宽度（留余量防止边距溢出）
  for (const line of lines.length ? lines : [""]) {
    wrappedLines.push(...wrapText(line || " ", 58))
  }

  const labelHeight = language ? 26 : 0
  return {
    type: "code",
    language: language.trim(),
    lines: wrappedLines,
    fontSize: CODE_FONT_SIZE,
    lineHeight: CODE_LINE_HEIGHT,
    labelHeight,
    height: wrappedLines.length * CODE_LINE_HEIGHT + labelHeight + 26
  }
}

function scoreCodeLanguage(lines, language) {
  const text = lines.join("\n")
  const nonEmptyLines = lines.filter(line => line.trim())
  const indentedLines = nonEmptyLines.filter(line => /^\s{2,}\S/.test(line)).length
  let score = 0

  if (language === "python") {
    score += (text.match(/^\s*(def|class|import|from|for|if|elif|else|while|try|except|with|return|print|break|continue)\b/gm) || []).length * 2
    score += (text.match(/:\s*$/gm) || []).length
    score += indentedLines
  } else if (language === "javascript") {
    score += (text.match(/^\s*(const|let|var|function|class|import|export|return|if|for|while|switch|try|catch)\b/gm) || []).length * 2
    score += (text.match(/=>|console\.|;\s*$|{\s*$|}\s*$/gm) || []).length
  } else if (language === "json") {
    score += /^\s*[{[]/.test(text) ? 3 : 0
    score += (text.match(/^\s*"[^"]+"\s*:/gm) || []).length * 2
  } else if (language === "yaml") {
    score += (text.match(/^\s*[\w.-]+\s*:\s*.+$/gm) || []).length
    score += (text.match(/^\s*-\s+[\w"']/gm) || []).length
  } else if (language === "bash") {
    score += (text.match(/^\s*(#!|cd|echo|export|grep|curl|wget|npm|pnpm|yarn|git|sudo|if|for|while)\b/gm) || []).length * 2
    score += (text.match(/\$\w+|\|\s*\w+|&&|\bfi\b|\bdone\b/g) || []).length
  }

  return score
}

function inferCodeLanguage(lines) {
  const candidates = ["python", "javascript", "json", "yaml", "bash"]
  return candidates
    .map(language => ({ language, score: scoreCodeLanguage(lines, language) }))
    .sort((a, b) => b.score - a.score)[0]
}

function looksLikeMarkdown(text) {
  const src = String(text || "")
  if (!src) return false

  // 强信号：以下任一命中即认为是 markdown
  // - markdown 二级以上标题 ## xxx / ### xxx（单 # 容易和 bash/python 行注释 "# 注释" 撞，剔除）
  if (/^#{2,3}\s+\S/m.test(src)) return true
  // - markdown 引用 > xxx（代码里 > 通常在行中而非行首）
  if (/^>\s+\S/m.test(src)) return true

  // 弱信号：单独命中不足以判定（避免和代码/yaml/shell 混淆），需要至少两类联合
  let weakSignals = 0
  // 加粗 **xxx**（至少 2 处）
  const boldMatches = src.match(/\*\*[^*\n]+\*\*/g)
  if (boldMatches && boldMatches.length >= 2) weakSignals++
  // 无序列表 - xxx / * xxx / + xxx（≥ 3 行）
  const listLines = src.split(/\r?\n/).filter(line => /^\s*[-*+]\s+\S/.test(line)).length
  if (listLines >= 3) weakSignals++
  // 有序列表 1. xxx 2. xxx（≥ 2 行）
  const orderedListLines = src.split(/\r?\n/).filter(line => /^\s*\d+\.\s+\S/.test(line)).length
  if (orderedListLines >= 2) weakSignals++
  // 行内代码 `xxx`（≥ 2 处）
  const inlineCode = src.match(/`[^`\n]+`/g)
  if (inlineCode && inlineCode.length >= 2) weakSignals++
  // markdown 链接 [text](url)：要求 url 像真 URL（含 :// 或 / 或 . 后缀），且 text 至少 2 字符
  // 这样 python/js 代码里 arr[i](x) / dict["k"](v) 不会误命中
  if (/\[[^\]\n]{2,}\]\((?:https?:\/\/|\/|\.\/|#)[^)\n]+\)/.test(src)) weakSignals++

  return weakSignals >= 2
}

function getPlainCodeBlock(text) {
  if (String(text).includes("```")) return null
  // markdown 特征明显的内容不走"无栅栏代码块"识别
  if (looksLikeMarkdown(text)) return null

  const rawLines = String(text || "").split(/\r?\n/)
  const lines = rawLines.filter(line => line.trim())
  if (lines.length < 3) return null

  let language = ""
  let codeLines = rawLines
  const firstTextLineIndex = rawLines.findIndex(line => line.trim())
  const firstTextLine = rawLines[firstTextLineIndex]?.trim().toLowerCase()

  if (firstTextLine && ["python", "py", "javascript", "js", "typescript", "ts", "json", "yaml", "yml", "bash", "sh"].includes(firstTextLine)) {
    language = normalizeLanguage(firstTextLine)
    codeLines = rawLines.slice(firstTextLineIndex + 1)
  }

  const inferred = inferCodeLanguage(codeLines)
  language ||= inferred.language

  const joinedCode = codeLines.join("\n")
  const hasKeywordLine = /^\s*(def|class|for|if|elif|else|while|return|import|from|print|break|continue|const|let|var|function|class|export|if|switch|try|catch)\b/m.test(joinedCode)
  const hasMultipleIndentedLines = codeLines.filter(line => /^\s{2,}\S/.test(line)).length >= 2
  const hasCodeOperator = /[A-Za-z_$][\w$.\[\]]*\s*(?:=|==|===|>|<|\+|-|\*|\/)/.test(joinedCode)
  const hasCodeBrackets = /[{}();]/.test(joinedCode)
  const hasCodeShape =
    inferred.score >= 5 ||
    (hasKeywordLine && (hasMultipleIndentedLines || hasCodeOperator || hasCodeBrackets)) ||
    (inferred.score >= 3 && hasCodeOperator && hasCodeBrackets)
  if (!hasCodeShape) return null

  return createCodeBlock(codeLines, language)
}

function flushMarkdownLines(blocks, lines) {
  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (!trimmed) {
      blocks.push({ type: "spacer", height: 14, lines: [] })
      continue
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      blocks.push(
        createTextBlock("heading", heading[2], {
          fontSize: HEADING_FONT_SIZE,
          lineHeight: HEADING_LINE_HEIGHT,
          maxUnits: 30,
          fontWeight: "700",
          fill: "#111827"
        })
      )
      continue
    }

    const quote = trimmed.match(/^>\s?(.+)$/)
    if (quote) {
      blocks.push(
        createTextBlock("quote", quote[1], {
          fontSize: QUOTE_FONT_SIZE,
          lineHeight: QUOTE_LINE_HEIGHT,
          maxUnits: 36,
          fill: "#5b6472"
        })
      )
      continue
    }

    const list = trimmed.match(/^((?:[-*+])|(?:\d+\.))\s+(.+)$/)
    if (list) {
      blocks.push(createTextBlock("list", list[2], { prefix: list[1].match(/\d+\./) ? list[1] : "•" }))
      continue
    }

    blocks.push(createTextBlock("paragraph", line.trim(), { maxUnits: 36 }))
  }
}

function parseMarkdown(text) {
  const plainCodeBlock = getPlainCodeBlock(text)
  if (plainCodeBlock) return [plainCodeBlock]

  const blocks = []
  const normalLines = []
  let inCode = false
  let codeLanguage = ""
  let codeLines = []

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const fence = rawLine.match(/^```\s*([^`]*)$/)
    if (fence) {
      if (inCode) {
        blocks.push(createCodeBlock(codeLines, codeLanguage))
        codeLines = []
        codeLanguage = ""
        inCode = false
      } else {
        flushMarkdownLines(blocks, normalLines.splice(0))
        codeLanguage = fence[1] || ""
        inCode = true
      }
      continue
    }

    if (inCode) codeLines.push(rawLine)
    else normalLines.push(rawLine)
  }

  if (inCode) blocks.push(createCodeBlock(codeLines, codeLanguage))
  flushMarkdownLines(blocks, normalLines)

  while (blocks[0]?.type === "spacer") blocks.shift()
  while (blocks.at(-1)?.type === "spacer") blocks.pop()

  return blocks.length ? blocks : [createTextBlock("paragraph", "")]
}

function cleanOverviewLine(text = "", maxLength = 96) {
  return stripInlineMarkdown(String(text || ""))
    .replace(/^#{1,3}\s+/, "")
    .replace(/^>\s*/, "")
    .replace(/^\s*(?:[-*+•]|\d+\.)\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}

function getOverviewSentences(text = "") {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .split(/(?<=[。！？!?；;])|\n+/)
    .map(item => cleanOverviewLine(item, 120))
    .filter(item => item.length >= 8 && !/^(?:http|CQ:|data:image|base64)/i.test(item))
}

function extractParchmentOverview(text = "", { maxPoints = 4 } = {}) {
  const content = String(text || "").trim()
  const nonEmptyLines = content.split(/\r?\n/).filter(line => line.trim())
  if (content.length < 360 && nonEmptyLines.length < 5) return null

  const heading = nonEmptyLines
    .map(line => line.match(/^\s*#{1,3}\s+(.{2,40})\s*$/)?.[1])
    .find(Boolean)
  const title = cleanOverviewLine(heading || "这段先看这里", 34)
  const sentences = getOverviewSentences(content)
  const summary = sentences.find(line =>
    /(原因|主要|问题|结论|本质|关键|先|可以|需要|建议|检查|确认)/.test(line)
  ) || sentences[0] || ""
  if (!summary) return null

  const directPoints = nonEmptyLines
    .filter(line => /^\s*(?:[-*+•]|\d+\.)\s+\S/.test(line))
    .map(line => cleanOverviewLine(line, 90))
  const keywordPoints = sentences.filter(line =>
    line !== summary && /(先|再|然后|最后|如果|需要|检查|确认|注意|建议|解决|版本|依赖|配置)/.test(line)
  )
  const fallbackPoints = sentences.filter(line => line !== summary)
  const points = [...directPoints, ...keywordPoints, ...fallbackPoints]
    .map(line => cleanOverviewLine(line, 90))
    .filter((line, index, list) => line && list.indexOf(line) === index && line !== summary && line !== title)
    .slice(0, maxPoints)

  if (!points.length && summary.length < 24) return null
  return { eyebrow: "先看结论", title, summary, points }
}

function createParchmentOverviewBlock(text, variant) {
  if (variant.name === "short") return null
  const overview = extractParchmentOverview(text, { maxPoints: variant.name === "long" ? 5 : 4 })
  if (!overview) return null

  const eyebrowFontSize = 20
  const eyebrowLineHeight = 28
  const titleFontSize = Math.max(32, variant.headingFontSize - 2)
  const titleLineHeight = Math.max(44, variant.headingLineHeight - 4)
  const summaryFontSize = Math.max(25, variant.textFontSize - 2)
  const summaryLineHeight = Math.max(36, variant.textLineHeight - 6)
  const pointFontSize = Math.max(23, variant.textFontSize - 5)
  const pointLineHeight = Math.max(32, variant.textLineHeight - 10)
  const maxUnits = Math.max(28, variant.paragraphMaxUnits - 6)
  const titleLines = wrapText(overview.title, Math.max(22, variant.headingMaxUnits - 4)).slice(0, 2)
  const summaryLines = wrapText(overview.summary, maxUnits)
  const points = overview.points.map(point => ({
    text: point,
    lines: wrapText(point, Math.max(24, maxUnits - 3))
  }))
  const pointsHeight = points.reduce((sum, point) => sum + Math.max(34, point.lines.length * pointLineHeight) + 12, 0)
  const height = 28 + eyebrowLineHeight + 10 + titleLines.length * titleLineHeight + 16 +
    summaryLines.length * summaryLineHeight + (points.length ? 24 + pointsHeight : 0) + 30

  return {
    type: "overview",
    lines: [],
    eyebrow: overview.eyebrow,
    title: overview.title,
    titleLines,
    summaryLines,
    points,
    eyebrowFontSize,
    eyebrowLineHeight,
    titleFontSize,
    titleLineHeight,
    summaryFontSize,
    summaryLineHeight,
    pointFontSize,
    pointLineHeight,
    height
  }
}

function selectParchmentVariant(text = "", variantName = "") {
  if (variantName && PARCHMENT_VARIANTS[variantName]) return PARCHMENT_VARIANTS[variantName]

  const content = String(text || "").trim()
  const nonEmptyLines = content.split(/\r?\n/).filter(line => line.trim()).length
  const hasCodeBlock = /```|^\s*(?:public|private|class|function|const|let|var|def|import|package)\b/m.test(content)

  if (!hasCodeBlock && content.length <= 260 && nonEmptyLines <= 5) return PARCHMENT_VARIANTS.short
  if (content.length >= 1100 || nonEmptyLines >= 12) return PARCHMENT_VARIANTS.long
  return PARCHMENT_VARIANTS.medium
}

function parseParchmentBlocks(text, variant = PARCHMENT_VARIANTS.medium) {
  const blocks = parseMarkdown(text)
  const parchmentBlocks = blocks.map(block => {
    if (block.type === "code" || block.type === "spacer") return block

    const source = block.text || block.lines.join("\n")
    const isHeading = block.type === "heading"
    const isQuote = block.type === "quote"
    return createTextBlock(block.type, source, {
      fontSize: isHeading ? variant.headingFontSize : isQuote ? variant.quoteFontSize : variant.textFontSize,
      lineHeight: isHeading ? variant.headingLineHeight : isQuote ? variant.quoteLineHeight : variant.textLineHeight,
      maxUnits: isHeading ? variant.headingMaxUnits : isQuote ? variant.quoteMaxUnits : variant.paragraphMaxUnits,
      fontWeight: isHeading ? "700" : block.fontWeight,
      fill: isQuote ? "#6d5534" : "#3d2614",
      prefix: block.prefix
    })
  })
  const overview = createParchmentOverviewBlock(text, variant)
  return overview ? [overview, ...parchmentBlocks] : parchmentBlocks
}

function measureBlockWidth(block) {
  if (block.type === "code") {
    const codeWidth = Math.max(...block.lines.map(line => measureTextWidth(line, block.fontSize, true)), 80)
    const labelWidth = block.language ? measureTextWidth(block.language, 14, true) + 24 : 0
    return Math.max(codeWidth + 28, labelWidth)
  }

  const prefixWidth = block.prefix ? measureTextWidth(`${block.prefix} `, block.fontSize) : 0
  return Math.max(...block.lines.map(line => prefixWidth + measureTextWidth(line, block.fontSize)), 80)
}

async function fetchAvatarDataUrl(avatarUrl) {
  if (!avatarUrl) return ""

  try {
    const response = await fetch(avatarUrl)
    if (!response.ok) return ""

    const contentType = response.headers.get("content-type") || "image/png"
    const buffer = Buffer.from(await response.arrayBuffer())
    return `data:${contentType};base64,${buffer.toString("base64")}`
  } catch {
    return ""
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function deleteGeneratedFile(filePath) {
  for (let index = 0; index < DELETE_RETRY_DELAYS_MS.length; index++) {
    const delay = DELETE_RETRY_DELAYS_MS[index]
    if (delay > 0) await wait(delay)

    try {
      await fs.promises.unlink(filePath)
      return
    } catch (error) {
      if (error?.code === "ENOENT") return

      const canRetry = ["EBUSY", "EPERM"].includes(error?.code) && index < DELETE_RETRY_DELAYS_MS.length - 1
      if (canRetry) continue

      globalThis.logger?.warn?.(`[textImageTool] 清理临时图片失败：${error.message}`)
      return
    }
  }
}

export class TextImageTool extends AbstractTool {
  constructor() {
    super()
    this.name = "textImageTool"
    this.description =
      "把文字、Markdown 或代码内容渲染成图片并发送。默认使用 QQ 聊天气泡样式；科普、讲解、推导、公式总结这类较长内容应使用 parchment 羊皮纸模板。只要用户要求写代码、给代码、实现算法、提供示例代码、编写 Markdown/MD 文档或输出较长结构化文本，都必须调用本工具，把完整内容作为 text 参数发送，不要直接在普通回复里发送代码或 Markdown 原文。也适用于文字可能被 QQ 群管家、其他 QQ 机器人、风控、敏感词检测撤回的场景。代码内容即使没有使用 ``` 包裹，也可以交给本工具自动识别并按代码块高亮渲染。调用后不要再重复发送原始文字。"
    this.parameters = {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "需要转成图片发送的完整内容。用户要求写代码、示例代码、算法实现、Markdown/MD 文档、科普讲解、公式推导时，请把生成好的完整内容放在这里"
        },
        nickname: {
          type: "string",
          description: "图片中显示的昵称，不填则使用机器人昵称"
        },
        avatarUrl: {
          type: "string",
          description: "图片左侧头像链接，不填则使用机器人 QQ 头像"
        },
        template: {
          type: "string",
          enum: ["chat", "parchment", "parchment_short", "parchment_medium", "parchment_long"],
          description: "渲染模板。chat 为聊天气泡；parchment 会按内容长度自动选择羊皮纸；parchment_short/parchment_medium/parchment_long 可固定短纸条、标准纸和长卷"
        }
      },
      required: ["text"],
      additionalProperties: false
    }
  }

  async func(opts, e) {
    const text = String(opts.text || "").trim()
    if (!text) return "error: text 不能为空"

    const rawTemplate = String(opts.template || "").trim()
    const template = rawTemplate.startsWith("parchment") ? "parchment" : "chat"
    const parchmentVariantName = rawTemplate.match(/^parchment_(short|medium|long)$/)?.[1] || ""
    const maxTextLength = template === "parchment" ? PARCHMENT_MAX_TEXT_LENGTH : CHAT_MAX_TEXT_LENGTH
    const safeText = text.slice(0, maxTextLength)
    const nickname = String(opts.nickname || globalThis.Bot?.nickname || "机器人").trim()
    const avatarUrl =
      opts.avatarUrl || `https://q1.qlogo.cn/g?b=qq&nk=${globalThis.Bot?.uin || e?.self_id || ""}&s=100`
    let imagePath = ""

    try {
      imagePath = template === "parchment"
        ? await this.renderParchmentImage({ text: safeText, variantName: parchmentVariantName })
        : await this.renderChatImage({
            text: safeText,
            nickname,
            avatarUrl
          })

      await e.reply(segment.image(imagePath))
      return "已将文字、Markdown 或代码转为图片发送成功，不需要再重复发送原始内容，绝对不要以文本形式发送代码和markdown内容，会导致严重群内刷屏！！！。"
    } finally {
      if (imagePath) await deleteGeneratedFile(imagePath)
    }
  }

  async renderParchmentImage({ text, variantName = "" }) {
    const outputDir = path.join(process.cwd(), "resources", "bl-chat-plugin", "safe_text_images")
    await fs.promises.mkdir(outputDir, { recursive: true })

    const variant = selectParchmentVariant(text, variantName)
    const blocks = parseParchmentBlocks(text, variant)
    const paperX = variant.paperX
    const paperY = variant.paperY
    const paperWidth = variant.paperWidth
    const paperPaddingX = variant.paperPaddingX
    const paperPaddingY = variant.paperPaddingY
    const contentWidth = paperWidth - paperPaddingX * 2
    const contentX = paperX + paperPaddingX
    let currentY = paperY + paperPaddingY
    const contentHeight = blocks.reduce((sum, block, index) => {
      const gap = index > 0 && block.type !== "spacer" ? variant.blockGap : 0
      return sum + block.height + gap
    }, 0)
    const paperHeight = Math.max(variant.minHeight, contentHeight + paperPaddingY * 2)
    const width = paperX * 2 + paperWidth
    const height = paperY * 2 + paperHeight
    const paperPath = `
      M ${paperX + 26} ${paperY + 10}
      C ${paperX + paperWidth * 0.13} ${paperY - 6}, ${paperX + paperWidth * 0.26} ${paperY + 6}, ${paperX + paperWidth * 0.36} ${paperY + 2}
      C ${paperX + paperWidth * 0.55} ${paperY - 8}, ${paperX + paperWidth * 0.75} ${paperY + 10}, ${paperX + paperWidth - 28} ${paperY + 4}
      C ${paperX + paperWidth + 10} ${paperY + paperHeight * 0.22}, ${paperX + paperWidth - 12} ${paperY + paperHeight * 0.72}, ${paperX + paperWidth - 8} ${paperY + paperHeight - 26}
      C ${paperX + paperWidth * 0.84} ${paperY + paperHeight + 8}, ${paperX + paperWidth * 0.59} ${paperY + paperHeight - 2}, ${paperX + paperWidth * 0.40} ${paperY + paperHeight + 6}
      C ${paperX + paperWidth * 0.23} ${paperY + paperHeight + 12}, ${paperX + paperWidth * 0.10} ${paperY + paperHeight - 8}, ${paperX + 20} ${paperY + paperHeight - 2}
      C ${paperX - 8} ${paperY + paperHeight * 0.67}, ${paperX + 6} ${paperY + paperHeight * 0.48}, ${paperX + 2} ${paperY + 38}
      C ${paperX + 8} ${paperY + 20}, ${paperX + 16} ${paperY + 14}, ${paperX + 26} ${paperY + 10}
      Z`

    const blockSvg = blocks.map((block, index) => {
      if (index > 0 && block.type !== "spacer") currentY += variant.blockGap
      if (block.type === "spacer") {
        currentY += Math.max(18, block.height)
        return ""
      }

      if (block.type === "overview") {
        const rectY = currentY
        const rectHeight = block.height
        const rectX = contentX - 22
        const rectWidth = contentWidth + 44
        const eyebrowY = rectY + 28 + block.eyebrowFontSize
        const eyebrowWidth = Math.ceil(measureTextWidth(block.eyebrow, block.eyebrowFontSize) + 32)
        let textY = rectY + 28 + block.eyebrowLineHeight + 10
        const titleSvg = block.titleLines
          .map((line, lineIndex) =>
            `<tspan x="${contentX}" y="${textY + block.titleFontSize + lineIndex * block.titleLineHeight}">${escapeXml(line)}</tspan>`
          )
          .join("")
        textY += block.titleLines.length * block.titleLineHeight + 18
        const dividerY = textY - 13
        const summarySvg = block.summaryLines
          .map((line, lineIndex) =>
            `<tspan x="${contentX}" y="${textY + block.summaryFontSize + lineIndex * block.summaryLineHeight}">${escapeXml(line)}</tspan>`
          )
          .join("")
        textY += block.summaryLines.length * block.summaryLineHeight + 24
        const pointsSvg = block.points.map((point, pointIndex) => {
          const pointY = textY
          const badgeY = pointY + 3
          const badgeTextY = pointY + block.pointFontSize + 1
          const linesSvg = point.lines
            .map((line, lineIndex) =>
              `<tspan x="${contentX + 52}" y="${pointY + lineIndex * block.pointLineHeight + block.pointFontSize}">${escapeXml(line)}</tspan>`
            )
            .join("")
          textY += Math.max(34, point.lines.length * block.pointLineHeight) + 12
          const order = String(pointIndex + 1).padStart(2, "0")
          return `
    <rect x="${contentX}" y="${badgeY}" width="38" height="26" rx="13" fill="#6f431c" opacity="${pointIndex === 0 ? "0.92" : "0.72"}"/>
    <text x="${contentX + 8}" y="${badgeTextY}" font-size="16" fill="#fff5d6" font-weight="700" font-family="Georgia, Times New Roman, serif">${order}</text>
    <text font-size="${block.pointFontSize}" fill="#4a2d14" font-family="STKaiti, KaiTi, Kaiti SC, Songti SC, Microsoft YaHei, serif" dominant-baseline="alphabetic">
      ${linesSvg}
    </text>`
        }).join("")

        currentY += rectHeight
        return `
  <g>
    <rect x="${rectX}" y="${rectY}" width="${rectWidth}" height="${rectHeight}" rx="22" fill="#fff1bd" opacity="0.24"/>
    <rect x="${rectX + 8}" y="${rectY + 8}" width="${rectWidth - 16}" height="${rectHeight - 16}" rx="18" fill="none" stroke="#7d4f22" stroke-width="2" stroke-opacity="0.30"/>
    <rect x="${contentX}" y="${rectY + 24}" width="${eyebrowWidth}" height="30" rx="15" fill="#5d3717" opacity="0.86"/>
    <text x="${contentX + 16}" y="${eyebrowY}" font-size="${block.eyebrowFontSize}" fill="#fff0c2" font-weight="700" font-family="STKaiti, KaiTi, Kaiti SC, Songti SC, Microsoft YaHei, serif">${escapeXml(block.eyebrow)}</text>
    <text font-size="${block.titleFontSize}" fill="#3a210f" font-weight="700" font-family="STKaiti, KaiTi, Kaiti SC, Songti SC, Microsoft YaHei, serif" dominant-baseline="alphabetic">
      ${titleSvg}
    </text>
    <path d="M ${contentX} ${dividerY} C ${contentX + rectWidth * 0.20} ${dividerY - 8}, ${contentX + rectWidth * 0.48} ${dividerY + 7}, ${contentX + rectWidth * 0.72} ${dividerY - 3}" fill="none" stroke="#8d5e2d" stroke-width="2" stroke-opacity="0.34"/>
    <text font-size="${block.summaryFontSize}" fill="#3d2614" font-weight="600" font-family="STKaiti, KaiTi, Kaiti SC, Songti SC, Microsoft YaHei, serif" dominant-baseline="alphabetic">
      ${summarySvg}
    </text>
    ${pointsSvg}
  </g>`
      }

      if (block.type === "code") {
        const rectY = currentY
        const rectHeight = block.height + 10
        const labelSvg = block.language
          ? `<text x="${contentX + 18}" y="${rectY + 25}" font-size="15" fill="#d6c2a2" font-family="Consolas, Cascadia Mono, monospace">${escapeXml(block.language)}</text>`
          : ""
        const firstLineY = rectY + 22 + block.labelHeight + CODE_FONT_SIZE
        const linesSvg = block.lines
          .map((line, lineIndex) =>
            renderHighlightedCodeLine(line, block.language, contentX + 18, firstLineY + lineIndex * CODE_LINE_HEIGHT)
          )
          .join("")
        currentY += rectHeight
        return `
  <rect x="${contentX - 6}" y="${rectY}" width="${contentWidth + 12}" height="${rectHeight}" rx="10" fill="#2a1b12" opacity="0.94"/>
  ${labelSvg}
  ${linesSvg}`
      }

      const prefixWidth = block.prefix ? measureTextWidth(`${block.prefix} `, block.fontSize) : 0
      const lineX = contentX + prefixWidth
      const prefixSvg = block.prefix
        ? `<text x="${contentX}" y="${currentY + block.fontSize}" font-size="${block.fontSize}" fill="#5d3f20" font-family="STKaiti, KaiTi, Kaiti SC, Songti SC, serif">${escapeXml(block.prefix)}</text>`
        : ""
      const quoteSvg = block.type === "quote"
        ? `<rect x="${contentX - 18}" y="${currentY + 4}" width="5" height="${block.height - 4}" rx="2" fill="#9d7a45" opacity="0.75"/>`
        : ""
      const linesSvg = block.lines
        .map((line, lineIndex) =>
          `<tspan x="${lineX}" y="${currentY + block.fontSize + lineIndex * block.lineHeight}">${escapeXml(line)}</tspan>`
        )
        .join("")

      currentY += block.height
      return `
  ${quoteSvg}
  ${prefixSvg}
  <text font-size="${block.fontSize}" fill="${block.fill}" font-weight="${block.fontWeight}" font-family="STKaiti, KaiTi, Kaiti SC, Songti SC, Microsoft YaHei, serif" dominant-baseline="alphabetic">
    ${linesSvg}
  </text>`
    }).join("")

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="paperShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#4a2c12" flood-opacity="0.36"/>
    </filter>
    <filter id="paperNoise">
      <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="4" seed="17"/>
      <feColorMatrix type="matrix" values="0.22 0 0 0 0.69  0 0.17 0 0 0.52  0 0 0.09 0 0.31  0 0 0 0.20 0"/>
    </filter>
    <linearGradient id="paperGradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f3dfae"/>
      <stop offset="45%" stop-color="#dfbe7a"/>
      <stop offset="100%" stop-color="#c7944c"/>
    </linearGradient>
    <radialGradient id="paperLight" cx="50%" cy="35%" r="75%">
      <stop offset="0%" stop-color="#fff0c7" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#9b642b" stop-opacity="0.12"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="#24170d"/>
  <rect width="100%" height="100%" fill="#110b06" opacity="0.18"/>
  <g filter="url(#paperShadow)">
    <path d="${paperPath}" fill="url(#paperGradient)"/>
    <path d="${paperPath}" fill="url(#paperLight)"/>
    <rect x="${paperX + 26}" y="${paperY + 28}" width="${paperWidth - 52}" height="${paperHeight - 56}" rx="26" fill="url(#paperGradient)" filter="url(#paperNoise)" opacity="0.28"/>
    <rect x="${paperX + 34}" y="${paperY + 34}" width="${paperWidth - 68}" height="${paperHeight - 68}" rx="20" fill="none" stroke="#8c5928" stroke-width="2" stroke-opacity="0.34"/>
    <rect x="${paperX + 46}" y="${paperY + 46}" width="${paperWidth - 92}" height="${paperHeight - 92}" rx="14" fill="none" stroke="#f8df9b" stroke-width="1" stroke-opacity="0.28"/>
  </g>
  ${blockSvg}
</svg>`

    const outputPath = path.join(
      outputDir,
      `safe_text_parchment_${variant.name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`
    )

    try {
      await sharp(Buffer.from(svg)).png().toFile(outputPath)
      return outputPath
    } catch (error) {
      await deleteGeneratedFile(outputPath)
      throw error
    }
  }

  async renderChatImage({ text, nickname, avatarUrl }) {
    const outputDir = path.join(process.cwd(), "resources", "bl-chat-plugin", "safe_text_images")
    await fs.promises.mkdir(outputDir, { recursive: true })

    const avatarDataUrl = await fetchAvatarDataUrl(avatarUrl)
    const blocks = parseMarkdown(text)
    const bubblePaddingX = 28
    const bubblePaddingY = 24
    const maxContentWidth = Math.max(...blocks.map(measureBlockWidth), 140)
    const bubbleWidth = Math.min(820, Math.max(210, Math.ceil(maxContentWidth + bubblePaddingX * 2)))
    const contentWidth = bubbleWidth - bubblePaddingX * 2
    const contentHeight = blocks.reduce((sum, block, index) => {
      const gap = index > 0 && block.type !== "spacer" ? 12 : 0
      return sum + block.height + gap
    }, 0)
    const bubbleHeight = Math.max(76, contentHeight + bubblePaddingY * 2)
    const avatarX = 28
    const avatarY = 28
    const bubbleX = avatarX + AVATAR_SIZE + 26
    const nameY = avatarY + 19
    const bubbleY = avatarY + 36
    const width = bubbleX + bubbleWidth + 28
    const height = Math.max(avatarY + AVATAR_SIZE + 28, bubbleY + bubbleHeight + 28)
    const contentX = bubbleX + bubblePaddingX
    let currentY = bubbleY + bubblePaddingY

    const blockSvg = blocks
      .map((block, index) => {
        if (index > 0 && block.type !== "spacer") currentY += 12

        if (block.type === "spacer") {
          currentY += block.height
          return ""
        }

        if (block.type === "code") {
          const rectY = currentY
          const rectHeight = block.height
          const labelSvg = block.language
            ? `<text x="${contentX + 14}" y="${rectY + 21}" font-size="14" fill="#9ca3af" font-family="Consolas, Cascadia Mono, monospace">${escapeXml(block.language)}</text>`
            : ""
          const firstLineY = rectY + 18 + block.labelHeight + CODE_FONT_SIZE
          const linesSvg = block.lines
            .map(
              (line, lineIndex) =>
                renderHighlightedCodeLine(line, block.language, contentX + 14, firstLineY + lineIndex * CODE_LINE_HEIGHT)
            )
            .join("")

          currentY += block.height
          return `
  <rect x="${contentX - 2}" y="${rectY}" width="${contentWidth + 4}" height="${rectHeight}" rx="12" fill="#111827"/>
  ${labelSvg}
  ${linesSvg}`
        }

        const prefixWidth = block.prefix ? measureTextWidth(`${block.prefix} `, block.fontSize) : 0
        const lineX = contentX + prefixWidth
        const prefixSvg = block.prefix
          ? `<text x="${contentX}" y="${currentY + block.fontSize}" font-size="${block.fontSize}" fill="#374151" font-family="Microsoft YaHei, Noto Sans CJK SC, Arial">${escapeXml(block.prefix)}</text>`
          : ""
        const quoteSvg =
          block.type === "quote"
            ? `<rect x="${contentX - 12}" y="${currentY + 2}" width="4" height="${block.height - 4}" rx="2" fill="#c9d2df"/>`
            : ""
        const linesSvg = block.lines
          .map(
            (line, lineIndex) =>
              `<tspan x="${lineX}" y="${currentY + block.fontSize + lineIndex * block.lineHeight}">${escapeXml(line)}</tspan>`
          )
          .join("")

        currentY += block.height
        return `
  ${quoteSvg}
  ${prefixSvg}
  <text font-size="${block.fontSize}" fill="${block.fill}" font-weight="${block.fontWeight}" font-family="Microsoft YaHei, Noto Sans CJK SC, Arial" dominant-baseline="alphabetic">
    ${linesSvg}
  </text>`
      })
      .join("")

    const avatarSvg = avatarDataUrl
      ? `<image href="${avatarDataUrl}" x="${avatarX}" y="${avatarY}" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMid slice"/>`
      : `<circle cx="${avatarX + AVATAR_SIZE / 2}" cy="${avatarY + AVATAR_SIZE / 2}" r="${AVATAR_SIZE / 2}" fill="#8fb6ff"/>
         <text x="${avatarX + AVATAR_SIZE / 2}" y="${avatarY + 42}" text-anchor="middle" font-size="24" fill="#fff" font-family="Microsoft YaHei, Arial">AI</text>`

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <clipPath id="avatarClip">
      <circle cx="${avatarX + AVATAR_SIZE / 2}" cy="${avatarY + AVATAR_SIZE / 2}" r="${AVATAR_SIZE / 2}"/>
    </clipPath>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#d7dde8" flood-opacity="0.75"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="#f4f6fb"/>
  ${avatarSvg}
  <text x="${bubbleX}" y="${nameY}" font-size="18" fill="#8a94a6" font-family="Microsoft YaHei, Arial">${escapeXml(nickname)}</text>
  <path d="M ${bubbleX - 10} ${bubbleY + 26} L ${bubbleX + 4} ${bubbleY + 18} L ${bubbleX + 4} ${bubbleY + 34} Z" fill="#ffffff"/>
  <rect x="${bubbleX}" y="${bubbleY}" width="${bubbleWidth}" height="${bubbleHeight}" rx="18" fill="#ffffff" filter="url(#softShadow)"/>
  ${blockSvg}
</svg>`

    const outputPath = path.join(
      outputDir,
      `safe_text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`
    )

    try {
      await sharp(Buffer.from(svg)).png().toFile(outputPath)
      return outputPath
    } catch (error) {
      await deleteGeneratedFile(outputPath)
      throw error
    }
  }
}
