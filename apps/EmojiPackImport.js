import { emojiPackManager } from "../utils/EmojiPackManager.js"
import { TakeImages } from "../utils/fileUtils.js"
import common from "../../../lib/common/common.js"
import fs from "fs"
import path from "path"

async function fetchImageBuffer(url, timeoutMs = 15000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function sendForward(e, msgs, title = "表情包") {
  try {
    const forwardMsg = await common.makeForwardMsg(e, msgs, title)
    await e.reply(forwardMsg)
  } catch {
    await e.reply(msgs.join("\n"))
  }
}

export class EmojiPackPlugin extends plugin {
  constructor() {
    super({
      name: "表情包管理",
      dsc: "本地表情包库的导入/删除/打标管理",
      event: "message",
      priority: 500,
      rule: [
        { reg: "^#表情包导入$", fnc: "importEmoji", permission: "master" },
        { reg: "^#表情包列表(\\s+\\d+)?$", fnc: "listEmoji", permission: "master" },
        { reg: "^#表情包删除\\s+\\S+$", fnc: "deleteEmoji", permission: "master" },
        { reg: "^#表情包打标\\s+\\S+$", fnc: "retagEmoji", permission: "master" },
        { reg: "^#表情包重载$", fnc: "reloadEmoji", permission: "master" },
        { reg: "^#表情包统计$", fnc: "emojiStats", permission: "master" },
        { reg: "^#表情包预览\\s+\\S+$", fnc: "previewEmoji", permission: "master" },
        { reg: "^#表情包封禁\\s+\\S+$", fnc: "banEmoji", permission: "master" },
        { reg: "^#表情包解封\\s+\\S+$", fnc: "unbanEmoji", permission: "master" },
        { reg: "^#表情包巡检$", fnc: "runMaintenance", permission: "master" }
      ]
    })
  }

  async importEmoji(e) {
    emojiPackManager.refreshConfig()
    if (!emojiPackManager.config?.enabled) {
      return e.reply("表情包系统未启用，请先在 config/message.yaml 将 emojiSystem.enabled 设为 true")
    }

    const urls = await TakeImages(e)
    if (!urls?.length) return e.reply("请在消息中附带图片，或引用一张含图片的消息后再发送 #表情包导入")

    e.reply(`正在导入 ${urls.length} 张图片...`)

    const results = []
    for (const url of urls) {
      try {
        const buffer = await fetchImageBuffer(url)
        const result = await emojiPackManager.addFromBuffer(buffer, { source: "manual" })
        if (result.added) {
          const tagInfo = (result.item.tags || []).join(",") || "无标签"
          results.push(`✅ ${result.item.hash.slice(0, 8)} [${tagInfo}]`)
        } else if (result.reason === "duplicate") {
          results.push(`⚠️ ${result.item.hash.slice(0, 8)} 已存在`)
        } else if (result.reason === "full") {
          results.push(`❌ 库已满 (${emojiPackManager.config.maxItems} 张)`)
          break
        } else if (result.reason === "unsupported_format") {
          results.push(`❌ 不支持的图片格式`)
        }
      } catch (err) {
        results.push(`❌ 下载/处理失败: ${err.message}`)
      }
    }

    await sendForward(e, ["表情包导入结果:", ...results], "表情包导入")
    return true
  }

  async listEmoji(e) {
    const items = await emojiPackManager.loadItems(true)
    if (!items.length) return e.reply("本地表情包库为空")

    const pageMatch = e.msg.match(/(\d+)/)
    const page = pageMatch ? Math.max(1, parseInt(pageMatch[1])) : 1
    const pageSize = 10
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
    const start = (page - 1) * pageSize
    const pageItems = items.slice(start, start + pageSize)
    if (!pageItems.length) return e.reply(`第 ${page} 页没有数据，共 ${totalPages} 页`)

    const msgs = [`表情包列表 (第 ${page}/${totalPages} 页，共 ${items.length} 张)`]
    pageItems.forEach((item, i) => {
      const tags = (item.tags || []).join(",") || "无标签"
      const desc = item.description ? `\n${item.description}` : ""
      const flags = []
      if (item.isBanned) flags.push("封禁")
      if (item.noFileFlag) flags.push("缺文件")
      const flagStr = flags.length ? ` [${flags.join("|")}]` : ""
      const textLine = `${start + i + 1}. ${item.hash.slice(0, 8)}${flagStr}\n用 ${item.usedCount || 0} 次 | [${tags}]${desc}`

      const abs = emojiPackManager.getAbsoluteFilePath(item)
      if (!item.noFileFlag && fs.existsSync(abs)) {
        msgs.push([segment.image(`file://${abs}`), `\n${textLine}`])
      } else {
        msgs.push(`${textLine}\n⚠️ 文件丢失`)
      }
    })
    if (totalPages > 1) msgs.push(`提示: 发送 #表情包列表 <页码> 查看其他页`)
    await sendForward(e, msgs, "表情包列表")
    return true
  }

  async deleteEmoji(e) {
    const prefix = e.msg.replace(/^#表情包删除\s+/, "").trim()
    if (!prefix) return e.reply("请提供要删除的 hash 前缀（至少 4 位）")
    if (prefix.length < 4) return e.reply("hash 前缀至少 4 位，避免误删")

    const result = await emojiPackManager.removeByHashPrefix(prefix)
    if (!result.removed) return e.reply(`未找到 hash 以 ${prefix} 开头的表情包`)
    return e.reply(`已删除 ${result.removed} 张表情包`)
  }

  async retagEmoji(e) {
    const prefix = e.msg.replace(/^#表情包打标\s+/, "").trim()
    if (!prefix || prefix.length < 4) return e.reply("请提供至少 4 位的 hash 前缀")

    e.reply("正在重新打标...")
    const result = await emojiPackManager.retagByHashPrefix(prefix)
    if (!result.updated) {
      return e.reply(`打标失败: ${result.error || "未找到匹配的表情包"}`)
    }
    const tags = (result.item.tags || []).join(",") || "无标签"
    return e.reply(`已更新 ${result.item.hash.slice(0, 8)}\n标签: ${tags}\n描述: ${result.item.description || "(无)"}`)
  }

  async reloadEmoji(e) {
    emojiPackManager.refreshConfig()
    const items = await emojiPackManager.loadItems(true)
    return e.reply(`已重载，当前 ${items.length} 张表情包`)
  }

  async emojiStats(e) {
    emojiPackManager.refreshConfig()
    const stats = await emojiPackManager.stats()
    const cfg = emojiPackManager.config
    const msgs = [
      "表情包统计",
      `启用状态: ${stats.enabled ? "已启用" : "未启用"}`,
      `自动收集: ${stats.autoCollect ? "已开启" : "已关闭"}`,
      `内容审查: ${stats.contentFiltration ? "已开启" : "已关闭"}`,
      `满额替换: ${stats.doReplace ? "已开启" : "已关闭"}`,
      `周期维护: ${stats.enableMaintenance ? `已开启 (${cfg.checkIntervalMinutes || 10}分钟)` : "已关闭"}`,
      `总数: ${stats.total} / ${stats.maxItems}`,
      `已打标: ${stats.tagged}`,
      `已生成 embedding: ${stats.embedded}`,
      `封禁: ${stats.banned}`,
      `存储目录: ${emojiPackManager.storeDir}`,
      `数据库文件: ${emojiPackManager.dbPath}`,
      `VLM 自动打标: ${cfg.visionTagOnAdd !== false ? "开" : "关"}`,
      `使用 embedding 召回: ${cfg.useEmbedding !== false ? "开" : "关"}`
    ]
    await sendForward(e, msgs, "表情包统计")
    return true
  }

  async banEmoji(e) {
    const prefix = e.msg.replace(/^#表情包封禁\s+/, "").trim()
    if (!prefix || prefix.length < 4) return e.reply("请提供至少 4 位的 hash 前缀")
    const result = await emojiPackManager.setBannedByHashPrefix(prefix, true)
    if (!result.updated) return e.reply(`未找到 hash 以 ${prefix} 开头的表情包`)
    return e.reply(`已封禁 ${result.updated} 张表情包（不参与选图，不删除文件）`)
  }

  async unbanEmoji(e) {
    const prefix = e.msg.replace(/^#表情包解封\s+/, "").trim()
    if (!prefix || prefix.length < 4) return e.reply("请提供至少 4 位的 hash 前缀")
    const result = await emojiPackManager.setBannedByHashPrefix(prefix, false)
    if (!result.updated) return e.reply(`未找到 hash 以 ${prefix} 开头的表情包`)
    return e.reply(`已解封 ${result.updated} 张表情包`)
  }

  async runMaintenance(e) {
    emojiPackManager.refreshConfig()
    e.reply("正在执行文件一致性巡检...")
    try {
      await emojiPackManager.runMaintenance()
      const stats = await emojiPackManager.stats()
      e.reply(`巡检完成，当前 ${stats.total} 张表情包`)
    } catch (err) {
      e.reply(`巡检失败: ${err.message}`)
    }
    return true
  }

  async previewEmoji(e) {
    const prefix = e.msg.replace(/^#表情包预览\s+/, "").trim()
    if (!prefix || prefix.length < 4) return e.reply("请提供至少 4 位的 hash 前缀")

    const items = await emojiPackManager.loadItems()
    const item = items.find(i => i.hash.startsWith(prefix.toLowerCase()))
    if (!item) return e.reply(`未找到 hash 以 ${prefix} 开头的表情包`)

    const abs = emojiPackManager.getAbsoluteFilePath(item)
    if (!fs.existsSync(abs)) return e.reply(`文件丢失: ${abs}`)

    const tags = (item.tags || []).join(",") || "无标签"
    await e.reply([
      segment.image(`file://${abs}`),
      `\nhash: ${item.hash}\n标签: ${tags}\n描述: ${item.description || "(无)"}\n使用次数: ${item.usedCount || 0}`
    ])
    return true
  }
}
