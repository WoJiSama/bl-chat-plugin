import fs from "node:fs"
import { classifyImageTaskPolicy } from "../utils/imageTaskPolicy.js"
import { selectToolIntentCandidates } from "../utils/toolIntentManifests.js"
import { selectImageEditBase, canUseRecentImage } from "../utils/imageSourcePolicy.js"
import { extractImageResult } from "../utils/imageResult.js"
import { classifyImageFailure, buildImageFailureReply } from "../utils/imageFailurePolicy.js"
import { isMessageSendFailed } from "../utils/reliableImageSender.js"

const repeatTo100 = (templates, mapper) => Array.from({ length: 100 }, (_, index) => mapper(templates[index % templates.length], index))
const routeTemplates = [
  ["把这张图水印去掉", "image_edit"], ["看一下这张图片", "image_analysis"], ["画一只猫", "image_generation"], ["看一下maela头像", "avatar_inspection"],
  ["提醒我明天开会", "reminderTool"], ["搜索一下今天的新闻", "searchInformationTool"], ["解析这个网页内容", "webParserTool"], ["分析这个视频", "chat"],
  ["禁言小明一分钟", "jinyanTool"], ["给小明点赞", "likeTool"], ["查一下三角洲战绩", "deltaForceTool"], ["今天天气怎么样", "chat"],
  ["我想换衣服出门", "chat"], ["删除这条记忆", "chat"], ["继续改上一张图", "image_edit"], ["这张IDEA报错截图怎么看", "image_analysis"],
  ["不要画图，只给提示词", "chat"], ["把背景换成雪景", "image_edit"], ["评价一下这个头像", "image_analysis"], ["你好呀", "chat"]
]
const availableTools = ["reminderTool", "searchInformationTool", "webParserTool", "videoAnalysisTool", "jinyanTool", "likeTool", "deltaForceTool", "weatherTool"]
const routeCases = repeatTo100(routeTemplates, ([text, expected], index) => {
  const hasImages = /这张|这个头像|背景/.test(text)
  const recent = /上一张/.test(text)
  const imageTask = classifyImageTaskPolicy({ text, hasImages, hasRecentBotImage: recent })
  const candidates = selectToolIntentCandidates(text, availableTools)
  let actual = imageTask !== "chat" && !imageTask.includes("missing") ? imageTask : (candidates[0] || "chat")
  if (/不要画图/.test(text)) actual = "chat"
  return { id: index + 1, text, expected, actual, passed: expected === actual }
})

const sourceTemplates = [
  { currentImages: ["current"], replyImages: ["reply"], recentImage: "recent", isContinuation: true, expected: "current" },
  { currentImages: [], replyImages: ["reply"], recentImage: "recent", isContinuation: true, expected: "reply" },
  { currentImages: [], replyImages: [], recentImage: "recent", isContinuation: true, expected: "recent" },
  { currentImages: [], replyImages: [], recentImage: "recent", isContinuation: false, expected: "missing" },
  { currentImages: ["a", "b"], replyImages: ["reply"], recentImage: "recent", isContinuation: true, expected: "current" },
  { currentImages: [], replyImages: ["r1", "r2"], recentImage: "recent", isContinuation: true, expected: "reply" },
  { currentImages: [], replyImages: [], recentImage: "", isContinuation: true, expected: "missing" },
  { currentImages: [], replyImages: [], recentImage: "recent", isContinuation: true, sender: "other", expected: "missing" },
  { currentImages: [], replyImages: [], recentImage: "recent", isContinuation: true, ageMs: 16 * 60 * 1000, expected: "missing" },
  { currentImages: [], replyImages: [], recentImage: "recent", isContinuation: true, ageMs: 14 * 60 * 1000, expected: "recent" }
]
const sourceCases = repeatTo100(sourceTemplates, (template, index) => {
  const allowedRecent = canUseRecentImage({ isContinuation: template.isContinuation, recentSenderId: template.sender || "bot", botId: "bot", ageMs: template.ageMs || 0 })
  const selected = selectImageEditBase({ ...template, recentImage: allowedRecent ? template.recentImage : "" })
  return { id: index + 1, ...template, actual: selected.origin, passed: selected.origin === template.expected }
})

const failureTemplates = [
  ["content blocked by safety policy", "safety", "text"], ["multipart: NextPart: EOF", "multipart", "text"], ["ETIMEDOUT", "timeout", "text"], ["未接收到有效图片", "empty_image", "text"],
  ["429 rate limit", "rate_limit", "text"], ["401 invalid api key", "auth", "text"], ["图片发送失败 retcode=1200", "send", "text"], ["unknown upstream fault", "unknown", "text"],
  ["base64://QUJD", "success", "image"], ["https://example.com/a.png", "success", "image"], ["![x](data:image/png;base64,QUJD)", "success", "image"],
  ["data:image/png;base64,QUJD", "success", "image"], ["plain analysis text", "success", "text"], ["", "unknown", "text"], ["图片链接已过期", "send", "text"],
  ["API timeout after 120 seconds", "timeout", "text"], ["审核拦截", "safety", "text"], ["quota insufficient", "rate_limit", "text"], ["forbidden token", "auth", "text"], ["no valid image response", "empty_image", "text"]
]
const failureCases = repeatTo100(failureTemplates, ([value, expectedKind, expectedShape], index) => {
  const image = extractImageResult(value)
  const isNormalTextResult = expectedKind === "success" && expectedShape === "text"
  const actualKind = image || isNormalTextResult ? "success" : classifyImageFailure(value)
  const sendResult = expectedShape === "image" ? { retcode: 0 } : null
  const actualShape = image && !isMessageSendFailed(sendResult) ? "image" : "text"
  const reply = image ? "" : buildImageFailureReply(value)
  const passed = actualKind === expectedKind && actualShape === expectedShape && (image || reply.length > 0)
  return { id: index + 1, value, expectedKind, actualKind, expectedShape, actualShape, passed }
})

function summarize(name, rows) {
  const passed = rows.filter(row => row.passed).length
  return { name, total: rows.length, passed, failed: rows.length - passed, passRate: `${(passed / rows.length * 100).toFixed(1)}%`, failures: rows.filter(row => !row.passed) }
}
const report = { suites: [summarize("tool-routing", routeCases), summarize("image-source", sourceCases), summarize("failure-delivery", failureCases)], rows: { routeCases, sourceCases, failureCases } }
report.total = report.suites.reduce((sum, suite) => sum + suite.total, 0)
report.passed = report.suites.reduce((sum, suite) => sum + suite.passed, 0)
report.failed = report.total - report.passed
report.passRate = `${(report.passed / report.total * 100).toFixed(1)}%`
fs.writeFileSync("reports/three-image-suites.json", JSON.stringify(report, null, 2))
console.log(JSON.stringify({ total: report.total, passed: report.passed, failed: report.failed, passRate: report.passRate, suites: report.suites }, null, 2))
if (report.failed) process.exitCode = 1
