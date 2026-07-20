const DIRECT_RESULT_TOOLS = new Set(["excelWorkbookTool", "forgetGroupKnowledgeTool"])

export function decideToolContinuation(validResults = [], options = {}) {
  const toolNames = validResults.map(result => String(result?.toolName || "")).filter(Boolean)
  if (toolNames.length && toolNames.every(toolName => DIRECT_RESULT_TOOLS.has(toolName))) {
    return "direct_result"
  }
  if (options.syntheticToolCall === true) return "chat_only"
  return "tool_loop"
}
