import test from "node:test"
import assert from "node:assert/strict"
import {
  DICE_COMMAND_RULES,
  matchDiceCommand,
  normalizeDiceCommandText,
  stripDiceCommand
} from "../utils/diceCommandPolicy.js"

function route(message) {
  return DICE_COMMAND_RULES.find(rule => new RegExp(rule.reg).test(message))?.fnc || null
}

test("dice commands accept ASCII or Chinese periods and optional argument spaces", () => {
  const cases = [
    [".ra力量", "seaCocCheck"],
    [".ra 力量", "seaCocCheck"],
    ["。ra力量", "seaCocCheck"],
    ["。ra 力量", "seaCocCheck"],
    [".rc敏捷", "check"],
    ["。sc1/1d6 60", "sanCheck"],
    ["。st力量60", "st"],
    [".pcnew 调查员", "pc"],
    [".nn希洛", "nn"],
    [".setcoc1", "setCoc"],
    [".r1d100", "roll"],
    ["。r 1d100", "roll"],
    [".rab斗殴60", "seaCocCheck"],
    [".rah侦查60", "seaCocCheck"],
    [".ra+1力量", "numberedCheck"],
    ["。ra-1 力量", "numberedCheck"],
    [".helpra", "help"],
    [".boton", "botControl"],
    [".replyoff", "replyControl"],
    [".send内容", "sendToMaster"],
    [".find克苏鲁", "findEntry"],
    [".setd20", "setDiceOption"],
    ["。setdnd", "setDiceOption"],
    [".snon", "sn"],
    [".lognew团录", "logNew"],
    [".ri+3", "initiativeRoll"],
    [".initlist", "initiative"],
    [".rsr甲 乙", "rsr"],
    [".ww10", "ww"],
    [".dx10c8", "dx"],
    [".ek1d100", "ek"],
    [".bp1理由", "bonusRoll"],
    [".pp2理由", "penaltyRoll"],
    [".rav斗殴60", "opposed"],
    [".rb斗殴60", "bonusCheck"],
    [".rp斗殴60", "penaltyCheck"],
    [".rh侦查60", "hiddenCheck"],
    [".en侦查60", "enCheck"],
    [".coc5", "coc"],
    [".dnd5", "dnd"],
    [".cast1", "dndUtility"],
    [".namednd5", "nameDnd"],
    [".db120 100", "db"],
    [".nnAlice", "nn"],
    [".骰规则导入", "manageDiceRules"],
    ["。骰规则 启用 fate-lite", "manageDiceRules"]
  ]

  for (const [message, expected] of cases) {
    assert.equal(route(message), expected, message)
  }
})

test("dice command routing keeps short commands from consuming unrelated text", () => {
  for (const message of [".rabc", ".random", ".science", ".string", "普通。ra力量", "第二个方案"]) {
    assert.equal(route(message), null, message)
  }
  assert.equal(route(".ra"), "seaCocCheck")
  assert.equal(route(".setcoc1"), "setCoc")
})

test("dice command parsing normalizes the Chinese period before extracting arguments", () => {
  assert.equal(normalizeDiceCommandText("。ra力量"), ".ra力量")
  assert.equal(stripDiceCommand("。ra 力量", "(ra|rc)"), "力量")
  assert.equal(stripDiceCommand(".nn希洛", "nn"), "希洛")

  const sea = matchDiceCommand("。rab斗殴60", "(rab|rap|rahb|rahp|rah|ra)(\\d+)?#?(b|p)?\\s*([\\s\\S]*)")
  assert.deepEqual(sea?.slice(1), ["rab", undefined, undefined, "斗殴60"])

  const numbered = matchDiceCommand("。ra+1力量", "(?:ra|rc)([+\\-]?\\d+)\\s*([\\s\\S]*)")
  assert.deepEqual(numbered?.slice(1), ["+1", "力量"])
})

test("all dice routing rules compile as JavaScript regular expressions", () => {
  for (const rule of DICE_COMMAND_RULES) assert.doesNotThrow(() => new RegExp(rule.reg), rule.reg)
})
