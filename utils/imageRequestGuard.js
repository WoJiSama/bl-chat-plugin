const VISUAL_INSPECTION_VERB_RE = /(?:看看|看下|看一下|看一眼|帮我看|帮我看看|瞅瞅|瞧瞧|评价一下|评一下|分析一下|识别一下)/
const VISUAL_TARGET_RE = /(?:腿|手|手臂|胳膊|脸|眼睛|头发|发型|衣服|裙子|鞋|穿搭|姿势|表情|身材|比例|细节|画面|图|图片|照片|截图|头像|这个|这张|里面|上面)/
const NON_VISUAL_ADVICE_RE = /(?:疼|痛|酸|麻|肿|伤|受伤|抽筋|治疗|医生|医院|怎么练|怎么锻炼|如何练|训练|锻炼|拉伸|运动|怎么办|咋办)/

function normalizeVisualRequestText(text = "") {
  return String(text || "")
    .replace(/\[CQ:[^\]]+\]/g, " ")
    .replace(/@QQ:\d+|@BOT/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function looksLikeVisualInspectionRequest(text = "") {
  const content = normalizeVisualRequestText(text)
  if (!content) return false
  if (!VISUAL_INSPECTION_VERB_RE.test(content)) return false
  if (NON_VISUAL_ADVICE_RE.test(content)) return false
  return VISUAL_TARGET_RE.test(content)
}

export function buildMissingImageAnalysisReply() {
  return "唔，我这边没看到图诶…你把图片发一下，或者引用那张图再叫我，我就认真看。没有图我怕乱讲嘛。"
}
