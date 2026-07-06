import { umaRaceManager } from "../utils/UmaRaceManager.js"

export class UmaRacePlugin extends plugin {
  constructor() {
    super({
      name: "赛马娘小游戏",
      dsc: "群聊赛马小游戏和全局 QQ 积分",
      event: "message",
      priority: 550,
      rule: [
        { reg: "^[.。]赛马娘\\s*$", fnc: "showHelp" },
        { reg: "^[.。]赛马娘\\s*(帮助|help)\\s*$", fnc: "showHelp" },
        { reg: "^[.。]赛马娘\\s*(领养|创建|注册)\\s+[\\s\\S]+$", fnc: "adoptUma" },
        { reg: "^[.。]赛马娘\\s*重新领养\\s+[\\s\\S]+$", fnc: "readoptUma" },
        { reg: "^[.。]赛马娘\\s*(弃养|放生)(\\s*确认)?\\s*$", fnc: "abandonUma" },
        { reg: "^[.。]赛马娘\\s*(我的赛马娘|赛马娘信息|属性|六维)\\s*$", fnc: "showUma" },
        { reg: "^[.。]赛马娘\\s*(训练|训练状态|训练进度)\\s*$", fnc: "showTrainingStatus" },
        { reg: "^[.。]赛马娘\\s*训练\\s+[\\s\\S]+$", fnc: "trainUma" },
        { reg: "^[.。]赛马娘\\s*(开始|开局|创建)\\s*$", fnc: "startRace" },
        { reg: "^[.。]赛马娘\\s*(加入|参加|上马|报名)([\\s\\S]*)$", fnc: "joinRace" },
        { reg: "^[.。]赛马娘\\s*(决策|选择|行动)\\s+[\\s\\S]+$", fnc: "raceDecision" },
        { reg: "^[.。]赛马娘\\s*(开跑|开赛|比赛|冲|跑)\\s*$", fnc: "runRace" },
        { reg: "^[.。]赛马娘\\s*(取消|关闭|结束)\\s*$", fnc: "cancelRace" },
        { reg: "^[.。]赛马娘\\s*(积分|分数|我的积分)\\s*$", fnc: "showScore" },
        { reg: "^[.。]赛马娘\\s*(排行|排行榜|排名)(\\s+\\d+)?\\s*$", fnc: "showRank" }
      ]
    })
  }

  async showHelp(e) {
    await e.reply(umaRaceManager.showHelp())
    return true
  }

  async startRace(e) {
    await e.reply(await umaRaceManager.startRace(e))
    return true
  }

  async adoptUma(e) {
    await e.reply(await umaRaceManager.adoptUma(e))
    return true
  }

  async readoptUma(e) {
    await e.reply(await umaRaceManager.adoptUma(e, { overwrite: true }))
    return true
  }

  async abandonUma(e) {
    await e.reply(await umaRaceManager.abandonUma(e, { confirm: /确认/.test(String(e.msg || "")) }))
    return true
  }

  async showUma(e) {
    await e.reply(umaRaceManager.showUma(e))
    return true
  }

  async trainUma(e) {
    await e.reply(await umaRaceManager.trainUma(e))
    return true
  }

  async showTrainingStatus(e) {
    await e.reply(umaRaceManager.showTrainingStatus(e))
    return true
  }

  async joinRace(e) {
    await e.reply(await umaRaceManager.joinRace(e, e.msg))
    return true
  }

  async raceDecision(e) {
    await e.reply(umaRaceManager.raceDecision(e))
    return true
  }

  async runRace(e) {
    await e.reply(await umaRaceManager.runRace(e))
    return true
  }

  async cancelRace(e) {
    await e.reply(umaRaceManager.cancelRace(e))
    return true
  }

  async showScore(e) {
    await e.reply(umaRaceManager.showScore(e))
    return true
  }

  async showRank(e) {
    const match = String(e.msg || "").match(/\s+(\d+)\s*$/)
    await e.reply(umaRaceManager.showRank(match?.[1]))
    return true
  }
}
