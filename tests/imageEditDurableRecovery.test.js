import { test } from "node:test"
import assert from "node:assert/strict"

test("image edit durable job is recovered after process restart", async t => {
  if (!globalThis.logger) {
    globalThis.logger = { info() {}, warn() {}, error() {}, debug() {}, mark() {} }
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
  const records = new Map()
  globalThis.redis = {
    set: async (key, value) => records.set(key, value),
    get: async key => records.get(key),
    del: async key => records.delete(key),
    keys: async pattern => [...records.keys()].filter(key => key.startsWith(pattern.replace("*", "")))
  }
  globalThis.Bot = {
    uin: 999,
    pickGroup: () => ({ sendMsg: async () => ({ retcode: 0 }) })
  }

  const interrupted = new GoogleImageEditTool()
  const job = interrupted.createDurableJob({ prompt: "换头", images: ["base", "avatar"] }, { group_id: 1, user_id: 2, message_id: 3, sender: {} })
  await interrupted.persistDurableJob(job)
  assert.equal(records.size, 1)

  class RecoveringTool extends GoogleImageEditTool {
    recovered = null
    async performImageEdit(opts) {
      this.recovered = opts
      return "图片编辑成功"
    }
  }
  const recovering = new RecoveringTool()
  await recovering.recoverDurableJobs()

  assert.deepEqual(recovering.recovered, { prompt: "换头", images: ["base", "avatar"] })
  assert.equal(records.size, 0)
  delete globalThis.redis
  delete globalThis.Bot
})
