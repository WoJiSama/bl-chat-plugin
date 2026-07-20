import fs from "node:fs"
import {
  classifyImageTaskPolicy,
  shouldRenderImageAnalysisAsDocument
} from "../utils/imageTaskPolicy.js"
import { prepareImageEditAssets } from "../utils/editReferencePipeline.js"

const members = new Map([
  [3188163302, { user_id: 3188163302, card: "maela", nickname: "霜落" }],
  [10001, { user_id: 10001, card: "小白", nickname: "白白" }],
  [10002, { user_id: 10002, card: "小黑", nickname: "黑黑" }],
  [10003, { user_id: 10003, card: "阿树", nickname: "tree" }]
])

const cases = []
const add = (category, texts, expected) => texts.forEach((text, index) => cases.push({ id: `${category}-${index + 1}`, category, text, ...expected }))

add("simple_edit", [
  "把这张图右下角水印去掉", "删除图片里多余的手", "把背景换成雪景", "给人物换成红色衣服", "把头发颜色改成银灰色",
  "修一下这张照片的光线", "把左边路人移除", "保留人物，把文字擦掉", "把图片扩展成横版", "给角色加上一顶帽子"
], { expectedTask: "image_edit", hasImages: true, expectedReferences: 0 })

add("mixed_edit_avatar", [
  "取消掉脖子旁边的手，再看一下maela的头像像不像", "把脸修得更像maela的头像", "删除多余手臂，并参考maela头像调整五官", "你看一下maela头像，把这张图的头改得像一点", "这脸不像maela，修改一下图片",
  "保留身体，把头换成maela头像的样子", "去掉错误耳朵，然后按照maela头像修脸", "调整这张图，让人物外貌贴合maela头像", "把人物的脸融合成maela头像的特征", "先看maela头像，再把图里的头部替换掉"
], { expectedTask: "image_edit", hasImages: true, expectedReferences: 1 })

add("avatar_analysis", [
  "看一下maela的头像", "评价一下maela头像好不好看", "maela头像是什么风格", "帮我分析小白的头像", "看看小黑头像里有什么",
  "说说阿树的头像", "maela的头像像什么角色", "描述一下小白头像", "点评一下小黑的头像", "讲讲maela头像的配色"
], { expectedTask: "avatar_inspection", hasImages: false, expectedReferences: 0 })

add("regular_analysis", [
  "看看这张图里有什么", "分析图片内容", "图里这个人是谁", "这张照片好看吗", "识别图片里的文字",
  "图片里哪里不自然", "看图告诉我发生了什么", "这像吗", "图中有几个人", "帮我看看这张截图"
], { expectedTask: "image_analysis", hasImages: true, expectedReferences: 0 })

add("generation", [
  "画一只猫", "生成一张雪山图片", "给我画个二次元少女", "做一张赛博朋克海报", "生图：森林里的城堡",
  "绘制一个机器人", "出一张海边日落", "画一幅水墨山水", "生成可爱狗狗头像", "做一张横版壁纸"
], { expectedTask: "image_generation", hasImages: false, expectedReferences: 0 })

add("missing_base", [
  "把这张图水印去掉", "删除图片里的人", "把背景换掉", "修一下照片", "给图中人物换脸",
  "擦掉图片文字", "把头发改成红色", "移除多余的手", "调整这张图的构图", "把图片扩成横版"
], { expectedTask: "image_edit_missing_base", hasImages: false, expectedReferences: 0 })

add("chat_false_positive", [
  "我把今天的烦恼去掉了", "换成另一个话题吧", "删除这条记忆", "调整一下心态", "这个人背景很强",
  "他的手段很高明", "头像框活动什么时候结束", "图片仅供参考这句话什么意思", "我想换衣服出门", "把群名改一下"
], { expectedTask: "chat", hasImages: false, expectedReferences: 0 })

add("ambiguous_or_explicit", [
  "把头换成小白的头像", "把脸换成小黑头像", "参考阿树头像修改人物", "把头换成QQ3188163302的头像", "把脸换成maela头像",
  "把人物换成小白的样子", "调整成小黑头像的外貌", "把图中的头替换成阿树头像", "用maela头像作为脸部参考修改", "删除手并参考QQ3188163302头像"
], { expectedTask: "image_edit", hasImages: true, expectedReferences: 1 })

add("continuation_edit", [
  "把刚才那张图的手删掉", "上一张图背景换成夜晚", "继续改，头发换成白色", "刚生成的图去掉文字", "把你刚画的那张再修自然点",
  "上一版脸改得更像maela头像", "继续，把多余耳朵取消掉", "刚才成图扩成横版", "把上一张人物衣服换掉", "继续修改那张图的光影"
], { expectedTask: "image_edit", hasImages: false, hasRecentBotImage: true, expectedReferences: null })

add("render_shape", [
  "为什么这张人物图的手很怪", "这张头像像吗", "分析一下人物五官", "看看这幅画哪里不自然", "评价一下这个头像",
  "这个IDEA报错截图为什么红了", "Maven依赖错误截图怎么看", "Gradle报错截图帮我分析", "这张代码截图哪里错了", "IntelliJ红线截图解释一下"
], { expectedTask: "image_analysis", hasImages: true, expectedReferences: 0, checkRender: true })

const failures = []
const rows = cases.map((scenario, index) => {
  const task = classifyImageTaskPolicy({ text: scenario.text, hasImages: scenario.hasImages, hasRecentBotImage: scenario.hasRecentBotImage })
  const baseImages = scenario.hasImages || scenario.hasRecentBotImage ? ["base-image"] : []
  const editAssets = prepareImageEditAssets({ baseImages, text: scenario.text, memberMap: members, botId: 99999 })
  const referenceCount = editAssets.references.length
  const output = "这是用于模拟的详细图片分析结果。".repeat(12)
  const renderDocument = scenario.checkRender
    ? shouldRenderImageAnalysisAsDocument({ userText: scenario.text, output, looksDiagnostic: true })
    : false
  const expectedDocument = scenario.checkRender ? index % 10 >= 5 : false
  const problems = []
  if (task !== scenario.expectedTask) problems.push(`task expected=${scenario.expectedTask} actual=${task}`)
  if (scenario.expectedReferences !== null && referenceCount !== scenario.expectedReferences) problems.push(`references expected=${scenario.expectedReferences} actual=${referenceCount}`)
  if (scenario.checkRender && renderDocument !== expectedDocument) problems.push(`document expected=${expectedDocument} actual=${renderDocument}`)
  const passed = problems.length === 0
  if (!passed) failures.push({ ...scenario, actualTask: task, referenceCount, renderDocument, problems })
  return { ...scenario, actualTask: task, referenceCount, renderDocument, passed, problems: problems.join("; ") }
})

const byCategory = Object.values(rows.reduce((acc, row) => {
  acc[row.category] ||= { category: row.category, total: 0, passed: 0, failed: 0 }
  acc[row.category].total++
  acc[row.category][row.passed ? "passed" : "failed"]++
  return acc
}, {}))
const summary = {
  total: rows.length,
  passed: rows.filter(row => row.passed).length,
  failed: failures.length,
  passRate: `${(rows.filter(row => row.passed).length / rows.length * 100).toFixed(1)}%`,
  byCategory,
  failures
}
fs.writeFileSync("reports/image-task-simulation.json", JSON.stringify({ summary, rows }, null, 2))
console.log(JSON.stringify(summary, null, 2))
if (failures.length) process.exitCode = 1
