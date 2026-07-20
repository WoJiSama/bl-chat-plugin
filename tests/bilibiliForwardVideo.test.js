import assert from "node:assert/strict"
import fs from "fs"
import os from "os"
import path from "path"
import { test } from "node:test"

test("merged-forward video nodes inline a local MP4 as base64", async t => {
  globalThis.plugin ||= class {}
  globalThis.logger ||= { info() {}, warn() {}, error() {}, debug() {}, mark() {} }
  let inlineForwardVideoSegment
  try {
    ;({ inlineForwardVideoSegment } = await import("../utils/messagePipeline/deliveryGateway.js"))
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      t.diagnostic(`本机缺少既有运行依赖，合并转发视频测试留给线上: ${error.message}`)
      return
    }
    throw error
  }
  const file = path.join(os.tmpdir(), `bilibili-forward-${Date.now()}.mp4`)
  await fs.promises.writeFile(file, Buffer.from("mp4-data"))
  try {
    const video = await inlineForwardVideoSegment({ type: "video", file })
    assert.equal(video.type, "video")
    assert.equal(video.file, `base64://${Buffer.from("mp4-data").toString("base64")}`)
  } finally {
    await fs.promises.unlink(file).catch(() => {})
  }
})
