import { test } from "node:test"
import assert from "node:assert/strict"
import { collectMentionTargetIds, getMentionTargetId, messageMentionsUser, replaceCqMentions, stripCqMentions } from "../utils/mentionTargets.js"

test("collects mentioned users across adapter segment shapes", () => {
  const event = {
    message: [
      { type: "at", qq: 10001 },
      { type: "at", data: { qq: "10002" } },
      { type: "at", user_id: "10003" },
      { type: "at", data: { user_id: 10004 } },
      { type: "at", qq: 99999 }
    ]
  }

  assert.deepEqual(collectMentionTargetIds(event, 99999), ["10001", "10002", "10003", "10004"])
})

test("falls back to event lists and CQ text without duplicates", () => {
  const event = {
    at_user: ["20001", 20002, { data: { qq: "20004" } }],
    msg: "[CQ:at,qq=20002] [CQ:at,user_id=20003]"
  }

  assert.deepEqual(collectMentionTargetIds(event), ["20001", "20002", "20004", "20003"])
})

test("reads one mention target through the shared segment abstraction", () => {
  assert.equal(getMentionTargetId({ type: "at", data: { user_id: "30001" } }), "30001")
})

test("detects bot mentions from adapter flags and regular targets", () => {
  assert.equal(messageMentionsUser({ bot: { uin: 40001 }, atBot: true }, 40001), true)
  assert.equal(messageMentionsUser({ message: [{ type: "at", data: { qq: 40002 } }] }, 40002), true)
  assert.equal(messageMentionsUser({ message: [{ type: "at", data: { qq: 40002 } }] }, 40003), false)
})

test("normalizes CQ mentions for readable text and command parsing", () => {
  const text = "检定[CQ:at,user_id=50001,name=test] 侦查"
  assert.equal(replaceCqMentions(text), "检定@50001 侦查")
  assert.equal(stripCqMentions(text), "检定 侦查")
})
