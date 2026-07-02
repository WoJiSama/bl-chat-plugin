import { messageArchiveManager } from "../utils/MessageArchiveManager.js"

class BaseMessageArchiveNotice extends plugin {
  async archiveNotice(e) {
    messageArchiveManager.recordNotice(e).catch(error => {
      logger.warn(`[MessageArchive] 通知归档失败: ${error.message}`)
    })
    return false
  }
}

export class MessageArchiveGroupIncrease extends BaseMessageArchiveNotice {
  constructor() {
    super({
      name: "聊天归档-入群",
      dsc: "归档入群事件",
      event: "notice.group.increase",
      priority: -Infinity,
      rule: [{ fnc: "archiveNotice", log: false }]
    })
  }
}

export class MessageArchiveGroupDecrease extends BaseMessageArchiveNotice {
  constructor() {
    super({
      name: "聊天归档-退群",
      dsc: "归档退群事件",
      event: "notice.group.decrease",
      priority: -Infinity,
      rule: [{ fnc: "archiveNotice", log: false }]
    })
  }
}

export class MessageArchiveGroupRecall extends BaseMessageArchiveNotice {
  constructor() {
    super({
      name: "聊天归档-撤回",
      dsc: "归档群消息撤回事件",
      event: "notice.group.recall",
      priority: -Infinity,
      rule: [{ fnc: "archiveNotice", log: false }]
    })
  }
}

export class MessageArchiveGroupPoke extends BaseMessageArchiveNotice {
  constructor() {
    super({
      name: "聊天归档-戳一戳",
      dsc: "归档群戳一戳事件",
      event: "notice.group.poke",
      priority: -Infinity,
      rule: [{ fnc: "archiveNotice", log: false }]
    })
  }
}
