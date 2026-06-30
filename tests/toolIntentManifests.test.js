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
