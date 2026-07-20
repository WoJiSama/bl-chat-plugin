import { safeTruncateUnicode } from "./unicodeText.js"

const VAGUE_REFERENCE_RE = /(?:这个|这张|它|上面|里面|前面|刚才|刚刚|之前|上一张|上一个|照着|参考|按这个|根据这个|画这个|改这个|修这个|继续|接着|沿用|同风格|同样的?|还是那个)/
const EDIT_RE = /(?:修图|改图|编辑|美化|去水印|换背景|换衣服|加上|添加|去掉|删除|移除|改成|变成|可爱点|好看点|清晰|修复|重绘)/
const COMPILED_PROMPT_MARKER = "【绘图请求原文】"

function compact(text = "", maxLength = 1200) {
  return safeTruncateUnicode(String(text || "")
    .replace(/\[CQ:[^\]]+\]/g, " ")
    .replace(/\r/g, "")
    .trim(), maxLength)
}

function inferTask(task = "", prompt = "") {
  if (task === "image_edit" || task === "image_generation") return task
  return EDIT_RE.test(prompt) ? "image_edit" : "image_generation"
}

function hasMeaningfulPrompt(text = "") {
  const content = compact(text)
  if (!content) return false
  const stripped = content
    .replace(/^(希洛|小希洛|bot|机器人)[，,：:\s]*/i, "")
    .replace(/^(帮我|给我|替我|麻烦|可以|能不能|能不能帮我|请你)?(画|生成|生图|出图|做图|修|改|编辑|看看|弄一下|处理一下)?/i, "")
    .replace(VAGUE_REFERENCE_RE, "")
    .replace(/[，。,.!！?？\s]/g, "")
  return stripped.length >= 2
}

function shouldUseRecentContext({ prompt = "", recentContext = "", hasContextualReference = false }) {
  if (!compact(recentContext)) return false
  if (!hasMeaningfulPrompt(prompt)) return true
  return Boolean(hasContextualReference) || VAGUE_REFERENCE_RE.test(prompt)
}

export function compileImagePrompt(options = {}) {
  const task = inferTask(options.task, options.userPrompt || options.prompt || "")
  const prompt = compact(options.userPrompt || options.prompt || "", 2400)
  if (prompt.includes(COMPILED_PROMPT_MARKER)) {
    return compact(prompt, task === "image_edit" ? 4800 : 4400)
  }

  const quotedContext = compact(options.quotedContext || "", 1800)
  const hasReferenceImages = Boolean(options.hasReferenceImages)
  const hasContextualReference = Boolean(options.hasContextualReference) ||
    VAGUE_REFERENCE_RE.test([prompt, quotedContext].filter(Boolean).join("\n"))
  const rawRecentContext = compact(options.recentContext || "", 1200)
  const recentContext = shouldUseRecentContext({ prompt, recentContext: rawRecentContext, hasContextualReference })
    ? rawRecentContext
    : ""

  const lines = [
    COMPILED_PROMPT_MARKER,
    `任务类型：${task === "image_edit" ? "图片编辑/图生图" : "图片生成"}`,
    prompt ? `用户原话（必须保留原词，不得改写、替换、软化或扩写）：\n${prompt}` : "",
    quotedContext ? `用户引用的原文：\n${quotedContext}` : "",
    recentContext ? `用户明确指代时可参考的近期原文：\n${recentContext}` : "",
    hasReferenceImages ? "请求中附有参考图片；图片用途和顺序以素材清单为准。" : "",
    "不要自动补充质量词、风格词、构图词、情绪词或安全化措辞；只按上述用户原话和明确上下文执行。"
  ].filter(Boolean)

  return compact(lines.join("\n"), task === "image_edit" ? 4800 : 4400)
}
