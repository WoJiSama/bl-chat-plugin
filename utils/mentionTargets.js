function normalizeUserId(value) {
  if (value && typeof value === "object") return ""
  const userId = String(value ?? "").trim()
  if (!userId || userId.toLowerCase() === "all") return ""
  return /^\d+$/.test(userId) ? userId : ""
}

export function getMentionTargetId(segment = {}) {
  return segment?.qq ?? segment?.user_id ?? segment?.id ?? segment?.uin ?? segment?.uid ??
    segment?.data?.qq ?? segment?.data?.user_id ?? segment?.data?.id ?? segment?.data?.uin ?? segment?.data?.uid
}

export function collectMentionTargetIds(event = {}, excludedUserId = "") {
  const targets = []
  const seen = new Set()
  const excluded = normalizeUserId(excludedUserId)
  const addTarget = value => {
    const userId = normalizeUserId(value)
    if (!userId || userId === excluded || seen.has(userId)) return
    seen.add(userId)
    targets.push(userId)
  }

  const eventTargets = [event?.at, event?.at_user].flatMap(value => Array.isArray(value) ? value : [value])
  for (const target of eventTargets) addTarget(typeof target === "object" ? getMentionTargetId(target) : target)

  for (const segment of Array.isArray(event?.message) ? event.message : []) {
    if (segment?.type === "at") addTarget(getMentionTargetId(segment))
  }

  const raw = String(event?.msg || "")
  for (const match of raw.matchAll(/\[CQ:at,[^\]]*(?:qq|user_id|id|uin)=(\d+)(?:,|\])/g)) {
    addTarget(match[1])
  }

  return targets
}

export function messageMentionsUser(event = {}, userId = "") {
  const targetUserId = normalizeUserId(userId)
  if (!targetUserId) return false

  const botId = normalizeUserId(event?.bot?.uin || globalThis.Bot?.uin)
  if (targetUserId === botId && (event?.atBot || event?.atme || event?.atMe || event?.isAt)) return true
  return collectMentionTargetIds(event).includes(targetUserId)
}

export function replaceCqMentions(text = "", replacer = userId => `@${userId}`) {
  return String(text || "").replace(
    /\[CQ:at,[^\]]*(?:qq|user_id|id|uin)=(\d+)[^\]]*\]/g,
    (_, userId) => replacer(String(userId))
  )
}

export function stripCqMentions(text = "") {
  return replaceCqMentions(text, () => " ").replace(/\s+/g, " ").trim()
}
