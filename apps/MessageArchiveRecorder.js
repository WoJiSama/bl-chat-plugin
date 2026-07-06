import { messageArchiveManager } from "../utils/MessageArchiveManager.js"

export class MessageArchiveRecorder extends plugin {
  constructor() {
    super({
      name: "聊天归档-实时记录",
      dsc: "优先归档群聊和私聊消息",
      event: "message",
      priority: 10050,
      rule: [
        {
          reg: ".*",
          fnc: "recordArchiveMessage",
          log: false
        }
      ]
    })
  }

  async recordArchiveMessage(e) {
    messageArchiveManager.recordMessage(e).catch(error => {
      logger.warn(`[MessageArchive] 后台归档失败: ${error.message}`)
    })
    return false
  }
}
