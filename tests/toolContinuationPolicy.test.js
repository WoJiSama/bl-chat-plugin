import test from "node:test"
import assert from "node:assert/strict"
import { decideToolContinuation } from "../utils/toolContinuationPolicy.js"

test("returns exact Excel results directly", () => {
  assert.equal(decideToolContinuation([{ toolName: "excelWorkbookTool" }]), "direct_result")
})

test("returns exact group-knowledge deletion results directly", () => {
  assert.equal(decideToolContinuation([{ toolName: "forgetGroupKnowledgeTool" }]), "direct_result")
})

test("routes synthetic tool calls to chat-only summary instead of a thinking tool continuation", () => {
  assert.equal(
    decideToolContinuation([{ toolName: "googleImageAnalysisTool" }], { syntheticToolCall: true }),
    "chat_only"
  )
})

test("keeps provider-native tool calls in the normal tool loop", () => {
  assert.equal(decideToolContinuation([{ toolName: "searchInformationTool" }]), "tool_loop")
})
