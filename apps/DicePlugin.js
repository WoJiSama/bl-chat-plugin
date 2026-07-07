import { diceManager } from "../utils/DiceManager.js"
import { sendSmartReply } from "../utils/SmartReply.js"

export class DicePlugin extends plugin {
  constructor() {
    super({
      name: "COC骰娘",
      dsc: "COC 跑团骰娘命令",
      event: "message",
      priority: 560,
      rule: [
        { reg: "^[.。](骰娘|dice)\\s*$", fnc: "showHelp" },
        { reg: "^[.。](骰娘|dice)\\s*(帮助|help)\\s*$", fnc: "showHelp" },
        { reg: "^[.。](help|帮助)(\\s+[\\s\\S]+)?$", fnc: "help" },
        { reg: "^[.。](bot|dismiss|bye)(\\s+[\\s\\S]+)?$", fnc: "botControl" },
        { reg: "^[.。]reply(\\s+[\\s\\S]+)?$", fnc: "replyControl" },
        { reg: "^[.。]send(\\s+[\\s\\S]+)?$", fnc: "sendToMaster" },
        { reg: "^[.。]find(\\s+[\\s\\S]+)?$", fnc: "findEntry" },
        { reg: "^[.。]set(?!coc)(\\s+[\\s\\S]+)?$", fnc: "setDiceOption" },
        { reg: "^[.。]sn(\\s+[\\s\\S]+)?$", fnc: "sn" },
        { reg: "^[.。]log\\s*(on|start|开始|开启)(\\s+[\\s\\S]+)?$", fnc: "logStart" },
        { reg: "^[.。]log\\s*(new|新建|create)(\\s+[\\s\\S]+)?$", fnc: "logNew" },
        { reg: "^[.。]log\\s*(off|stop|结束|关闭)\\s*$", fnc: "logStop" },
        { reg: "^[.。]log\\s*(end|结束并导出)\\s*$", fnc: "logEnd" },
        { reg: "^[.。]log\\s*(status|状态)?\\s*$", fnc: "logStatus" },
        { reg: "^[.。]log\\s*(export|get|导出|获取)(\\s+[\\s\\S]+)?$", fnc: "logExport" },
        { reg: "^[.。](ri)(\\s+[\\s\\S]+)?$", fnc: "initiativeRoll" },
        { reg: "^[.。](init|先攻)(\\s+[\\s\\S]+)?$", fnc: "initiative" },
        { reg: "^[.。](?:r(?![A-Za-z])|roll)([\\s\\S]*)$", fnc: "roll" },
        { reg: "^[.。](rsr)(\\s+[\\s\\S]+)?$", fnc: "rsr" },
        { reg: "^[.。](ww)(\\s+[\\s\\S]+)?$", fnc: "ww" },
        { reg: "^[.。](dx)(\\s+[\\s\\S]+)?$", fnc: "dx" },
        { reg: "^[.。](ekgen)(\\s+[\\s\\S]+)?$", fnc: "ekgen" },
        { reg: "^[.。](ek)(\\s+[\\s\\S]+)?$", fnc: "ek" },
        { reg: "^[.。](bp)(\\d+)?(\\s+[\\s\\S]+)?$", fnc: "bonusRoll" },
        { reg: "^[.。](pp)(\\d+)?(\\s+[\\s\\S]+)?$", fnc: "penaltyRoll" },
        { reg: "^[.。](rav)(\\s+[\\s\\S]+)?$", fnc: "opposed" },
        { reg: "^[.。](rab|rap|rahb|rahp|rah|ra)(\\d+)?#?(b|p)?(\\s+[\\s\\S]+)?$", fnc: "seaCocCheck" },
        { reg: "^[.。](ra|rc)([+\\-]?\\d+)(\\s+[\\s\\S]+)?$", fnc: "numberedCheck" },
        { reg: "^[.。](ra|rc)(\\s+[\\s\\S]+)?$", fnc: "check" },
        { reg: "^[.。](rb)(\\d+)?(\\s+[\\s\\S]+)?$", fnc: "bonusCheck" },
        { reg: "^[.。](rp)(\\d+)?(\\s+[\\s\\S]+)?$", fnc: "penaltyCheck" },
        { reg: "^[.。](rh|rah)(\\s+[\\s\\S]+)?$", fnc: "hiddenCheck" },
        { reg: "^[.。]sc([\\s\\S]*)$", fnc: "sanCheck" },
        { reg: "^[.。]en(\\s+[\\s\\S]+)?$", fnc: "enCheck" },
        { reg: "^[.。](?:coc7?|天命)([\\s\\S]*)$", fnc: "coc" },
        { reg: "^[.。](dnd5e?|dnd)([\\s\\S]*)$", fnc: "dnd" },
        { reg: "^[.。](buff|ss|cast|longrest|ds)([\\s\\S]*)$", fnc: "dndUtility" },
        { reg: "^[.。](namednd)([\\s\\S]*)$", fnc: "nameDnd" },
        { reg: "^[.。](jrrp|今日人品)\\s*$", fnc: "jrrp" },
        { reg: "^[.。](db|伤害加值)(\\s+[\\s\\S]+)?$", fnc: "db" },
        { reg: "^[.。]st([\\s\\S]*)$", fnc: "st" },
        { reg: "^[.。]pc(\\s+[\\s\\S]+)?$", fnc: "pc" },
        { reg: "^[.。]nn(\\s+[\\s\\S]+)?$", fnc: "nn" },
        { reg: "^[.。]setcoc([\\s\\S]*)$", fnc: "setCoc" },
        { reg: "^[.。]ti\\s*$", fnc: "ti" },
        { reg: "^[.。]li\\s*$", fnc: "li" }
      ]
    })
  }

  strip(e, head) {
    return String(e.msg || "").replace(new RegExp(`^[.。]${head}\\s*`, "i"), "").trim()
  }

  async reply(e, output, options = {}) {
    return await sendSmartReply(e, output, options)
  }

  async showHelp(e) {
    await this.reply(e, diceManager.showHelp(), { kind: "diceLong" })
    return true
  }

  async help(e) {
    await this.reply(e, diceManager.showHelp(this.strip(e, "(help|帮助)")), { kind: "diceLong" })
    return true
  }

  async botControl(e) {
    await this.reply(e, await diceManager.handleBotControl(e, this.strip(e, "(bot|dismiss|bye)")))
    return true
  }

  async replyControl(e) {
    await this.reply(e, await diceManager.handleReplyControl(e, this.strip(e, "reply")))
    return true
  }

  async sendToMaster(e) {
    await this.reply(e, diceManager.handleSendToMaster(e, this.strip(e, "send")))
    return true
  }

  async findEntry(e) {
    await this.reply(e, diceManager.handleFind(e, this.strip(e, "find")), { kind: "knowledgeList" })
    return true
  }

  async setDiceOption(e) {
    await this.reply(e, await diceManager.handleSetOption(e, this.strip(e, "set")))
    return true
  }

  async sn(e) {
    await this.reply(e, await diceManager.handleSn(e, this.strip(e, "sn")))
    return true
  }

  async logStart(e) {
    await this.reply(e, await diceManager.startLog(e, this.strip(e, "log\\s*(on|start|开始|开启)")))
    return true
  }

  async logNew(e) {
    await this.reply(e, await diceManager.startLog(e, this.strip(e, "log\\s*(new|新建|create)")))
    return true
  }

  async logStop(e) {
    await this.reply(e, await diceManager.stopLog(e))
    return true
  }

  async logEnd(e) {
    const stopped = await diceManager.stopLog(e)
    const exported = await diceManager.exportLog(e)
    if (exported) await this.reply(e, exported)
    await this.reply(e, stopped)
    return true
  }

  async logStatus(e) {
    await this.reply(e, diceManager.getLogStatus(e), { kind: "messageArchive" })
    return true
  }

  async logExport(e) {
    const result = await diceManager.exportLog(e)
    if (result) await this.reply(e, result, { kind: "messageArchive" })
    return true
  }

  async roll(e) {
    const text = String(e.msg || "")
    const match = text.match(/^[.。](?:r(?![A-Za-z])|roll)\s*([\s\S]*)$/i)
    await this.reply(e, diceManager.handleRoll(e, match?.[1] || ""))
    return true
  }

  async initiativeRoll(e) {
    await this.reply(e, diceManager.handleInitiativeRoll(e, this.strip(e, "ri")))
    return true
  }

  async initiative(e) {
    await this.reply(e, await diceManager.handleInitiative(e, this.strip(e, "(init|先攻)")))
    return true
  }

  async rsr(e) {
    await this.reply(e, diceManager.handleRsr(e, this.strip(e, "rsr")))
    return true
  }

  async ww(e) {
    await this.reply(e, diceManager.handleWw(e, this.strip(e, "ww")))
    return true
  }

  async dx(e) {
    await this.reply(e, diceManager.handleDx(e, this.strip(e, "dx")))
    return true
  }

  async ek(e) {
    await this.reply(e, diceManager.handleEk(e, this.strip(e, "ek")))
    return true
  }

  async ekgen(e) {
    await this.reply(e, diceManager.handleEkgen(e, this.strip(e, "ekgen")))
    return true
  }

  async bonusRoll(e) {
    const text = String(e.msg || "")
    const match = text.match(/^[.。]bp(\d+)?\s*([\s\S]*)$/i)
    await this.reply(e, diceManager.handleBonusPenaltyRoll(e, match?.[2] || "", Number(match?.[1] || 1)))
    return true
  }

  async penaltyRoll(e) {
    const text = String(e.msg || "")
    const match = text.match(/^[.。]pp(\d+)?\s*([\s\S]*)$/i)
    await this.reply(e, diceManager.handleBonusPenaltyRoll(e, match?.[2] || "", -Number(match?.[1] || 1)))
    return true
  }

  async opposed(e) {
    await this.reply(e, diceManager.handleOpposed(e, this.strip(e, "rav")))
    return true
  }

  async seaCocCheck(e) {
    const text = String(e.msg || "")
    const match = text.match(/^[.。](rab|rap|rahb|rahp|rah|ra)(\d+)?#?(b|p)?\s*([\s\S]*)$/i)
    const head = String(match?.[1] || "ra").toLowerCase()
    const num = Number(match?.[2] || 0)
    const suffix = String(match?.[3] || "").toLowerCase()
    const modifier = head.includes("b") || suffix === "b" ? (num || 1) : head.includes("p") || suffix === "p" ? -(num || 1) : 0
    const hidden = head.includes("h")
    const raw = match?.[4] || ""
    await this.reply(e, hidden ? await diceManager.handleHiddenCheck(e, raw, { modifier }) : diceManager.handleCheck(e, raw, { modifier }))
    return true
  }

  async check(e) {
    const text = String(e.msg || "")
    const raw = this.strip(e, "(ra|rc)")
    await this.reply(e, /^[.。]rc/i.test(text) && diceManager.shouldUseDndCheck(e, raw)
      ? diceManager.handleDndCheck(e, raw)
      : diceManager.handleCheck(e, raw))
    return true
  }

  async numberedCheck(e) {
    const text = String(e.msg || "")
    const match = text.match(/^[.。](?:ra|rc)([+\-]?\d+)\s*([\s\S]*)$/i)
    const modifier = Number(match?.[1] || 0)
    await this.reply(e, diceManager.handleCheck(e, match?.[2] || "", { modifier }))
    return true
  }

  async bonusCheck(e) {
    const text = String(e.msg || "")
    const match = text.match(/^[.。]rb(\d+)?\s*([\s\S]*)$/i)
    await this.reply(e, diceManager.handleCheck(e, match?.[2] || "", { modifier: Number(match?.[1] || 1) }))
    return true
  }

  async penaltyCheck(e) {
    const text = String(e.msg || "")
    const match = text.match(/^[.。]rp(\d+)?\s*([\s\S]*)$/i)
    await this.reply(e, diceManager.handleCheck(e, match?.[2] || "", { modifier: -Number(match?.[1] || 1) }))
    return true
  }

  async hiddenCheck(e) {
    await this.reply(e, await diceManager.handleHiddenCheck(e, this.strip(e, "(rh|rah)")))
    return true
  }

  async sanCheck(e) {
    await this.reply(e, await diceManager.handleSan(e, this.strip(e, "sc")))
    return true
  }

  async enCheck(e) {
    await this.reply(e, diceManager.handleEn(e, this.strip(e, "en")))
    return true
  }

  async coc(e) {
    const text = String(e.msg || "")
    const match = text.match(/^[.。](?:coc7?|天命)\s*([\s\S]*)$/i)
    await this.reply(e, diceManager.handleCoc(e, match?.[1] || ""), { kind: "cocAttributes" })
    return true
  }

  async dnd(e) {
    const text = String(e.msg || "")
    const match = text.match(/^[.。](?:dnd5e?|dnd)\s*([\s\S]*)$/i)
    await this.reply(e, diceManager.handleDnd(e, match?.[1] || ""), { kind: "diceLong" })
    return true
  }

  async nameDnd(e) {
    await this.reply(e, diceManager.handleNameDnd(e, this.strip(e, "namednd")))
    return true
  }

  async dndUtility(e) {
    const text = String(e.msg || "")
    const match = text.match(/^[.。](buff|ss|cast|longrest|ds)\s*([\s\S]*)$/i)
    await this.reply(e, await diceManager.handleDndUtility(e, match?.[1] || "", match?.[2] || ""))
    return true
  }

  async jrrp(e) {
    await this.reply(e, diceManager.handleJrrp(e))
    return true
  }

  async db(e) {
    await this.reply(e, diceManager.handleDb(e, this.strip(e, "(db|伤害加值)")))
    return true
  }

  async st(e) {
    await this.reply(e, await diceManager.handleSt(e, this.strip(e, "st")))
    return true
  }

  async pc(e) {
    await this.reply(e, await diceManager.handlePc(e, this.strip(e, "pc")))
    return true
  }

  async nn(e) {
    await this.reply(e, await diceManager.handleNn(e, this.strip(e, "nn")))
    return true
  }

  async setCoc(e) {
    await this.reply(e, await diceManager.handleSetCoc(e, this.strip(e, "setcoc")))
    return true
  }

  async ti(e) {
    await this.reply(e, diceManager.handleInsanity("ti"))
    return true
  }

  async li(e) {
    await this.reply(e, diceManager.handleInsanity("li"))
    return true
  }
}
