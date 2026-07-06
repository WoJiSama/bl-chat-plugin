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

const STRATEGIES = {
  normal: {
    label: "正常跑",
    aliases: ["默认", "均衡", "正常", "随便", "普通"],
    description: "没有短板，什么赛道都能跑",
    event: "{name} 选择正常跑，节奏很均衡，没有急着把体力交出去。",
    weights: { speed: 0.35, stamina: 0.28, focus: 0.22, luck: 0.15 },
    variance: 14,
    risk: 0.04
  },
  steady: {
    label: "稳一点",
    aliases: ["稳", "稳一点", "保守", "别浪", "稳住"],
    description: "失误少，雨天、泥地、弯道多时更舒服",
    event: "{name} 选择稳一点，前半程没有硬冲，复杂赛道反而处理得很干净。",
    weights: { speed: 0.24, stamina: 0.30, focus: 0.34, luck: 0.12 },
    variance: 8,
    risk: 0.01
  },
  burst: {
    label: "拼一把",
    aliases: ["拼", "拼一把", "冲", "赌", "莽", "全力"],
    description: "上限高，短距离和长直线更强，但可能失误",
    event: "{name} 选择拼一把，起步就把速度拉满，场面一下子紧张起来。",
    weights: { speed: 0.48, stamina: 0.18, focus: 0.14, luck: 0.20 },
    variance: 24,
    risk: 0.13
  },
  conserve: {
    label: "留体力",
    aliases: ["留体力", "后劲", "省体力", "耐力", "苟住"],
    description: "前半段不抢，长距离和最后直线更容易追回来",
    event: "{name} 选择留体力，前面看起来不急，最后直线才开始慢慢咬上来。",
    weights: { speed: 0.24, stamina: 0.42, focus: 0.20, luck: 0.14 },
    variance: 12,
    risk: 0.05
  },
  inside: {
    label: "抢内道",
    aliases: ["抢内道", "内道", "贴内", "卡位", "抢位"],
    description: "起跑和弯道有优势，人多时容易被堵",
    event: "{name} 选择抢内道，开局直接往里切，位置抢得很凶。",
    weights: { speed: 0.34, stamina: 0.22, focus: 0.30, luck: 0.14 },
    variance: 18,
    risk: 0.08
  }
}

const TRACKS = [
  {
    id: "rain_mud",
    name: "雨天泥地",
    description: "路面很滑，稳住比硬冲更重要。",
    fit: { steady: 14, conserve: 4, burst: -10, inside: -4 },
    weights: { speed: 0.26, stamina: 0.28, focus: 0.34, luck: 0.12 },
    events: [
      "{name} 过弯时压住了节奏，没有被湿滑路面带偏。",
      "{name} 起步很凶，但泥地反作用太大，节奏被迫慢了一拍。",
      "{name} 在雨里一路贴住前排，最后才开始往外拉。"
    ]
  },
  {
    id: "long_straight",
    name: "长直线",
    description: "终点前有很长一段冲刺区，爆发力会被放大。",
    fit: { burst: 12, conserve: 7, steady: -2, inside: 2 },
    weights: { speed: 0.42, stamina: 0.22, focus: 0.18, luck: 0.18 },
    events: [
      "{name} 进最后直线后突然提速，身位开始一点点追回来。",
      "{name} 前面忍了很久，直线区终于把速度放出来了。",
      "{name} 冲刺很早，但后半段还能不能撑住就有点悬了。"
    ]
  },
  {
    id: "many_corners",
    name: "弯道很多",
    description: "卡位和节奏很关键，乱冲很容易损失速度。",
    fit: { steady: 8, inside: 11, burst: -7, conserve: 2 },
    weights: { speed: 0.28, stamina: 0.23, focus: 0.36, luck: 0.13 },
    events: [
      "{name} 在连续弯道里卡住了好位置，没给后面太多空间。",
      "{name} 过弯时被挤了一下，只能先收住速度。",
      "{name} 沿着内侧一路省距离，位置看起来很漂亮。"
    ]
  },
  {
    id: "short_sprint",
    name: "短距离冲刺",
    description: "没有太多调整时间，开局和爆发最重要。",
    fit: { burst: 13, inside: 6, conserve: -8, steady: -3 },
    weights: { speed: 0.48, stamina: 0.16, focus: 0.18, luck: 0.18 },
    events: [
      "{name} 出闸就开始抢速度，短途局面一下子被拉开。",
      "{name} 想留体力，但这局距离太短，能追回来的时间不多。",
      "{name} 在前半段就完成卡位，后面的人只能硬追。"
    ]
  },
  {
    id: "endurance",
    name: "耐力赛",
    description: "距离很长，前面太急的人可能会在后段掉速。",
    fit: { conserve: 14, steady: 5, burst: -9, inside: -1 },
    weights: { speed: 0.24, stamina: 0.44, focus: 0.20, luck: 0.12 },
    events: [
      "{name} 前半段不急不躁，后半程体力优势开始显出来。",
      "{name} 一开始冲得很猛，但长距离让体力消耗变得明显。",
      "{name} 一直咬在中段，等别人掉速才慢慢往前挤。"
    ]
  }
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

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
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

  pickTrack() {
    return pick(TRACKS)
  }

  parseStrategy(input = "") {
    const text = String(input || "")
      .replace(/^[.。]赛马娘\s*(加入|参加|上马|报名)\s*/u, "")
      .trim()
    if (!text) return STRATEGIES.normal

    for (const strategy of Object.values(STRATEGIES)) {
      if (strategy.aliases.some(alias => text.includes(alias))) return strategy
    }
    return STRATEGIES.normal
  }

  formatStrategyTips() {
    return "策略：稳一点 / 拼一把 / 留体力 / 抢内道；不填就是正常跑"
  }

  formatTrack(track) {
    return `本局赛道：${track.name} - ${track.description}`
  }

  startRace(e) {
    const config = this.getConfig()
    if (!config.enabled) return "赛马娘小游戏现在没开。"
    if (!e?.group_id) return "这个小游戏要在群里玩。"

    const groupId = String(e.group_id)
    const existing = this.getRoom(groupId)
    if (existing) {
      return [
        `这一局已经开了，当前 ${existing.participants.size} 人。`,
        this.formatTrack(existing.track),
        "想参加发：.赛马娘 加入 稳一点",
        this.formatStrategyTips()
      ].join("\n")
    }

    const lastAt = this.lastRaceAt.get(groupId) || 0
    const remain = config.cooldownSeconds - Math.floor((Date.now() - lastAt) / 1000)
    if (remain > 0) return `刚跑完一局，先歇 ${formatDuration(remain)} 再开。`

    const room = {
      groupId,
      starterId: String(e.user_id || e.sender?.user_id || ""),
      createdAt: Date.now(),
      track: this.pickTrack(),
      participants: new Map()
    }
    this.rooms.set(groupId, room)
    this.joinRace(e)

    return [
      "赛马娘小游戏开局啦。",
      this.formatTrack(room.track),
      `报名：.赛马娘 加入 稳一点`,
      this.formatStrategyTips(),
      `开跑：.赛马娘 开跑`,
      `人数：${room.participants.size}/${config.maxPlayers}，至少 ${config.minPlayers} 人`
    ].join("\n")
  }

  joinRace(e, strategyText = "") {
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
    const strategy = this.parseStrategy(strategyText)
    if (room.participants.has(userId)) {
      const player = room.participants.get(userId)
      player.strategyKey = this.getStrategyKey(strategy)
      player.strategyLabel = strategy.label
      return `${this.getDisplayName(e)} 已更新策略：${strategy.label}`
    }
    if (room.participants.size >= config.maxPlayers) return "这局人满了，下一局再来。"

    room.participants.set(userId, {
      userId,
      nickname: this.getDisplayName(e),
      strategyKey: this.getStrategyKey(strategy),
      strategyLabel: strategy.label,
      joinedAt: Date.now()
    })
    return `报名成功：${this.getDisplayName(e)}，策略：${strategy.label}（${room.participants.size}/${config.maxPlayers}）`
  }

  getStrategyKey(strategy) {
    for (const [key, value] of Object.entries(STRATEGIES)) {
      if (value === strategy) return key
    }
    return "normal"
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

    const result = this.simulateRace(players, room.track)
    const awards = this.getAwards(config)
    const awardLines = await this.applyAwards(result.ranking, awards, config)
    return this.formatRaceResult(result, awardLines)
  }

  simulateRace(players, track = pick(TRACKS)) {
    const runners = players.map(player => {
      const speed = 70 + Math.random() * 35
      const stamina = 70 + Math.random() * 35
      const focus = 70 + Math.random() * 35
      const luck = 60 + Math.random() * 45
      const strategyKey = player.strategyKey && STRATEGIES[player.strategyKey] ? player.strategyKey : "normal"
      const strategy = STRATEGIES[strategyKey]
      const weights = {
        speed: (track.weights.speed + strategy.weights.speed) / 2,
        stamina: (track.weights.stamina + strategy.weights.stamina) / 2,
        focus: (track.weights.focus + strategy.weights.focus) / 2,
        luck: (track.weights.luck + strategy.weights.luck) / 2
      }
      const fitBonus = Number(track.fit?.[strategyKey]) || 0
      const riskPenalty = Math.random() < strategy.risk ? randomBetween(10, 24) : 0
      const insideCrowdPenalty = strategyKey === "inside" && players.length >= 7 ? randomBetween(0, 10) : 0
      const variance = randomBetween(-strategy.variance, strategy.variance)
      const score = speed * weights.speed +
        stamina * weights.stamina +
        focus * weights.focus +
        luck * weights.luck +
        fitBonus +
        variance -
        riskPenalty -
        insideCrowdPenalty
      return {
        ...player,
        speed,
        stamina,
        focus,
        luck,
        strategyKey,
        strategyLabel: strategy.label,
        fitBonus,
        riskPenalty,
        insideCrowdPenalty,
        score,
        event: this.buildRunnerEvent(player.nickname, strategy, track, { fitBonus, riskPenalty, insideCrowdPenalty })
      }
    })

    runners.sort((a, b) => b.score - a.score)
    const highlights = this.buildRaceHighlights(runners, track)
    return { ranking: runners, highlights, track }
  }

  buildRunnerEvent(name, strategy, track, details = {}) {
    if (details.riskPenalty > 0) {
      return `${name} 选择${strategy.label}，但这次有点用力过猛，节奏被打乱了一段。`
    }
    if (details.insideCrowdPenalty > 0) {
      return `${name} 选择抢内道，可这局人太多，刚进弯道就被堵了一下。`
    }
    if (details.fitBonus >= 8) {
      return `${name} 选择${strategy.label}，刚好很适合${track.name}，优势越跑越明显。`
    }
    if (details.fitBonus <= -7) {
      return `${name} 选择${strategy.label}，但和${track.name}不太合拍，中段有点吃亏。`
    }
    return strategy.event.replace("{name}", name)
  }

  buildRaceHighlights(runners, track) {
    const top = runners.slice(0, Math.min(4, runners.length))
    const highlightSet = new Set()
    highlightSet.add(pick(track.events).replace("{name}", top[0]?.nickname || "前排"))
    for (const runner of top) {
      if (runner?.event) highlightSet.add(runner.event)
      if (highlightSet.size >= 4) break
    }
    return [...highlightSet].slice(0, 4)
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
      `${index + 1}. ${runner.nickname}（${runner.strategyLabel || "正常跑"}）`
    )
    return [
      "赛马结果出炉：",
      this.formatTrack(result.track),
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
      ".赛马娘 加入 稳一点 - 报名，可选策略",
      "策略：稳一点 / 拼一把 / 留体力 / 抢内道；不填就是正常跑",
      ".赛马娘 开跑 - 结算比赛",
      ".赛马娘 积分 - 查看自己的全群互通积分",
      ".赛马娘 排行 - 查看全局排行"
    ].join("\n")
  }
}

export const umaRaceManager = new UmaRaceManager()
