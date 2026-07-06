import fs from "fs"
import path from "path"
import yaml from "js-yaml"

const DEFAULT_CONFIG = {
  enabled: true,
  minPlayers: 8,
  maxPlayers: 8,
  lobbySeconds: 300,
  raceStageSeconds: 45,
  cooldownSeconds: 30,
  winPoints: 5,
  secondPoints: 2,
  thirdPoints: 1,
  rankLimit: 10,
  baseDir: "data/uma_race"
}

const RACE_SIZE = 8

const RACE_STAGES = [
  {
    key: "start",
    label: "起步阶段",
    prompt: "刚出闸，抢速度和找位置都很关键。",
    event: "闸门一开，前排很快挤成一线，后面的人也在找空档。"
  },
  {
    key: "mid",
    label: "半程阶段",
    prompt: "节奏已经拉开，有人开始喘，也有人还在等机会。",
    event: "半程过后，队伍节奏明显分层，内外线都在重新洗牌。"
  },
  {
    key: "finish",
    label: "冲刺阶段",
    prompt: "最后直线到了，保住节奏还是全力冲刺都要现在决定。",
    event: "终点线已经能看见，前排开始顶速度，后排只能找最后的机会。"
  }
]

const RACE_ACTIONS = {
  speed_up: {
    label: "提速",
    aliases: ["提速", "加速", "冲", "快跑", "拉速度"],
    description: "吃速度，位置提升明显，但会消耗耐力并让节奏更紧。",
    defaultFor: ["burst"]
  },
  slow_down: {
    label: "减速",
    aliases: ["减速", "放慢", "慢一点", "缓一缓", "回复"],
    description: "位置会让一点，但能把呼吸和节奏收回来。"
  },
  steady: {
    label: "稳住",
    aliases: ["稳住", "稳一点", "稳定", "别急", "保持"],
    description: "吃稳定，波动最小，适合复杂路况。"
  },
  inside: {
    label: "抢位",
    aliases: ["抢位", "抢内道", "内道", "卡位", "贴内"],
    description: "吃判断，成功会省距离，失败会被堵。"
  },
  burst: {
    label: "爆发",
    aliases: ["爆发", "冲刺", "全力", "拼一把", "开大"],
    description: "吃爆发，冲刺收益很高，但会大量消耗余力。"
  },
  gamble: {
    label: "赌一把",
    aliases: ["赌一把", "赌", "搏一把", "莽", "看运气"],
    description: "吃运气，上下限都很大，可能突然翻盘也可能乱节奏。"
  },
  follow: {
    label: "跟跑",
    aliases: ["跟跑", "跟住", "咬住", "跟前面"],
    description: "吃判断和稳定，适合贴住前排，超车能力一般。"
  },
  pace: {
    label: "压节奏",
    aliases: ["压节奏", "留体力", "省体力", "控节奏", "攒体力"],
    description: "吃耐力和稳定，短期不抢，后段更舒服。",
    defaultFor: ["conserve"]
  }
}

const STRATEGY_DEFAULT_ACTIONS = {
  normal: "steady",
  steady: "steady",
  burst: "speed_up",
  conserve: "pace",
  inside: "inside"
}

const NPC_NAMES = [
  "晨间训练员",
  "栗色围巾",
  "弯道观察员",
  "终点裁判",
  "薄荷汽水",
  "夜樱看台",
  "红茶加冰",
  "星砂领航"
]

const NPC_UMA_PREFIXES = [
  "栗毛",
  "晨风",
  "青叶",
  "星砂",
  "白露",
  "红茶",
  "薄荷",
  "夜樱"
]

const NPC_UMA_SUFFIXES = [
  "流星",
  "疾驰",
  "弯道",
  "终线",
  "小步",
  "追光",
  "回响",
  "闪击"
]

const ATTRIBUTE_DEFS = [
  { key: "speed", label: "速度" },
  { key: "stamina", label: "耐力" },
  { key: "power", label: "爆发" },
  { key: "focus", label: "稳定" },
  { key: "wisdom", label: "判断" },
  { key: "luck", label: "运气" }
]

const ATTRIBUTE_TOTAL = 40
const ATTRIBUTE_MAX = 50
const ATTRIBUTE_MIN = 1

const ATTRIBUTE_ALIASES = {
  speed: ["速度", "速"],
  stamina: ["耐力", "体力"],
  power: ["爆发", "力量", "冲刺"],
  focus: ["稳定", "稳"],
  wisdom: ["判断", "智力", "策略"],
  luck: ["运气", "幸运"]
}

const TRAINING_TYPES = {
  basic: {
    label: "基础训练",
    aliases: ["基础", "普通", "基础训练"],
    cost: 2,
    baseRate: 0.9,
    decay: 0.008,
    minRate: 0.55,
    gain: 1,
    maxTargetValue: 19,
    pity: 3,
    failPenaltyCount: 1,
    failPenaltyChance: 0.25
  },
  hard: {
    label: "强化训练",
    aliases: ["强化", "强训", "强化训练"],
    cost: 5,
    baseRate: 0.75,
    decay: 0.01,
    minRate: 0.35,
    gain: 3,
    pity: 4,
    failPenaltyCount: 1,
    failPenaltyChance: 0.6
  },
  gamble: {
    label: "赌狗训练",
    aliases: ["赌狗", "赌博", "赌", "搏一把", "赌狗训练"],
    cost: 8,
    baseRate: 0.5,
    decay: 0.0064,
    minRate: 0.18,
    gain: 5,
    critGain: 7,
    critRate: 0.2,
    pity: 5,
    failPenaltyCount: 3,
    failPenaltyChance: 1,
    failTargetPenaltyChance: 0.45
  }
}

const PERSONALITY_ATTRIBUTE_RULES = [
  { pattern: /温柔|体贴|照顾|可靠|沉稳|稳重|安静|冷静|害羞|内向/, add: { focus: 3, wisdom: 2, stamina: 1 } },
  { pattern: /活泼|元气|开朗|外向|吵闹|调皮|快乐|阳光/, add: { speed: 3, luck: 2, power: 1 } },
  { pattern: /不服输|热血|胜负欲|骄傲|倔强|拼命|冲动|莽|强势/, add: { power: 4, speed: 2 } },
  { pattern: /聪明|机灵|冷静|理性|策略|观察|判断|腹黑|狡猾/, add: { wisdom: 4, focus: 2 } },
  { pattern: /耐心|坚韧|努力|认真|持久|长跑|能忍|执着/, add: { stamina: 4, focus: 2 } },
  { pattern: /幸运|随缘|玄学|天选|欧皇|奇迹/, add: { luck: 5, speed: 1 } },
  { pattern: /自由|飘忽|神秘|浪漫|梦幻|天然|迷糊/, add: { luck: 3, wisdom: 2, speed: 1 } },
  { pattern: /优雅|高贵|大小姐|端庄|自信|从容/, add: { wisdom: 3, focus: 2, power: 1 } }
]

const PERSONALITY_TRAITS = [
  {
    key: "gentle",
    label: "温柔可靠",
    pattern: /温柔|体贴|照顾|可靠|沉稳|稳重|安静|害羞|内向/,
    fit: { steady: 5, conserve: 3, burst: -2 },
    sceneFit: { rain_mud: 4, night_race: 3 },
    description: "复杂赛况下更稳，保守策略更容易发挥。"
  },
  {
    key: "competitive",
    label: "不服输",
    pattern: /不服输|热血|胜负欲|骄傲|倔强|拼命|冲动|莽|强势/,
    fit: { burst: 6, inside: 2, conserve: -3 },
    sceneFit: { long_straight: 4, uphill_finish: 3, endurance: -3 },
    riskAdjust: 0.04,
    description: "冲刺和对抗更强，但激进策略更容易出风险。"
  },
  {
    key: "calm",
    label: "冷静策略",
    pattern: /聪明|机灵|冷静|理性|策略|观察|判断|腹黑|狡猾/,
    fit: { steady: 4, normal: 4, inside: 2 },
    sceneFit: { many_corners: 4, downhill_corner: 4, night_race: 3 },
    description: "复杂路线和变化节奏里更容易做出正确判断。"
  },
  {
    key: "patient",
    label: "耐心坚韧",
    pattern: /耐心|坚韧|努力|认真|持久|长跑|能忍|执着/,
    fit: { conserve: 6, steady: 3, burst: -2 },
    sceneFit: { endurance: 5, uphill_finish: 4, sand_track: 3 },
    description: "长距离、重场地和后半段更有优势。"
  },
  {
    key: "lucky",
    label: "天然幸运",
    pattern: /幸运|随缘|玄学|天选|欧皇|奇迹|自由|飘忽|神秘|浪漫|梦幻|天然|迷糊/,
    fit: { normal: 3, burst: 2, inside: 1 },
    sceneFit: { short_sprint: 2 },
    varianceBonus: 8,
    luckBonus: 8,
    description: "随机波动更大，运气好的时候能突然翻盘。"
  },
  {
    key: "elegant",
    label: "优雅从容",
    pattern: /优雅|高贵|大小姐|端庄|自信|从容/,
    fit: { normal: 4, steady: 3, inside: 2 },
    sceneFit: { night_race: 4, long_straight: 2 },
    description: "节奏稳定，越是需要姿态和判断的赛况越舒服。"
  }
]

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
  },
  {
    id: "uphill_finish",
    name: "上坡终点",
    description: "最后一段是明显上坡，耐力和爆发缺一不可。",
    fit: { conserve: 8, burst: 6, steady: 3, inside: -3 },
    weights: { speed: 0.28, stamina: 0.36, focus: 0.18, luck: 0.18 },
    events: [
      "{name} 进上坡后还在顶着往前压，后劲开始变得关键。",
      "{name} 提前冲上坡，速度很漂亮，但体力消耗也很明显。",
      "{name} 在坡道前留了一口气，最后几步反而越跑越稳。"
    ]
  },
  {
    id: "downhill_corner",
    name: "下坡弯道",
    description: "下坡接连续弯，速度容易起来，失误也会被放大。",
    fit: { steady: 8, inside: 7, normal: 2, burst: -5 },
    weights: { speed: 0.32, stamina: 0.18, focus: 0.38, luck: 0.12 },
    events: [
      "{name} 下坡进弯时收得很准，没有被速度拖出路线。",
      "{name} 借下坡把速度带起来，但弯道里每一步都很考验控制。",
      "{name} 贴着内侧过弯，距离省得漂亮，位置也抢住了。"
    ]
  },
  {
    id: "sand_track",
    name: "沙地赛道",
    description: "脚下阻力很重，力量和耐力会比纯速度更重要。",
    fit: { conserve: 8, steady: 5, burst: -4, inside: -5 },
    weights: { speed: 0.22, stamina: 0.34, focus: 0.26, luck: 0.18 },
    events: [
      "{name} 在沙地里步幅很稳，没有被厚重阻力拖散节奏。",
      "{name} 起步很快，但沙地吃力，后面能不能撑住还不好说。",
      "{name} 沿着较硬的路线往前挤，速度没有掉得太难看。"
    ]
  },
  {
    id: "night_race",
    name: "夜间赛",
    description: "视野和判断更重要，临场稳定性会被放大。",
    fit: { steady: 7, normal: 5, inside: 2, burst: -3 },
    weights: { speed: 0.30, stamina: 0.22, focus: 0.32, luck: 0.16 },
    events: [
      "{name} 在夜色里判断路线很冷静，没有被前排动作带乱。",
      "{name} 借着灯光找到空档，一点点把位置挤了出来。",
      "{name} 夜间节奏有点微妙，但脚步还算稳。"
    ]
  }
]

const RACE_TWISTS = [
  {
    name: "慢节奏",
    description: "前半程没人愿意带速度，后半段才突然开始提速。",
    fit: { conserve: 6, steady: 4, burst: -3, inside: -2, normal: 1 },
    event: "{name} 被慢节奏拖住了一会儿，最后才找到加速窗口。"
  },
  {
    name: "突然提速",
    description: "中段有人强行拉速度，比赛节奏被提前点燃。",
    fit: { burst: 8, inside: 4, conserve: -6, steady: -1, normal: 1 },
    event: "{name} 正好接住了中段提速，位置一下子变得有威胁。"
  },
  {
    name: "位置混战",
    description: "前排互相卡位，抢线和避让都变得更重要。",
    fit: { inside: 7, steady: 5, burst: -4, conserve: -2, normal: 0 },
    event: "{name} 在混战里一直找缝，几次差点被挤出路线。"
  },
  {
    name: "外道顺风",
    description: "外侧风向很好，后排和外侧冲刺更容易打开空间。",
    fit: { burst: 5, conserve: 5, inside: -6, steady: 0, normal: 2 },
    event: "{name} 从外侧借到顺风，最后一段速度明显起来了。"
  },
  {
    name: "节奏很乱",
    description: "全程几次变速，稳定和运气都会被放大。",
    fit: { steady: 5, normal: 4, burst: -2, conserve: -2, inside: -1 },
    event: "{name} 在乱节奏里没有慌，几次变速都跟得还算稳。"
  },
  {
    name: "终点前逆风",
    description: "最后直线逆风明显，太早冲刺的人容易被反噬。",
    fit: { steady: 5, conserve: 4, burst: -8, inside: 1, normal: 2 },
    event: "{name} 顶着逆风往前压，冲刺没有想象中那么轻松。"
  }
]

const RACE_SCENES = [
  {
    name: "大雨突袭",
    description: "比赛中突然下起大雨，稳定处理和保守节奏更吃香。",
    fit: { steady: 8, conserve: 4, normal: 1, burst: -7, inside: -3 },
    event: "{name} 顶着突然变大的雨势稳住步伐，没有被路面变化带乱。"
  },
  {
    name: "观众欢呼",
    description: "看台声浪很大，爆发和运气的波动都会变强。",
    fit: { burst: 7, normal: 3, inside: 2, steady: -1, conserve: -2 },
    event: "{name} 被看台声浪带起了气势，冲刺动作突然变得更果断。"
  },
  {
    name: "起跑失误",
    description: "起跑区出现小混乱，太激进的策略更容易吃亏。",
    fit: { steady: 7, normal: 4, conserve: 2, burst: -8, inside: -5 },
    event: "{name} 起跑阶段被小混乱影响了一下，但很快把节奏找了回来。"
  },
  {
    name: "最后弯道堵车",
    description: "终点前的弯道挤成一团，抢内道可能大赚也可能被堵死。",
    fit: { inside: 5, steady: 4, burst: -4, conserve: -1, normal: 1 },
    event: "{name} 在最后弯道里找缝钻出，差一点就被前排完全堵住。"
  }
]

const CONDITION_EVENTS = [
  { min: 8, text: "{name} 今天状态很好，脚步明显比平时轻。" },
  { min: 4, text: "{name} 热身感觉不错，中段还多留了一点余力。" },
  { min: -3, text: "{name} 状态普通，基本按自己的节奏在跑。" },
  { min: -7, text: "{name} 今天状态有点紧，前半段没完全放开。" },
  { min: -99, text: "{name} 起跑前就有点不在状态，只能边跑边找感觉。" }
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

function hashString(text = "") {
  let hash = 2166136261
  for (const char of String(text)) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = Math.imul(state + 0x6D2B79F5, 0x85EBCA6B) >>> 0
    state ^= state >>> 13
    state = Math.imul(state, 0xC2B2AE35) >>> 0
    return ((state ^ (state >>> 16)) >>> 0) / 4294967296
  }
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
      minPlayers: RACE_SIZE,
      maxPlayers: RACE_SIZE,
      lobbySeconds: safeNumber(raw.lobbySeconds, DEFAULT_CONFIG.lobbySeconds, 10, 300),
      raceStageSeconds: safeNumber(raw.raceStageSeconds, DEFAULT_CONFIG.raceStageSeconds, 10, 180),
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

  getUserId(e) {
    return String(e?.user_id || e?.sender?.user_id || "")
  }

  getPlayerRecord(userId, config = this.getConfig()) {
    if (!userId) return null
    const data = this.readPoints(config)
    return data.players?.[String(userId)] || null
  }

  getPlayerUma(userId, config = this.getConfig()) {
    const record = this.getPlayerRecord(userId, config)
    return record?.uma && this.isValidAttributes(record.uma.attributes) ? record.uma : null
  }

  async ensurePlayerUmaTrait(userId, config = this.getConfig()) {
    if (!userId) return null
    const data = this.readPoints(config)
    const record = data.players?.[String(userId)]
    const uma = record?.uma
    if (!uma || !this.isValidAttributes(uma.attributes)) return null
    const previousKey = uma.trait?.key
    const trait = this.normalizeUmaTrait(uma)
    if (uma.trait?.key !== previousKey) {
      record.updatedAt = nowIso()
      data.players[String(userId)] = record
      await this.writePoints(data, config)
    }
    return { uma, trait }
  }

  isValidAttributes(attributes = {}) {
    return ATTRIBUTE_DEFS.every(def => Number.isFinite(Number(attributes[def.key])))
  }

  parseAdoptionInput(msg = "") {
    const text = String(msg || "")
      .replace(/^[.。]赛马娘\s*(重新领养|领养|创建|注册)\s*/u, "")
      .trim()
    if (!text) return null
    const [name = "", ...rest] = text.split(/\s+/)
    const personality = rest.join(" ").trim()
    return {
      name: escapeName(name).slice(0, 12),
      personality: personality.slice(0, 120)
    }
  }

  buildAttributeScores(personality = "") {
    const scores = Object.fromEntries(ATTRIBUTE_DEFS.map(def => [def.key, 1]))
    for (const rule of PERSONALITY_ATTRIBUTE_RULES) {
      if (!rule.pattern.test(personality)) continue
      for (const [key, value] of Object.entries(rule.add || {})) {
        scores[key] = (scores[key] || 1) + value
      }
    }
    return scores
  }

  generateAttributes(name = "", personality = "", total = ATTRIBUTE_TOTAL) {
    const targetTotal = this.normalizeAttributeTargetTotal(total)
    const base = Object.fromEntries(ATTRIBUTE_DEFS.map(def => [def.key, 4]))
    const extraPoints = targetTotal - ATTRIBUTE_DEFS.length * 4
    let remaining = extraPoints
    const scores = this.buildAttributeScores(`${name} ${personality}`)
    const totalScore = ATTRIBUTE_DEFS.reduce((sum, def) => sum + (scores[def.key] || 1), 0)
    const fractional = []

    for (const def of ATTRIBUTE_DEFS) {
      const exact = extraPoints * (scores[def.key] || 1) / totalScore
      const add = Math.floor(exact)
      base[def.key] += add
      fractional.push({ key: def.key, rest: exact - add })
      remaining -= add
    }

    const random = seededRandom(hashString(`${name}|${personality}`))
    fractional.sort((a, b) => b.rest - a.rest || random() - 0.5)
    for (let index = 0; index < remaining; index++) {
      base[fractional[index % fractional.length].key] += 1
    }

    this.normalizeAttributeTotal(base, targetTotal)
    return base
  }

  inferPersonalityTrait(name = "", personality = "") {
    const text = `${name} ${personality}`
    return PERSONALITY_TRAITS.find(trait => trait.pattern.test(text)) || {
      key: "balanced",
      label: "均衡适应",
      fit: { normal: 3, steady: 1, conserve: 1, burst: 1, inside: 1 },
      sceneFit: {},
      description: "没有明显偏科，什么场景都能按自己的节奏跑。"
    }
  }

  normalizeUmaTrait(uma = {}) {
    const trait = this.inferPersonalityTrait(uma.name, uma.personality)
    if (!uma.trait || uma.trait.key !== trait.key) {
      uma.trait = {
        key: trait.key,
        label: trait.label,
        description: trait.description
      }
    }
    return trait
  }

  normalizeAttributeTargetTotal(total) {
    const minTotal = ATTRIBUTE_DEFS.length * 4
    const value = Math.round(Number(total) || ATTRIBUTE_TOTAL)
    return Math.max(minTotal, value)
  }

  normalizeAttributeTotal(attributes, targetTotal = ATTRIBUTE_TOTAL) {
    targetTotal = this.normalizeAttributeTargetTotal(targetTotal)
    let total = this.sumAttributes(attributes)
    const order = [...ATTRIBUTE_DEFS].sort((a, b) => Number(attributes[b.key]) - Number(attributes[a.key]))
    while (total > targetTotal) {
      const target = order.find(def => attributes[def.key] > 1)
      if (!target) break
      attributes[target.key] -= 1
      total--
    }
    let addIndex = 0
    while (total < targetTotal) {
      attributes[ATTRIBUTE_DEFS[addIndex % ATTRIBUTE_DEFS.length].key] += 1
      addIndex++
      total++
    }
  }

  sumAttributes(attributes = {}) {
    return ATTRIBUTE_DEFS.reduce((sum, def) => sum + (Number(attributes[def.key]) || 0), 0)
  }

  formatAttributes(attributes = {}) {
    return ATTRIBUTE_DEFS
      .map(def => `${def.label}${Number(attributes[def.key]) || 0}`)
      .join(" / ")
  }

  formatTrainingAttributes(attributes = {}) {
    return ATTRIBUTE_DEFS
      .map(def => `${def.label}${Number(attributes[def.key]) || 0}/${ATTRIBUTE_MAX}`)
      .join(" / ")
  }

  async adoptUma(e, { overwrite = false } = {}) {
    const config = this.getConfig()
    if (!config.enabled) return "赛马娘小游戏现在没开。"
    const userId = this.getUserId(e)
    if (!userId) return "没拿到你的 QQ 号，领养失败。"
    const parsed = this.parseAdoptionInput(e?.msg)
    if (!parsed?.name) {
      return "格式：.赛马娘 领养 名字 性格描述\n例如：.赛马娘 领养 小春 温柔但不服输，关键时刻会拼一把"
    }
    if (!parsed.personality) {
      return "还需要写一点期待的性格描述，例如：温柔但不服输。"
    }

    const data = this.readPoints(config)
    const record = data.players[userId] || {
      userId,
      nickname: this.getDisplayName(e),
      points: 0,
      wins: 0,
      races: 0,
      podiums: 0,
      updatedAt: nowIso()
    }
    if (record.uma && !overwrite) {
      return `你已经领养了「${record.uma.name}」。如果要重建，使用：.赛马娘 重新领养 名字 性格描述`
    }

    const uma = {
      name: parsed.name,
      personality: parsed.personality,
      attributes: this.generateAttributes(parsed.name, parsed.personality),
      total: ATTRIBUTE_TOTAL,
      createdAt: nowIso()
    }
    this.normalizeUmaTrait(uma)
    record.nickname = this.getDisplayName(e)
    record.uma = uma
    record.updatedAt = nowIso()
    data.players[userId] = record
    await this.writePoints(data, config)

    return [
      `领养成功：${uma.name}`,
      `性格：${uma.personality}`,
      `特质：${uma.trait.label} - ${uma.trait.description}`,
      `六维：${this.formatAttributes(uma.attributes)}`,
      `初始总点数：${this.sumAttributes(uma.attributes)}`
    ].join("\n")
  }

  showUma(e) {
    const userId = this.getUserId(e)
    if (!userId) return "没拿到你的 QQ 号。"
    const record = this.getPlayerRecord(userId)
    const uma = record?.uma
    if (!uma) return "你还没有领养赛马娘。格式：.赛马娘 领养 名字 性格描述"
    const trait = this.normalizeUmaTrait(uma)
    return [
      `你的赛马娘：${uma.name}`,
      `性格：${uma.personality || "未记录"}`,
      `特质：${trait.label} - ${trait.description}`,
      `六维：${this.formatAttributes(uma.attributes)}`,
      `初始总点数：${this.sumAttributes(uma.attributes)}`,
      `积分：${Number(record.points) || 0}，胜场：${Number(record.wins) || 0}，参赛：${Number(record.races) || 0}`
    ].join("\n")
  }

  parseTrainingInput(msg = "") {
    const text = String(msg || "")
      .replace(/^[.。]赛马娘\s*训练\s*/u, "")
      .trim()
    if (!text) return null
    const parts = text.split(/\s+/).filter(Boolean)
    return {
      type: this.resolveTrainingType(parts[0] || text),
      attribute: this.resolveAttribute(parts.slice(1).join(" ") || parts[1] || text),
      raw: text
    }
  }

  resolveTrainingType(text = "") {
    const normalized = String(text || "").trim()
    for (const [key, type] of Object.entries(TRAINING_TYPES)) {
      if (type.aliases.some(alias => normalized.includes(alias))) return { key, ...type }
    }
    return null
  }

  resolveAttribute(text = "") {
    const normalized = String(text || "").trim()
    for (const def of ATTRIBUTE_DEFS) {
      const aliases = ATTRIBUTE_ALIASES[def.key] || [def.label]
      if (aliases.some(alias => normalized.includes(alias))) return def
    }
    return null
  }

  getTrainingPity(record, typeKey, attrKey) {
    return Number(record?.trainingPity?.[typeKey]?.[attrKey]) || 0
  }

  setTrainingPity(record, typeKey, attrKey, value) {
    if (!record.trainingPity || typeof record.trainingPity !== "object") record.trainingPity = {}
    if (!record.trainingPity[typeKey] || typeof record.trainingPity[typeKey] !== "object") record.trainingPity[typeKey] = {}
    record.trainingPity[typeKey][attrKey] = Math.max(0, Math.floor(Number(value) || 0))
  }

  getTrainingSuccessRate(type, currentValue) {
    const value = Math.max(ATTRIBUTE_MIN, Number(currentValue) || ATTRIBUTE_MIN)
    return Math.max(type.minRate, type.baseRate - value * type.decay)
  }

  async trainUma(e) {
    const config = this.getConfig()
    if (!config.enabled) return "赛马娘小游戏现在没开。"
    const userId = this.getUserId(e)
    if (!userId) return "没拿到你的 QQ 号，训练失败。"

    const parsed = this.parseTrainingInput(e?.msg)
    if (!parsed?.type || !parsed?.attribute) {
      return [
        "格式：.赛马娘 训练 基础 速度",
        "训练类型：基础 / 强化 / 赌狗",
        "属性：速度 / 耐力 / 爆发 / 稳定 / 判断 / 运气"
      ].join("\n")
    }

    const data = this.readPoints(config)
    const record = data.players?.[userId]
    const uma = record?.uma
    if (!uma || !this.isValidAttributes(uma.attributes)) {
      return "你还没有领养赛马娘。先用：.赛马娘 领养 名字 性格描述"
    }

    const currentPoints = Number(record.points) || 0
    if (currentPoints < parsed.type.cost) {
      return [
        `${uma.name} 当前属性：`,
        this.formatTrainingAttributes(uma.attributes),
        `当前积分：${currentPoints}`,
        "",
        `${parsed.type.label}需要 ${parsed.type.cost} 积分，积分不够。`
      ].join("\n")
    }

    const beforeAttributes = { ...uma.attributes }
    const currentValue = Number(uma.attributes[parsed.attribute.key]) || ATTRIBUTE_MIN
    if (currentValue >= ATTRIBUTE_MAX) {
      return [
        `${uma.name} 当前属性：`,
        this.formatTrainingAttributes(uma.attributes),
        `当前积分：${currentPoints}`,
        "",
        `${parsed.attribute.label}已经到上限 ${ATTRIBUTE_MAX}，这次不用训练。`
      ].join("\n")
    }
    if (parsed.type.maxTargetValue && currentValue > parsed.type.maxTargetValue) {
      return [
        `${uma.name} 当前属性：`,
        this.formatTrainingAttributes(uma.attributes),
        `当前积分：${currentPoints}`,
        "",
        `${parsed.attribute.label}已经达到 ${currentValue}，基础训练不能继续提升这个属性。`,
        "可以改用：.赛马娘 训练 强化 [属性] 或 .赛马娘 训练 赌狗 [属性]"
      ].join("\n")
    }

    const successRate = this.getTrainingSuccessRate(parsed.type, currentValue)
    const pityBefore = this.getTrainingPity(record, parsed.type.key, parsed.attribute.key)
    const forcedByPity = pityBefore >= parsed.type.pity
    const success = forcedByPity || Math.random() < successRate
    const resultLines = []
    let actualGain = 0
    let penaltyLines = []

    record.points = currentPoints - parsed.type.cost
    if (success) {
      const gain = parsed.type.critGain && !forcedByPity && Math.random() < parsed.type.critRate
        ? parsed.type.critGain
        : parsed.type.gain
      const before = Number(uma.attributes[parsed.attribute.key]) || ATTRIBUTE_MIN
      const after = Math.min(ATTRIBUTE_MAX, before + gain)
      actualGain = after - before
      uma.attributes[parsed.attribute.key] = after
      this.setTrainingPity(record, parsed.type.key, parsed.attribute.key, 0)
      resultLines.push("结果：成功")
      resultLines.push(actualGain > 0
        ? `${parsed.attribute.label} +${actualGain}`
        : `${parsed.attribute.label} 已到上限 ${ATTRIBUTE_MAX}`)
    } else {
      this.setTrainingPity(record, parsed.type.key, parsed.attribute.key, pityBefore + 1)
      penaltyLines = this.applyTrainingPenalty(uma.attributes, parsed.attribute.key, parsed.type)
      resultLines.push("结果：失败")
      resultLines.push(penaltyLines.length ? penaltyLines.join("，") : "没有额外掉属性")
    }

    uma.total = this.sumAttributes(uma.attributes)
    record.nickname = this.getDisplayName(e)
    record.updatedAt = nowIso()
    data.players[userId] = record
    await this.writePoints(data, config)

    return [
      `${uma.name} 当前属性：`,
      this.formatTrainingAttributes(beforeAttributes),
      `当前积分：${currentPoints}`,
      "",
      `训练：${parsed.type.label} - ${parsed.attribute.label}`,
      `消耗：${parsed.type.cost} 积分`,
      "",
      ...resultLines,
      "",
      "训练后：",
      this.formatTrainingAttributes(uma.attributes),
      `剩余积分：${record.points}`
    ].join("\n")
  }

  applyTrainingPenalty(attributes, targetKey, type) {
    if (Math.random() >= type.failPenaltyChance) return []
    const keys = ATTRIBUTE_DEFS
      .map(def => def.key)
      .filter(key => key !== targetKey && (Number(attributes[key]) || ATTRIBUTE_MIN) > ATTRIBUTE_MIN)
    const lines = []
    const targetDef = ATTRIBUTE_DEFS.find(item => item.key === targetKey)
    if (type.failTargetPenaltyChance && Math.random() < type.failTargetPenaltyChance) {
      const before = Number(attributes[targetKey]) || ATTRIBUTE_MIN
      const after = Math.max(ATTRIBUTE_MIN, before - 1)
      attributes[targetKey] = after
      if (after < before) lines.push(`${targetDef?.label || targetKey} -1`)
    }
    for (let index = 0; index < type.failPenaltyCount && keys.length; index++) {
      const key = keys.splice(Math.floor(Math.random() * keys.length), 1)[0]
      const def = ATTRIBUTE_DEFS.find(item => item.key === key)
      const before = Number(attributes[key]) || ATTRIBUTE_MIN
      const after = Math.max(ATTRIBUTE_MIN, before - 1)
      attributes[key] = after
      if (after < before) lines.push(`${def?.label || key} -1`)
    }
    return lines
  }

  showTrainingStatus(e) {
    const userId = this.getUserId(e)
    if (!userId) return "没拿到你的 QQ 号。"
    const record = this.getPlayerRecord(userId)
    const uma = record?.uma
    if (!uma || !this.isValidAttributes(uma.attributes)) {
      return "你还没有领养赛马娘。先用：.赛马娘 领养 名字 性格描述"
    }
    return [
      "赛马娘训练：",
      `${uma.name} 当前属性：`,
      this.formatTrainingAttributes(uma.attributes),
      `当前积分：${Number(record.points) || 0}`,
      "",
      "训练方式：",
      ".赛马娘 训练 基础 [属性] - 消耗 2 积分，单项 20 后不可用",
      ".赛马娘 训练 强化 [属性] - 消耗 5 积分，提升更多但有风险",
      ".赛马娘 训练 赌狗 [属性] - 消耗 8 积分，波动最大",
      "",
      "属性：速度 / 耐力 / 爆发 / 稳定 / 判断 / 运气",
      "满值：每项 50"
    ].join("\n")
  }

  async abandonUma(e, { confirm = false } = {}) {
    const config = this.getConfig()
    if (!config.enabled) return "赛马娘小游戏现在没开。"
    const userId = this.getUserId(e)
    if (!userId) return "没拿到你的 QQ 号，弃养失败。"

    const data = this.readPoints(config)
    const record = data.players?.[userId]
    const uma = record?.uma
    if (!uma) return "你现在没有领养赛马娘。"
    if (!confirm) {
      return `确认要弃养「${uma.name}」吗？积分和历史战绩会保留，但这匹小马的六维档案会删除。\n确认请发：.赛马娘 弃养 确认`
    }

    delete record.uma
    record.nickname = this.getDisplayName(e)
    record.updatedAt = nowIso()
    data.players[userId] = record
    await this.writePoints(data, config)

    const removedFromRoom = this.removeUserFromActiveRoom(e, userId)
    return [
      `已弃养：${uma.name}`,
      "你的积分和历史战绩已保留。",
      removedFromRoom ? "你也已从当前赛马局报名列表中移除。" : ""
    ].filter(Boolean).join("\n")
  }

  removeUserFromActiveRoom(e, userId) {
    if (!e?.group_id || !userId) return false
    const room = this.getRoom(e.group_id)
    if (!room?.participants?.has(userId)) return false
    room.participants.delete(userId)
    return true
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

  pickTwist() {
    return pick(RACE_TWISTS)
  }

  pickScene() {
    return pick(RACE_SCENES)
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

  async startRace(e) {
    const config = this.getConfig()
    if (!config.enabled) return "赛马娘小游戏现在没开。"
    if (!e?.group_id) return "这个小游戏要在群里玩。"
    if (!this.getPlayerUma(this.getUserId(e), config)) {
      return "你还没有领养自己的赛马娘。先用：.赛马娘 领养 名字 性格描述"
    }

    const groupId = String(e.group_id)
    const existing = this.getRoom(groupId)
    if (existing) {
      if (existing.phase === "race") {
        return this.formatActiveRaceStatus(existing)
      }
      return [
        `这一局已经开了，当前 ${existing.participants.size} 人。`,
        this.formatTrack(existing.track),
        "想参加发：.赛马娘 加入 [策略]",
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
      phase: "lobby",
      track: this.pickTrack(),
      participants: new Map(),
      event: e,
      timer: null
    }
    this.rooms.set(groupId, room)
    await this.joinRace(e)
    const starter = room.participants.get(this.getUserId(e))
    const starterLine = starter
      ? `已自动报名：${starter.nickname}「${starter.umaName}」`
      : "已自动报名开局者"

    return [
      "赛马娘小游戏开局啦。",
      this.formatTrack(room.track),
      starterLine,
      `报名：.赛马娘 加入 [策略]`,
      this.formatStrategyTips(),
      `开跑：.赛马娘 开跑`,
      `人数：${room.participants.size}/${RACE_SIZE}，开跑不够 ${RACE_SIZE} 人会补 NPC`
    ].join("\n")
  }

  async joinRace(e, strategyText = "") {
    const config = this.getConfig()
    if (!config.enabled) return "赛马娘小游戏现在没开。"
    if (!e?.group_id) return "这个小游戏要在群里玩。"

    const groupId = String(e.group_id)
    let room = this.getRoom(groupId)
    let createdByJoin = false
    const userId = String(e.user_id || e.sender?.user_id || "")
    if (!userId) return "没拿到你的 QQ 号，报名失败。"
    const owned = await this.ensurePlayerUmaTrait(userId, config)
    if (!owned?.uma) return "你还没有领养自己的赛马娘。先用：.赛马娘 领养 名字 性格描述"
    const { uma, trait } = owned

    if (!room) {
      const lastAt = this.lastRaceAt.get(groupId) || 0
      const remain = config.cooldownSeconds - Math.floor((Date.now() - lastAt) / 1000)
      if (remain > 0) return `刚跑完一局，先歇 ${formatDuration(remain)} 再开。`

      room = {
        groupId,
        starterId: userId,
        createdAt: Date.now(),
        phase: "lobby",
        track: this.pickTrack(),
        participants: new Map(),
        event: e,
        timer: null
      }
      this.rooms.set(groupId, room)
      createdByJoin = true
    }

    if (room.phase === "race") {
      return [
        "这一局已经开跑了，不能再报名。",
        this.formatActiveRaceStatus(room)
      ].join("\n")
    }

    const elapsed = Math.floor((Date.now() - room.createdAt) / 1000)
    if (elapsed > config.lobbySeconds) {
      this.clearAutoStart(room)
      this.rooms.delete(groupId)
      const lastAt = this.lastRaceAt.get(groupId) || 0
      const remain = config.cooldownSeconds - Math.floor((Date.now() - lastAt) / 1000)
      if (remain > 0) return `上一局报名超时了，刚跑完一局，先歇 ${formatDuration(remain)} 再开。`

      room = {
        groupId,
        starterId: userId,
        createdAt: Date.now(),
        phase: "lobby",
        track: this.pickTrack(),
        participants: new Map(),
        event: e,
        timer: null
      }
      this.rooms.set(groupId, room)
      createdByJoin = true
    }

    const strategy = this.parseStrategy(strategyText)
    if (room.participants.has(userId)) {
      const player = room.participants.get(userId)
      player.strategyKey = this.getStrategyKey(strategy)
      player.strategyLabel = strategy.label
      room.createdAt = Date.now()
      room.event = e
      this.scheduleAutoStart(room, config)
      return `${this.getDisplayName(e)} 选择了${strategy.label}，已更新策略。`
    }
    if (room.participants.size >= config.maxPlayers) return "这局人满了，下一局再来。"

    room.participants.set(userId, {
      userId,
      nickname: this.getDisplayName(e),
      umaName: uma.name,
      attributes: uma.attributes,
      personality: uma.personality,
      traitKey: trait.key,
      traitLabel: trait.label,
      strategyKey: this.getStrategyKey(strategy),
      strategyLabel: strategy.label,
      joinedAt: Date.now()
    })
    room.createdAt = Date.now()
    room.event = e
    this.scheduleAutoStart(room, config)
    if (createdByJoin) {
      return [
        "赛马娘小游戏开局啦。",
        this.formatTrack(room.track),
        `报名成功：${this.getDisplayName(e)} 的「${uma.name}」`,
        `${this.getDisplayName(e)} 选择了${strategy.label}`,
        `报名：.赛马娘 加入 [策略]`,
        this.formatStrategyTips(),
        `开跑：.赛马娘 开跑`,
        `人数：${room.participants.size}/${RACE_SIZE}，开跑不够 ${RACE_SIZE} 人会补 NPC`
      ].join("\n")
    }
    return [
      `报名成功：${this.getDisplayName(e)} 的「${uma.name}」（${room.participants.size}/${config.maxPlayers}）`,
      `${this.getDisplayName(e)} 选择了${strategy.label}`
    ].join("\n")
  }

  scheduleAutoStart(room, config = this.getConfig()) {
    if (!room) return
    this.clearAutoStart(room)
    const delayMs = Math.max(1, Number(config.lobbySeconds) || DEFAULT_CONFIG.lobbySeconds) * 1000
    room.timer = setTimeout(() => {
      this.autoStartRace(room.groupId).catch(error => {
        this.logger?.warn?.(`[赛马娘小游戏] 自动开赛失败: ${error.message}`)
      })
    }, delayMs)
    room.timer.unref?.()
  }

  clearAutoStart(room) {
    if (room?.timer) {
      clearTimeout(room.timer)
      room.timer = null
    }
  }

  scheduleStageAdvance(room, config = this.getConfig()) {
    if (!room || room.phase !== "race") return
    this.clearStageTimer(room)
    const delayMs = Math.max(1, Number(config.raceStageSeconds) || DEFAULT_CONFIG.raceStageSeconds) * 1000
    room.stageTimer = setTimeout(() => {
      this.advanceRaceStage(room.groupId).catch(error => {
        this.logger?.warn?.(`[赛马娘小游戏] 阶段推进失败: ${error.message}`)
      })
    }, delayMs)
    room.stageTimer.unref?.()
  }

  clearStageTimer(room) {
    if (room?.stageTimer) {
      clearTimeout(room.stageTimer)
      room.stageTimer = null
    }
  }

  async autoStartRace(groupId) {
    const room = this.getRoom(groupId)
    if (!room) return
    const event = room.event
    if (!event?.reply) {
      this.rooms.delete(String(groupId || ""))
      return
    }
    if (!room.participants?.size) {
      this.clearAutoStart(room)
      this.rooms.delete(String(groupId || ""))
      await event.reply("报名时间到了，但没有参赛者，本局赛马取消。")
      return
    }
    const result = await this.runRace(event)
    await event.reply(`报名时间到了，自动开赛。\n${result}`)
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
    this.clearAutoStart(room)
    this.clearStageTimer(room)
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
    if (room.phase === "race") return this.formatActiveRaceStatus(room)

    const players = [...room.participants.values()]
    if (players.length < RACE_SIZE) {
      this.fillNpcPlayers(players, RACE_SIZE)
    }

    this.clearAutoStart(room)
    room.phase = "race"
    room.event = e
    room.startedAt = Date.now()
    room.stageIndex = 0
    room.twist = this.pickTwist()
    room.scene = this.pickScene()
    room.decisions = new Map()
    room.history = []
    room.runners = this.initializeStageRunners(players, room.track, room.twist, room.scene)
    this.lastRaceAt.set(groupId, Date.now())
    this.scheduleStageAdvance(room, config)

    return this.formatRaceStage(room, { opening: true })
  }

  raceDecision(e) {
    if (!e?.group_id) return "这个小游戏要在群里玩。"
    const groupId = String(e.group_id)
    const room = this.getRoom(groupId)
    if (!room) return "现在没有赛马局。先发：.赛马娘 开始"
    if (room.phase !== "race") return "比赛还没开跑。开跑后每个阶段可以发：.赛马娘 决策 提速"

    const userId = this.getUserId(e)
    const runner = room.runners?.find(item => String(item.userId) === userId && !item.isNpc)
    if (!runner) return "你不在这一局里，不能下阶段决策。"

    const action = this.parseRaceAction(e?.msg)
    if (!action) {
      return [
        "没看懂这个决策。",
        this.formatRaceActionTips()
      ].join("\n")
    }

    const stage = RACE_STAGES[room.stageIndex] || RACE_STAGES[0]
    if (!room.decisions) room.decisions = new Map()
    let stageDecisions = room.decisions.get(stage.key)
    if (!stageDecisions) {
      stageDecisions = new Map()
      room.decisions.set(stage.key, stageDecisions)
    }
    const previous = stageDecisions.get(userId)
    stageDecisions.set(userId, action.key)
    return previous && previous !== action.key
      ? `${runner.nickname} 把${stage.label}决策改成了：${action.label}`
      : `${runner.nickname} 的${stage.label}决策：${action.label}`
  }

  parseRaceAction(msg = "") {
    const text = String(msg || "")
      .replace(/^[.。]赛马娘\s*(决策|选择|行动)\s*/u, "")
      .trim()
    if (!text) return null
    for (const [key, action] of Object.entries(RACE_ACTIONS)) {
      if (action.aliases.some(alias => text.includes(alias))) return { key, ...action }
    }
    return null
  }

  formatRaceActionTips() {
    return [
      "可选决策：提速 / 减速 / 稳住 / 抢位 / 爆发 / 赌一把 / 跟跑 / 压节奏",
      "格式：.赛马娘 决策 提速"
    ].join("\n")
  }

  initializeStageRunners(players, track, twist, scene) {
    const strategyCounts = this.countStrategies(players)
    return players.map(player => {
      const attributes = this.isValidAttributes(player.attributes)
        ? player.attributes
        : this.generateAttributes(player.umaName || player.nickname, "均衡")
      const strategyKey = player.strategyKey && STRATEGIES[player.strategyKey] ? player.strategyKey : "normal"
      const strategy = STRATEGIES[strategyKey]
      const trait = this.getRaceTrait(player)
      const speed = this.rollAttributeValue(attributes.speed)
      const staminaAttr = this.rollAttributeValue(attributes.stamina)
      const power = this.rollAttributeValue(attributes.power)
      const focus = this.rollAttributeValue(attributes.focus)
      const wisdom = this.rollAttributeValue(attributes.wisdom)
      const luck = this.rollAttributeValue(attributes.luck, 50 + (trait.luckBonus || 0), 6)
      const conditionBonus = randomBetween(-7, 8)
      const fitBonus = Number(track.fit?.[strategyKey]) || 0
      const twistBonus = Number(twist.fit?.[strategyKey]) || 0
      const sceneBonus = Number(scene.fit?.[strategyKey]) || 0
      const traitBonus = this.getTraitBonus(trait, strategyKey, track.id)
      const strategyCrowdPenalty = this.getStrategyCrowdPenalty(strategyKey, strategyCounts, players.length)
      const basePosition = speed * 0.24 +
        staminaAttr * 0.15 +
        power * 0.15 +
        focus * 0.16 +
        wisdom * 0.14 +
        luck * 0.08 +
        fitBonus +
        twistBonus * 0.55 +
        sceneBonus * 0.55 +
        traitBonus +
        conditionBonus -
        strategyCrowdPenalty +
        randomBetween(-8, 9)

      return {
        ...player,
        attributes,
        strategyKey,
        strategyLabel: strategy.label,
        traitKey: trait.key,
        traitLabel: trait.label,
        race: {
          speed,
          staminaAttr,
          power,
          focus,
          wisdom,
          luck,
          position: basePosition,
          stamina: Math.min(125, 66 + Number(attributes.stamina || 0) * 2.4 + randomBetween(-5, 8)),
          rhythm: Math.min(125, 66 + Number(attributes.focus || 0) * 2.2 + randomBetween(-6, 8)),
          burstReserve: Math.min(120, 48 + Number(attributes.power || 0) * 2.5 + randomBetween(-6, 8)),
          route: Math.min(120, 48 + Number(attributes.wisdom || 0) * 2.4 + randomBetween(-7, 8)),
          luckState: Math.min(120, 46 + Number(attributes.luck || 0) * 2.3 + randomBetween(-10, 11)),
          notes: [this.formatConditionEvent(player.nickname, conditionBonus)]
        }
      }
    })
  }

  async advanceRaceStage(groupId) {
    const room = this.getRoom(groupId)
    if (!room || room.phase !== "race") return
    this.clearStageTimer(room)
    const stage = RACE_STAGES[room.stageIndex] || RACE_STAGES[0]
    const lines = this.resolveRaceStage(room, stage)
    room.history.push({ stage: stage.key, lines })

    if (room.stageIndex >= RACE_STAGES.length - 1) {
      const finalText = await this.finishStagedRace(room)
      await room.event?.reply?.(finalText)
      return
    }

    room.stageIndex += 1
    this.scheduleStageAdvance(room)
    await room.event?.reply?.([
      `${stage.label}结束：`,
      ...lines,
      "",
      this.formatRaceStage(room)
    ].join("\n"))
  }

  resolveRaceStage(room, stage) {
    const rankedBefore = this.rankRunners(room.runners)
    const stageDecisions = room.decisions?.get(stage.key) || new Map()
    const lines = []
    for (const runner of room.runners) {
      const beforeRank = rankedBefore.findIndex(item => item.userId === runner.userId) + 1
      const actionKey = runner.isNpc
        ? this.pickNpcStageAction(runner, beforeRank, stage)
        : (stageDecisions.get(String(runner.userId)) || this.getDefaultStageAction(runner))
      const action = RACE_ACTIONS[actionKey] ? { key: actionKey, ...RACE_ACTIONS[actionKey] } : { key: "steady", ...RACE_ACTIONS.steady }
      const result = this.applyRaceAction(runner, action, stage, beforeRank, room)
      if (!runner.isNpc && result.line) lines.push(result.line)
    }
    for (const runner of room.runners) {
      const race = runner.race
      if (race.stamina < 24) race.position -= randomBetween(5, 11)
      if (race.rhythm < 24) race.position -= randomBetween(4, 10)
      if (race.stamina > 82 && stage.key === "finish") race.position += randomBetween(1, 5)
    }
    return lines.length ? lines.slice(0, 5) : ["大家都按自己的节奏处理了这一段，队形还在继续变化。"]
  }

  applyRaceAction(runner, action, stage, beforeRank, room) {
    const race = runner.race
    const stageRate = this.getStageActionRate(action.key, stage.key, room.track?.id)
    const attrPush = this.getActionAttributePush(runner, action.key)
    const crowdRisk = action.key === "inside" && beforeRank <= 4 ? randomBetween(0, 8) : 0
    const lowStaminaPenalty = race.stamina < 38 && ["speed_up", "burst", "gamble"].includes(action.key)
      ? randomBetween(5, 14)
      : 0
    const lowRhythmPenalty = race.rhythm < 38 && ["inside", "gamble", "burst"].includes(action.key)
      ? randomBetween(4, 12)
      : 0
    let positionDelta = attrPush * stageRate + randomBetween(-4, 5) - crowdRisk - lowStaminaPenalty - lowRhythmPenalty
    let note = ""

    if (action.key === "speed_up") {
      race.stamina -= randomBetween(11, 18)
      race.rhythm -= randomBetween(3, 8)
      note = `${runner.nickname} 选择提速，脚步明显往前压，呼吸也开始急了一点。`
    } else if (action.key === "slow_down") {
      positionDelta -= randomBetween(6, 11)
      race.stamina += randomBetween(12, 20)
      race.rhythm += randomBetween(6, 12)
      note = `${runner.nickname} 主动减速，把呼吸收了回来，但位置让出了一些。`
    } else if (action.key === "steady") {
      race.rhythm += randomBetween(7, 13)
      race.stamina -= randomBetween(3, 7)
      note = `${runner.nickname} 稳住了节奏，动作不夸张，但路线处理得很干净。`
    } else if (action.key === "inside") {
      race.route += randomBetween(4, 10)
      race.rhythm -= randomBetween(2, 7)
      if (crowdRisk > 0) {
        positionDelta -= randomBetween(4, 9)
        note = `${runner.nickname} 想抢位，可前排太挤，被迫多等了一拍。`
      } else {
        note = `${runner.nickname} 抢到更舒服的位置，像是贴着内侧省了一段距离。`
      }
    } else if (action.key === "burst") {
      race.burstReserve -= randomBetween(18, 30)
      race.stamina -= randomBetween(14, 24)
      race.rhythm -= randomBetween(5, 11)
      if (race.burstReserve < 18) positionDelta -= randomBetween(7, 15)
      note = `${runner.nickname} 开始爆发，身位一下子往前顶，余力也被用掉不少。`
    } else if (action.key === "gamble") {
      const lucky = randomBetween(0, 120) < race.luckState
      positionDelta += lucky ? randomBetween(8, 20) : -randomBetween(8, 18)
      race.luckState -= randomBetween(5, 14)
      race.rhythm -= randomBetween(4, 12)
      note = lucky
        ? `${runner.nickname} 赌了一把，刚好抓到空档，位置突然变得很有威胁。`
        : `${runner.nickname} 赌了一把，但这次没接住节奏，脚步有点乱。`
    } else if (action.key === "follow") {
      race.rhythm += randomBetween(4, 10)
      race.stamina -= randomBetween(3, 7)
      positionDelta += beforeRank > 4 ? randomBetween(1, 6) : randomBetween(-2, 3)
      note = `${runner.nickname} 选择跟跑，贴住前面的人影，没有急着单独冲出去。`
    } else if (action.key === "pace") {
      race.stamina += randomBetween(5, 12)
      race.rhythm += randomBetween(4, 10)
      positionDelta += stage.key === "finish" ? randomBetween(-5, 2) : randomBetween(-3, 4)
      note = `${runner.nickname} 压住节奏，把一口气留了下来，看起来是在等后面。`
    }

    race.position += positionDelta
    race.stamina = Math.max(0, Math.min(130, race.stamina))
    race.rhythm = Math.max(0, Math.min(130, race.rhythm))
    race.burstReserve = Math.max(0, Math.min(125, race.burstReserve))
    race.route = Math.max(0, Math.min(125, race.route))
    race.luckState = Math.max(0, Math.min(125, race.luckState))
    race.notes = [note, this.describeRunnerState(runner)].filter(Boolean)
    return { line: `${note} ${this.describeRunnerState(runner)}` }
  }

  getActionAttributePush(runner, actionKey) {
    const race = runner.race
    const attr = {
      speed_up: race.speed * 0.085 + race.staminaAttr * 0.025,
      slow_down: race.staminaAttr * 0.03 + race.focus * 0.03,
      steady: race.focus * 0.07 + race.wisdom * 0.025,
      inside: race.wisdom * 0.07 + race.focus * 0.035,
      burst: race.power * 0.095 + race.speed * 0.04,
      gamble: race.luck * 0.08 + race.power * 0.025,
      follow: race.wisdom * 0.055 + race.focus * 0.045,
      pace: race.staminaAttr * 0.055 + race.focus * 0.035
    }
    return Number(attr[actionKey]) || 0
  }

  getStageActionRate(actionKey, stageKey, trackId) {
    const table = {
      start: { speed_up: 1.15, inside: 1.18, steady: 1.08, burst: 0.92, slow_down: 0.72, pace: 0.9 },
      mid: { slow_down: 1.15, follow: 1.15, pace: 1.18, inside: 1.08, speed_up: 0.95, burst: 0.86 },
      finish: { burst: 1.28, speed_up: 1.16, gamble: 1.18, follow: 0.9, pace: 0.78, slow_down: 0.65 }
    }
    let rate = table[stageKey]?.[actionKey] || 1
    if (trackId === "short_sprint" && ["speed_up", "burst"].includes(actionKey)) rate += 0.08
    if (trackId === "endurance" && ["pace", "slow_down", "follow"].includes(actionKey)) rate += 0.08
    if (trackId === "many_corners" && ["inside", "steady"].includes(actionKey)) rate += 0.08
    if (trackId === "rain_mud" && ["steady", "pace"].includes(actionKey)) rate += 0.08
    return rate
  }

  getDefaultStageAction(runner) {
    return STRATEGY_DEFAULT_ACTIONS[runner.strategyKey] || "steady"
  }

  pickNpcStageAction(runner, beforeRank, stage) {
    const race = runner.race
    if (race.stamina < 32) return pick(["slow_down", "pace", "steady"])
    if (race.rhythm < 32) return pick(["steady", "follow", "slow_down"])
    if (stage.key === "finish") return beforeRank <= 3 ? pick(["speed_up", "burst", "steady"]) : pick(["burst", "gamble", "speed_up"])
    if (stage.key === "mid") return beforeRank <= 3 ? pick(["follow", "pace", "steady"]) : pick(["inside", "speed_up", "follow"])
    return this.getDefaultStageAction(runner)
  }

  rankRunners(runners = []) {
    return [...runners].sort((a, b) => (b.race?.position || 0) - (a.race?.position || 0))
  }

  formatRaceStage(room, { opening = false } = {}) {
    const stage = RACE_STAGES[room.stageIndex] || RACE_STAGES[0]
    const stageCount = `${room.stageIndex + 1}/${RACE_STAGES.length}`
    return [
      opening ? "比赛开跑。" : `${stage.label}开始。`,
      this.formatTrack(room.track),
      `复合场景：${room.track.name} + ${room.twist.name} + ${room.scene.name}`,
      `当前阶段：${stage.label}（${stageCount}）- ${stage.prompt}`,
      room.stageIndex === 0 ? `临场变化：${room.twist.name} - ${room.twist.description}` : `赛况事件：${room.scene.name} - ${room.scene.description}`,
      "",
      "当前队形：",
      ...this.formatStageRanking(room.runners),
      "",
      this.formatRaceActionTips()
    ].join("\n")
  }

  formatActiveRaceStatus(room) {
    const stage = RACE_STAGES[room.stageIndex] || RACE_STAGES[0]
    return [
      `这一局已经开跑了，当前是${stage.label}。`,
      "当前队形：",
      ...this.formatStageRanking(room.runners || []),
      "",
      this.formatRaceActionTips()
    ].join("\n")
  }

  formatStageRanking(runners = []) {
    return this.rankRunners(runners).slice(0, RACE_SIZE).map((runner, index) =>
      `${index + 1}. ${this.formatRunnerName(runner)}｜${this.describeRunnerState(runner)}`
    )
  }

  describeRunnerState(runner) {
    const race = runner?.race || {}
    const breath = race.stamina >= 86
      ? "呼吸很稳"
      : race.stamina >= 62
        ? "已经轻微喘气"
        : race.stamina >= 36
          ? "气息明显乱了"
          : "像是快被体力拖住了"
    const rhythm = race.rhythm >= 86
      ? "步点很干净"
      : race.rhythm >= 62
        ? "节奏还压得住"
        : race.rhythm >= 36
          ? "步伐有点散"
          : "节奏被拉得很碎"
    const route = race.route >= 82
      ? "贴着舒服路线"
      : race.route >= 55
        ? "还在找空档"
        : "有点被堵在外侧"
    const burst = race.burstReserve >= 78
      ? "还藏着冲刺劲"
      : race.burstReserve >= 42
        ? "余力还够再顶一下"
        : "爆发余力不多"
    return `${breath}，${rhythm}，${route}，${burst}`
  }

  async finishStagedRace(room) {
    this.clearStageTimer(room)
    const ranking = this.rankRunners(room.runners)
    this.rooms.delete(String(room.groupId || ""))
    const config = this.getConfig()
    const awardLines = await this.applyAwards(ranking, this.getAwards(config), config)
    const result = {
      ranking,
      track: room.track,
      twist: room.twist,
      scene: room.scene,
      highlights: [
        ...room.history.flatMap(item => item.lines).slice(-5),
        pick(room.track.events).replace("{name}", ranking[0]?.nickname || "前排")
      ].slice(0, 5)
    }
    return this.formatRaceResult(result, awardLines)
  }

  fillNpcPlayers(players, minPlayers) {
    const need = Math.max(0, Number(minPlayers) - players.length)
    const usedNames = new Set(players.map(player => player.nickname))
    const usedUmaNames = new Set(players.map(player => player.umaName || player.nickname))
    const baseTotal = this.getNpcBaseAttributeTotal(players)
    for (let index = 0; index < need; index++) {
      const name = this.pickNpcName(usedNames)
      const umaName = this.pickNpcUmaName(usedUmaNames)
      const personality = pick(["稳重可靠", "活泼开朗", "不服输", "聪明冷静", "耐心坚韧", "幸运自由"])
      const total = this.pickNpcAttributeTotal(baseTotal)
      usedNames.add(name)
      usedUmaNames.add(umaName)
      players.push({
        userId: `npc:${Date.now()}:${index}`,
        nickname: name,
        umaName,
        attributes: this.generateAttributes(umaName, personality, total),
        personality,
        traitKey: this.inferPersonalityTrait(umaName, personality).key,
        traitLabel: this.inferPersonalityTrait(umaName, personality).label,
        strategyKey: pick(["normal", "steady", "burst", "conserve", "inside"]),
        isNpc: true,
        joinedAt: Date.now()
      })
    }
  }

  pickNpcName(usedNames) {
    const available = NPC_NAMES.filter(name => !usedNames.has(name))
    return available.length ? pick(available) : `临时选手${usedNames.size + 1}`
  }

  pickNpcUmaName(usedNames) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const name = `${pick(NPC_UMA_PREFIXES)}${pick(NPC_UMA_SUFFIXES)}`
      if (!usedNames.has(name)) return name
    }
    return `临时赛马娘${usedNames.size + 1}`
  }

  getNpcBaseAttributeTotal(players = []) {
    const totals = players
      .filter(player => !player.isNpc && this.isValidAttributes(player.attributes))
      .map(player => this.sumAttributes(player.attributes))
      .filter(total => Number.isFinite(total) && total > 0)
    if (!totals.length) return ATTRIBUTE_TOTAL
    return totals.reduce((sum, total) => sum + total, 0) / totals.length
  }

  pickNpcAttributeTotal(baseTotal = ATTRIBUTE_TOTAL) {
    const min = Math.max(ATTRIBUTE_DEFS.length * 4, Math.floor(baseTotal * 0.9))
    const max = Math.max(min, Math.ceil(baseTotal * 1.1))
    return Math.floor(randomBetween(min, max + 1))
  }

  simulateRace(players, track = pick(TRACKS), twist = pick(RACE_TWISTS), scene = pick(RACE_SCENES)) {
    const strategyCounts = this.countStrategies(players)
    const runners = players.map(player => {
      const attributes = this.isValidAttributes(player.attributes)
        ? player.attributes
        : this.generateAttributes(player.umaName || player.nickname, "均衡")
      const speed = this.rollAttributeValue(attributes.speed)
      const stamina = this.rollAttributeValue(attributes.stamina)
      const power = this.rollAttributeValue(attributes.power)
      const focus = this.rollAttributeValue(attributes.focus)
      const wisdom = this.rollAttributeValue(attributes.wisdom)
      const strategyKey = player.strategyKey && STRATEGIES[player.strategyKey] ? player.strategyKey : "normal"
      const strategy = STRATEGIES[strategyKey]
      const trait = this.getRaceTrait(player)
      const luck = this.rollAttributeValue(attributes.luck, 50 + (trait.luckBonus || 0), 6)
      const weights = {
        speed: (track.weights.speed + strategy.weights.speed) / 2,
        stamina: (track.weights.stamina + strategy.weights.stamina) / 2,
        focus: (track.weights.focus + strategy.weights.focus) / 2,
        luck: (track.weights.luck + strategy.weights.luck) / 2
      }
      const fitBonus = Number(track.fit?.[strategyKey]) || 0
      const twistBonus = Number(twist.fit?.[strategyKey]) || 0
      const sceneBonus = Number(scene.fit?.[strategyKey]) || 0
      const traitBonus = this.getTraitBonus(trait, strategyKey, track.id)
      const riskRate = Math.max(0, (Number(strategy.risk) || 0) + (Number(trait.riskAdjust) || 0))
      const riskPenalty = Math.random() < riskRate ? randomBetween(10, 24) : 0
      const insideCrowdPenalty = strategyKey === "inside" && players.length >= 7 ? randomBetween(0, 10) : 0
      const strategyCrowdPenalty = this.getStrategyCrowdPenalty(strategyKey, strategyCounts, players.length)
      const conditionBonus = randomBetween(-9, 10)
      const variance = randomBetween(-strategy.variance - (trait.varianceBonus || 0), strategy.variance + (trait.varianceBonus || 0))
      const score = speed * weights.speed +
        stamina * weights.stamina +
        focus * weights.focus +
        luck * weights.luck +
        power * 0.16 +
        wisdom * 0.13 +
        fitBonus +
        twistBonus +
        sceneBonus +
        traitBonus +
        conditionBonus +
        variance -
        riskPenalty -
        insideCrowdPenalty -
        strategyCrowdPenalty
      return {
        ...player,
        speed,
        stamina,
        power,
        focus,
        wisdom,
        luck,
        attributes,
        strategyKey,
        strategyLabel: strategy.label,
        traitKey: trait.key,
        traitLabel: trait.label,
        fitBonus,
        twistBonus,
        sceneBonus,
        traitBonus,
        riskRate,
        conditionBonus,
        riskPenalty,
        insideCrowdPenalty,
        strategyCrowdPenalty,
        score,
        event: this.buildRunnerEvent(player.nickname, strategy, track, twist, scene, {
          fitBonus,
          twistBonus,
          sceneBonus,
          traitBonus,
          traitLabel: trait.label,
          riskRate,
          conditionBonus,
          riskPenalty,
          insideCrowdPenalty,
          strategyCrowdPenalty
        })
      }
    })

    runners.sort((a, b) => b.score - a.score)
    const highlights = this.buildRaceHighlights(runners, track, twist, scene)
    return { ranking: runners, highlights, track, twist, scene }
  }

  countStrategies(players) {
    const counts = new Map()
    for (const player of players) {
      const key = player.strategyKey && STRATEGIES[player.strategyKey] ? player.strategyKey : "normal"
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return counts
  }

  getRaceTrait(player = {}) {
    return PERSONALITY_TRAITS.find(trait => trait.key === player.traitKey) ||
      this.inferPersonalityTrait(player.umaName || player.nickname, player.personality || "")
  }

  getTraitBonus(trait, strategyKey, trackId) {
    return (Number(trait?.fit?.[strategyKey]) || 0) + (Number(trait?.sceneFit?.[trackId]) || 0)
  }

  rollAttributeValue(attribute, base = 48, scale = 5) {
    return base + (Number(attribute) || 0) * scale + randomBetween(0, 18)
  }

  getStrategyCrowdPenalty(strategyKey, strategyCounts, totalPlayers) {
    const count = strategyCounts.get(strategyKey) || 0
    if (count <= 1 || totalPlayers <= 2) return 0
    const crowdedRatio = count / totalPlayers
    if (crowdedRatio < 0.45) return 0
    return randomBetween(2, Math.min(14, 2 + (count - 1) * 4))
  }

  buildRunnerEvent(name, strategy, track, twist, scene, details = {}) {
    if (details.riskPenalty > 0) {
      return `${name} 选择${strategy.label}，但这次有点用力过猛，节奏被打乱了一段。`
    }
    if (details.insideCrowdPenalty > 0) {
      return `${name} 选择抢内道，可这局人太多，刚进弯道就被堵了一下。`
    }
    if (details.strategyCrowdPenalty > 0) {
      return `${name} 也选了${strategy.label}，但同策略的人太多，节奏互相挤在一起。`
    }
    if (details.twistBonus >= 6) {
      return (twist.event || "{name} 抓住了临场变化。").replace("{name}", name)
    }
    if (details.twistBonus <= -6) {
      return `${name} 选择${strategy.label}，但临场变化是${twist.name}，这次有点被克到了。`
    }
    if (details.sceneBonus >= 6) {
      return (scene.event || "{name} 抓住了赛况变化。").replace("{name}", name)
    }
    if (details.sceneBonus <= -6) {
      return `${name} 选择${strategy.label}，但赛况是${scene.name}，这次处理起来很别扭。`
    }
    if (details.traitBonus >= 7) {
      return `${name} 的${details.traitLabel || "性格"}刚好适合这一局，跑法明显更顺。`
    }
    if (Math.abs(details.conditionBonus) >= 4) {
      return this.formatConditionEvent(name, details.conditionBonus)
    }
    if (details.fitBonus >= 8) {
      return `${name} 选择${strategy.label}，刚好很适合${track.name}，优势越跑越明显。`
    }
    if (details.fitBonus <= -7) {
      return `${name} 选择${strategy.label}，但和${track.name}不太合拍，中段有点吃亏。`
    }
    return strategy.event.replace("{name}", name)
  }

  formatConditionEvent(name, conditionBonus) {
    const item = CONDITION_EVENTS.find(event => conditionBonus >= event.min) || CONDITION_EVENTS[CONDITION_EVENTS.length - 1]
    return item.text.replace("{name}", name)
  }

  buildRaceHighlights(runners, track, twist, scene) {
    const top = runners.slice(0, Math.min(4, runners.length))
    const highlightSet = new Set()
    highlightSet.add(`临场变化：${twist.name} - ${twist.description}`)
    highlightSet.add(`赛况事件：${scene.name} - ${scene.description}`)
    highlightSet.add(pick(track.events).replace("{name}", top[0]?.nickname || "前排"))
    for (const runner of top) {
      if (runner?.event) highlightSet.add(runner.event)
      if (highlightSet.size >= 5) break
    }
    return [...highlightSet].slice(0, 5)
  }

  getAwards(config) {
    return [config.winPoints, config.secondPoints, config.thirdPoints]
  }

  async applyAwards(ranking, awards, config) {
    const data = this.readPoints(config)
    const lines = []
    ranking.forEach((runner, index) => {
      const points = awards[index] || 0
      if (runner.isNpc) {
        if (points > 0) lines.push(`${index + 1}. ${runner.nickname} 是NPC，不计入积分`)
        return
      }
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
      `${index + 1}. ${this.formatRunnerName(runner)}（${runner.strategyLabel || "正常跑"}）`
    )
    return [
      "赛马结果出炉：",
      this.formatTrack(result.track),
      `复合场景：${result.track.name} + ${result.twist.name} + ${result.scene.name}`,
      ...result.highlights.map(line => `- ${line}`),
      "",
      "名次：",
      ...rankingLines,
      "",
      awardLines.length ? `积分：\n${awardLines.join("\n")}` : "积分：本局无人获得积分"
    ].join("\n")
  }

  formatRunnerName(runner) {
    const name = runner.umaName || runner.nickname
    if (runner.isNpc) return `${runner.nickname}「${name}」（NPC）`
    return `${runner.nickname}「${name}」`
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
      ".赛马娘 领养 名字 性格描述 - 创建自己的赛马娘",
      ".赛马娘 我的赛马娘 - 查看六维属性",
      ".赛马娘 弃养 - 删除当前小马档案，保留积分",
      ".赛马娘 训练 - 进入训练页面",
      ".赛马娘 开始 - 开一局",
      ".赛马娘 加入 [策略] - 报名，可选策略",
      "策略：稳一点 / 拼一把 / 留体力 / 抢内道；不填就是正常跑",
      ".赛马娘 开跑 - 开始三段比赛",
      ".赛马娘 决策 [行动] - 每个阶段调整一次跑法",
      "行动：提速 / 减速 / 稳住 / 抢位 / 爆发 / 赌一把 / 跟跑 / 压节奏",
      ".赛马娘 积分 - 查看自己的全群互通积分",
      ".赛马娘 排行 - 查看全局排行"
    ].join("\n")
  }
}

export const umaRaceManager = new UmaRaceManager()
