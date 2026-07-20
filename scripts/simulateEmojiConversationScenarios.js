import { classifyEmojiToolExposure } from "../utils/emojiToolPolicy.js"

const scenarios = [
  // 笑与接梗：表情足以承担整句反应
  ["amusement", "哈哈哈哈哈哈", "emoji_only"],
  ["amusement", "笑死我了", "emoji_only"],
  ["amusement", "绷不住了", "emoji_only"],
  ["amusement", "这也太逗了吧", "emoji_only"],
  ["amusement", "我真的会谢", "emoji_only"],
  ["amusement", "绝了", "emoji_only"],
  ["amusement", "你小子真行啊", "emoji_only"],
  ["amusement", "他还真敢说哈哈哈", "emoji_only"],

  // 震惊、无语、看不懂
  ["disbelief", "这也太离谱了", "emoji_only"],
  ["disbelief", "无语了", "emoji_only"],
  ["disbelief", "不是吧", "emoji_only"],
  ["disbelief", "真的假的", "emoji_only"],
  ["disbelief", "逆天", "emoji_only"],
  ["disbelief", "我服了", "emoji_only"],
  ["disbelief", "什么鬼", "emoji_only"],
  ["disbelief", "我人都看傻了", "emoji_only"],

  // 困、累、生气、崩溃
  ["frustration", "困死了", "emoji_only"],
  ["frustration", "累死我了", "emoji_only"],
  ["frustration", "不想动了", "emoji_only"],
  ["frustration", "烦死了", "emoji_only"],
  ["frustration", "气死我了", "emoji_only"],
  ["frustration", "我裂开了", "emoji_only"],
  ["frustration", "彻底崩溃", "emoji_only"],
  ["frustration", "今天又加班到十一点，累死我了", "emoji_only"],

  // 尴尬、害羞、得意、庆祝
  ["social", "尴尬死了", "emoji_only"],
  ["social", "脚趾已经抠出三室一厅了", "emoji_only"],
  ["social", "我刚在群里认错人了，社死", "emoji_only"],
  ["social", "你别夸了，害羞", "emoji_only"],
  ["social", "哼，我就知道", "emoji_only"],
  ["social", "好耶", "emoji_only"],
  ["social", "太好了！", "emoji_only"],
  ["social", "牛啊", "emoji_only"],

  // 亲近、安慰和纯反应
  ["affection", "抱抱我", "emoji_only"],
  ["affection", "摸摸你", "emoji_only"],
  ["affection", "贴贴", "emoji_only"],
  ["affection", "哄哄我", "emoji_only"],
  ["affection", "可怜巴巴", "emoji_only"],
  ["affection", "委屈死了", "emoji_only"],

  // 明确要求附带有信息量的文字
  ["with_text", "发个表情包，再跟他说我马上到", "emoji_with_text"],
  ["with_text", "配个无语表情，顺便告诉他别等我", "emoji_with_text"],
  ["with_text", "先说晚安，再发个表情包", "emoji_with_text"],
  ["with_text", "发个抱抱表情，跟她说不是她的错", "emoji_with_text"],

  // 需要真正文字回应，不能用一张图敷衍
  ["needs_words", "我失恋了", "text"],
  ["needs_words", "我今天被裁员了，心里很难受", "text"],
  ["needs_words", "朋友去世了，我不知道该怎么办", "text"],
  ["needs_words", "我有点喘不上气，需要去医院吗", "text"],
  ["needs_words", "我该不该辞职，烦死了", "text"],
  ["needs_words", "你觉得这个方案是不是很离谱", "text"],
  ["needs_words", "为什么大家都不理我，好难过", "text"],
  ["needs_words", "我和朋友吵架了，怎么道歉", "text"],

  // 其他工具或严肃任务不能被情绪词抢走
  ["serious", "这个接口为什么报错，太无语了", "text"],
  ["serious", "帮我分析这段代码，写得太离谱了", "text"],
  ["serious", "查一下这个离谱新闻", "text"],
  ["serious", "禁言他，太无语了", "text"],
  ["serious", "提醒我十分钟后关火，差点忘了", "text"],
  ["serious", "来首歌吧，我累死了", "text"],
  ["serious", "生成一张崩溃打工人的图片", "text"],
  ["serious", "网上搜一个无语表情包", "text"],

  // 普通短对话也只提供选择权；词内命中不再决定是否真的发表情
  ["ordinary_chat", "草莓好吃吗", "model_choice"],
  ["ordinary_chat", "乐队演出几点开始", "model_choice"],
  ["needs_words", "抱抱枕应该怎么买", "text"],
  ["ordinary_chat", "这个角色的表情是什么意思", "model_choice"]
]

function currentMode(text) {
  return classifyEmojiToolExposure(text) === "none" ? "text_only" : "model_choice"
}

const results = scenarios.map(([category, text, expected]) => {
  const actual = currentMode(text)
  const expectedChoice = expected === "text" ? "text_only" : "model_choice"
  return { category, text, expected: expectedChoice, actual, pass: actual === expectedChoice }
})

const byCategory = new Map()
for (const result of results) {
  const stats = byCategory.get(result.category) || { total: 0, passed: 0 }
  stats.total++
  if (result.pass) stats.passed++
  byCategory.set(result.category, stats)
}

const modeCounts = Object.fromEntries(["model_choice", "text_only"].map(mode => [
  mode,
  results.filter(item => item.actual === mode).length
]))
console.log(`emoji conversation simulation: ${results.filter(item => item.pass).length}/${results.length}`)
console.log(`modes: model_choice=${modeCounts.model_choice} text_only=${modeCounts.text_only}`)
for (const [category, stats] of byCategory) {
  console.log(`${category}: ${stats.passed}/${stats.total}`)
}
for (const result of results.filter(item => !item.pass)) {
  console.log(`FAIL [${result.category}] ${result.text} expected=${result.expected} actual=${result.actual}`)
}

if (process.argv.includes("--assert")) {
  const failed = results.filter(item => !item.pass)
  if (failed.length) process.exitCode = 1
}

export { scenarios }
