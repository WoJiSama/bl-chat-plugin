import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import { MessagePipeline } from "../utils/messagePipeline/messagePipeline.js"
import { RedisJobStore } from "../utils/messagePipeline/redisJobStore.js"
import { createEventEnvelope } from "../utils/messagePipeline/eventEnvelope.js"
import { createFakeRedis } from "./helpers/fakeRedis.js"

function rawEvent(groupId, messageId) {
  const event = {
    post_type: "message",
    group_id: groupId,
    user_id: 925640859,
    message_id: messageId,
    time: 1784517000,
    raw_message: "same-card",
    message: [{ type: "bilibili", title: "same-card", duration: 1801 }],
    sender: { user_id: 925640859, nickname: "user" }
  }
  Object.defineProperty(event, "message_type", { value: "group", enumerable: false })
  Object.defineProperty(event, "self_id", { value: 3094088525, enumerable: false })
  return event
}

function buildPipeline({ redis = createFakeRedis(), delayMs = 0, enrichBilibili, emojiCollector } = {}) {
  const recent = []
  const archive = []
  const deliveries = []
  const store = new RedisJobStore({ redis })
  const mediaOutbox = {
    async enqueue(value) { deliveries.push(value); return value },
    async recover() { return 0 },
    stop() {}
  }
  const pipeline = new MessagePipeline({
    store,
    recentManager: { async recordMessage(event) { recent.push(event) } },
    archiveManager: {
      shouldRecord() { return true },
      shouldRecordNotice() { return true },
      async recordMessage(event) { archive.push(event) },
      async recordNotice(event) { archive.push(event) }
    },
    mediaOutbox,
    emojiCollector,
    logger: { info() {}, warn() {} },
    enrichBilibili: enrichBilibili || (async message => {
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs))
      return message
    }),
    enrichDouyin: async message => message
  })
  return { pipeline, store, recent, archive, deliveries, redis }
}

test("raw listener captures identical cross-group events before business throttling", async () => {
  const { pipeline, store, recent, archive, deliveries } = buildPipeline({ delayMs: 40 })
  const bot = new EventEmitter()
  pipeline.start(bot)
  bot.emit("message", rawEvent(609235590, 201))
  bot.emit("message", rawEvent(953676639, 202))
  await new Promise(resolve => setTimeout(resolve, 100))

  const jobs = await store.list("event")
  assert.equal(jobs.length, 2)
  assert.ok(jobs.every(job => job.state === "completed"))
  assert.deepEqual(recent.map(item => String(item.group_id)).sort(), ["609235590", "953676639"])
  assert.equal(archive.length, 2)
  assert.equal(deliveries.length, 2)
  pipeline.stop()
})

test("duplicate raw delivery of one event runs consumers once", async () => {
  const { pipeline, store, recent, deliveries } = buildPipeline()
  const event = rawEvent(609235590, 203)
  const envelopeId = pipeline.handleRawEvent(event, "message")
  pipeline.handleRawEvent(event, "message")
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal((await store.get("event", envelopeId)).state, "completed")
  assert.equal(recent.length, 1)
  assert.equal(deliveries.length, 1)
  pipeline.stop()
})

test("media enqueue is not blocked by metadata enrichment", async () => {
  const { pipeline, recent, deliveries } = buildPipeline({ delayMs: 80 })
  pipeline.handleRawEvent(rawEvent(609235590, 205), "message")
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(deliveries.length, 1)
  assert.equal(recent.length, 0)
  await new Promise(resolve => setTimeout(resolve, 90))
  assert.equal(recent.length, 1)
  pipeline.stop()
})

test("raw CQ JSON is detected even when the normalized message array is empty", async () => {
  const { pipeline, deliveries } = buildPipeline()
  const event = rawEvent(609235590, 208)
  event.message = []
  event.raw_message = `[CQ:json,data=${JSON.stringify({
    prompt: "[QQ小程序]哔哩哔哩",
    meta: { detail_1: { desc: "raw card", qqdocurl: "https://b23.tv/JvNsiRF" } }
  })}]`
  pipeline.handleRawEvent(event, "message")
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0].media.type, "bilibili")
  pipeline.stop()
})

test("metadata enrichment failure preserves raw storage consumers", async () => {
  const { pipeline, store, recent, archive } = buildPipeline({
    enrichBilibili: async () => { throw new Error("metadata unavailable") }
  })
  const id = pipeline.handleRawEvent(rawEvent(609235590, 206), "message")
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal((await store.get("event", id)).state, "completed")
  assert.equal(recent.length, 1)
  assert.equal(archive.length, 1)
  assert.equal(recent[0].message[0].title, "same-card")
  pipeline.stop()
})

test("emoji auto-collection cannot hold the core event job open", async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  let started = false
  const { pipeline, store } = buildPipeline({
    emojiCollector: {
      async maybeAutoCollect() {
        started = true
        await gate
      }
    }
  })
  const event = rawEvent(609235590, 207)
  event.raw_message = "[image]"
  event.message = [{ type: "image", url: "https://example.test/emoji.png" }]
  const id = pipeline.handleRawEvent(event, "message")
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(started, true)
  assert.equal((await store.get("event", id)).state, "completed")
  release()
  pipeline.stop()
})

test("pipeline waits for a live lease and recovers only after it expires", async () => {
  const first = buildPipeline()
  const envelope = createEventEnvelope(rawEvent(609235590, 204), "message")
  const id = envelope.eventId
  const job = first.pipeline.createJob(envelope)
  job.state = "processing"
  job.ownerRunId = "old-process"
  job.leaseUntil = Date.now() + 600000
  await first.store.create("event", id, job)
  await first.store.acquireLock("event", id, 600000)

  const recovered = buildPipeline({ redis: first.redis })
  assert.equal(await recovered.pipeline.recover(), 1)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal((await recovered.store.get("event", id)).state, "processing")

  const expired = await recovered.store.get("event", id)
  expired.leaseUntil = Date.now() - 1000
  await recovered.store.save("event", id, expired)
  await recovered.store.clearLock("event", id)
  assert.equal(await recovered.pipeline.recover(), 1)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal((await recovered.store.get("event", id)).state, "completed")
  recovered.pipeline.stop()
})
