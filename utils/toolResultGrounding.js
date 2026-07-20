const ERROR_PATTERN = /^(?:error|错误|失败)[:：]|"error"\s*:|(?:请求|查询|分析|下载|解析|发送).{0,16}(?:失败|错误|异常|超时)|链接已过期|无效的.+链接|未检测到有效/i
const NOT_FOUND_PATTERN = /(?:未找到|没有找到|没找到|未查到|没有查到|没查到|未命中|无匹配|没有匹配|没有相关结果|未找到相关结果|匹配数量\s*[:：]\s*0|结果数量\s*[:：]\s*0)/i

function parseJson(text = "") {
  try { return JSON.parse(text) } catch { return undefined }
}
function hasMeaningfulValue(value) {
  if (value === undefined || value === null) return false
  if (typeof value === "string") return value.trim().length > 0
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value === "boolean") return false
  if (Array.isArray(value)) return value.some(hasMeaningfulValue)
  if (typeof value === "object") {
    return Object.entries(value).some(([key, nested]) => {
      if (["success", "ok", "status", "code"].includes(String(key).toLowerCase())) return false
      return hasMeaningfulValue(nested)
    })
  }
  return false
}

export function classifyToolResult(result) {
  const text = typeof result === "string" ? result.trim() : JSON.stringify(result ?? "").trim()
  if (!text) return { kind: "empty", text: "" }
  if (ERROR_PATTERN.test(text)) return { kind: "error", text }
  if (NOT_FOUND_PATTERN.test(text)) return { kind: "not_found", text }
  const parsed = parseJson(text)
  if (parsed !== undefined && !hasMeaningfulValue(parsed)) return { kind: "empty", text, parsed }
  return { kind: "success", text, parsed }
}

export function buildToolGroundingInstruction(results = []) {
  const statuses = results.map(result => ({
    toolName: String(result?.toolName || "tool"),
    kind: classifyToolResult(result?.result).kind
  }))
  return [
    "【本轮工具结果事实边界】",
    "最终回复只能陈述本轮工具结果中明确出现的事实。聊天历史、旧回复、记忆和常识只能帮助理解指代，绝不能用来填补本轮工具的空白。",
    "如果某项结果是 empty、not_found 或 error，必须明确说本轮没有拿到/没有找到，禁止回忆旧答案、猜测数值、补全名称或假装查到了。",
    `本轮状态: ${statuses.map(item => `${item.toolName}=${item.kind}`).join("；")}`
  ].join("\n")
}

export function buildUnavailableToolReply(results = []) {
  const kinds = results.map(result => classifyToolResult(result?.result).kind)
  if (kinds.includes("not_found")) {
    return "这次没有找到你要的内容。现有结果里没有依据，我不会拿旧聊天记录补答案。"
  }
  if (kinds.includes("error")) {
    return "这次查询没有成功，我没拿到可靠结果。没查到就是没查到，我不会凭印象乱说。"
  }
  return "这次没有返回可用内容，所以我现在不能确认。没拿到结果就是没拿到，我不猜。"
}

export function hasUsableToolResult(results = []) {
  return results.some(result => classifyToolResult(result?.result).kind === "success")
}
