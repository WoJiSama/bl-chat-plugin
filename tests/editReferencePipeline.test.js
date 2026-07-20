import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildEditAssetManifest,
  formatEditAssetManifestPrompt,
  prepareImageEditAssets,
  resolveAvatarEditBase,
  resolveEditReferenceAssets
} from "../utils/editReferencePipeline.js"

function memberMap(members) {
  return new Map(members.map(member => [Number(member.user_id), member]))
}

test("builds an ordered edit manifest from base and resolved references", () => {
  const result = prepareImageEditAssets({
    baseImages: ["base-image"],
    text: "希洛把这个图片的头换成maela的头像",
    memberMap: memberMap([{ user_id: 10001, card: "maela" }]),
    botId: 99999
  })

  assert.deepEqual(result.images, ["base-image", result.references[0].source])
  assert.equal(result.manifest[0].role, "edit_base")
  assert.equal(result.manifest[1].role, "appearance_reference")
  assert.match(result.promptHint, /第1张：待编辑原图/)
  assert.match(result.promptHint, /第2张：参考素材/)
})

test("resolves explicit mentions and refuses ambiguous member names", () => {
  const mentioned = prepareImageEditAssets({
    baseImages: ["base"],
    text: "把脸换成他的头像",
    atQq: ["20001"],
    memberMap: memberMap([{ user_id: 20001, card: "目标" }])
  })
  assert.equal(mentioned.references[0].target.userId, "20001")

  const ambiguous = prepareImageEditAssets({
    baseImages: ["base"],
    text: "把头换成小白的头像",
    memberMap: memberMap([{ user_id: 30001, card: "小白" }, { user_id: 30002, nickname: "小白" }])
  })
  assert.equal(ambiguous.references.length, 0)
  assert.deepEqual(ambiguous.images, ["base"])
})

test("reference resolvers are extensible without changing the edit flow", () => {
  const customResolver = context => context.text.includes("设定图")
    ? [{ id: "character-sheet:1", role: "style_reference", kind: "character_sheet", source: "sheet-image", label: "角色设定图" }]
    : []
  const references = resolveEditReferenceAssets({ text: "参考设定图修改" }, [customResolver])
  const manifest = buildEditAssetManifest(["base"], references)

  assert.deepEqual(manifest.map(asset => asset.source), ["base", "sheet-image"])
  assert.match(formatEditAssetManifestPrompt(manifest), /用途=style_reference/)
})

test("deduplicates sources and ignores unrelated wording", () => {
  const unrelated = prepareImageEditAssets({
    baseImages: ["base"],
    text: "让maela站在旁边看戏",
    memberMap: memberMap([{ user_id: 40001, card: "maela" }])
  })
  assert.equal(unrelated.references.length, 0)

  const manifest = buildEditAssetManifest(["same"], [{ id: "duplicate", role: "reference", source: "same" }])
  assert.equal(manifest.length, 1)
})

test("treats avatar inspection words as reference material when an edit action is present", () => {
  const result = prepareImageEditAssets({
    baseImages: ["edited-image"],
    text: "把脖子旁边的手取消掉，然后再看一下maela的头像，这像吗",
    memberMap: memberMap([{ user_id: 50001, card: "maela" }])
  })

  assert.equal(result.references[0].role, "appearance_reference")
  assert.deepEqual(result.images, ["edited-image", result.references[0].source])
})

test("prefers an explicitly named appearance target over incidental reply mentions", () => {
  const result = prepareImageEditAssets({
    baseImages: ["base"],
    text: "希洛把这个图片的头换成绘梨衣的头像",
    atQq: ["3906061530"],
    memberMap: memberMap([
      { user_id: 3906061530, card: "星野" },
      { user_id: 360802380, card: "绘梨衣" }
    ])
  })

  assert.equal(result.references[0].target.userId, "360802380")
})

test("uses a mention only when the edit wording explicitly binds it as reference", () => {
  const result = prepareImageEditAssets({
    baseImages: ["base"],
    text: "把这个人的头换成@目标的头像",
    atQq: ["20001"],
    memberMap: memberMap([{ user_id: 20001, card: "目标" }])
  })

  assert.equal(result.references[0].target.userId, "20001")
})

test("resolves a named group member avatar as the edit base", () => {
  const result = resolveAvatarEditBase({
    text: "希洛帮我把maela的头像换成男人",
    memberMap: memberMap([{ user_id: 60001, card: "maela" }]),
    botId: 99999
  })

  assert.equal(result.targets[0].userId, "60001")
  assert.equal(result.manifest[0].role, "edit_base")
  assert.deepEqual(result.images, ["https://q1.qlogo.cn/g?b=qq&nk=60001&s=640"])
  assert.match(result.promptHint, /头像编辑底图/)
})

test("does not turn avatar reference replacement into an avatar edit base", () => {
  const result = resolveAvatarEditBase({
    text: "希洛把这个图片的头换成maela的头像",
    memberMap: memberMap([{ user_id: 60001, card: "maela" }])
  })

  assert.equal(result, null)
})

test("resolves a single explicit mention avatar as edit base", () => {
  const result = resolveAvatarEditBase({
    text: "把[CQ:at,qq=60001]的头像改成赛博风",
    atQq: ["60001"],
    memberMap: memberMap([{ user_id: 60001, card: "目标" }])
  })

  assert.equal(result.targets[0].userId, "60001")
})

test("resolves the quoted sender avatar as edit base without an automatic mention", () => {
  const result = resolveAvatarEditBase({
    text: "把他的头像改成赛博朋克风",
    replyTargetUserId: "70001",
    replyTargetLabel: "被引用群友",
    memberMap: memberMap([{ user_id: 70001, card: "被引用群友" }])
  })

  assert.equal(result.targets[0].userId, "70001")
  assert.equal(result.targets[0].label, "被引用群友")
  assert.deepEqual(result.images, ["https://q1.qlogo.cn/g?b=qq&nk=70001&s=640"])
})

test("uses the quoted sender avatar as an appearance reference for another base image", () => {
  const result = prepareImageEditAssets({
    baseImages: ["base"],
    text: "把这个图片的脸换成他的头像",
    replyTargetUserId: "70002",
    replyTargetLabel: "引用对象",
    memberMap: memberMap([{ user_id: 70002, card: "引用对象" }])
  })

  assert.equal(result.references[0].target.userId, "70002")
  assert.deepEqual(result.images, ["base", "https://q1.qlogo.cn/g?b=qq&nk=70002&s=640"])
})
