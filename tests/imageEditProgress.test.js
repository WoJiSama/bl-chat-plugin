import { test } from "node:test"
import assert from "node:assert/strict"

async function loadTool(t) {
  if (!globalThis.logger) {
    globalThis.logger = { info() {}, warn() {}, error() {}, debug() {}, mark() {} }
  }
  try {
    return (await import("../functions/functions_tools/GoogleImageEditTool.js")).GoogleImageEditTool
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      t.skip(`runtime dependency is not installed in this checkout: ${error.message}`)
      return null
    }
    throw error
  }
}

test("image edit progress does not claim unrelated previous context", async t => {
  const GoogleImageEditTool = await loadTool(t)
  if (!GoogleImageEditTool) return
  const tool = new GoogleImageEditTool()
  const prompt = "引用/回复内容：无\n近期相关上下文：无\n编辑目标：把文字改成红色"

  for (let index = 0; index < 20; index++) {
    const message = tool.getProgressMessage(prompt)
    assert.doesNotMatch(message, /前面|上下文|一起对上|不会只盯着/)
    assert.match(message, /改|处理/)
  }
})

test("unsupported named edit provider fails before sending a progress reply", async t => {
  const GoogleImageEditTool = await loadTool(t)
  if (!GoogleImageEditTool) return
  class UnsupportedProviderTool extends GoogleImageEditTool {
    loadConfig() {
      return {
        imageGenerationAiConfig: {
          providers: [
            { name: "Grok", apiUrl: "https://grok.example/v1", model: "grok-imagine", apiKey: "grok-key" },
            { name: "Krill", apiUrl: "https://krill.example/v1", model: "gpt-image-2", apiKey: "krill-key" }
          ]
        }
      }
    }
    async sendProgress() {
      throw new Error("progress should not be sent")
    }
  }

  const tool = new UnsupportedProviderTool()
  const result = await tool.performImageEdit({
    prompt: "改成夜景",
    images: ["https://img.example/base.png"],
    provider: "Grok"
  }, { reply: async () => ({ message_id: 1 }) })

  assert.match(result.error, /未找到可用于图片编辑的指定图片渠道“Grok”/)
  assert.match(result.error, /不会自动改用其他渠道/)
})
