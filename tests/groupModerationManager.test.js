import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import {
  analyzeModerationRules,
  buildModerationReport,
  normalizeGroupModerationConfig
} from "../utils/groupModerationRules.js"

test("normalizes group moderation admin and threshold config", () => {
  const config = normalizeGroupModerationConfig({
    enabledGroups: [609235590, " 123 "],
    globalAdmins: [925640859],
    groupAdmins: [
      { groupId: 609235590, admins: [111, " 222 "] },
      { groupId: "", admins: [333] }
    ],
    minActiveLevel: "5",
    thresholds: { report: "1.5", mute: "-1" }
  })

  assert.deepEqual(config.enabledGroups, ["609235590", "123"])
  assert.deepEqual(config.globalAdmins, ["925640859"])
  assert.deepEqual(config.groupAdmins, [{ groupId: "609235590", admins: ["111", "222"] }])
  assert.equal(config.minActiveLevel, 5)
  assert.equal(config.thresholds.report, 1)
  assert.equal(config.thresholds.mute, 0)
})

test("detects low-level external recruitment text", () => {
  const config = normalizeGroupModerationConfig({ minActiveLevel: 5 })
  const result = analyzeModerationRules({
    memberLevel: 3,
    text: "长期招募兼职代理，日结佣金，加微信 abc12345，详情看 https://example.com",
    imageCount: 0,
    atCount: 0
  }, config)

  assert.ok(result.rules.includes("低活跃等级"))
  assert.ok(result.rules.includes("包含外链"))
  assert.ok(result.rules.includes("疑似招募话术"))
  assert.ok(result.rules.includes("包含联系方式"))
  assert.ok(result.confidence >= 0.7)
})

test("detects group invite qr and add-v promotion patterns", () => {
  const config = normalizeGroupModerationConfig({ minActiveLevel: 5 })
  const qrResult = analyzeModerationRules({
    memberLevel: 1,
    text: "扫码进群，长按识别二维码，进群领取福利",
    imageCount: 1,
    atCount: 0
  }, config)
  const addVResult = analyzeModerationRules({
    memberLevel: 1,
    text: "推广合作，加V abc12345 私聊领取，名额有限",
    imageCount: 0,
    atCount: 0
  }, config)

  assert.ok(qrResult.rules.includes("疑似二维码引流"))
  assert.ok(qrResult.confidence >= 0.7)
  assert.ok(addVResult.rules.includes("疑似招募话术"))
  assert.ok(addVResult.rules.includes("包含联系方式"))
  assert.ok(addVResult.confidence >= 0.7)
})

test("detects authorization promotion and low-level forwarded ads", () => {
  const config = normalizeGroupModerationConfig({ minActiveLevel: 5 })
  const authResult = analyzeModerationRules({
    memberLevel: 1,
    text: "[🔗🍀一念成仙](https://qm.qq.com/q/cSHh9UTFyo) | [✨免@授权](mqqapi://aio/inlinecmd?command=全量申请) 请点击B站关注按钮查阅详细",
    imageCount: 0,
    atCount: 0
  }, config)
  const forwardResult = analyzeModerationRules({
    memberLevel: 1,
    text: "[合并转发]",
    imageCount: 0,
    atCount: 0,
    forwardCount: 1
  }, config)

  assert.ok(authResult.rules.includes("疑似授权推广"))
  assert.ok(authResult.confidence >= 0.7)
  assert.ok(forwardResult.rules.includes("低活跃合并转发"))
  assert.ok(forwardResult.confidence >= 0.7)
})

test("renders natural-language moderation report instead of json object", () => {
  const config = normalizeGroupModerationConfig()
  const text = buildModerationReport({
    rules: ["低活跃等级", "包含外链", "疑似招募话术"],
    confidence: 0.864,
    action: "report",
    evidenceForwarded: true
  }, config)

  assert.equal(text, '群管检测：命中规则["低活跃等级", "包含外链", "疑似招募话术"],置信度:0.86。证据已转发到群管理员私聊')
})

test("group guard schema exposes composite moderation settings", async () => {
  const { default: groupGuardSchema } = await import("../models/Guoba/schemas/groupGuard.js")
  const fields = groupGuardSchema.map(item => item.field).filter(Boolean)
  const labels = groupGuardSchema.map(item => item.label).filter(Boolean)

  assert.ok(labels.includes("复合群管"))
  assert.ok(fields.includes("groupModeration.globalAdmins"))
  assert.ok(fields.includes("groupModeration.groupAdmins"))
  assert.ok(fields.includes("groupModeration.thresholds.report"))
  assert.ok(fields.includes("groupModeration.actions.muteEnabled"))
})

test("group moderation checks bot admin permission before content extraction", () => {
  const source = fs.readFileSync(new URL("../utils/GroupModerationManager.js", import.meta.url), "utf8")
  const configCheck = source.indexOf("if (!this.isGroupEnabled(config, groupId)) return false")
  const botAdminCheck = source.indexOf("if (!await this.isBotAdmin(e, groupId)) return false")
  const extractContent = source.indexOf("const content = await this.extractContent(e, config)")

  assert.ok(source.includes("async isBotAdmin(e, groupId)"))
  assert.ok(configCheck >= 0)
  assert.ok(botAdminCheck > configCheck)
  assert.ok(extractContent > botAdminCheck)
})
