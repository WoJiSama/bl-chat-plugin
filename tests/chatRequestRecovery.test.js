import test from "node:test"
import assert from "node:assert/strict"
import {
  buildChatRequestRecovery,
  classifyChatRequestFailure,
  executeChatRequestWithRecovery
} from "../utils/chatRequestRecovery.js"

const excelTool = { type: "function", function: { name: "excelWorkbookTool", parameters: { type: "object" } } }

test("thinking tool-choice incompatibility retries once with the same tools and auto choice", async () => {
  const requests = []
  const requestData = {
    messages: [{ role: "user", content: "读取表格里的 B40" }],
    tools: [excelTool],
    tool_choice: { type: "function", function: { name: "excelWorkbookTool" } }
  }
  const response = await executeChatRequestWithRecovery(async request => {
    requests.push(request)
    if (requests.length === 1) {
      return { error: "OpenAI API 请求失败：400 Bad Request - Thinking mode does not support this tool_choice" }
    }
    return { choices: [{ message: { tool_calls: [{ function: { name: "excelWorkbookTool" } }] } }] }
  }, requestData, { retries: 1 })

  assert.equal(requests.length, 2)
  assert.equal(requests[0].tool_choice.function.name, "excelWorkbookTool")
  assert.equal(requests[1].tool_choice, "auto")
  assert.deepEqual(requests[1].tools, requestData.tools)
  assert.equal(response.choices[0].message.tool_calls[0].function.name, "excelWorkbookTool")
})

test("an unrelated 400 is not retried", async () => {
  let calls = 0
  const response = await executeChatRequestWithRecovery(async () => {
    calls++
    return { error: "API 请求失败：400 Bad Request - invalid messages" }
  }, { tool_choice: "auto" }, { retries: 2 })

  assert.equal(calls, 1)
  assert.match(response.error, /400/)
})

test("429, 503, timeout and empty choices are retryable", async () => {
  const failures = [
    { error: "API 请求失败：429 Too Many Requests" },
    { error: "API 请求失败：503 Service Unavailable" },
    new Error("request timeout"),
    { choices: [] }
  ]

  for (const firstFailure of failures) {
    let calls = 0
    const response = await executeChatRequestWithRecovery(async () => {
      calls++
      if (calls === 1) {
        if (firstFailure instanceof Error) throw firstFailure
        return firstFailure
      }
      return { choices: [{ message: { content: "ok" } }] }
    }, { tool_choice: "auto" }, { retries: 1 })

    assert.equal(calls, 2)
    assert.equal(response.choices[0].message.content, "ok")
  }
})

test("exhausted empty responses become a structured visible failure", async () => {
  const response = await executeChatRequestWithRecovery(async () => ({ choices: [] }), {}, { retries: 1 })

  assert.equal(response.failure_kind, "empty")
  assert.match(response.error, /没有返回有效内容/)
})

test("compatibility recovery only applies to an explicit function choice", () => {
  const failure = classifyChatRequestFailure({ error: "400 Thinking mode does not support this tool_choice" })
  assert.equal(failure.kind, "tool_choice_compatibility")
  assert.equal(buildChatRequestRecovery({ tool_choice: "auto" }, failure), null)
})
