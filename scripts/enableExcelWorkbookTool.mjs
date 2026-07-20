import fs from "fs"
import YAML from "yaml"

const configPath = process.argv[2] || "/opt/trss-yunzai/plugins/bl-chat-plugin/config/message.yaml"
const source = fs.readFileSync(configPath, "utf8")
const document = YAML.parseDocument(source)
let tools = document.getIn(["pluginSettings", "oneapi_tools"], true)

if (!tools) {
  document.setIn(["pluginSettings", "oneapi_tools"], ["excelWorkbookTool"])
  tools = document.getIn(["pluginSettings", "oneapi_tools"], true)
}

const existing = Array.isArray(tools?.items)
  ? tools.items.map(item => String(item?.value ?? item))
  : []
if (!existing.some(item => item.replace(/\(.*\)$/, "") === "excelWorkbookTool")) {
  tools.add("excelWorkbookTool")
}

fs.writeFileSync(configPath, document.toString(), "utf8")
console.log(`excelWorkbookTool enabled=${document.toJS()?.pluginSettings?.oneapi_tools?.some(item => String(item).replace(/\(.*\)$/, "") === "excelWorkbookTool")}`)
