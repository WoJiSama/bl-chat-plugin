import test from "node:test"
import assert from "node:assert/strict"
import {
  buildToolGroundingInstruction,
  buildUnavailableToolReply,
  classifyToolResult,
  hasUsableToolResult
} from "../utils/toolResultGrounding.js"

test("classifies empty structured tool payloads as unusable", () => {
  for (const result of ["", "{}", "[]", "null", '{"analysis":null}', '{"analysis":""}', { success: true }]) {
    assert.equal(classifyToolResult(result).kind, "empty", JSON.stringify(result))
  }
})
test("distinguishes errors, not-found results and grounded success", () => {
  assert.equal(classifyToolResult('error: 图片分析失败').kind, "error")
  assert.equal(classifyToolResult('匹配数量: 0\n没有找到匹配项').kind, "not_found")
  assert.equal(classifyToolResult('{"analysis":"图片里写着测试"}').kind, "success")
})

test("forbids filling empty results from chat history", () => {
  const empty = [{ toolName: "googleImageAnalysisTool", result: "{}" }]
  assert.equal(hasUsableToolResult(empty), false)
  assert.match(buildUnavailableToolReply(empty), /不猜/)
  assert.match(buildToolGroundingInstruction(empty), /聊天历史.*绝不能/)
  assert.match(buildToolGroundingInstruction(empty), /googleImageAnalysisTool=empty/)
})

test("allows mixed tool rounds to continue only from their usable results", () => {
  const mixed = [
    { toolName: "googleImageAnalysisTool", result: '{"analysis":"标题是测试公告"}' },
    { toolName: "searchInformationTool", result: "未找到相关搜索结果" }
  ]
  assert.equal(hasUsableToolResult(mixed), true)
  const instruction = buildToolGroundingInstruction(mixed)
  assert.match(instruction, /googleImageAnalysisTool=success/)
  assert.match(instruction, /searchInformationTool=not_found/)
})
