import { groupModerationManager } from "../utils/GroupModerationManager.js"

export class GroupModerationMessage extends plugin {
  constructor() {
    super({
      name: "群管理-复合风控",
      dsc: "检测低活跃成员广告、外链和招募话术",
      event: "message.group",
      priority: 9990,
      rule: [
        {
          reg: ".*",
          fnc: "handleModerationMessage",
          log: false
        }
      ]
    })
  }

  async handleModerationMessage(e) {
    return await groupModerationManager.handleMessage(e)
  }
}
