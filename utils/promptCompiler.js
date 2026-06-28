const VAGUE_REFERENCE_RE = /(?:这个|这张|它|上面|里面|前面|刚才|刚刚|之前|上一张|上一个|照着|参考|按这个|根据这个|画这个|改这个|修这个|继续|接着|沿用|同风格|同样的?|还是那个)/
const COMIC_RE = /(?:连环画|漫画|四格|多格|分镜|组图|小剧场)/
const EDIT_RE = /(?:修图|改图|编辑|美化|去水印|换背景|换衣服|加上|添加|去掉|删除|移除|改成|变成|可爱点|好看点|清晰|修复|重绘)/
const COMPILED_PROMPT_MARKER = "【提示词编译结果】"

const STYLE_HINTS = [
  [/赛博|霓虹|未来|机甲/, "赛博朋克/未来感"],
  [/电影|大片|镜头|摄影|写实/, "电影感写实"],
  [/二次元|动漫|漫画|插画|立绘/, "二次元插画"],
  [/水彩|油画|厚涂|像素|国风|古风/, "保留用户指定画风"],
  [/羊皮纸|卷轴|古旧|复古/, "复古纸张质感"]
]

const EMOTION_HINTS = [
  [/孤独|寂寞|冷清|落寞/, "孤独、安静、带一点疏离感"],
  [/温柔|治愈|甜|可爱|撒娇/, "温柔、可爱、亲近"],
  [/压迫|末日|恐怖|紧张|危险/, "压迫、紧张、有冲击力"],
  [/搞笑|沙雕|吐槽|离谱/, "轻松、搞笑、表情夸张"],
  [/害羞|脸红|暧昧|亲密/, "含蓄害羞的亲近氛围"]
]

const COMPOSITION_HINTS = [
  [/全身|全身像/, "全身构图，主体完整"],
  [/半身|头像|特写|近景/, "近景/半身构图，表情清楚"],
  [/广角|透视|俯视|仰视/, "按用户指定镜头和透视"],
  [/海报|封面|壁纸/, "海报式构图，视觉中心明确"]
]

const LIGHTING_HINTS = [
  [/雨夜|夜晚|夜景|霓虹/, "夜景光影，湿润反光，氛围清晰"],
  [/夕阳|黄昏|日落/, "暖色侧光，黄昏氛围"],
  [/阳光|白天|清晨/, "自然日光，画面通透"],
  [/暗黑|黑暗|阴影/, "低调光影，明暗对比"]
]

function compact(text = "", maxLength = 1200) {
  return String(text || "")
    .replace(/\[CQ:[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}

function pickHints(text = "", rules = []) {
  const content = String(text || "")
  return rules
    .filter(([pattern]) => pattern.test(content))
    .map(([, hint]) => hint)
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))]
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

function inferTask(task = "", prompt = "") {
  if (task === "image_edit" || task === "image_generation") return task
  return EDIT_RE.test(prompt) ? "image_edit" : "image_generation"
}

function shouldUseRecentContext({ prompt = "", recentContext = "", hasContextualReference = false }) {
  if (!compact(recentContext)) return false
  if (!hasMeaningfulPrompt(prompt)) return true
  return Boolean(hasContextualReference) || VAGUE_REFERENCE_RE.test(prompt)
}

function buildBaseSubject({ prompt, quotedContext, recentContext, hasReferenceImages, hasContextualReference, task }) {
  if (hasMeaningfulPrompt(prompt)) return compact(prompt, 1000)
  if (quotedContext) return "以引用内容中的人物、事件、关系和场景为主体"
  if (hasReferenceImages) return task === "image_edit"
    ? "以用户提供的参考图片为主体进行编辑"
    : "参考用户提供的图片主体进行创作"
  if (recentContext) return "结合近期对话中正在讨论的对象进行创作"
  if (hasContextualReference) return "根据当前上下文指代的对象进行创作"
  return "根据用户当前要求生成画面"
}

function buildGenerationLines({
  prompt,
  quotedContext,
  recentContext,
  hasReferenceImages,
  hasContextualReference,
  isComic
}) {
  const referenceText = [prompt, quotedContext, recentContext].filter(Boolean).join("\n")
  const subject = buildBaseSubject({
    prompt,
    quotedContext,
    recentContext,
    hasReferenceImages,
    hasContextualReference,
    task: "image_generation"
  })
  const styles = pickHints(referenceText, STYLE_HINTS)
  const emotions = pickHints(referenceText, EMOTION_HINTS)
  const compositions = pickHints(referenceText, COMPOSITION_HINTS)
  const lighting = pickHints(referenceText, LIGHTING_HINTS)
  const comic = isComic || COMIC_RE.test(referenceText)

  const lines = [
    "【提示词编译结果】",
    "任务：文生图/参考内容生图。",
    `核心画面：${subject}`,
    `真实语义：${hasContextualReference || quotedContext || recentContext ? "先理解用户指代和上下文，再围绕其真实目标作画；不要把“这个/这张/上面”当成无意义词丢掉。" : "按用户原话生成画面，不额外更换题材。"}`,
    quotedContext ? `引用/回复内容：${compact(quotedContext, 1100)}` : "",
    recentContext ? `近期相关上下文：${compact(recentContext, 700)}` : "",
    hasReferenceImages ? "参考图约束：参考用户给的图片主体、身份特征、构图关系和主要视觉元素；除非用户要求替换，否则不要把主体改没。" : "",
    `主体与动作：围绕核心画面明确主体、动作、人物关系和正在发生的事情。`,
    `场景与氛围：${unique([...emotions, ...lighting]).join("；") || "补足清楚的场景、时间、空间和情绪氛围。"}`,
    `构图与镜头：${unique(compositions).join("；") || "主体清楚，视觉中心明确，构图完整。"}`,
    `风格与质感：${unique(styles).join("；") || "画面自然、有细节，风格统一。"}`,
    comic ? "连环画/分镜要求：做成一张图内多格画面；剧情必须来自用户给出的内容，保留人物关系、情绪转折和关键台词含义，不要胡编无关桥段。" : "",
    "内容适配：如有不适合直接入画的细节，转成全年龄的脸红、靠近、躲闪、牵手、拥抱、互相吐槽、温柔安抚等含蓄表达，保留关系和情绪，不还原直白细节。",
    "必须避免：无关题材、随机校园段子、乱加人物、乱码文字、水印、Logo、主体丢失、只画背景不画重点。"
  ]

  return lines.filter(Boolean)
}

function buildEditLines({
  prompt,
  quotedContext,
  recentContext,
  hasReferenceImages,
  hasContextualReference
}) {
  const referenceText = [prompt, quotedContext, recentContext].filter(Boolean).join("\n")
  const subject = buildBaseSubject({
    prompt,
    quotedContext,
    recentContext,
    hasReferenceImages,
    hasContextualReference,
    task: "image_edit"
  })
  const styles = pickHints(referenceText, STYLE_HINTS)
  const emotions = pickHints(referenceText, EMOTION_HINTS)

  const lines = [
    "【提示词编译结果】",
    "任务：图像编辑/图生图。",
    `编辑目标：${subject}`,
    "真实语义：用户给图时，图片通常是要被保留和修改的对象；先判断用户要改哪里，不要重新生成无关新图。",
    quotedContext ? `引用/回复内容：${compact(quotedContext, 900)}` : "",
    recentContext ? `近期相关上下文：${compact(recentContext, 600)}` : "",
    hasReferenceImages ? "必须保留：参考图里的主要人物/物体、身份特征、构图关系、姿态基础和可识别元素。" : "如果上下文里有参考对象，保留其身份和关系。",
    "只修改：用户明确要求修改的部分；未提到的主体、背景关系和关键特征尽量保持。",
    `情绪与风格：${unique([...emotions, ...styles]).join("；") || "按用户要求调整氛围，整体自然统一。"}`,
    "画面质量：边缘自然、光影一致、比例合理、主体清楚，不要出现明显拼贴感。",
    "必须避免：把主体换掉、把原图重画成无关题材、丢失用户指定元素、乱加文字、水印、Logo。"
  ]

  return lines.filter(Boolean)
}

export function compileImagePrompt(options = {}) {
  const task = inferTask(options.task, options.userPrompt || options.prompt || "")
  const prompt = compact(options.userPrompt || options.prompt || "", 1800)
  if (prompt.includes(COMPILED_PROMPT_MARKER)) {
    return compact(prompt, task === "image_edit" ? 4200 : 3900)
  }
  const quotedContext = compact(options.quotedContext || "", 1800)
  const hasReferenceImages = Boolean(options.hasReferenceImages)
  const hasContextualReference = Boolean(options.hasContextualReference) || VAGUE_REFERENCE_RE.test([prompt, quotedContext].filter(Boolean).join("\n"))
  const rawRecentContext = compact(options.recentContext || "", 1200)
  const recentContext = shouldUseRecentContext({ prompt, recentContext: rawRecentContext, hasContextualReference })
    ? rawRecentContext
    : ""
  const referenceText = [prompt, quotedContext, recentContext].filter(Boolean).join("\n")
  const isComic = Boolean(options.isComic) || COMIC_RE.test(referenceText)

  const lines = task === "image_edit"
    ? buildEditLines({ prompt, quotedContext, recentContext, hasReferenceImages, hasContextualReference })
    : buildGenerationLines({ prompt, quotedContext, recentContext, hasReferenceImages, hasContextualReference, isComic })

  return compact(lines.join("\n"), task === "image_edit" ? 4200 : 3900)
}
