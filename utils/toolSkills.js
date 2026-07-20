function normalizeText(value = "", maxLength = 480) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength)
}

function summarizeParameters(parameters = {}) {
  const properties = parameters?.properties && typeof parameters.properties === "object"
    ? parameters.properties
    : {}
  const required = new Set(Array.isArray(parameters?.required) ? parameters.required : [])
  return Object.entries(properties).map(([name, schema]) => {
    const type = schema?.type || "value"
    const requiredText = required.has(name) ? " required" : ""
    const choices = Array.isArray(schema?.enum) && schema.enum.length
      ? ` choices=${schema.enum.join("|")}`
      : ""
    return `${name}:${type}${requiredText}${choices}`
  }).join(", ")
}

export function resolveToolSkill(tool = {}) {
  const declared = typeof tool?.getSkill === "function" ? tool.getSkill() : tool?.skill
  const skill = declared && typeof declared === "object" ? declared : {}
  return {
    name: String(skill.name || tool?.name || "").trim(),
    purpose: normalizeText(skill.purpose || tool?.description, 600),
    whenToUse: normalizeText(skill.whenToUse, 420),
    boundaries: normalizeText(skill.boundaries, 420),
    instructions: normalizeText(skill.instructions, 900),
    examples: Array.isArray(skill.examples)
      ? skill.examples.map(item => normalizeText(item, 260)).filter(Boolean).slice(0, 4)
      : [],
    parameters: tool?.parameters || { type: "object", properties: {}, required: [] }
  }
}

export function buildToolSkillCatalog(toolInstances = {}, availableToolNames = []) {
  const allowed = new Set(availableToolNames)
  return Object.values(toolInstances)
    .filter(tool => tool?.name && allowed.has(tool.name))
    .map(tool => {
      const skill = resolveToolSkill(tool)
      return [
        `- ${skill.name}: ${skill.purpose || "执行已注册能力"}`,
        skill.whenToUse ? `  use: ${skill.whenToUse}` : "",
        skill.boundaries ? `  boundary: ${skill.boundaries}` : "",
        skill.instructions ? `  instructions: ${skill.instructions}` : "",
        `  parameters: ${summarizeParameters(skill.parameters) || "none"}`,
        ...skill.examples.map(example => `  example: ${example}`)
      ].filter(Boolean).join("\n")
    })
    .join("\n")
}

export function normalizeToolSkillParams(tool, params = {}, context = {}) {
  const input = params && typeof params === "object" ? { ...params } : {}
  if (typeof tool?.normalizeParameters !== "function") return input
  const normalized = tool.normalizeParameters(input, context)
  return normalized && typeof normalized === "object" ? normalized : input
}
