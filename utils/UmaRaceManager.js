import fs from "fs"
import path from "path"
import yaml from "js-yaml"

const DEFAULT_CONFIG = {
  enabled: true,
  minPlayers: 2,
  maxPlayers: 12,
  lobbySeconds: 60,
  cooldownSeconds: 30,
  winPoints: 5,
  secondPoints: 2,
  thirdPoints: 1,
  rankLimit: 10,
  baseDir: "data/uma_race"
}

const NPC_NAMES = [
  "栗毛流星",
  "晨风铃",
  "青叶疾驰",
  "星砂步",
  "白露弯道",
  "红茶终线"
]

const TRACK_EVENTS = [
  "{name} 出闸很稳，贴着内道往前压。",
  "{name} 在中段突然提速，差点把节奏带乱。",
  "{name} 过弯很漂亮，身位一下子追回来了。",
  "{name} 被前方挡了一下，但马上从外侧绕出。",
  "{name} 最后直线开始冲刺，气势很凶。",
  "{name} 留了一口气，终点前还在加速。"
]

function nowIso() {
  return new Date().toISOString()
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function safeNumber(value, fallback, min, max) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

function escapeName(name) {
  return String(name || "群友").replace(/\s+/g, " ").trim().slice(0, 24) || "群友"
}

function pick(array) {
  return array[Math.floor(Math.random() * array.length)]
}

function formatDuration(seconds) {
  return `${Math.max(1, Math.round(seconds))} 秒`
}

export class UmaRaceManager {
  constructor({ cwd = process.cwd(), logger = globalThis.logger } = {}) {
    this.cwd = cwd
    this.logger = logger
    this.rooms = new Map()
    this.lastRaceAt = new Map()
    this.writeChain = Promise.resolve()
  }

  getConfig() {
    const userPath = path.join(this.cwd, "plugins/bl-chat-plugin/config/message.yaml")
    const defaultPath = path.join(this.cwd, "plugins/bl-chat-plugin/config_default/message.yaml")
    const configPath = fs.existsSync(userPath) ? userPath : defaultPath
    let raw = {}
    try {
      raw = yaml.load(fs.readFileSync(configPath, "utf8"))?.pluginSettings?.umaRace || {}
    } catch (error) {
      this.logger?.warn?.(`[赛马娘小游戏] 读取配置失败: ${error.message}`)
    }
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      minPlayers: safeNumber(raw.minPlayers, DEFAULT_CONFIG.minPlayers, 1, 20),
      maxPlayers: safeNumber(raw.maxPlayers, DEFAULT_CONFIG.maxPlayers, 2, 30),
      lobbySeconds: safeNumber(raw.lobbySeconds, DEFAULT_CONFIG.lobbySeconds, 10, 300),
      cooldownSeconds: safeNumber(raw.cooldownSeconds, DEFAULT_CONFIG.cooldownSeconds, 0, 3600),
      winPoints: safeNumber(raw.winPoints, DEFAULT_CONFIG.winPoints, 0, 100000),
      secondPoints: safeNumber(raw.secondPoints, DEFAULT_CONFIG.secondPoints, 0, 100000),
      thirdPoints: safeNumber(raw.thirdPoints, DEFAULT_CONFIG.thirdPoints, 0, 100000),
      rankLimit: safeNumber(raw.rankLimit, DEFAULT_CONFIG.rankLimit, 3, 50)
    }
  }

  getDataDir(config = this.getConfig()) {
    return path.isAbsolute(config.baseDir)
      ? config.baseDir
      : path.join(this.cwd, "plugins/bl-chat-plugin", config.baseDir)
  }

  getPointsPath(config = this.getConfig()) {
    return path.join(this.getDataDir(config), "points.json")
  }

  readPoints(config = this.getConfig()) {
    const file = this.getPointsPath(config)
    if (!fs.existsSync(file)) return { players: {} }
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"))
      return data && typeof data === "object" && data.players ? data : { players: {} }
    } catch (error) {
      this.logger?.warn?.(`[赛马娘小游戏] 读取积分失败: ${error.message}`)
      return { players: {} }
    }
  }

  async writePoints(data, config = this.getConfig()) {
    this.writeChain = this.writeChain.then(async () => {
      const file = this.getPointsPath(config)
      ensureDir(path.dirname(file))
      const tmp = `${file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8")
      fs.renameSync(tmp, file)
    })
    return this.writeChain
  }

  getRoom(groupId) {
    return this.rooms.get(String(groupId || ""))
  }

  getDisplayName(e) {
    return escapeName(e?.sender?.card || e?.sender?.nickname || e?.nickname || e?.user_id)
  }

  startRace(e) {
    const config = this.getConfig()
    if (!config.enabled) return "赛马娘小游戏现在没开。"
    if (!e?.group_id) return "这个小游戏要在群里玩。"

    const groupId = String(e.group_id)
    const existing = this.getRoom(groupId)
    if (existing) {
      return `这一局已经开了，当前 ${existing.participants.size} 人。想参加发：.赛马娘 加入`
    }

    const lastAt = this.lastRaceAt.get(groupId) || 0
    const remain = config.cooldownSeconds - Math.floor((Date.now() - lastAt) / 1000)
    if (remain > 0) return `刚跑完一局，先歇 ${formatDuration(remain)} 再开。`

    const room = {
      groupId,
      starterId: String(e.user_id || e.sender?.user_id || ""),
      createdAt: Date.now(),
      participants: new Map()
    }
    this.rooms.set(groupId, room)
    this.joinRace(e)

    return [
      "赛马娘小游戏开局啦。",
      `报名：.赛马娘 加入`,
      `开跑：.赛马娘 开跑`,
      `人数：${room.participants.size}/${config.maxPlayers}，至少 ${config.minPlayers} 人`
    ].join("\n")
  }

  joinRace(e) {
    const config = this.getConfig()
    if (!config.enabled) return "赛马娘小游戏现在没开。"
    if (!e?.group_id) return "这个小游戏要在群里玩。"

    const groupId = String(e.group_id)
    const room = this.getRoom(groupId)
    if (!room) return "现在没有赛马局。先发：.赛马娘 开始"

    const elapsed = Math.floor((Date.now() - room.createdAt) / 1000)
    if (elapsed > config.lobbySeconds) {
      this.rooms.delete(groupId)
      return "这局报名超时了，重新开一局吧：.赛马娘 开始"
    }

    const userId = String(e.user_id || e.sender?.user_id || "")
    if (!userId) return "没拿到你的 QQ 号，报名失败。"
    if (room.participants.has(userId)) return `${this.getDisplayName(e)} 已经在赛道上了。`
    if (room.participants.size >= config.maxPlayers) return "这局人满了，下一局再来。"

    room.participants.set(userId, {
      userId,
      nickname: this.getDisplayName(e),
      joinedAt: Date.now()
    })
    return `报名成功：${this.getDisplayName(e)}（${room.participants.size}/${config.maxPlayers}）`
  }

  cancelRace(e) {
    if (!e?.group_id) return "这个小游戏要在群里玩。"
    const groupId = String(e.group_id)
    const room = this.getRoom(groupId)
    if (!room) return "现在没有赛马局。"
    const userId = String(e.user_id || e.sender?.user_id || "")
    if (!e.isMaster && userId !== room.starterId) return "只有开局的人或主人可以取消这一局。"
    this.rooms.delete(groupId)
    return "这局赛马已经取消。"
  }

  async runRace(e) {
    const config = this.getConfig()
    if (!config.enabled) return "赛马娘小游戏现在没开。"
    if (!e?.group_id) return "这个小游戏要在群里玩。"

    const groupId = String(e.group_id)
    const room = this.getRoom(groupId)
    if (!room) return "现在没有赛马局。先发：.赛马娘 开始"

    const players = [...room.participants.values()]
    if (players.length < config.minPlayers) {
      return `人数还不够，现在 ${players.length}/${config.minPlayers}。想参加发：.赛马娘 加入`
    }

    this.rooms.delete(groupId)
    this.lastRaceAt.set(groupId, Date.now())

    const result = this.simulateRace(players)
    const awards = this.getAwards(config)
    const awardLines = await this.applyAwards(result.ranking, awards, config)
    return this.formatRaceResult(result, awardLines)
  }

  simulateRace(players) {
    const runners = players.map(player => {
      const speed = 70 + Math.random() * 35
      const stamina = 70 + Math.random() * 35
      const guts = 70 + Math.random() * 35
      const luck = Math.random() * 30
      const lateBoost = Math.random() * guts
      const score = speed * 0.46 + stamina * 0.24 + guts * 0.18 + luck + lateBoost * 0.12
      return {
        ...player,
        speed,
        stamina,
        guts,
        score
      }
    })

    runners.sort((a, b) => b.score - a.score)
    const highlights = runners.slice(0, Math.min(3, runners.length)).map(runner =>
      pick(TRACK_EVENTS).replace("{name}", runner.nickname)
    )
    return { ranking: runners, highlights }
  }

  getAwards(config) {
    return [config.winPoints, config.secondPoints, config.thirdPoints]
  }

  async applyAwards(ranking, awards, config) {
    const data = this.readPoints(config)
    const lines = []
    ranking.forEach((runner, index) => {
      const points = awards[index] || 0
      const record = data.players[runner.userId] || {
        userId: runner.userId,
        nickname: runner.nickname,
        points: 0,
        wins: 0,
        races: 0,
        podiums: 0,
        updatedAt: nowIso()
      }
      record.nickname = runner.nickname
      record.races = (Number(record.races) || 0) + 1
      if (index === 0) record.wins = (Number(record.wins) || 0) + 1
      if (index <= 2) record.podiums = (Number(record.podiums) || 0) + 1
      if (points > 0) {
        record.points = (Number(record.points) || 0) + points
        lines.push(`${index + 1}. ${runner.nickname} +${points}`)
      } else {
        record.points = Number(record.points) || 0
      }
      record.updatedAt = nowIso()
      data.players[runner.userId] = record
    })
    await this.writePoints(data, config)
    return lines
  }

  formatRaceResult(result, awardLines) {
    const rankingLines = result.ranking.slice(0, 8).map((runner, index) =>
      `${index + 1}. ${runner.nickname}`
    )
    return [
      "赛马结果出炉：",
      ...result.highlights.map(line => `- ${line}`),
      "",
      "名次：",
      ...rankingLines,
      "",
      awardLines.length ? `积分：\n${awardLines.join("\n")}` : "积分：本局无人获得积分"
    ].join("\n")
  }

  showScore(e) {
    const userId = String(e?.user_id || e?.sender?.user_id || "")
    if (!userId) return "没拿到你的 QQ 号。"
    const data = this.readPoints()
    const record = data.players[userId]
    if (!record) return "你还没有赛马积分。"
    return [
      `${record.nickname || userId} 的赛马积分：${Number(record.points) || 0}`,
      `胜场：${Number(record.wins) || 0}，参赛：${Number(record.races) || 0}，前三：${Number(record.podiums) || 0}`
    ].join("\n")
  }

  showRank(limit) {
    const config = this.getConfig()
    const finalLimit = safeNumber(limit, config.rankLimit, 3, 50)
    const data = this.readPoints(config)
    const ranking = Object.values(data.players || {})
      .sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0) || (Number(b.wins) || 0) - (Number(a.wins) || 0))
      .slice(0, finalLimit)

    if (!ranking.length) return "现在还没有赛马积分排行。"
    return [
      "赛马积分排行：",
      ...ranking.map((item, index) =>
        `${index + 1}. ${item.nickname || item.userId}：${Number(item.points) || 0} 分 / ${Number(item.wins) || 0} 胜`
      )
    ].join("\n")
  }

  showHelp() {
    return [
      "赛马娘小游戏：",
      ".赛马娘 开始 - 开一局",
      ".赛马娘 加入 - 报名",
      ".赛马娘 开跑 - 结算比赛",
      ".赛马娘 积分 - 查看自己的全群互通积分",
      ".赛马娘 排行 - 查看全局排行"
    ].join("\n")
  }
}

export const umaRaceManager = new UmaRaceManager()
