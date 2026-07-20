import { test } from "node:test"
import assert from "node:assert/strict"
import { buildGenericChatFailureReply, hasMeaningfulUserText, isToneCorrectionMessage } from "../utils/chatFailureReply.js"

test("tone criticism gets an acknowledgement instead of a greeting fallback", () => {
  const text = "你跟哪学的,怎么感觉阴阳怪气的"

  assert.equal(isToneCorrectionMessage(text), true)
  assert.equal(
    buildGenericChatFailureReply(text, { isGreeting: false }),
    "你说得对，刚才那几句有点顶着你说了，听着确实不舒服。我收一下。"
  )
})

test("a complete request is never described as missing or asks the user to repeat it", () => {
  const output = buildGenericChatFailureReply("我刚才说的你认真看一下", { isGreeting: false })

  assert.match(output, /完整收到了/)
  assert.doesNotMatch(output, /没接住|再发一遍|重新(?:发|说|描述)|叫我吗/)
})

test("real short greetings acknowledge receipt without pretending the greeting was lost", () => {
  const output = buildGenericChatFailureReply("希洛在吗", { isGreeting: true })

  assert.match(output, /我在/)
  assert.match(output, /已经收到了/)
  assert.doesNotMatch(output, /没接住|再发|叫我吗/)
})

test("only genuinely empty CQ-only input asks for more text", () => {
  assert.equal(hasMeaningfulUserText("[CQ:at,qq=123] 希洛？"), false)
  assert.equal(hasMeaningfulUserText("希洛希洛根据现行国标GB14887中红灯和绿灯对应波长范围是多少呢"), true)

  const output = buildGenericChatFailureReply("[CQ:at,qq=123] 希洛？")
  assert.match(output, /补一句/)
})

test("failure kinds produce truthful complete-request replies", () => {
  for (const failureKind of ["request", "rate_limit", "timeout", "network", "upstream", "empty"]) {
    const output = buildGenericChatFailureReply("请计算红灯蓝移到蓝光所需的速度", { failureKind })
    assert.match(output, /问题我完整收到了/)
    assert.doesNotMatch(output, /没接住|再发一遍|重新(?:发|说|描述)/)
  }
})
