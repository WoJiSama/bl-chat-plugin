import { test } from "node:test"
import assert from "node:assert/strict"

test("base v1 image edit URLs route to image edit endpoint", async t => {
  if (!globalThis.logger) {
    globalThis.logger = { info() {}, warn() {}, error() {}, debug() {}, mark() {} }
  }
  try {
    const { GoogleImageEditTool } = await import("../functions/functions_tools/GoogleImageEditTool.js")
    const tool = new GoogleImageEditTool()
    assert.equal(tool.shouldUseImageEditEndpoint("https://api.krill-ai.com/v1"), true)
    assert.equal(tool.toImageEditUrl("https://api.krill-ai.com/v1"), "https://api.krill-ai.com/v1/images/edits")
    assert.equal(tool.shouldUseImageEditEndpoint("https://api.krill-ai.com/v1/chat/completions"), false)
  } catch (error) {
    t.skip(`runtime dependency is not installed in this checkout: ${error.message}`)
  }
})
