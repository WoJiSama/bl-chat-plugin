import assert from "node:assert/strict"
import fs from "fs"
import { Readable } from "stream"
import { test } from "node:test"
import { buildDouyinArchiveRelaySegments, cleanupDouyinArchiveRelayFiles } from "../utils/douyinMediaRelay.js"

test("short Douyin videos attach cover and a local video segment", async () => {
  const previousFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => ({
      ok: true,
      headers: { get: name => name === "content-length" ? "4" : null },
      body: Readable.toWeb(Readable.from(Buffer.from("mp4!")))
    })
    const result = await buildDouyinArchiveRelaySegments({
      type: "douyin", aweme_id: "123", duration: 16,
      page_url: "https://www.iesdouyin.com/share/video/123/",
      cover_url: "https://cover.example/cover.webp", play_url: "https://video.example/play"
    }, { segmentApi: { image: url => ({ type: "image", url }), video: file => ({ type: "video", file }) }, logger: { warn() {} } })
    assert.ok(result.segments.some(part => part?.type === "image"))
    assert.ok(result.segments.some(part => part?.type === "video"))
    assert.equal(result.tempFiles.length, 1)
    assert.ok(fs.existsSync(result.tempFiles[0]))
    await cleanupDouyinArchiveRelayFiles(result.tempFiles)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test("long Douyin videos never download a body", async () => {
  const previousFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => { throw new Error("long video must not download") }
    const result = await buildDouyinArchiveRelaySegments({ type: "douyin", duration: 1801, cover_url: "https://cover.example/cover.webp" }, {
      segmentApi: { image: url => ({ type: "image", url }), video: file => ({ type: "video", file }) }
    })
    assert.equal(result.tempFiles.length, 0)
    assert.ok(result.segments.some(part => typeof part === "string" && part.includes("超过30分钟")))
    assert.ok(!result.segments.some(part => part?.type === "video"))
  } finally {
    globalThis.fetch = previousFetch
  }
})
