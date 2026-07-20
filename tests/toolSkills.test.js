import test from "node:test"
import assert from "node:assert/strict"
import { AbstractTool } from "../functions/functions_tools/AbstractTool.js"
import { ModrinthTool } from "../functions/functions_tools/ModrinthTool.js"
import { buildToolSkillCatalog, resolveToolSkill } from "../utils/toolSkills.js"

class EnumTool extends AbstractTool {
  constructor() {
    super()
    this.name = "enumTool"
    this.description = "A test tool"
    this.parameters = {
      type: "object",
      properties: { mode: { type: "string", enum: ["safe"] } },
      required: ["mode"]
    }
  }

  async func(params) {
    return params
  }
}

test("all tools expose an Agent Skill even without a bespoke declaration", () => {
  const tool = new EnumTool()
  const skill = resolveToolSkill(tool)
  assert.equal(skill.name, "enumTool")
  assert.equal(skill.purpose, "A test tool")
  assert.match(buildToolSkillCatalog({ enumTool: tool }, ["enumTool"]), /mode:string required choices=safe/)
})

test("tool execution normalizes before validating schemas", async () => {
  const tool = new EnumTool()
  assert.deepEqual(await tool.execute({ mode: "safe" }), { mode: "safe" })
  assert.match(await tool.execute({ mode: "unsafe" }), /必须是以下值之一/)
  tool.parameters.required = []
  assert.deepEqual(await tool.execute({ mode: "" }), { mode: "" })
})

test("Modrinth skill turns natural request semantics into API parameters", () => {
  const tool = new ModrinthTool()
  assert.deepEqual(
    tool.normalizeParameters({ sort: "recently_updated", category: "魔法", limit: 5 }, {
      userText: "告诉我Modrinth 最近更新的魔法模组前五"
    }),
    { sort: "updated", loader: "", category: "magic", gameVersion: "", query: "", limit: 5 }
  )
})

test("optional enum filters do not block a normalized Modrinth execution", async () => {
  const tool = new ModrinthTool({
    fetchImpl: async () => ({ ok: true, async json() { return { total_hits: 0, hits: [] } } })
  })
  const result = await tool.execute({
    sort: "updated",
    loader: "",
    category: "magic",
    gameVersion: "",
    query: "",
    limit: 5
  }, { msg: "告诉我Modrinth最近更新的魔法模组前五名" })
  assert.equal(result.kind, "modrinth_ranking")
  assert.equal(result.query.loader, "")
  assert.equal(result.query.category, "magic")
})
