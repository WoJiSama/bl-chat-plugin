import { diceManager } from "../utils/DiceManager.js"
import { sendSmartReply } from "../utils/SmartReply.js"
import { DICE_COMMAND_RULES, matchDiceCommand, stripDiceCommand } from "../utils/diceCommandPolicy.js"

export class DicePlugin extends plugin {
  constructor() {
    super({
      name: "COC骰娘",
      dsc: "COC 跑团骰娘命令",
      event: "message",
      priority: 560,
      rule: DICE_COMMAND_RULES.map(rule => ({ ...rule }))
    })
  }

  strip(e, head) {
    return stripDiceCommand(e?.msg, head)
  }

  async reply(e, output, options = {}) {
    const userId = e?.user_id || e?.sender?.user_id
    const senderOptions = userId
      ? {
          nickname: e?.sender?.card || e?.sender?.nickname || String(userId),
          avatarUrl: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=100`
        }
      : {}
    return await sendSmartReply(e, output, { ...senderOptions, ...options })
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
    const match = matchDiceCommand(text, "(?:r(?![A-Za-z])|roll)\\s*([\\s\\S]*)")
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
    const match = matchDiceCommand(text, "bp(\\d+)?\\s*([\\s\\S]*)")
    await this.reply(e, diceManager.handleBonusPenaltyRoll(e, match?.[2] || "", Number(match?.[1] || 1)))
    return true
  }

  async penaltyRoll(e) {
    const text = String(e.msg || "")
    const match = matchDiceCommand(text, "pp(\\d+)?\\s*([\\s\\S]*)")
    await this.reply(e, diceManager.handleBonusPenaltyRoll(e, match?.[2] || "", -Number(match?.[1] || 1)))
    return true
  }

  async opposed(e) {
    await this.reply(e, diceManager.handleOpposed(e, this.strip(e, "rav")))
    return true
  }

  async seaCocCheck(e) {
    const text = String(e.msg || "")
    const match = matchDiceCommand(text, "(rab|rap|rahb|rahp|rah|ra)(\\d+)?#?(b|p)?\\s*([\\s\\S]*)")
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
    const match = matchDiceCommand(text, "(?:ra|rc)([+\\-]?\\d+)\\s*([\\s\\S]*)")
    const modifier = Number(match?.[1] || 0)
    await this.reply(e, diceManager.handleCheck(e, match?.[2] || "", { modifier }))
    return true
  }

  async bonusCheck(e) {
    const text = String(e.msg || "")
    const match = matchDiceCommand(text, "rb(\\d+)?\\s*([\\s\\S]*)")
    await this.reply(e, diceManager.handleCheck(e, match?.[2] || "", { modifier: Number(match?.[1] || 1) }))
    return true
  }

  async penaltyCheck(e) {
    const text = String(e.msg || "")
    const match = matchDiceCommand(text, "rp(\\d+)?\\s*([\\s\\S]*)")
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
    const match = matchDiceCommand(text, "(?:coc7?|天命)\\s*([\\s\\S]*)")
    await this.reply(e, diceManager.handleCoc(e, match?.[1] || ""), { kind: "cocAttributes" })
    return true
  }

  async dnd(e) {
    const text = String(e.msg || "")
    const match = matchDiceCommand(text, "(?:dnd5e?|dnd)\\s*([\\s\\S]*)")
    await this.reply(e, diceManager.handleDnd(e, match?.[1] || ""), { kind: "diceLong" })
    return true
  }

  async nameDnd(e) {
    await this.reply(e, diceManager.handleNameDnd(e, this.strip(e, "namednd")))
    return true
  }

  async dndUtility(e) {
    const text = String(e.msg || "")
    const match = matchDiceCommand(text, "(buff|ss|cast|longrest|ds)\\s*([\\s\\S]*)")
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
