import fs from "node:fs"

export class DeliveryError extends Error {
  constructor(message, { retryable = true, uncertain = false, retcode = null } = {}) {
    super(message)
    this.name = "DeliveryError"
    this.retryable = retryable
    this.uncertain = uncertain
    this.retcode = retcode
  }
}

function toOneBotContent(message = []) {
  return (Array.isArray(message) ? message : [message]).map(item => {
    if (typeof item !== "object" || item === null) return { type: "text", data: { text: String(item || "") } }
    const data = item.data && typeof item.data === "object" ? { ...item.data } : { ...item }
    delete data.type
    if (item.type === "image" && data.url && !data.file) data.file = data.url
    return { type: item.type || "text", data }
  })
}

export function buildOneBotForwardNodes(nodes = []) {
  return nodes.map(node => ({
    type: "node",
    data: {
      name: node.nickname || "匿名消息",
      uin: String(node.user_id || 80000000),
      content: toOneBotContent(node.message)
    }
  }))
}

export async function inlineForwardVideoSegment(video = {}, { artifactStore = null } = {}) {
  const data = video?.data && typeof video.data === "object" ? video.data : video
  const file = data?.file || ""
  if (!file || String(file).startsWith("base64://") || /^https?:\/\//i.test(String(file))) return video
  const base64File = artifactStore?.encodeFile
    ? await artifactStore.encodeFile(file)
    : `base64://${(await fs.promises.readFile(file)).toString("base64")}`
  return video?.data
    ? { ...video, data: { ...video.data, file: base64File } }
    : { ...video, file: base64File }
}

function compactReceipt(result) {
  return {
    retcode: result?.retcode ?? 0,
    status: result?.status || "ok",
    messageId: result?.data?.message_id || result?.message_id || null,
    wording: result?.wording || result?.msg || ""
  }
}

export class DeliveryGateway {
  constructor({ botRoot = () => globalThis.Bot, logger = globalThis.logger } = {}) {
    this.botRoot = botRoot
    this.logger = logger
  }

  resolveBot(botId) {
    const root = typeof this.botRoot === "function" ? this.botRoot() : this.botRoot
    if (!root) return null
    const key = String(botId || "")
    return root.bots?.[key] || root[key] || (typeof root.sendApi === "function" ? root : null)
  }

  async sendGroupForward({ botId, groupId, nodes }) {
    const bot = this.resolveBot(botId)
    if (typeof bot?.sendApi !== "function") {
      throw new DeliveryError(`Bot ${botId || "unknown"} 当前没有可用的 OneBot sendApi`)
    }
    let result
    try {
      result = await bot.sendApi("send_group_forward_msg", {
        group_id: Number(groupId),
        messages: buildOneBotForwardNodes(nodes)
      })
    } catch (error) {
      throw new DeliveryError(error.message || "OneBot 调用异常", {
        retryable: false,
        uncertain: true
      })
    }
    if (!result || typeof result !== "object" || result.retcode === undefined || result.retcode === null) {
      throw new DeliveryError("OneBot 未返回可验证的发送回执", {
        retryable: false,
        uncertain: true
      })
    }
    const retcode = Number(result.retcode)
    if (!Number.isFinite(retcode)) {
      throw new DeliveryError(`OneBot 返回了非法 retcode: ${String(result.retcode).slice(0, 50)}`, {
        retryable: false,
        uncertain: true
      })
    }
    if (retcode !== 0) {
      throw new DeliveryError(result?.wording || result?.msg || `OneBot retcode=${retcode}`, { retcode })
    }
    return compactReceipt(result)
  }
}
