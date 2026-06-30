import fs from "fs"
import path from "path"
import yaml from "js-yaml"
import { AbstractTool } from "./AbstractTool.js"
import {
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

export class DeltaForceTool extends AbstractTool {
  constructor() {
    super()
    this.name = "deltaForceTool"
    this.description = [
      "三角洲行动第三方 API 工具。",
      "用户自然语言询问三角洲今日密码、每日密码、物品价格/物品价值、改枪码/改枪方案、特勤处制造利润、利润排行时调用。",
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
        }
      },
      required: ["operation"],
      additionalProperties: false
    }
  }

  async func(opts = {}) {
    const operation = normalizeOperation(opts.operation)
    const keyword = String(opts.keyword || "").trim()
    const limit = normalizeRankLimit(opts.limit)
    const placeText = String(opts.place || "").trim()
    const place = placeText ? normalizeDeltaForcePlace(placeText) : null

    if (placeText && !place) {
      return `不支持这个制作场所：「${placeText}」\n${getDeltaForcePlaceHelp()}`
    }

    if (operation === "help") return getDeltaForceHelp()

    const settings = readPluginSettings()
    const client = new DeltaForceClient(settings)

    if (operation === "daily_keyword") {
      const result = await client.getDailyKeyword()
      return formatDailyKeywordResponse(result)
    }

    if (operation === "object_value") {
      if (!keyword) return "请告诉我要查哪个三角洲物品的价值，比如 H70 或物品名。"
      const result = await client.searchObjectValue({ keyword, limit })
      return formatObjectValueSearchResponse(result, { keyword, limit })
    }

    if (operation === "solution_list") {
      const result = await client.getSolutionList({ keyword, limit })
      return formatSolutionListResponse(result, { keyword, limit })
    }

    if (operation === "place_profit") {
      const cache = await getObjectCache(settings)
      const result = await client.getPlaceProfit()
      return formatPlaceProfitResponse(result, {
        placeType: place?.type || "",
        limit,
        objectNameResolver: cache
      })
    }

    if (operation === "profit_rank") {
      const cache = await getObjectCache(settings)
      const result = await client.getPlaceProfitRank({ placeType: place?.type || "", limit })
      return formatProfitRankResponse(result, {
        placeType: place?.type || "",
        limit,
        objectNameResolver: cache
      })
    }

    return `没认出要查三角洲的哪一项。\n${getDeltaForceHelp()}`
  }
}
