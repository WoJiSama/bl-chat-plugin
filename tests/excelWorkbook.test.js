import test from "node:test"
import assert from "node:assert/strict"
import ExcelJS from "exceljs"
import {
  findInExcelWorkbook,
  listExcelWorksheets,
  loadExcelWorkbook,
  normalizeExcelCellAddress,
  readExcelCell,
  readExcelRange
} from "../utils/excelWorkbook.js"
import { downloadExcelBuffer, listGroupExcelFiles, resolveExcelFileContext } from "../utils/excelFileContext.js"
import { ExcelWorkbookTool } from "../functions/functions_tools/ExcelWorkbookTool.js"

async function createFixtureBuffer() {
  const workbook = new ExcelJS.Workbook()
  const budget = workbook.addWorksheet("预算表")
  budget.getCell("A1").value = "项目"
  budget.getCell("B1").value = "结果"
  budget.getCell("A2").value = "向量点积"
  budget.getCell("B2").value = { formula: "SUMPRODUCT({3,7},{4,6})", result: 54 }
  budget.getCell("B2").numFmt = "0.00"
  budget.getCell("A3").value = "等待重算"
  budget.getCell("B3").value = { formula: "1+2" }
  budget.mergeCells("A4:B4")
  budget.getCell("A4").value = "合并标题"

  const detail = workbook.addWorksheet("明细")
  detail.getCell("A1").value = "订单号"
  detail.getCell("B1").value = "金额"
  detail.getCell("A2").value = "20260715"
  detail.getCell("B2").value = 88
  detail.getCell("C2").value = { formula: "B2*2", result: 176 }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

test("reads sheet names and preserves a cell formula, cached value and display value", async () => {
  const workbook = await loadExcelWorkbook(await createFixtureBuffer())
  assert.deepEqual(listExcelWorksheets(workbook).map(sheet => sheet.name), ["预算表", "明细"])

  const result = readExcelCell(workbook, { sheetName: "预算表", address: "$b$2" })
  assert.equal(result.sheetName, "预算表")
  assert.equal(result.cell.address, "B2")
  assert.equal(result.cell.formula, "=SUMPRODUCT({3,7},{4,6})")
  assert.equal(result.cell.value, 54)
  assert.equal(result.cell.displayValue, "54")
  assert.equal(result.cell.hasCachedValue, true)
})

test("reports formulas without a saved cached result instead of inventing a value", async () => {
  const workbook = await loadExcelWorkbook(await createFixtureBuffer())
  const result = readExcelCell(workbook, { sheetName: "预算表", address: "B3" })
  assert.equal(result.cell.formula, "=1+2")
  assert.equal(result.cell.value, null)
  assert.equal(result.cell.hasCachedValue, false)
})

test("reads small ranges, resolves merged cells and rejects oversized ranges", async () => {
  const workbook = await loadExcelWorkbook(await createFixtureBuffer())
  const result = readExcelRange(workbook, { sheetName: "预算表", range: "A4:B4" })
  assert.equal(result.cellCount, 2)
  assert.equal(result.rows[0][1].merged, true)
  assert.equal(result.rows[0][1].sourceAddress, "A4")
  assert.equal(result.rows[0][1].value, "合并标题")
  assert.throws(() => readExcelRange(workbook, { sheetName: "预算表", range: "A1:Z99", maxCells: 300 }), /超过单次上限/)
})

test("finds values and formulas inside a selected tab", async () => {
  const workbook = await loadExcelWorkbook(await createFixtureBuffer())
  const byValue = findInExcelWorkbook(workbook, { sheetName: "明细", query: "20260715" })
  assert.equal(byValue.matches.length, 1)
  assert.equal(byValue.matches[0].address, "A2")

  const byFormula = findInExcelWorkbook(workbook, { sheetName: "明细", query: "B2*2", searchIn: "formula" })
  assert.equal(byFormula.matches.length, 1)
  assert.equal(byFormula.matches[0].formula, "=B2*2")
})

test("finds prefix matches inside a bounded neighborhood and returns the exact address", async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("名单")
  sheet.getCell("B39").value = "尚虹叙项目组"
  sheet.getCell("C41").value = "前缀尚虹叙不算"
  sheet.getCell("G60").value = "尚虹叙远处记录"

  const result = findInExcelWorkbook(workbook, {
    sheetName: "名单",
    query: "尚虹叙",
    matchMode: "starts_with",
    anchorCell: "B40",
    rowRadius: 3,
    columnRadius: 2
  })

  assert.equal(result.matchMode, "starts_with")
  assert.equal(result.scope, "A37:D43")
  assert.deepEqual(result.matches.map(match => match.address), ["B39"])
})

test("supports worksheet ordinals, related-term search and merged-cell deduplication", async () => {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet("附表").getCell("A1").value = "隐藏数据"
  const sheet = workbook.addWorksheet("人物卡")
  sheet.mergeCells("A1:C1")
  sheet.getCell("A1").value = "属性"
  sheet.getCell("A2").value = "力量\nSTR"
  sheet.getCell("B2").value = 50
  sheet.getCell("A3").value = { formula: "B2*2", result: 100 }
  const loaded = await loadExcelWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()))

  const result = findInExcelWorkbook(loaded, {
    sheetName: "2",
    query: ".st",
    relatedTerms: ["属性", "STR", "技能"]
  })
  assert.equal(result.exactMatchCount, 0)
  assert.equal(result.matches[0].sheetName, "人物卡")
  assert.equal(new Set(result.matches.map(match => match.sourceAddress)).size, result.matches.length)
  assert.ok(result.matches.some(match => match.address === "A1" && match.matchedTerms.includes("属性")))
  assert.ok(result.matches.some(match => match.address === "A2" && match.matchedTerms.includes("STR")))
  assert.ok(result.matches.every(match => match.displayValue !== "[object Object]"))
})

test("normalizes addresses and rejects invalid Excel coordinates", () => {
  assert.equal(normalizeExcelCellAddress("$c$12"), "C12")
  assert.throws(() => normalizeExcelCellAddress("XFE1"), /超出 Excel 范围/)
  assert.throws(() => normalizeExcelCellAddress("A0"), /无效/)
})

test("resolves current, quoted and recent Excel files without persisting them", async () => {
  const current = await resolveExcelFileContext({
    user_id: 1,
    message: [{ type: "file", name: "当前.xlsx", url: "https://files.example/current.xlsx" }]
  })
  assert.deepEqual(current, {
    fileUrl: "https://files.example/current.xlsx",
    fileName: "当前.xlsx",
    origin: "current"
  })

  const quoted = await resolveExcelFileContext({
    group_id: 2,
    user_id: 1,
    async getReply() {
      return { message: [{ type: "file", name: "引用.xlsm", fid: "quoted-id" }] }
    },
    group: {
      async getFileUrl(fid) {
        assert.equal(fid, "quoted-id")
        return "https://files.example/quoted.xlsm"
      }
    }
  })
  assert.equal(quoted.fileUrl, "https://files.example/quoted.xlsm")
  assert.equal(quoted.origin, "reply")

  const recent = await resolveExcelFileContext({
    group_id: 2,
    user_id: 1,
    bot: {
      async sendApi(name, payload) {
        if (name === "get_group_msg_history") {
          return { data: { messages: [{
            time: Math.floor(Date.now() / 1000),
            sender: { user_id: 1 },
            message: [{ type: "file", data: { name: "最近.xlsx", file_id: "recent-id" } }]
          }] } }
        }
        assert.equal(name, "get_group_file_url")
        assert.equal(payload.file_id, "recent-id")
        return { data: { url: "https://files.example/recent.xlsx" } }
      }
    }
  })
  assert.equal(recent.fileName, "最近.xlsx")
  assert.equal(recent.origin, "recent")
})

test("refreshes QQ file ids before falling back to possibly expired segment URLs", async () => {
  const result = await resolveExcelFileContext({
    group_id: 2,
    user_id: 1,
    message: [{
      type: "file",
      name: "刷新.xlsx",
      url: "https://files.example/expired.xlsx",
      fid: "fresh-id"
    }],
    group: {
      async getFileUrl(fid) {
        assert.equal(fid, "fresh-id")
        return "https://files.example/fresh.xlsx"
      }
    }
  })
  assert.equal(result.fileUrl, "https://files.example/fresh.xlsx")
})

function createGroupFileEvent({ duplicate = false } = {}) {
  const calls = []
  const e = {
    group_id: 9527,
    user_id: 1,
    bot: {
      async sendApi(name, payload) {
        calls.push({ name, payload })
        if (name === "get_group_msg_history") return { data: { messages: [] } }
        if (name === "get_group_root_files") {
          return { data: {
            files: [{ file_id: "root-file", file_name: "总表.xlsx", busid: 10, file_size: 123 }],
            folders: [
              { folder_id: "finance", folder_name: "财务" },
              ...(duplicate ? [{ folder_id: "archive", folder_name: "归档" }] : [])
            ]
          } }
        }
        if (name === "get_group_files_by_folder" && payload.folder_id === "finance") {
          return { data: {
            files: [{ file_id: "budget", file_name: "预算.xlsx", busid: 20, file_size: 456, uploader_name: "管理员" }],
            folders: [{ folder_id: "year", folder_name: "2026" }]
          } }
        }
        if (name === "get_group_files_by_folder" && payload.folder_id === "year") {
          return { data: { files: [{ file_id: "detail", file_name: "明细.xlsm", busid: 30 }], folders: [] } }
        }
        if (name === "get_group_files_by_folder" && payload.folder_id === "archive") {
          return { data: { files: [{ file_id: "budget-old", file_name: "预算.xlsx", busid: 40 }], folders: [] } }
        }
        if (name === "get_group_file_url") {
          return { data: { url: `https://files.example/${payload.file_id}.xlsx` } }
        }
        throw new Error(`unexpected api ${name}`)
      }
    }
  }
  return { e, calls }
}

test("recursively lists Excel files in group root and nested folders", async () => {
  const { e } = createGroupFileEvent()
  const result = await listGroupExcelFiles(e)
  assert.deepEqual(result.files.map(file => file.fullPath), [
    "/总表.xlsx",
    "/财务/预算.xlsx",
    "/财务/2026/明细.xlsm"
  ])
  assert.equal(result.scannedFolders, 3)
  assert.equal(result.truncated, false)
})

test("resolves a named group-file workbook and passes busid when requesting its URL", async () => {
  const { e, calls } = createGroupFileEvent()
  const result = await resolveExcelFileContext(e, { fileName: "预算.xlsx", folderPath: "财务" })
  assert.equal(result.origin, "group_file")
  assert.equal(result.fullPath, "/财务/预算.xlsx")
  assert.equal(result.fileUrl, "https://files.example/budget.xlsx")
  const urlCall = calls.find(call => call.name === "get_group_file_url")
  assert.deepEqual(urlCall.payload, { group_id: 9527, file_id: "budget", busid: "20" })
})

test("does not silently choose between duplicate group-file workbook names", async () => {
  const { e } = createGroupFileEvent({ duplicate: true })
  await assert.rejects(
    () => resolveExcelFileContext(e, { fileName: "预算.xlsx" }),
    /多个同名 Excel.*财务\/预算.xlsx.*归档\/预算.xlsx/
  )
})

test("rejects legacy xls and private-network downloads", async () => {
  await assert.rejects(() => resolveExcelFileContext({
    message: [{ type: "file", name: "旧表.xls", url: "https://files.example/old.xls" }]
  }), /另存为 .xlsx/)
  await assert.rejects(() => downloadExcelBuffer("http://127.0.0.1/private.xlsx"), /内网地址/)
})

test("tool schema exposes workbook operations and formula/value semantics", () => {
  const tool = new ExcelWorkbookTool()
  assert.equal(tool.name, "excelWorkbookTool")
  assert.deepEqual(tool.parameters.properties.operation.enum, ["list_group_excels", "list_sheets", "read_cell", "read_range", "find"])
  assert.match(tool.description, /公式/)
  assert.match(tool.description, /计算值/)
  assert.match(tool.parameters.properties.sheetName.description, /序号/)
  assert.equal(tool.parameters.properties.relatedTerms.type, "array")
  assert.deepEqual(tool.parameters.properties.matchMode.enum, ["contains", "exact", "starts_with", "ends_with"])
  assert.match(tool.parameters.properties.anchorCell.description, /附近/)
})

test("tool can list group-file workbooks without downloading one", async () => {
  const tool = new ExcelWorkbookTool({
    listGroupFiles: async () => ({
      files: [{ fullPath: "/财务/预算.xlsx", size: 456, uploaderName: "管理员" }],
      totalExcelFiles: 1,
      scannedFolders: 2,
      truncated: false
    })
  })
  const result = await tool.func({ operation: "list_group_excels" }, { group_id: 9527 })
  assert.match(result, /群文件中的 Excel: 1 个/)
  assert.match(result, /\/财务\/预算.xlsx/)
})

test("tool returns the exact formula and cached value for the conversation model", async () => {
  const fixture = await createFixtureBuffer()
  const tool = new ExcelWorkbookTool({
    resolveFile: async () => ({ fileUrl: "https://files.example/fixture.xlsx", fileName: "向量.xlsx", origin: "current" }),
    downloadFile: async () => fixture
  })
  const result = await tool.func({ operation: "read_cell", sheetName: "预算表", cell: "B2" }, {})
  assert.match(result, /公式: =SUMPRODUCT\(\{3,7\},\{4,6\}\)/)
  assert.match(result, /值: 54/)
  assert.match(result, /工作表: 预算表/)
})

test("reuses a parsed workbook from the bounded in-memory cache", async () => {
  const fixture = await createFixtureBuffer()
  let downloads = 0
  const tool = new ExcelWorkbookTool({
    workbookCache: new Map(),
    cacheTtlMs: 60_000,
    resolveFile: async () => ({
      fileUrl: "https://files.example/cache.xlsx",
      fileName: "缓存.xlsx",
      fileId: "same-file-id",
      origin: "reply"
    }),
    downloadFile: async () => {
      downloads++
      return fixture
    }
  })
  const e = { group_id: 9527, user_id: 1 }
  await tool.func({ operation: "list_sheets" }, e)
  const result = await tool.func({ operation: "find", sheetName: "2", query: "20260715" }, e)
  assert.equal(downloads, 1)
  assert.match(result, /工作表: 明细/)
  assert.match(result, /单元格: A2/)
})

test("tool clearly separates an absent literal query from related matches", async () => {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet("附表")
  const sheet = workbook.addWorksheet("人物卡")
  sheet.getCell("A1").value = "属性"
  sheet.getCell("A2").value = "力量 STR"
  const fixture = Buffer.from(await workbook.xlsx.writeBuffer())
  const tool = new ExcelWorkbookTool({
    workbookCache: new Map(),
    resolveFile: async () => ({ fileUrl: "https://files.example/card.xlsx", fileName: "人物卡.xlsx", origin: "reply" }),
    downloadFile: async () => fixture
  })
  const result = await tool.func({
    operation: "find",
    sheetName: "2",
    query: ".st",
    relatedTerms: ["属性", "STR"]
  }, { group_id: 9527 })
  assert.match(result, /原词精确命中: 0/)
  assert.match(result, /工作簿中没有出现搜索原词/)
  assert.match(result, /命中:关联词/)
})

test("tool exposes neighborhood prefix search results without asking for a fixed sentence format", async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("名单")
  sheet.getCell("D8").value = "尚虹叙记录"
  const fixture = Buffer.from(await workbook.xlsx.writeBuffer())
  const tool = new ExcelWorkbookTool({
    workbookCache: new Map(),
    resolveFile: async () => ({ fileUrl: "https://files.example/names.xlsx", fileName: "名单.xlsx", origin: "reply" }),
    downloadFile: async () => fixture
  })
  const result = await tool.func({
    operation: "find",
    sheetName: "名单",
    query: "尚虹叙",
    matchMode: "starts_with",
    anchorCell: "D10",
    rowRadius: 3,
    columnRadius: 2
  }, { group_id: 9527 })
  assert.match(result, /匹配方式: 开头是/)
  assert.match(result, /搜索区域: B7:F13/)
  assert.match(result, /单元格: D8/)
})
