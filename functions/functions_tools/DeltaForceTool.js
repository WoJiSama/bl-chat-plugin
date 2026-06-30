import fs from "fs"
import path from "path"
import yaml from "js-yaml"
import { AbstractTool } from "./AbstractTool.js"
import {
  buildObjectValueReportData,
  buildPlaceProfitReportData,
  buildProfitRankReportData,
  buildSolutionListReportData,
  DeltaForceClient,
  formatDailyKeywordResponse,
  formatObjectValueSearchResponse,
  formatPlaceProfitResponse,
  formatProfitRankResponse,
  formatSolutionListResponse,
  getDeltaForceHelp,
  getDeltaForcePlaceHelp,
  normalizeDeltaForcePlace,
  normalizeRankLimit
} from "../../utils/DeltaForceClient.js"
import { DeltaForceObjectCache } from "../../utils/DeltaForceObjectCache.js"
import { renderDeltaForceReport } from "../../utils/DeltaForceReportRenderer.js"

let objectCache = null

function readPluginSettings() {
  const root = process.cwd()
  const candidates = [
    path.join(root, "plugins/bl-chat-plugin/config/message.yaml"),
    path.join(root, "config/message.yaml"),
    path.join(root, "plugins/bl-chat-plugin/config_default/message.yaml"),
    path.join(root, "config_default/message.yaml")
  ]
  const configPath = candidates.find(file => fs.existsSync(file))
  if (!configPath) return {}
  return yaml.load(fs.readFileSync(configPath, "utf8"))?.pluginSettings || {}
}

async function getObjectCache(settings) {
  const client = new DeltaForceClient(settings)
  if (!client.config.objectCacheEnabled) return null

  if (!objectCache) objectCache = new DeltaForceObjectCache()
  objectCache.startAutoRefresh(client, client.config.objectCacheRefreshMinutes)

  try {
    await objectCache.refresh(client)
  } catch (err) {
    globalThis.logger?.warn?.(`[三角洲物品缓存] 更新失败: ${err.message}`)
  }

  return objectCache
}

function normalizeOperation(value = "") {
  const text = String(value || "").trim().toLowerCase()
  const aliases = {
    help: "help",
    daily_keyword: "daily_keyword",
    daily: "daily_keyword",
    keyword: "daily_keyword",
    password: "daily_keyword",
    object_value: "object_value",
    value: "object_value",
    price: "object_value",
    solution_list: "solution_list",
    solution: "solution_list",
    gun_code: "solution_list",
    place_profit: "place_profit",
    manufacture_profit: "place_profit",
    profit_rank: "profit_rank",
    rank: "profit_rank"
  }
  return aliases[text] || text
}

function wantsTextOutput(opts = {}) {
  const value = String(opts.output || opts.format || "").trim().toLowerCase()
  if (["text", "plain", "文字", "文本"].includes(value)) return true
  const prompt = String(opts.prompt || opts.userText || "").trim()
  return /(?:用|发|给).{0,6}(?:文字|文本)|不要(?:发)?图|别(?:发)?图|纯文字/.test(prompt)
}

async function replyReportImage(e, report, fallbackText) {
  try {
    const image = await renderDeltaForceReport(e, report)
    if (image && e?.reply) {
      await e.reply(image)
      return "已按三角洲命令格式发送图片报表"
    }
  } catch (err) {
    globalThis.logger?.warn?.(`[三角洲行动工具] 图片渲染失败: ${err.message}`)
  }
  if (e?.reply) {
    await e.reply(fallbackText)
    return "图片报表生成失败，已改发文字结果"
  }
  return fallbackText
}

async function replyText(e, text, status = "已发送三角洲文字结果") {
  if (e?.reply) {
    await e.reply(text)
    return status
  }
  return text
}

export class DeltaForceTool extends AbstractTool {
  constructor() {
    super()
    this.name = "deltaForceTool"
    this.description = [
      "三角洲行动第三方 API 工具。",
      "用户自然语言询问三角洲今日密码、每日密码、物品价格/物品价值、改枪码/改枪方案、特勤处制造利润、利润排行时调用。",
      "优先根据强关键词选择子功能：改枪码/改枪方案=solution_list，物品价格/价值=object_value，特勤处/制造利润=place_profit，利润排行=profit_rank，今日/每日密码=daily_keyword。",
      "例如“今天的三角洲改枪码，和277有关”应调用 solution_list 且 keyword=277；不要因为“今天的”误选 daily_keyword。",
      "不要用于普通聊天或非三角洲行动游戏内容。"
    ].join("")
    this.parameters = {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "操作类型：help 帮助；daily_keyword 今日/每日密码；object_value 物品价值/价格搜索；solution_list 改枪码/改枪方案；place_profit 特勤处/制造利润总览；profit_rank 利润排行。",
          enum: ["help", "daily_keyword", "object_value", "solution_list", "place_profit", "profit_rank"]
        },
        keyword: {
          type: "string",
          description: "物品价值搜索或改枪方案搜索关键词。例如 H70、M4A1、某个物品名。operation 为 object_value 时通常必填；solution_list 可选。"
        },
        place: {
          type: "string",
          description: "制作场所，可填：工作台、技术中心、制药台、防具台。仅 place_profit/profit_rank 使用，可不填表示全部。"
        },
        limit: {
          type: "number",
          description: "返回数量，默认 10，最多 20。"
        },
        output: {
          type: "string",
          description: "输出格式。默认 image，保持和 .三角洲 命令一致发送图片报表；用户明确要求文字时填 text。",
          enum: ["image", "text"]
        },
        prompt: {
          type: "string",
          description: "用户原话，可用于判断是否明确要求纯文字。"
        }
      },
      required: ["operation"],
      additionalProperties: false
    }
  }

  async func(opts = {}, e = null) {
    const operation = normalizeOperation(opts.operation)
    const keyword = String(opts.keyword || "").trim()
    const limit = normalizeRankLimit(opts.limit)
    const placeText = String(opts.place || "").trim()
    const place = placeText ? normalizeDeltaForcePlace(placeText) : null
    const textOutput = wantsTextOutput(opts)

    if (placeText && !place) {
      return `不支持这个制作场所：「${placeText}」\n${getDeltaForcePlaceHelp()}`
    }

    if (operation === "help") return replyText(e, getDeltaForceHelp())

    const settings = readPluginSettings()
    const client = new DeltaForceClient(settings)

    if (operation === "daily_keyword") {
      const result = await client.getDailyKeyword()
      return replyText(e, formatDailyKeywordResponse(result))
    }

    if (operation === "object_value") {
      if (!keyword) return replyText(e, "请告诉我要查哪个三角洲物品的价值，比如 H70 或物品名。", "缺少三角洲物品关键词")
      const result = await client.searchObjectValue({ keyword, limit })
      const text = formatObjectValueSearchResponse(result, { keyword, limit })
      if (textOutput) return replyText(e, text)
      return replyReportImage(e, buildObjectValueReportData(result, { keyword, limit }), text)
    }

    if (operation === "solution_list") {
      const result = await client.getSolutionList({ keyword, limit })
      const text = formatSolutionListResponse(result, { keyword, limit })
      if (textOutput) return replyText(e, text)
      return replyReportImage(e, buildSolutionListReportData(result, { keyword, limit }), text)
    }

    if (operation === "place_profit") {
      const cache = await getObjectCache(settings)
      const result = await client.getPlaceProfit()
      const options = {
        placeType: place?.type || "",
        limit,
        objectNameResolver: cache
      }
      const text = formatPlaceProfitResponse(result, options)
      if (textOutput) return replyText(e, text)
      return replyReportImage(e, buildPlaceProfitReportData(result, options), text)
    }

    if (operation === "profit_rank") {
      const cache = await getObjectCache(settings)
      const result = await client.getPlaceProfitRank({ placeType: place?.type || "", limit })
      const options = {
        placeType: place?.type || "",
        limit,
        objectNameResolver: cache
      }
      const text = formatProfitRankResponse(result, options)
      if (textOutput) return replyText(e, text)
      return replyReportImage(e, buildProfitRankReportData(result, options), text)
    }

    return replyText(e, `没认出要查三角洲的哪一项。\n${getDeltaForceHelp()}`, "未识别三角洲操作")
  }
}
