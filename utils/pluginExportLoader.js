export function collectPluginExports(moduleNamespace = {}, PluginBase) {
  if (typeof PluginBase !== "function") return []
  const entries = Object.entries(moduleNamespace || {})
  const ordered = [
    ...entries.filter(([name]) => name === "default"),
    ...entries.filter(([name]) => name !== "default")
  ]
  const seen = new Set()
  const plugins = []
  for (const [exportName, value] of ordered) {
    if (typeof value !== "function" || !value.prototype || !(value.prototype instanceof PluginBase)) continue
    if (seen.has(value)) continue
    seen.add(value)
    plugins.push({ exportName, PluginClass: value })
  }
  return plugins
}
