const DEFAULT_THRESHOLDS = {
  maxTextChars: 600,
  maxLines: 8,
  structuredRows: 5,
  documentChars: 1800,
  documentLines: 25
}

const STRUCTURED_KINDS = new Set([
  "table",
  "ranking",
  "cocAttributes",
  "deltaForce",
  "umaRaceResult",
  "messageArchive",
  "knowledgeList",
  "diceLong"
])

let sharedTextImageTool = null

async function getTextImageTool() {
  if (sharedTextImageTool) return sharedTextImageTool
  const { TextImageTool } = await import("../functions/functions_tools/TextImageTool.js")
  sharedTextImageTool = new TextImageTool()
  return sharedTextImageTool
}

export function analyzeReplyText(text = "", options = {}) {
  const source = String(text || "").trim()
  const lines = source ? source.split(/\r?\n/) : []
  const nonEmptyLines = lines.filter(line => line.trim())
  const structuredRows = nonEmptyLines.filter(line => (
    /^\s*(?:\d+\.|#\d+|[-*]\s+)/.test(line) ||
    /[｜|].+[｜|]/.test(line) ||
    /\s\/\s/.test(line) ||
    /：/.test(line)
  )).length
  const kind = String(options.kind || "")
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) }
  const forced = options.force === true
  const structuredKind = STRUCTURED_KINDS.has(kind)
  const shouldRender = forced ||
    source.length > thresholds.maxTextChars ||
    nonEmptyLines.length > thresholds.maxLines ||
    structuredRows >= thresholds.structuredRows ||
    (structuredKind && nonEmptyLines.length >= thresholds.structuredRows)
  const template = shouldRender ? "document" : "chat"

  return {
    shouldRender,
    template,
    chars: source.length,
    lines: nonEmptyLines.length,
    structuredRows,
    kind
  }
}

export async function sendSmartReply(e, output, options = {}) {
  if (output === undefined || output === null) return null
  if (Array.isArray(output) || typeof output !== "string") return await e.reply(output, options.quote)

  const text = output.trim()
  if (!text) return null
  const analysis = analyzeReplyText(text, options)
  if (!analysis.shouldRender) return await e.reply(text, options.quote)

  try {
    const tool = await getTextImageTool()
    const result = await tool.execute({
      text,
      template: options.template || analysis.template
    }, e)
    if (typeof result === "string" && result.trim().startsWith("error:")) {
      throw new Error(result)
    }
    return null
  } catch (error) {
    globalThis.logger?.warn?.(`[SmartReply] 长文本转图失败，回退文本发送: ${error.message}`)
    return await e.reply(text, options.quote)
  }
}
