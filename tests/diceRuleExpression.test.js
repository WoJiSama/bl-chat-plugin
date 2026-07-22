import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"
import {
  collectExpressionReferences,
  evaluateDiceRuleExpression,
  parseDiceRuleExpression
} from "../utils/DiceRuleExpression.js"
import { validateDiceRulePack } from "../utils/DiceRuleSchema.js"

const examplesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs/dice-rules/examples")

test("custom rule expressions respect precedence, references and short-circuit conditions", () => {
  const result = evaluateDiceRuleExpression(
    "attr.a + attr.b * 2 >= 10 && false ? 99 : max(derived.c, 4)",
    { attr: { a: 4, b: 3 }, derived: { c: 7 } }
  )
  assert.equal(result.value, 7)
  const references = collectExpressionReferences(parseDiceRuleExpression("attr.a + roll.check.total"))
  assert.deepEqual(references.references, ["attr.a", "roll.check.total"])
})

test("custom dice are rolled once and retain a readable trace", () => {
  const result = evaluateDiceRuleExpression("dice('fate', 4) + 2", {}, {
    diceSets: { fate: { label: "Fate", faces: [-1, -1, 0, 0, 1, 1] } },
    random: () => 0.99,
    maxDiceCount: 4
  })
  assert.equal(result.value, 6)
  assert.equal(result.diceCount, 4)
  assert.deepEqual(result.traces, ["Fate[1,1,1,1]"])
  assert.throws(() => evaluateDiceRuleExpression("dice('fate', 1.5)", {}, {
    diceSets: { fate: { faces: [-1, 0, 1] } },
    random: () => 0,
    maxDiceCount: 4
  }), /正整数/)
})

test("expression sandbox rejects unknown references, blocked paths and unknown functions", () => {
  assert.throws(() => evaluateDiceRuleExpression("attr.missing + 1", { attr: {} }), /未知值引用/)
  assert.throws(() => parseDiceRuleExpression("attr.constructor.name"), /禁止字段/)
  assert.throws(() => evaluateDiceRuleExpression("eval('1+1')", {}), /不支持的函数/)
  assert.throws(() => evaluateDiceRuleExpression("1 / 0", {}), /不能除以零/)
})

test("all documented example rule packs pass strict schema validation", () => {
  const files = fs.readdirSync(examplesDir).filter(file => file.endsWith(".yaml"))
  assert.ok(files.length >= 4, "教程至少应保留三份 V1 示例和一份 V2 团务示例")
  for (const file of files) {
    const source = fs.readFileSync(path.join(examplesDir, file), "utf8")
    const result = validateDiceRulePack(YAML.parse(source))
    assert.equal(result.ok, true, `${file}: ${result.errors.join("; ")}`)
  }
})

test("schema rejects cycles, core aliases and dice inside derived fields", () => {
  const base = {
    version: 1,
    id: "bad-pack",
    name: "Bad",
    aliases: ["bad"],
    character: {
      fields: {
        a: { type: "number", formula: "derived.b + 1" },
        b: { type: "number", formula: "derived.a + 1" }
      }
    },
    commands: [{ id: "check", aliases: ["check"], output: "{actor}" }]
  }
  const cycle = validateDiceRulePack(base)
  assert.equal(cycle.ok, false)
  assert.ok(cycle.errors.some(error => error.includes("循环依赖")))

  const reserved = validateDiceRulePack({ ...base, id: "core-pack", aliases: ["ra"], character: { fields: {} } })
  assert.equal(reserved.ok, false)
  assert.ok(reserved.errors.some(error => error.includes("核心命令")))

  const randomDerived = validateDiceRulePack({
    ...base,
    id: "dice-derived",
    aliases: ["derivedpack"],
    character: { fields: { a: { type: "number", formula: "1d6" } } }
  })
  assert.equal(randomDerived.ok, false)
  assert.ok(randomDerived.errors.some(error => error.includes("确定性表达式")))
})

test("schema enforces runtime, reserved commands, output fallback and configured dice limits", () => {
  const base = {
    version: 1,
    id: "schema-pack",
    name: "Schema",
    aliases: ["schema"],
    commands: [{ id: "check", aliases: ["check"], output: "{actor}" }]
  }
  const future = validateDiceRulePack({ ...base, compatibility: { min_runtime: "9.0" } })
  assert.equal(future.ok, false)
  assert.ok(future.errors.some(error => error.includes("当前只有")))

  const reservedId = validateDiceRulePack({ ...base, id: "dice", aliases: ["schema"] })
  assert.equal(reservedId.ok, false)
  assert.ok(reservedId.errors.some(error => error.includes("核心命令")))

  const swallowedPrefix = validateDiceRulePack({ ...base, id: "coc-house-rule", aliases: ["safehouse"] })
  assert.equal(swallowedPrefix.ok, false)
  assert.ok(swallowedPrefix.errors.some(error => error.includes("核心命令路由")))

  const reservedSubcommand = validateDiceRulePack({
    ...base,
    commands: [{ id: "card", aliases: ["卡"], output: "{actor}" }]
  })
  assert.equal(reservedSubcommand.ok, false)
  assert.ok(reservedSubcommand.errors.some(error => error.includes("人物卡操作保留")))

  const noFallback = validateDiceRulePack({
    ...base,
    commands: [{ id: "check", aliases: ["check"], branches: [{ when: "false", output: "never" }] }]
  })
  assert.equal(noFallback.ok, false)
  assert.ok(noFallback.errors.some(error => error.includes("默认分支 output")))

  const badTemplate = validateDiceRulePack({
    ...base,
    templates: { result: "{attr.missing}" },
    commands: [{ id: "check", aliases: ["check"], template: "result" }]
  })
  assert.equal(badTemplate.ok, false)
  assert.ok(badTemplate.errors.some(error => error.includes("未知模板变量")))

  const leakedSecret = validateDiceRulePack({
    ...base,
    character: { fields: { note: { type: "string", default: "hidden", secret: true } } },
    commands: [{ id: "check", aliases: ["check"], output: "{attr.note}" }]
  })
  assert.equal(leakedSecret.ok, false)
  assert.ok(leakedSecret.errors.some(error => error.includes("至少需要 gm") && error.includes("attr.note")))

  const gmSecret = validateDiceRulePack({
    ...base,
    character: { fields: { note: { type: "string", default: "hidden", secret: true } } },
    commands: [{ id: "check", aliases: ["check"], permission: "gm", output: "{attr.note}" }]
  })
  assert.equal(gmSecret.ok, true, gmSecret.errors.join("; "))

  const derivedSecret = validateDiceRulePack({
    ...base,
    identity: { display_name: "{derived.masked_twice}" },
    character: {
      fields: {
        score: { type: "integer", default: 1, secret: true },
        masked: { type: "integer", formula: "attr.score + 1" },
        masked_twice: { type: "integer", formula: "derived.masked + 1" }
      }
    },
    commands: [{ id: "check", aliases: ["check"], output: "{derived.masked_twice}" }]
  })
  assert.equal(derivedSecret.ok, false)
  assert.ok(derivedSecret.errors.some(error => error.includes("显示名称不能引用 secret 字段")))
  assert.ok(derivedSecret.errors.some(error => error.includes("至少需要 gm") && error.includes("derived.masked_twice")))

  const badErrorTemplate = validateDiceRulePack({
    ...base,
    commands: [{ id: "check", aliases: ["check"], output: "ok", error_output: "{attr.hp}: {message}" }]
  })
  assert.equal(badErrorTemplate.ok, false)
  assert.ok(badErrorTemplate.errors.some(error => error.includes("错误模板只支持 message")))

  const inherited = validateDiceRulePack(base, { maxDiceCount: 2 })
  assert.equal(inherited.ok, true, inherited.errors.join("; "))
  assert.equal(inherited.pack.limits.max_dice_count, 2)
  const oversized = validateDiceRulePack({ ...base, limits: { max_dice_count: 3 } }, { maxDiceCount: 2 })
  assert.equal(oversized.ok, false)

  const chainedMigration = validateDiceRulePack({
    ...base,
    compatibility: { migrations: [{ from: "1.0.0", rename_fields: { old: "middle", middle: "newest" } }] },
    character: { fields: { middle: { type: "integer", default: 0 }, newest: { type: "integer", default: 0 } } }
  })
  assert.equal(chainedMigration.ok, false)
  assert.ok(chainedMigration.errors.some(error => error.includes("链式重命名")))
})
