import assert from "node:assert/strict"
import fs from "fs"
import { Readable } from "stream"
import { test } from "node:test"
import { buildBilibiliArchiveRelaySegments, cleanupBilibiliArchiveRelayFiles } from "../utils/bilibiliMediaRelay.js"
import { MediaArtifactStore } from "../utils/messagePipeline/mediaArtifactStore.js"

test("短视频搬运下载为本地文件并返回视频段", async () => {
  const previousFetch = globalThis.fetch
  try {
    globalThis.fetch = async url => {
      if (String(url).includes("x/player/playurl")) {
        return {
          ok: true,
          async json() {
            return { code: 0, data: { durl: [{ url: "https://video.example/low.mp4?temporary=1", length: 2000, size: 4 }] } }
          }
        }
      }
      return {
        ok: true,
        headers: { get: name => name === "content-length" ? "4" : null },
        body: Readable.toWeb(Readable.from(Buffer.from("test")))
      }
    }
    const result = await buildBilibiliArchiveRelaySegments({
      type: "bilibili",
      bvid: "BV1234567890",
      cid: 1,
      duration: 2
    }, {
      segmentApi: { video: file => ({ type: "video", file }) },
      logger: { warn() {} }
    })

    assert.ok(result.segments.some(part => part?.type === "video"))
    assert.equal(result.tempFiles.length, 1)
    assert.ok(fs.existsSync(result.tempFiles[0]))
    await cleanupBilibiliArchiveRelayFiles(result.tempFiles)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test("concurrent groups reuse one Bilibili MP4 download while keeping separate relay results", async () => {
  const previousFetch = globalThis.fetch
  const artifactStore = new MediaArtifactStore({ ttlMs: 60_000, maxEncodedBytes: 1024 })
  let playbackCalls = 0
  let downloadCalls = 0
  try {
    globalThis.fetch = async url => {
      if (String(url).includes("x/player/playurl")) {
        playbackCalls += 1
        return {
          ok: true,
          async json() {
            return { code: 0, data: { durl: [{ url: "https://video.example/shared.mp4?token=temporary", size: 6 }] } }
          }
        }
      }
      downloadCalls += 1
      await new Promise(resolve => setTimeout(resolve, 10))
      return {
        ok: true,
        headers: { get: name => name === "content-length" ? "6" : null },
        body: Readable.toWeb(Readable.from(Buffer.from("shared")))
      }
    }
    const card = { type: "bilibili", bvid: "BVSHARED123", cid: 88, duration: 10 }
    const options = {
      artifactStore,
      segmentApi: { video: file => ({ type: "video", file }) },
      logger: { warn() {} }
    }
    const [left, right] = await Promise.all([
      buildBilibiliArchiveRelaySegments(card, options),
      buildBilibiliArchiveRelaySegments(card, options)
    ])
    assert.equal(playbackCalls, 1)
    assert.equal(downloadCalls, 1)
    assert.equal(left.segments.find(item => item?.type === "video").file, right.segments.find(item => item?.type === "video").file)
    assert.ok(!left.segments.some(item => typeof item === "string" && item.includes("视频本体暂时获取失败")))
    await Promise.all([...left.artifactLeases, ...right.artifactLeases].map(lease => lease.release()))
  } finally {
    await artifactStore.stop()
    globalThis.fetch = previousFetch
  }
})

test("Bangumi relay reports a concrete preview failure without exposing an upstream URL", async () => {
  const previousFetch = globalThis.fetch
  try {
    globalThis.fetch = async url => {
      assert.match(String(url), /pgc\/player\/web\/playurl/)
      return {
        ok: true,
        async json() {
          return {
            code: 0,
            message: "success",
            result: {
              is_preview: true,
              durl: [{ url: "https://video.example/preview.mp4?temporary=1", length: 360000, size: 4 }]
            }
          }
        }
      }
    }
    const result = await buildBilibiliArchiveRelaySegments({
      type: "bilibili",
      ep_id: "1455179",
      cid: 917377008,
      duration: 721
    }, { segmentApi: { video: file => ({ type: "video", file }) }, logger: { warn() {} } })

    const text = result.segments.filter(item => typeof item === "string").join("")
    assert.match(text, /B站番剧仅提供约6:00试看资源，未附带不完整视频/)
    assert.doesNotMatch(text, /temporary|https?:\/\//)
  } finally {
    globalThis.fetch = previousFetch
  }
})
