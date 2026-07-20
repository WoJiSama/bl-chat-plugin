import assert from "node:assert/strict"
import { test } from "node:test"
import { collectPluginExports } from "../utils/pluginExportLoader.js"

class PluginBase {}

test("plugin export loader ignores helpers and registers every plugin class", () => {
  class FirstPlugin extends PluginBase {}
  class SecondPlugin extends PluginBase {}
  const helper = () => {}
  const result = collectPluginExports({ helper, FirstPlugin, SecondPlugin }, PluginBase)
  assert.deepEqual(result.map(item => item.exportName), ["FirstPlugin", "SecondPlugin"])
  assert.deepEqual(result.map(item => item.PluginClass), [FirstPlugin, SecondPlugin])
})

test("plugin export loader de-duplicates default and named aliases", () => {
  class ExamplePlugin extends PluginBase {}
  const result = collectPluginExports({ default: ExamplePlugin, ExamplePlugin }, PluginBase)
  assert.equal(result.length, 1)
  assert.equal(result[0].PluginClass, ExamplePlugin)
})
