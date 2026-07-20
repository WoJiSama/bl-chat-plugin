import { test } from "node:test"
import assert from "node:assert/strict"
import { isRecentImageContinuationRequest, resolveRecentBotImage, resolveRecentUserImage } from "../utils/recentImageContinuation.js"

test("detects explicit follow-up image edits", () => {
  assert.equal(isRecentImageContinuationRequest("希洛在旁边再加上一个一百级的邪神"), true)
  assert.equal(isRecentImageContinuationRequest("继续把刚才那张图的人物换成红色"), true)
  assert.equal(isRecentImageContinuationRequest("这个邪神设定挺有意思"), false)
})

test("resolves the latest recent bot image in the same group", async () => {
  const now = Date.now()
  const event = {
    msg: "旁边再加一个角色",
    group: {
      getChatHistory: async () => [
        { time: Math.floor((now - 2000) / 1000), sender: { user_id: 111 }, message: [{ type: "image", url: "https://example.com/user.png" }] },
        { time: Math.floor((now - 1000) / 1000), sender: { user_id: 999 }, message: [{ type: "image", data: { url: "https://example.com/bot.png" } }] }
      ]
    }
  }
  const result = await resolveRecentBotImage(event, { botId: 999, now })
  assert.equal(result?.image, "https://example.com/bot.png")
})

test("ignores stale bot images", async () => {
  const now = Date.now()
  const result = await resolveRecentBotImage({
    msg: "再加一个角色",
    group: {
      getChatHistory: async () => [{
        time: Math.floor((now - 20 * 60 * 1000) / 1000),
        sender: { user_id: 999 },
        message: [{ type: "image", url: "https://example.com/stale.png" }]
      }]
    }
  }, { botId: 999, now })
  assert.equal(result, null)
})

test("resolves a recent image uploaded separately by the same user", async () => {
  const now = Date.now()
  const event = {
    user_id: 123,
    group: {
      getChatHistory: async () => [
        { time: now - 30_000, sender: { user_id: 456 }, message: [{ type: "image", url: "other-image" }] },
        { time: now - 20_000, sender: { user_id: 123 }, message: [{ type: "image", url: "same-user-image" }] }
      ]
    }
  }
  const result = await resolveRecentUserImage(event, { now })
  assert.equal(result.image, "same-user-image")
})

test("does not reuse a stale separately uploaded user image", async () => {
  const now = Date.now()
  const event = {
    user_id: 123,
    group: {
      getChatHistory: async () => [
        { time: now - 180_000, sender: { user_id: 123 }, message: [{ type: "image", url: "stale-image" }] }
      ]
    }
  }
  assert.equal(await resolveRecentUserImage(event, { now }), null)
})
