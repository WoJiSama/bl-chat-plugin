import crypto from "node:crypto"

const ROLE_LEVELS = Object.freeze({ player: 1, gm: 2, admin: 3, master: 4 })
const SELF_ALIASES = new Set(["self", "me", "我", "自己"])

function eventUserId(e) {
  return String(e?.user_id || e?.sender?.user_id || "")
}

function memberDisplayName(member, fallback) {
  return String(member?.card || member?.nickname || fallback || "").trim()
}

function normalizeMemberMap(value) {
  if (value instanceof Map) return value
  if (value && typeof value === "object") return new Map(Object.entries(value).map(([key, member]) => [Number(key), member]))
  return new Map()
}

async function getMemberMap(e) {
  try {
    return normalizeMemberMap(await e?.group?.getMemberMap?.())
  } catch {
    return new Map()
  }
}

export function ensureRuleGroupState(state, groupId, packId) {
  const gid = String(groupId || "")
  if (!gid) throw new Error("自定义团务只能在群聊中使用")
  state.groups ||= {}
  state.groups[gid] ||= {}
  state.groups[gid].diceRuleSessions ||= {}
  const root = state.groups[gid].diceRuleSessions[packId] ||= {}
  root.roles ||= {}
  root.npcs ||= {}
  root.group ||= { values: {} }
  root.group.values ||= {}
  root.session ||= {
    active: false,
    title: "",
    round: 0,
    turn: 0,
    phase: "idle",
    initiative: [],
    current: null
  }
  root.session.initiative ||= []
  root.audit ||= []
  return root
}

export function getRulePermission(e, ruleState) {
  if (e?.isMaster) return "master"
  if (["owner", "admin"].includes(e?.sender?.role)) return "admin"
  return ruleState?.roles?.[eventUserId(e)] === "gm" ? "gm" : "player"
}

export function requireRulePermission(e, ruleState, required = "player") {
  const actual = getRulePermission(e, ruleState)
  if ((ROLE_LEVELS[actual] || 0) < (ROLE_LEVELS[required] || ROLE_LEVELS.player)) {
    const labels = { player: "玩家", gm: "GM", admin: "群管理员", master: "主人" }
    throw new Error(`此操作需要${labels[required] || required}权限；你当前是${labels[actual] || actual}`)
  }
  return actual
}

export function actorStorageKey(actor) {
  return `${actor.kind}:${actor.id}`
}

export function selfActor(e) {
  const id = eventUserId(e)
  return {
    kind: "member",
    id,
    name: memberDisplayName(e?.sender, id),
    role: e?.sender?.role || "member",
    self: true
  }
}

function assertAllowed(actor, allowed) {
  const kind = actor.self ? "self" : actor.kind
  if (!allowed.has(kind)) throw new Error(`目标 ${actor.name || actor.id} 的类型 ${kind} 不在命令允许范围内`)
  return actor
}

async function resolveReplyActor(e) {
  try {
    const reply = await e?.getReply?.()
    const id = String(reply?.user_id || reply?.sender?.user_id || "")
    if (!id) return null
    return { kind: "member", id, name: memberDisplayName(reply?.sender, id), role: reply?.sender?.role || "member", self: id === eventUserId(e) }
  } catch {
    return null
  }
}

export async function resolveRuleActor(e, raw, ruleState, allowedKinds = ["self"]) {
  const token = String(raw || "").trim()
  const allowed = new Set(allowedKinds?.length ? allowedKinds : ["self"])
  if (!token || SELF_ALIASES.has(token.toLowerCase())) return assertAllowed(selfActor(e), allowed)

  if (["reply", "回复"].includes(token.toLowerCase())) {
    const actor = await resolveReplyActor(e)
    if (!actor) throw new Error("引用消息中没有可识别的发言者")
    return assertAllowed(actor, allowed)
  }

  const cqId = token.match(/^\[CQ:at,[^\]]*qq=(\d+)[^\]]*\]$/i)?.[1]
  const mentionId = token.match(/^<@!?(\d+)>$/)?.[1]
  const qqId = token.match(/^(?:qq:)?(\d{5,20})$/i)?.[1]
  const memberId = cqId || mentionId || qqId
  if (memberId) {
    const members = await getMemberMap(e)
    const member = members.get(Number(memberId)) || members.get(String(memberId))
    return assertAllowed({
      kind: "member",
      id: String(memberId),
      name: memberDisplayName(member, memberId),
      role: member?.role || "member",
      self: String(memberId) === eventUserId(e)
    }, allowed)
  }

  const npcToken = token.match(/^npc:(.+)$/i)?.[1] || token
  const npcEntry = Object.entries(ruleState?.npcs || {}).find(([id, npc]) => id === npcToken || npc?.name === npcToken)
  if (npcEntry) return assertAllowed({ kind: "npc", id: npcEntry[0], name: npcEntry[1].name || npcEntry[0], role: "npc", self: false }, allowed)

  const members = await getMemberMap(e)
  const matches = [...members.entries()].filter(([, member]) => [member?.card, member?.nickname].some(name => String(name || "").trim() === token))
  if (matches.length > 1) throw new Error(`群内有多个成员叫「${token}」，请改用 @ 或 qq:号码`)
  if (matches.length === 1) {
    const [id, member] = matches[0]
    return assertAllowed({ kind: "member", id: String(id), name: memberDisplayName(member, id), role: member?.role || "member", self: String(id) === eventUserId(e) }, allowed)
  }
  throw new Error(`没有找到目标：${token}`)
}

export async function getRuleGmRecipients(e, ruleState) {
  const ids = new Set(Object.entries(ruleState?.roles || {}).filter(([, role]) => role === "gm").map(([id]) => String(id)))
  const members = await getMemberMap(e)
  for (const [id, member] of members) if (["owner", "admin"].includes(member?.role)) ids.add(String(id))
  return [...ids].filter(Boolean)
}

export function createRuleRandom(externalRandom = null) {
  if (typeof externalRandom === "function") return { seed: "external", random: externalRandom }
  const seed = crypto.randomBytes(16).toString("hex")
  let counter = 0
  return {
    seed,
    random: () => {
      const digest = crypto.createHash("sha256").update(`${seed}:${counter++}`).digest()
      return digest.readUInt32BE(0) / 0x100000000
    }
  }
}

export function newAuditId() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`
}

export function sanitizeAuditValue(value, depth = 0) {
  if (depth > 5) return "[depth-limit]"
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeAuditValue(item, depth + 1))
  if (!value || typeof value !== "object") return String(value)
  const result = {}
  for (const [key, item] of Object.entries(value).slice(0, 100)) result[key] = sanitizeAuditValue(item, depth + 1)
  return result
}

export function roleLabel(role) {
  return { player: "玩家", gm: "GM", admin: "群管理员", master: "主人" }[role] || role
}
