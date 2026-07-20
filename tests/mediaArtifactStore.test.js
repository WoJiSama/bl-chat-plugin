import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { buildMediaArtifactKey, MediaArtifactStore } from "../utils/messagePipeline/mediaArtifactStore.js"

function tempFile(name, content = "video") {
  const filePath = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.mp4`)
  return fs.promises.writeFile(filePath, content).then(() => filePath)
}

test("media artifacts share an in-flight producer and expire after all consumers release", async () => {
  const store = new MediaArtifactStore({ ttlMs: 20, maxEntries: 4, maxIdleBytes: 1024, maxEncodedBytes: 1024 })
  let produces = 0
  const producer = async () => {
    produces += 1
    await new Promise(resolve => setTimeout(resolve, 10))
    return await tempFile("shared-artifact", "same-video")
  }

  const [left, right] = await Promise.all([
    store.acquire("bilibili:BV1:1:qn6", producer),
    store.acquire("bilibili:BV1:1:qn6", producer)
  ])
  assert.equal(produces, 1)
  assert.equal(left.filePath, right.filePath)
  assert.equal(await store.encodeFile(left.filePath), await store.encodeFile(right.filePath))

  await left.release()
  assert.equal(fs.existsSync(left.filePath), true)
  await right.release()
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(fs.existsSync(left.filePath), false)
})

test("failed producers are evicted instead of poisoning later downloads", async () => {
  const store = new MediaArtifactStore({ ttlMs: 0 })
  await assert.rejects(store.acquire("douyin:123:lowest", async () => { throw new Error("network") }), /network/)
  const lease = await store.acquire("douyin:123:lowest", () => tempFile("retry-artifact"))
  assert.ok(lease?.filePath)
  await lease.release()
  assert.equal(fs.existsSync(lease.filePath), false)
})

test("artifact keys use stable media identity and quality instead of temporary URLs", () => {
  assert.equal(
    buildMediaArtifactKey("bilibili", { bvid: "BV123", cid: 456, quality: 6, url: "https://temporary/one" }),
    "bilibili:BV123:456:qn6"
  )
  assert.equal(
    buildMediaArtifactKey("douyin", { aweme_id: "789", play_url: "https://temporary/two" }),
    "douyin:789:lowest"
  )
})
