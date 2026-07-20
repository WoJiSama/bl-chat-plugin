import test from "node:test"
import assert from "node:assert/strict"
import { ModrinthTool } from "../functions/functions_tools/ModrinthTool.js"
import {
  buildModrinthForwardItemsFromData,
  buildModrinthBilingualReplyInstruction,
  buildModrinthCardItemsFromData,
  buildModrinthRankingData,
  buildModrinthTranslationMessages,
  buildModrinthSearchUrl,
  cacheModrinthTranslations,
  collectModrinthTranslations,
  extractModrinthForwardItems,
  formatModrinthRanking,
  ModrinthTranslationCache,
  normalizeModrinthRankOptions,
  parseModrinthRankingData,
  parseModrinthRequestOptions,
  parseModrinthTranslationResponse,
  shouldKeepModrinthReplyAsText,
  stripModrinthForwardMarkers,
  wrapModrinthForwardItems
} from "../utils/modrinth.js"

const payload = {
  total_hits: 2,
  hits: [
    {
      project_id: "AANobbMI",
      slug: "sodium",
      title: "Sodium",
      author: "jellysquid3",
      description: "A high-performance rendering engine replacement for Minecraft.",
      downloads: 188475508,
      follows: 38830,
      categories: ["fabric", "optimization"],
      versions: ["1.20.1", "1.21.1"],
      client_side: "required",
      server_side: "unsupported",
      date_created: "2024-01-02T03:04:05Z",
      date_modified: "2025-06-07T08:09:10Z",
      license: "MIT",
      icon_url: "https://cdn.modrinth.com/sodium.webp"
    },
    {
      project_id: "YL57xq9U",
      slug: "iris",
      title: "Iris Shaders",
      author: "coderbot",
      description: "A modern shader pack loader compatible with existing OptiFine shader packs.",
      downloads: 146761192,
      follows: 27945,
      categories: ["fabric", "optimization"]
    }
  ]
}

test("builds a public Modrinth search URL with version, loader and category facets", () => {
  const url = new URL(buildModrinthSearchUrl({
    sort: "downloads",
    limit: 5,
    gameVersion: "1.21.1",
    loader: "fabric",
    category: "optimization"
  }))
  assert.equal(url.origin, "https://api.modrinth.com")
  assert.equal(url.pathname, "/v2/search")
  assert.equal(url.searchParams.get("index"), "downloads")
  assert.equal(url.searchParams.get("limit"), "5")
  assert.deepEqual(JSON.parse(url.searchParams.get("facets")), [
    ["project_type:mod"],
    ["versions:1.21.1"],
    ["categories:fabric"],
    ["categories:optimization"]
  ])
})

test("validates ranking options and bounds result count", () => {
  assert.equal(normalizeModrinthRankOptions({ limit: 99 }).limit, 10)
  assert.deepEqual(
    normalizeModrinthRankOptions({ sort: "recently_updated", category: "魔法", limit: 5 }),
    { sort: "updated", loader: "", category: "magic", gameVersion: "", query: "", limit: 5 }
  )
  assert.throws(() => normalizeModrinthRankOptions({ loader: "paper" }), /不支持的加载器/)
  assert.throws(() => normalizeModrinthRankOptions({ category: "optimization;drop" }), /分类格式/)
})

test("parses explicit Modrinth rankings without a planner model", () => {
  assert.deepEqual(
    parseModrinthRequestOptions("希洛查一下 Modrinth 1.21.1 Fabric 下载量前五的优化模组"),
    { sort: "downloads", limit: 5, gameVersion: "1.21.1", loader: "fabric", category: "optimization", query: "" }
  )
  assert.deepEqual(
    parseModrinthRequestOptions("MC模组按关注数排行前10"),
    { sort: "follows", limit: 10, gameVersion: "", loader: "", category: "", query: "" }
  )
  assert.deepEqual(
    parseModrinthRequestOptions("希洛，告诉我Modrinth 最近更新的魔法模组前五"),
    { sort: "updated", limit: 5, gameVersion: "", loader: "", category: "magic", query: "" }
  )
  assert.equal(parseModrinthRequestOptions("帮我看看 https://modrinth.com/mod/sodium 这个链接"), null)
  assert.equal(parseModrinthRequestOptions("最近在玩 Minecraft"), null)
})

test("formats verifiable English source descriptions without inventing translations", () => {
  const result = formatModrinthRanking(payload, { gameVersion: "1.21.1", loader: "fabric", sort: "downloads" })
  assert.match(result, /【Modrinth 模组排名】/)
  assert.match(result, /#1 Sodium/)
  assert.match(result, /下载: 188,475,508/)
  assert.match(result, /英文简介: A high-performance rendering engine replacement for Minecraft\./)
  assert.match(result, /https:\/\/modrinth\.com\/mod\/sodium/)
  assert.doesNotMatch(result, /中文翻译/)
})

test("tool queries Modrinth once and reuses the bounded in-memory cache", async () => {
  let calls = 0
  const tool = new ModrinthTool({
    cache: new Map(),
    cacheTtlMs: 60_000,
    fetchImpl: async url => {
      calls += 1
      assert.match(String(url), /api\.modrinth\.com\/v2\/search/)
      return { ok: true, async json() { return payload } }
    }
  })

  const first = await tool.func({ gameVersion: "1.21.1", loader: "fabric", limit: 2 })
  const second = await tool.func({ gameVersion: "1.21.1", loader: "fabric", limit: 2 })
  assert.equal(calls, 1)
  assert.equal(first.kind, "modrinth_ranking")
  assert.equal(first.items[0].descriptionEn, payload.hits[0].description)
  assert.deepEqual(first.items[0].gameVersions, ["1.20.1", "1.21.1"])
  assert.equal(first.items[0].clientSide, "required")
  assert.deepEqual(second, first)
})

test("Modrinth networking accepts a scoped IPv4 dispatcher", async () => {
  const dispatcher = { name: "ipv4" }
  let requestOptions
  const client = new (await import("../utils/modrinth.js")).ModrinthClient({
    fetchImpl: async (url, options) => {
      requestOptions = options
      return { ok: true, async json() { return payload } }
    },
    useIpv4Dispatcher: true,
    dispatcherFactory: async () => dispatcher
  })
  await client.search({ limit: 1 })
  assert.equal(requestOptions.dispatcher, dispatcher)
})

test("Modrinth networking falls back to the default path after an IPv4 transport failure", async () => {
  const dispatcher = { name: "ipv4" }
  const attempts = []
  const { ModrinthClient } = await import("../utils/modrinth.js")
  const client = new ModrinthClient({
    fetchImpl: async (url, options) => {
      attempts.push(options.dispatcher || null)
      if (options.dispatcher) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ETIMEDOUT" } })
      return { ok: true, async json() { return payload } }
    },
    useIpv4Dispatcher: true,
    dispatcherFactory: async () => dispatcher
  })
  await client.search({ limit: 1 })
  assert.deepEqual(attempts, [dispatcher, null])
})

test("the final reply instruction requires bilingual output while preserving source boundaries", () => {
  const instruction = buildModrinthBilingualReplyInstruction()
  assert.match(instruction, /英文简介/)
  assert.match(instruction, /中文翻译（希洛）/)
  assert.match(instruction, /排名、名称、作者、下载、关注、标签、英文简介、中文翻译（希洛）、项目页/)
  assert.match(instruction, /排名: 第 1 名/)
  assert.doesNotMatch(instruction, /第 N 名/)
  assert.match(instruction, /每个模组各占一个独立聊天节点/)
  assert.match(instruction, /\[\[MODRINTH_ITEM\]\]/)
  assert.match(instruction, /HTML 卡面/)
  assert.match(instruction, /不得添加官网没有写出的功能/)
})

test("builds a compact Modrinth-only translation request without group history or tools", () => {
  const messages = buildModrinthTranslationMessages([
    { projectId: "AANobbMI", en: "A high-performance rendering engine replacement for Minecraft." }
  ])
  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, "system")
  assert.equal(messages[1].role, "user")
  assert.match(messages[0].content, /只输出严格 JSON 数组/)
  assert.match(messages[1].content, /AANobbMI/)
  assert.doesNotMatch(messages[1].content, /下载|关注|作者|项目页/)
  assert.doesNotMatch(messages[1].content, /当前群聊上下文|人设/)
})

test("merges translation-only JSON with authoritative Modrinth fields", () => {
  const ranking = buildModrinthRankingData(payload, { sort: "downloads", limit: 2 })
  const translated = parseModrinthTranslationResponse(JSON.stringify([
    { projectId: "AANobbMI", zh: "Minecraft 的高性能渲染引擎替代品。" },
    { projectId: "YL57xq9U", zh: "兼容现有 OptiFine 光影包的现代光影加载器。" }
  ]), ["AANobbMI", "YL57xq9U"])
  assert.ok(translated instanceof Map)
  const items = buildModrinthForwardItemsFromData(parseModrinthRankingData(JSON.stringify(ranking)), translated)
  assert.equal(items.length, 2)
  assert.match(items[0], /排名: 第 1 名/)
  assert.match(items[0], /下载: 188,475,508/)
  assert.match(items[0], /关注: 38,830/)
  assert.match(items[0], /中文翻译（希洛）: Minecraft 的高性能渲染引擎替代品。/)
  assert.equal(extractModrinthForwardItems(wrapModrinthForwardItems(items)).length, 2)
})

test("builds one deterministic HTML-card payload per authoritative Modrinth item", () => {
  const ranking = buildModrinthRankingData(payload, { limit: 2 })
  const cards = buildModrinthCardItemsFromData(ranking, new Map([
    ["AANobbMI", "Minecraft 的高性能渲染引擎替代品。"],
    ["YL57xq9U", "兼容现有 OptiFine 光影包的现代光影加载器。"]
  ]))
  assert.equal(cards.length, 2)
  assert.equal(cards[0].pageUrl, "https://modrinth.com/mod/sodium")
  assert.equal(cards[0].view.iconUrl, "https://cdn.modrinth.com/sodium.webp")
  assert.equal(cards[0].view.versionsText, "1.20.1 · 1.21.1")
  assert.equal(cards[0].view.clientSide, "必需")
  assert.equal(cards[0].view.serverSide, "不适用")
  assert.match(cards[0].fallbackText, /创建时间: 2024-01-02/)
  assert.doesNotMatch(cards[0].fallbackText, /项目页:/)
})

test("caches translations by English description and only sends misses to the model", () => {
  const ranking = buildModrinthRankingData(payload, { limit: 2 })
  const cache = new ModrinthTranslationCache({ ttlMs: 60_000, maxEntries: 16 })
  let state = collectModrinthTranslations(ranking, cache)
  assert.equal(state.cached.size, 0)
  assert.equal(state.missing.length, 2)
  const translated = new Map([
    ["AANobbMI", "高性能渲染引擎。"],
    ["YL57xq9U", "现代光影加载器。"]
  ])
  cacheModrinthTranslations(ranking, translated, cache)
  state = collectModrinthTranslations(ranking, cache)
  assert.equal(state.cached.size, 2)
  assert.equal(state.missing.length, 0)
})

test("rejects incomplete or mismatched translation mappings", () => {
  assert.equal(parseModrinthTranslationResponse('[{"projectId":"AANobbMI","zh":"译文"}]', ["AANobbMI", "YL57xq9U"]), null)
  assert.equal(parseModrinthTranslationResponse('[{"projectId":"wrong","zh":"译文"}]', ["AANobbMI"]), null)
  assert.equal(parseModrinthTranslationResponse("not json", ["AANobbMI"]), null)
})

test("does not route Modrinth rankings through the generic text-image policy", () => {
  assert.equal(shouldKeepModrinthReplyAsText("modrinthTool", "查一下热门模组前五"), false)
  assert.equal(shouldKeepModrinthReplyAsText("modrinthTool", "把热门模组前五转成图片"), false)
  assert.equal(shouldKeepModrinthReplyAsText("searchInformationTool", "查一下热门模组前五"), false)
})

test("extracts complete Modrinth item blocks and drops any model-added summary", () => {
  const reply = [
    "[[MODRINTH_ITEM]]",
    "第 1 名: Sodium",
    "名称: Sodium",
    "作者: jellysquid3",
    "下载: 188,475,508",
    "关注: 38,830",
    "标签: fabric, optimization",
    "英文简介: A high-performance renderer.",
    "中文翻译（希洛）: 高性能渲染器。",
    "项目页: https://modrinth.com/mod/sodium",
    "[[/MODRINTH_ITEM]]",
    "看起来基本都是优化类，准备装哪个？"
  ].join("\n")
  const items = extractModrinthForwardItems(reply)
  assert.deepEqual(items, [
    [
      "第 1 名: Sodium",
      "名称: Sodium",
      "作者: jellysquid3",
      "下载: 188,475,508",
      "关注: 38,830",
      "标签: fabric, optimization",
      "英文简介: A high-performance renderer.",
      "中文翻译（希洛）: 高性能渲染器。",
      "项目页: https://modrinth.com/mod/sodium"
    ].join("\n")
  ])
  assert.equal(stripModrinthForwardMarkers(reply).includes("[[MODRINTH_ITEM]]"), false)
})

test("normalizes an old placeholder rank into a valid merged-forward item", () => {
  const reply = [
    "[[MODRINTH_ITEM]]",
    "第 N 名: 5",
    "名称: Entity Culling",
    "作者: tr7zw",
    "下载: 137,276,815",
    "关注: 16,459",
    "标签: fabric, optimization",
    "英文简介: Using async path-tracing to hide Block-/Entities that are not visible",
    "中文翻译（希洛）: 使用异步路径追踪隐藏不可见的方块/实体。",
    "项目页: https://modrinth.com/mod/entityculling",
    "[[/MODRINTH_ITEM]]"
  ].join("\n")
  assert.deepEqual(extractModrinthForwardItems(reply), [[
    "排名: 第 5 名",
    "名称: Entity Culling",
    "作者: tr7zw",
    "下载: 137,276,815",
    "关注: 16,459",
    "标签: fabric, optimization",
    "英文简介: Using async path-tracing to hide Block-/Entities that are not visible",
    "中文翻译（希洛）: 使用异步路径追踪隐藏不可见的方块/实体。",
    "项目页: https://modrinth.com/mod/entityculling"
  ].join("\n")])
})
