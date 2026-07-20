import { test } from "node:test"
import assert from "node:assert/strict"

test("image edit fallback preserves the exact user prompt instead of building a retry prompt", async t => {
  if (!globalThis.logger) {
    globalThis.logger = {
      info() {},
      warn() {},
      error() {},
      debug() {},
      mark() {}
    }
  }
  let GoogleImageEditTool
  try {
    GoogleImageEditTool = (await import("../functions/functions_tools/GoogleImageEditTool.js")).GoogleImageEditTool
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      t.skip(`runtime dependency is not installed in this checkout: ${error.message}`)
      return
    }
    throw error
  }

  const calls = []
  class ExactPromptTool extends GoogleImageEditTool {
    resolveImageEditConfigs() {
      return [{ name: "backup", apiUrl: "https://backup.example/v1/images/edits", model: "gpt-image-2", apiKey: "backup-key" }]
    }
    async generateChatImageEdit({ prompt, images }) {
      calls.push(["chat", prompt, images])
      throw new Error("503 No available channel")
    }
    async generateImageEdit(_configs, prompt, images) {
      calls.push(["edits", prompt, images])
      return "base64://edited"
    }
  }

  const tool = new ExactPromptTool()
  const rawPrompt = "把头换成参考头像，衣服内微微露胸，不要改我的原话"
  const images = ["base", "avatar"]
  const result = await tool.generateConfiguredImageEdit({}, {
    apiUrl: "https://chat.example/v1/chat/completions",
    apiKey: "chat-key",
    model: "gemini-image",
    prompt: rawPrompt,
    images
  })

  assert.equal(result, "base64://edited")
  assert.deepEqual(calls.map(item => item[0]), ["chat", "edits"])
  assert.ok(calls.every(item => item[1] === rawPrompt))
  assert.ok(calls.every(item => item[2] === images))
  assert.equal(typeof tool.buildEmptyImageRetryPrompt, "undefined")
  assert.equal(typeof tool.resolveEmptyImageFallbackModel, "undefined")
})

test("explicit image edit provider bypasses higher-priority and differently named channels", async t => {
  if (!globalThis.logger) globalThis.logger = { info() {}, warn() {}, error() {}, debug() {}, mark() {} }
  let GoogleImageEditTool
  try {
    GoogleImageEditTool = (await import("../functions/functions_tools/GoogleImageEditTool.js")).GoogleImageEditTool
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      t.skip(`runtime dependency is not installed in this checkout: ${error.message}`)
      return
    }
    throw error
  }

  const calls = []
  class NamedEditTool extends GoogleImageEditTool {
    resolveImageEditConfigs() {
      return [
        { name: "Krill", aliases: ["Krill"], apiUrl: "u1", model: "gpt-image-2", apiKey: "k1", priority: 1 },
        { name: "Sou", aliases: ["Sou"], apiUrl: "u2", model: "gpt-image-2", apiKey: "k2", priority: 3 }
      ]
    }
    async generateChatImageEdit() { calls.push("chat"); return "base64://wrong" }
    async generateImageEdit(configs) { calls.push(configs.map(item => item.name)); return "base64://sou" }
  }

  const tool = new NamedEditTool()
  const result = await tool.generateConfiguredImageEdit({}, {
    apiUrl: "https://chat.example/v1/chat/completions",
    apiKey: "chat-key",
    model: "gemini-image",
    prompt: "改成夜景",
    images: ["base"],
    provider: "Sou"
  })

  assert.equal(result, "base64://sou")
  assert.deepEqual(calls, [["Sou"]])
  assert.ok(tool.parameters.properties.provider)
})

test("explicit chat image provider uses only the named primary channel", async t => {
  if (!globalThis.logger) globalThis.logger = { info() {}, warn() {}, error() {}, debug() {}, mark() {} }
  let GoogleImageEditTool
  try {
    GoogleImageEditTool = (await import("../functions/functions_tools/GoogleImageEditTool.js")).GoogleImageEditTool
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      t.skip(`runtime dependency is not installed in this checkout: ${error.message}`)
      return
    }
    throw error
  }

  const calls = []
  class NamedChatTool extends GoogleImageEditTool {
    async generateChatImageEdit() { calls.push("Gemini"); return "base64://gemini" }
    async generateImageEdit() { calls.push("fallback"); return "base64://wrong" }
  }
  const config = {
    imageEditAiConfig: {
      name: "Gemini",
      imageEditApiUrl: "https://chat.example/v1/chat/completions",
      imageEditApiModel: "gemini-image",
      imageEditApiKey: "chat-key"
    }
  }
  const tool = new NamedChatTool()
  const result = await tool.generateConfiguredImageEdit(config, {
    apiUrl: config.imageEditAiConfig.imageEditApiUrl,
    apiKey: config.imageEditAiConfig.imageEditApiKey,
    model: config.imageEditAiConfig.imageEditApiModel,
    prompt: "改成夜景",
    images: ["base"],
    provider: "Gemini"
  })

  assert.equal(result, "base64://gemini")
  assert.deepEqual(calls, ["Gemini"])
})
