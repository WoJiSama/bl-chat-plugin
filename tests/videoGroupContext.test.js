import { test } from "node:test"
import assert from "node:assert/strict"

test("video analysis sees current, quoted and forwarded group videos", async t => {
  const previousLogger = globalThis.logger
  globalThis.logger = previousLogger || {
    info() {},
    warn() {},
    error() {},
    debug() {},
    mark() {}
  }
  let VideoAnalysisTool
  try {
    ;({ VideoAnalysisTool } = await import("../functions/functions_tools/VideoAnalysisTool.js"))
  } catch (error) {
    globalThis.logger = previousLogger
    t.skip(`runtime dependency is not installed in this checkout: ${error.message}`)
    return
  }

  const tool = new VideoAnalysisTool()
  const e = {
    message: [{ type: "video", url: "https://video.example/current.mp4" }],
    async getReply() {
      return { message: [{ type: "video", data: { url: "https://video.example/reply.mp4" } }] }
    },
    _groupContextAssets: {
      videos: [
        { source: "https://video.example/forward.mp4" },
        { source: "https://video.example/current.mp4" }
      ]
    }
  }

  try {
    assert.deepEqual(await tool.getVideo(e), [
      "https://video.example/current.mp4",
      "https://video.example/reply.mp4",
      "https://video.example/forward.mp4"
    ])
  } finally {
    globalThis.logger = previousLogger
  }
})
