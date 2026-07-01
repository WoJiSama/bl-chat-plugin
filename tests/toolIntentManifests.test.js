import test from "node:test"
import assert from "node:assert/strict"
import { buildToolIntentDisclosure, selectToolIntentCandidates } from "../utils/toolIntentManifests.js"

test("selects delta force manifest for natural delta force requests", () => {
  const available = ["searchInformationTool", "deltaForceTool", "bananaTool"]
  const candidates = selectToolIntentCandidates(
    "希洛发一下今天的三角洲的改枪码，我要和277有关的",
    available
  )
  assert.deepEqual(candidates, ["deltaForceTool"])

  const disclosure = buildToolIntentDisclosure(candidates)
  assert.match(disclosure, /operation=solution_list/)
  assert.match(disclosure, /keyword/)
  assert.match(disclosure, /277/)
  assert.match(disclosure, /名字有 非洲/)
  assert.match(disclosure, /"keyword":"非洲"/)
})

test("does not disclose unavailable or unrelated tool manifests", () => {
  assert.deepEqual(
    selectToolIntentCandidates("希洛发一下三角洲今日密码", ["searchInformationTool"]),
    []
  )
  assert.deepEqual(
    selectToolIntentCandidates("希洛帮我画一张猫", ["deltaForceTool", "bananaTool"]),
    []
  )
})

test("selects common tool manifests from natural language", () => {
  assert.deepEqual(
    selectToolIntentCandidates("半小时后提醒我收菜", ["reminderTool", "searchInformationTool"]),
    ["reminderTool"]
  )
  assert.match(buildToolIntentDisclosure(["reminderTool"]), /action=create/)

  assert.deepEqual(
    selectToolIntentCandidates("来首周杰伦的歌", ["searchMusicTool", "searchInformationTool"]),
    ["searchMusicTool"]
  )
  assert.match(buildToolIntentDisclosure(["searchMusicTool"]), /isArtistOnly=true/)

  assert.deepEqual(
    selectToolIntentCandidates("把这段内容整理成思维导图", ["aiMindMapTool", "textImageTool"]),
    ["aiMindMapTool"]
  )
})

test("prefers specific manifests over generic search or web parsing", () => {
  assert.deepEqual(
    selectToolIntentCandidates(
      "查一下三角洲今日密码",
      ["deltaForceTool", "searchInformationTool"]
    ),
    ["deltaForceTool"]
  )

  assert.deepEqual(
    selectToolIntentCandidates(
      "看看 https://github.com/user/repo 这个仓库",
      ["githubRepoTool", "webParserTool", "searchInformationTool"]
    ),
    ["githubRepoTool"]
  )

  assert.deepEqual(
    selectToolIntentCandidates(
      "帮我总结 https://example.com 这个页面",
      ["githubRepoTool", "webParserTool", "searchInformationTool"]
    ),
    ["webParserTool"]
  )
})
