import { test } from "node:test"
import assert from "node:assert/strict"
import {
  clearBilibiliMetadataCache,
  enrichBilibiliMessageSegments,
  extractBilibiliShareFromSegment,
  formatBilibiliHistoryLinks,
  formatBilibiliHistoryText,
  resolveBilibiliPlaybackResources,
  shouldAttachBilibiliVideo
} from "../utils/bilibiliMessage.js"

const cardPayload = {
  ver: "1.0.0.19",
  prompt: "[QQ小程序]听星野呜嘿伊呀8小时纯享",
  app: "com.tencent.miniapp_01",
  meta: {
    detail_1: {
      title: "哔哩哔哩",
      desc: "听星野呜嘿伊呀8小时纯享",
      preview: "https://qq.example/preview.jpg",
      qqdocurl: "https://b23.tv/JvNsiRF?share_source=qq",
      host: { uin: 3906061530, nick: "星野" }
    }
  }
}

test("parses a QQ miniapp Bilibili card without losing title, cover or short url", () => {
  const card = extractBilibiliShareFromSegment({ type: "json", data: JSON.stringify(cardPayload) })

  assert.equal(card.type, "bilibili")
  assert.equal(card.title, "听星野呜嘿伊呀8小时纯享")
  assert.equal(card.short_url, "https://b23.tv/JvNsiRF?share_source=qq")
  assert.equal(card.cover_url, "https://qq.example/preview.jpg")
  assert.equal(card.shared_by, "星野")
})

test("recovers a Bilibili card from encoded raw CQ JSON when normalized segment data is missing", () => {
  const encoded = JSON.stringify(cardPayload)
    .replace(/&/g, "&amp;")
    .replace(/,/g, "&#44;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;")
  const card = extractBilibiliShareFromSegment({ type: "json" }, `[CQ:json,data=${encoded}]`)

  assert.equal(card.title, "听星野呜嘿伊呀8小时纯享")
  assert.equal(card.short_url, "https://b23.tv/JvNsiRF?share_source=qq")
})

test("resolves short url and enriches stable Bilibili metadata", async () => {
  clearBilibiliMetadataCache()
  const calls = []
  const fetchImpl = async url => {
    calls.push(String(url))
    if (String(url).startsWith("https://b23.tv/")) {
      return { ok: false, status: 412, url: "https://www.bilibili.com/video/BV1H7Gq6zEiC/" }
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: 0,
          data: {
            bvid: "BV1H7Gq6zEiC",
            aid: 116622337511895,
            cid: 38547883096,
            title: "听星野呜嘿伊呀8小时纯享",
            desc: "-",
            duration: 21795,
            videos: 3,
            pic: "http://i0.hdslb.com/cover.jpg",
            owner: { mid: 3546917644536165, name: "最喜歡星野啦" },
            pages: [
              { page: 1, cid: 38547883096, part: "P1", duration: 7265 },
              { page: 2, cid: 38547884528, part: "P2", duration: 7265 },
              { page: 3, cid: 38548211918, part: "P3", duration: 7265 }
            ],
            stat: { view: 12034, like: 567, coin: 89, favorite: 321, share: 45, reply: 67, danmaku: 88 }
          }
        }
      }
    }
  }

  const [card] = await enrichBilibiliMessageSegments(
    [{ type: "json", data: JSON.stringify(cardPayload) }],
    "",
    { fetchImpl, timeoutMs: 1000 }
  )

  assert.equal(card.metadata_status, "resolved")
  assert.equal(card.bvid, "BV1H7Gq6zEiC")
  assert.equal(card.owner, "最喜歡星野啦")
  assert.equal(card.duration, 21795)
  assert.equal(card.page_count, 3)
  assert.deepEqual(card.stats, { view: 12034, like: 567, coin: 89, favorite: 321, share: 45, reply: 67, danmaku: 88 })
  assert.equal(card.pages.length, 3)
  assert.equal(card.cover_url, "https://i0.hdslb.com/cover.jpg")
  assert.equal(card.video_url, "https://www.bilibili.com/video/BV1H7Gq6zEiC")
  assert.equal(calls.length, 2)
})

test("keeps card metadata when Bilibili network enrichment fails", async () => {
  clearBilibiliMetadataCache()
  const [card] = await enrichBilibiliMessageSegments(
    [{ type: "json", data: JSON.stringify(cardPayload) }],
    "",
    { fetchImpl: async () => { throw new Error("offline") }, timeoutMs: 1000 }
  )

  assert.equal(card.title, "听星野呜嘿伊呀8小时纯享")
  assert.equal(card.cover_url, "https://qq.example/preview.jpg")
  assert.equal(card.short_url, "https://b23.tv/JvNsiRF?share_source=qq")
})

test("renders searchable chat history with video and cover links", async t => {
  const card = {
    type: "bilibili",
    title: "示例视频",
    owner: "示例UP",
    bvid: "BV1234567890",
    duration: 3661,
    page_count: 2,
    stats: { view: 12034, like: 567, coin: 89, favorite: 321, share: 45, reply: 67, danmaku: 88 },
    page_url: "https://www.bilibili.com/video/BV1234567890",
    cover_url: "https://i0.hdslb.com/example.jpg"
  }

  assert.match(formatBilibiliHistoryText(card), /示例视频/)
  assert.match(formatBilibiliHistoryText(card), /1:01:01/)
  assert.match(formatBilibiliHistoryText(card), /2个分P/)
  assert.match(formatBilibiliHistoryText(card), /\n数据：播放:12034 点赞:567 投币:89 收藏:321 转发:45 评论:67 弹幕:88/)
  assert.match(formatBilibiliHistoryLinks(card), /视频 URL:https:\/\/www\.bilibili\.com/)
  assert.match(formatBilibiliHistoryLinks(card), /封面 URL:https:\/\/i0\.hdslb\.com/)

  let MessageArchiveManager
  try {
    ;({ MessageArchiveManager } = await import("../utils/MessageArchiveManager.js"))
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" && /yaml/.test(error.message)) {
      t.diagnostic("本机缺少既有 yaml 运行依赖，归档集成断言留给线上完整依赖环境")
      return
    }
    throw error
  }
  const manager = new MessageArchiveManager({ cwd: process.cwd(), logger: null, redis: null })
  const record = manager.buildRecord({
    time: 1784304716,
    message_type: "group",
    group_id: 609235590,
    user_id: 925640859,
    sender: { user_id: 925640859, nickname: "测试" },
    message_id: 579041999,
    message: [card],
    raw_message: "[CQ:json]"
  }, { maxMessageLength: 5000, storeMediaUrl: true })

  assert.equal(record.message[0].type, "bilibili")
  assert.equal(record.message[0].video_url, card.page_url)
  assert.equal(record.message[0].cover_url, card.cover_url)
  assert.deepEqual(record.message[0].stats, card.stats)
  assert.match(manager.formatRecord(record), /示例视频/)
  assert.match(manager.formatRecord(record), /封面 URL:https:\/\/i0\.hdslb\.com/)
})

test("attaches video body only when total duration is at most 30 minutes", async () => {
  assert.equal(shouldAttachBilibiliVideo({ duration: 1800 }), true)
  assert.equal(shouldAttachBilibiliVideo({ duration: 1801 }), false)
  assert.equal(shouldAttachBilibiliVideo({ duration: 0 }), false)

  let calls = 0
  const longResources = await resolveBilibiliPlaybackResources({
    bvid: "BV1H7Gq6zEiC",
    cid: 1,
    duration: 1801
  }, {
    fetchImpl: async () => { calls++; throw new Error("must not fetch") }
  })
  assert.deepEqual(longResources, [])
  assert.equal(calls, 0)
})

test("resolves temporary playback resources for short videos without persisting them", async () => {
  const resources = await resolveBilibiliPlaybackResources({
    bvid: "BV1234567890",
    duration: 120,
    pages: [{ page: 1, cid: 987, title: "P1", duration: 120 }]
  }, {
    fetchImpl: async url => {
      assert.match(String(url), /x\/player\/playurl/)
      assert.match(String(url), /[?&]qn=6(?:&|$)/)
      return {
        ok: true,
        async json() {
          return {
            code: 0,
            data: {
              durl: [{
                url: "http://video.example/test.mp4?token=temporary",
                backup_url: ["https://backup.example/test.mp4"],
                length: 120000,
                size: 123456
              }]
            }
          }
        }
      }
    }
  })

  assert.equal(resources.length, 1)
  assert.equal(resources[0].url, "https://video.example/test.mp4?token=temporary")
  assert.equal(resources[0].duration, 120)
  assert.equal(resources[0].size, 123456)
})
