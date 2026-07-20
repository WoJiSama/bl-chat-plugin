import assert from "node:assert/strict"
import { test } from "node:test"
import {
  clearDouyinMetadataCache,
  enrichDouyinShare,
  enrichDouyinMessageSegments,
  extractDouyinShareFromText,
  formatDouyinHistoryLinks,
  formatDouyinHistoryText
} from "../utils/douyinMessage.js"

const item = {
  aweme_id: "7661206883327471737",
  desc: "有路人 好尴尬…… #日系#dance#NIGHTDANCER 👓",
  author: { nickname: "Luffy乐菲^^", sec_uid: "sec-user" },
  duration: 16,
  statistics: { play_count: 0, digg_count: 1533257, comment_count: 7515, share_count: 96125, collect_count: 83917 },
  video: {
    play_addr: { url_list: ["https://aweme.example/playwm?ratio=720p"] },
    cover: { url_list: ["https://cover.example/cover.webp"] }
  }
}

function routerHtml(value = item) {
  return `<script>window._ROUTER_DATA = ${JSON.stringify({ loaderData: { "video_(id)/page": { videoInfoRes: { item_list: [value] } } } })}</script>`
}

test("extracts and enriches a Douyin text share from public router data", async () => {
  clearDouyinMetadataCache()
  const source = "复制打开抖音 https://v.douyin.com/EULdbQEydtc/ :6pm"
  const raw = extractDouyinShareFromText(source)
  assert.equal(raw?.type, "douyin")
  assert.equal(raw?.short_url, "https://v.douyin.com/EULdbQEydtc/")

  const segments = await enrichDouyinMessageSegments([{ type: "text", text: source }], "", {
    fetchImpl: async () => ({
      ok: true,
      url: "https://www.iesdouyin.com/share/video/7661206883327471737/?tracking=1",
      async text() { return routerHtml() }
    })
  })
  const card = segments.at(-1)
  assert.equal(card.type, "douyin")
  assert.equal(card.aweme_id, item.aweme_id)
  assert.equal(card.author, "Luffy乐菲^^")
  assert.equal(card.duration, 16)
  assert.equal(card.play_url, "https://aweme.example/playwm?ratio=720p")
  assert.deepEqual(card.stats, item.statistics)
  assert.match(formatDouyinHistoryText(card), /点赞:1533257/)
  assert.match(formatDouyinHistoryText(card), /\n数据：/)
  assert.match(formatDouyinHistoryLinks(card), /视频 URL:https:\/\/www\.iesdouyin\.com\/share\/video\/7661206883327471737\//)
})

test("does not create a Douyin card for unrelated text or failed public data", async () => {
  assert.equal(extractDouyinShareFromText("https://example.com/video"), null)
  const segments = await enrichDouyinMessageSegments([{ type: "text", text: "https://v.douyin.com/test/" }], "", {
    fetchImpl: async () => ({ ok: false, url: "https://www.iesdouyin.com/share/video/1/", async text() { return "" } })
  })
  assert.equal(segments.length, 2)
  assert.equal(segments[1].type, "douyin")
  assert.equal(segments[1].metadata_status, "link")
})

test("refreshes temporary Douyin playback resources after the short cache window", async () => {
  clearDouyinMetadataCache()
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return {
      ok: true,
      url: "https://www.iesdouyin.com/share/video/7661206883327471737/",
      async text() {
        return routerHtml({
          ...item,
          video: { ...item.video, play_addr: { url_list: [`https://aweme.example/play-${calls}`] } }
        })
      }
    }
  }
  const source = extractDouyinShareFromText("https://v.douyin.com/EULdbQEydtc/")
  const first = await enrichDouyinShare(source, { fetchImpl, cacheTtlMs: 0 })
  const second = await enrichDouyinShare(source, { fetchImpl, cacheTtlMs: 0 })
  assert.equal(calls, 2)
  assert.notEqual(first.play_url, second.play_url)
})
