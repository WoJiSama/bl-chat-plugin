import test from "node:test"
import assert from "node:assert/strict"
import {
  buildExcelToolParams,
  extractExcelSearchQuery,
  extractExcelSheetReference,
  getExcelRelatedTerms,
  hasExcelWorkbookContext,
  shouldBypassMergeForExcel,
  shouldUseExcelWorkbookTool
} from "../utils/excelRequestPolicy.js"

test("parses ordinal and named worksheet references", () => {
  assert.equal(extractExcelSheetReference("第二个tab里面有什么"), "2")
  assert.equal(extractExcelSheetReference("第12个工作表"), "12")
  assert.equal(extractExcelSheetReference("在预算表这个 sheet 里找订单"), "预算表")
})

test("turns the real second-tab dot-st request into one find call", () => {
  const params = buildExcelToolParams("希洛，你能找到第二个tab里面跟.st有关的内容吗", { hasExcelContext: true })
  assert.equal(params.operation, "find")
  assert.equal(params.sheetName, "2")
  assert.equal(params.query, ".st")
  assert.ok(params.relatedTerms.includes("属性"))
  assert.ok(params.relatedTerms.includes("STR"))
})

test("parses quoted-workbook cell requests before any carrier media routing", () => {
  assert.deepEqual(
    buildExcelToolParams("希洛把第二个tab里面b40的内容告诉我", { hasExcelContext: true }),
    { operation: "read_cell", sheetName: "2", cell: "B40" }
  )
  assert.deepEqual(
    buildExcelToolParams("希洛告诉我 简化卡 tab里面b40的内容告诉我", { hasExcelContext: true }),
    { operation: "read_cell", sheetName: "简化卡", cell: "B40" }
  )
})

test("parses cell, range, sheet list and group-file list requests", () => {
  assert.deepEqual(
    buildExcelToolParams("查群文件预算.xlsx里预算表这个tab的C12"),
    { operation: "read_cell", sheetName: "预算表", cell: "C12", fileName: "预算.xlsx" }
  )
  assert.deepEqual(
    buildExcelToolParams("读取明细工作表的 A1:D10"),
    { operation: "read_range", sheetName: "明细", range: "A1:D10" }
  )
  assert.deepEqual(buildExcelToolParams("这个 Excel 有哪些 tab"), { operation: "list_sheets" })
  assert.deepEqual(buildExcelToolParams("群文件里有哪些 Excel"), { operation: "list_group_excels" })
})

test("does not steal ordinary non-Excel chat", () => {
  assert.equal(buildExcelToolParams("第二个方案感觉怎么样"), null)
  assert.equal(extractExcelSearchQuery("普通聊天"), "")
  assert.deepEqual(getExcelRelatedTerms("普通关键词"), [])
  assert.equal(shouldBypassMergeForExcel("第二个方案感觉怎么样"), false)
  assert.equal(shouldBypassMergeForExcel("第二个 tab 里找跟 .st 有关的内容"), true)
})

test("does not treat standards and model identifiers as bare Excel cells", () => {
  for (const text of [
    "希洛希洛根据现行国标GB14887中红灯和绿灯对应波长范围是多少呢，若要让红灯光蓝移到蓝灯光，需要达到多少速度呢",
    "GB/T 14887 的现行版本是什么",
    "ISO9001 有哪些要求",
    "A320和B52有什么区别",
    "Q345是什么材料",
    "stable版本的A320兼容性怎么样"
  ]) {
    assert.equal(buildExcelToolParams(text), null, text)
    assert.equal(shouldUseExcelWorkbookTool(text), false, text)
  }
})

test("only actual spreadsheet files establish workbook context", () => {
  assert.equal(hasExcelWorkbookContext({ text: "[文件:说明书.pdf]" }), false)
  assert.equal(hasExcelWorkbookContext({ text: "[文件:预算.xlsx]" }), true)
  assert.equal(hasExcelWorkbookContext({ media: [{ type: "file", fileName: "数据.xlsm" }] }), true)
  assert.equal(hasExcelWorkbookContext({ media: [{ type: "file", fileName: "国标GB14887.pdf" }] }), false)
  assert.equal(hasExcelWorkbookContext({ media: [{ type: "image", source: "https://example.com/a.xlsx" }] }), false)
})

test("requires workbook context or explicit Excel wording for A1 addresses", () => {
  assert.equal(buildExcelToolParams("查一下 B40"), null)
  assert.equal(buildExcelToolParams("A1:D10"), null)
  assert.deepEqual(
    buildExcelToolParams("查一下 B40", { hasExcelContext: true }),
    { operation: "read_cell", sheetName: undefined, cell: "B40" }
  )
  assert.deepEqual(
    buildExcelToolParams("读取表格里的 GB14887"),
    { operation: "read_cell", sheetName: undefined, cell: "GB14887" }
  )
  assert.deepEqual(
    buildExcelToolParams("GB14887", { hasExcelContext: true }),
    { operation: "read_cell", sheetName: undefined, cell: "GB14887" }
  )
})

test("offers the Excel tool for open-ended natural language and leaves parameters to the model", () => {
  const text = "希洛看一下附近的单元格，有没有一个是 尚虹叙 开头的，告诉我单元格是多少"
  assert.equal(buildExcelToolParams(text, { hasExcelContext: true }), null)
  assert.equal(shouldUseExcelWorkbookTool(text, { hasExcelContext: true }), true)
  assert.equal(shouldBypassMergeForExcel(text, { hasExcelContext: true }), true)
})
