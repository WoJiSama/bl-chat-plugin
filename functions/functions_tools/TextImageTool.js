import fs from "fs"
import path from "path"
import sharp from "sharp"
import { AbstractTool } from "./AbstractTool.js"

const AVATAR_SIZE = 64
const MAX_TEXT_LENGTH = 1800
const DELETE_RETRY_DELAYS_MS = [0, 200, 1000]

const TEXT_FONT_SIZE = 28
const TEXT_LINE_HEIGHT = 42
const HEADING_FONT_SIZE = 32
const HEADING_LINE_HEIGHT = 46
const QUOTE_FONT_SIZE = 25
const QUOTE_LINE_HEIGHT = 36
const CODE_FONT_SIZE = 20
const CODE_LINE_HEIGHT = 30
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
  if (monospace) return Math.max(1, [...String(text)].length) * fontSize * 0.62
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
  const keywords = KEYWORDS[lang] || KEYWORDS.javascript
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

  for (const line of lines.length ? lines : [""]) {
    wrappedLines.push(...wrapText(line || " ", 62))
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
      "将文字、Markdown 或代码内容渲染成一张类似 QQ 聊天气泡样式的图片并发送。适用于用户要求把文字转图片、发送 Markdown/代码截图，或准备发送的文字可能被 QQ 群管家、其他 QQ 机器人、风控、敏感词检测撤回的场景。调用后不要再重复发送原始文字。"
    this.parameters = {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "需要转成图片发送的完整文本，支持基础 Markdown 和 ``` 代码块"
        },
        nickname: {
          type: "string",
          description: "图片中显示的昵称，不填则使用机器人昵称"
        },
        avatarUrl: {
          type: "string",
          description: "图片左侧头像链接，不填则使用机器人 QQ 头像"
        }
      },
      required: ["text"],
      additionalProperties: false
    }
  }

  async func(opts, e) {
    const text = String(opts.text || "").trim()
    if (!text) return "error: text 不能为空"

    const safeText = text.slice(0, MAX_TEXT_LENGTH)
    const nickname = String(opts.nickname || globalThis.Bot?.nickname || "机器人").trim()
    const avatarUrl =
      opts.avatarUrl || `https://q1.qlogo.cn/g?b=qq&nk=${globalThis.Bot?.uin || e?.self_id || ""}&s=100`
    let imagePath = ""

    try {
      imagePath = await this.renderChatImage({
        text: safeText,
        nickname,
        avatarUrl
      })

      await e.reply(segment.image(imagePath))
      return "已将文本转为图片发送成功，不需要再重复发送原始文字。"
    } finally {
      if (imagePath) await deleteGeneratedFile(imagePath)
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
