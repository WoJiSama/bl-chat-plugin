import { compactText } from './constants.js'

const DEFINING_VERB = /(?:是|叫|算|作为|属于|负责)/u
const FIRST_PERSON_POSSESSIVE = /(?:我的|我(?:在|群)?(?:里|中|里面)?的)/u
const EXPLICIT_TEACHING_SIGNAL = /(?:记住|记一下|记着|记得|记好|记下来|定义|以后叫|你要知道)/u

function normalizeKey(value = '') {
  return String(value || '').toLowerCase().replace(/[\s，,。；;：:！!？?、@"“”'']/g, '')
}

export function describeGroupKnowledgeEntry(entry = {}) {
  const subject = compactText(entry?.subject || '', 80) || '未命名群知识'
  if (entry?.kind === 'group_file') {
    return `“${subject}”对应群文件「${compactText(entry?.resource?.fileName || '', 180) || '未知文件'}」`
  }
  const targets = (Array.isArray(entry?.targets) ? entry.targets : [])
    .map(target => compactText(target?.displayName || target?.userId || '', 80))
    .filter(Boolean)
  return targets.length ? `“${subject}”指的是：${targets.join('、')}` : `“${subject}”`
}

// Retrieval can tolerate fuzzy overlap; deletion must match a stored name exactly.
export function findGroupKnowledgeDeletionCandidates(entries = [], { query = '', speakerQQ = '', createdBy = '' } = {}) {
  const rawQuery = compactText(query, 180)
  const normalizedQuery = normalizeKey(rawQuery)
  if (!normalizedQuery) return []
  const ownerScoped = FIRST_PERSON_POSSESSIVE.test(rawQuery)
  const requester = String(createdBy || '')
  return (Array.isArray(entries) ? entries : []).filter(entry => {
    if (!entry || entry.enabled === false) return false
    if (requester && String(entry.createdBy || '') !== requester) return false
    if (ownerScoped && String(entry.ownerQQ || '') !== String(speakerQQ || '')) return false
    const names = [entry.subject, ...(Array.isArray(entry.aliases) ? entry.aliases : []), entry.resource?.fileName]
      .map(normalizeKey).filter(Boolean)
    return names.some(name => name === normalizedQuery)
  })
}

function displayName(member = {}) {
  return compactText(member?.card || member?.nickname || member?.user_id || '', 80)
}

function membersFromMap(memberMap) {
  return memberMap?.values ? Array.from(memberMap.values()).filter(member => member?.user_id) : []
}

function mentionIds(segments = [], botId = '') {
  const ids = []
  for (const segment of Array.isArray(segments) ? segments : []) {
    if (segment?.type !== 'at') continue
    const value = segment?.qq ?? segment?.user_id ?? segment?.data?.qq ?? segment?.data?.user_id
    const id = String(value || '').trim()
    if (/^\d+$/.test(id) && id !== String(botId || '') && !ids.includes(id)) ids.push(id)
  }
  return ids
}

function resolveMemberTargets({ text = '', messageSegments = [], memberMap, botId = '' } = {}) {
  const members = membersFromMap(memberMap)
  const byId = new Map(members.map(member => [String(member.user_id), member]))
  const ids = mentionIds(messageSegments, botId)
  for (const match of String(text).matchAll(/(?:@QQ:|QQ[:：]?|@)(\d{5,12})/gi)) {
    const id = String(match[1])
    if (byId.has(id) && id !== String(botId || '') && !ids.includes(id)) ids.push(id)
  }
  const lowered = String(text).toLowerCase()
  for (const member of members) {
    const name = displayName(member)
    if (name.length >= 2 && lowered.includes(name.toLowerCase())) {
      const id = String(member.user_id)
      if (id !== String(botId || '') && !ids.includes(id)) ids.push(id)
    }
  }
  return ids.map(userId => ({ userId, displayName: displayName(byId.get(userId)) || userId }))
}

function normalizeFileAsset(asset = {}) {
  const fileName = compactText(asset?.fileName || asset?.name || '', 180)
  if (!fileName) return null
  return {
    fileName,
    fileId: compactText(asset?.fileId || '', 180),
    folderPath: compactText(asset?.folderPath || '', 240),
    origin: compactText(asset?.origin || 'message', 40)
  }
}

function fileReferenceFromText(text = '') {
  const match = String(text).match(/群文件(?:里面|中的|里的|里|中)?\s*(?:的)?\s*["“]?([^，,。；;]+?)["”]?\s*(?:是|叫|算|作为)/u)
  return compactText(match?.[1] || '', 180)
}

function resolveFileResource(text, fileAssets = []) {
  const assets = fileAssets.map(normalizeFileAsset).filter(Boolean)
  const referencedName = fileReferenceFromText(text)
  if (referencedName) {
    const exact = assets.find(asset => asset.fileName === referencedName)
    return exact || { fileName: referencedName, fileId: '', folderPath: '', origin: 'named_group_file' }
  }
  const exact = assets.find(asset => String(text).includes(asset.fileName))
  if (exact) return exact
  return assets.length === 1 ? assets[0] : null
}

function extractDescriptor(text = '') {
  const raw = String(text)
  const action = raw.match(/(?:是|叫|算|作为)\s*(?:我|@QQ:\d+|[^，,。；;]{0,24})?(?:做的|制作的|画的|写的|负责的)\s*([^，,。；;！!？?]{1,48})/u)
  const fallback = raw.match(/(?:是|叫|算|作为)\s*([^，,。；;！!？?]{1,48})/u)
  const value = action?.[1] || fallback?.[1] || ''
  return compactText(value
    .replace(/^(?:我|他|她|它|@QQ:\d+)?(?:做的|制作的|画的|写的|负责的)?/u, '')
    .replace(/^(?:一个|一份|那个|这个|群里的|群文件里的)/u, ''), 80)
}

function resolveOwner(text, creatorQQ, targets) {
  if (/(?:是|叫|算|作为)\s*我(?:做|制作|画|写|负责)/u.test(text)) return String(creatorQQ || '')
  const matched = String(text).match(/(?:是|叫|算|作为)\s*@QQ:(\d+)(?:做|制作|画|写|负责)/u)
  if (matched?.[1]) return matched[1]
  return targets.length === 1 && /(?:做|制作|画|写|负责)/u.test(text) ? targets[0].userId : ''
}

function buildFileKnowledge({ text, creatorQQ, targets, file, now }) {
  const descriptor = extractDescriptor(text)
  if (!file || !descriptor || !/(?:做|制作|画|写|负责|是|叫|算|作为)/u.test(text)) return null
  const ownerQQ = resolveOwner(text, creatorQQ, targets)
  if (!ownerQQ && !/(?:是|叫|算|作为)/u.test(text)) return null
  return {
    kind: 'group_file',
    subject: descriptor,
    subjectKey: normalizeKey(descriptor),
    aliases: ownerQQ ? [`我的${descriptor}`, `${descriptor}`] : [descriptor],
    ownerQQ,
    targetUserIds: [],
    targets: [],
    resource: file,
    sourceText: compactText(text, 300),
    createdBy: String(creatorQQ || ''),
    at: Number(now) || Date.now(),
    enabled: true
  }
}

function extractMemberSubject(text = '') {
  const match = String(text).match(/(?:是|叫|算|作为|属于|负责)\s*([^，,。；;！!？?]{1,80})/u)
  return compactText(match?.[1] || '', 80)
    .replace(/(?:你|妳)?(?:记住|记一下|记着|记得|记好|记下来|知道).*/u, '')
    .replace(/^(?:我们(?:的)?|群里(?:的)?|本群(?:的)?)/u, '')
    .trim()
}

function resolveRelationshipOwner(subject = '', creatorQQ = '', botId = '') {
  if (/^我的/u.test(subject)) return { ownerQQ: String(creatorQQ || ''), subject: subject.replace(/^我的/u, '') }
  if (/^(?:你的|妳的|希洛的)/u.test(subject)) return { ownerQQ: String(botId || ''), subject: subject.replace(/^(?:你的|妳的|希洛的)/u, '') }
  return { ownerQQ: '', subject }
}

function buildMemberKnowledge({ text, creatorQQ, creatorDisplay, botId, targets, now }) {
  if (!targets.length || !DEFINING_VERB.test(text)) return null
  const rawSubject = extractMemberSubject(text)
  const relationship = resolveRelationshipOwner(rawSubject, creatorQQ, botId)
  const subject = compactText(relationship.subject, 80)
  if (!subject) return null
  return {
    kind: targets.length > 1 ? 'member_set' : 'member_definition',
    subject,
    subjectKey: normalizeKey(subject),
    aliases: relationship.ownerQQ ? [`我的${subject}`, subject] : [subject],
    ownerQQ: relationship.ownerQQ,
    ownerDisplay: relationship.ownerQQ === String(creatorQQ || '') ? compactText(creatorDisplay, 80) : '',
    targetUserIds: targets.map(item => item.userId),
    targets,
    resource: null,
    sourceText: compactText(text, 300),
    createdBy: String(creatorQQ || ''),
    at: Number(now) || Date.now(),
    enabled: true
  }
}

export function extractExplicitGroupKnowledge({ text = '', messageSegments = [], memberMap, fileAssets = [], creatorQQ = '', creatorDisplay = '', botId = '', now = Date.now() } = {}) {
  const normalized = String(text || '')
    .replace(/\[CQ:at,[^\]]*(?:qq|user_id|id|uin)=(\d+)[^\]]*\]/g, ' @QQ:$1 ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized || !DEFINING_VERB.test(normalized)) return []
  const targets = resolveMemberTargets({ text: normalized, messageSegments, memberMap, botId })
  const file = resolveFileResource(normalized, fileAssets)
  const fileEntry = buildFileKnowledge({ text: normalized, creatorQQ, targets, file, now })
  if (fileEntry) return [fileEntry]
  const memberEntry = buildMemberKnowledge({ text: normalized, creatorQQ, creatorDisplay, botId, targets, now })
  return memberEntry ? [memberEntry] : []
}

export function shouldUseSemanticGroupKnowledgeExtraction(text = '') {
  return EXPLICIT_TEACHING_SIGNAL.test(String(text || ''))
}

function parseJsonArray(raw = '') {
  const value = String(raw || '').trim()
  const match = value.match(/\[[\s\S]*\]/)
  try {
    const parsed = JSON.parse(match ? match[0] : value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Model output is only a semantic interpretation. Targets are still resolved against the live member map.
export function parseSemanticGroupKnowledgeOutput(raw, context = {}) {
  const entries = []
  for (const item of parseJsonArray(raw)) {
    if (!item || typeof item !== 'object') continue
    const kind = item.kind === 'member_set' ? 'member_set' : 'member_definition'
    const subject = compactText(item.subject, 80)
    if (!subject) continue
    const targetText = Array.isArray(item.targetNames) ? item.targetNames.join(' ') : String(item.targetName || item.target || '')
    const targets = resolveMemberTargets({ text: targetText, memberMap: context.memberMap, botId: context.botId })
    if (!targets.length) continue
    const owner = String(item.owner || '').toLowerCase()
    const ownerQQ = owner === 'speaker'
      ? String(context.creatorQQ || '')
      : owner === 'bot'
        ? String(context.botId || '')
        : /^\d+$/.test(owner) ? owner : ''
    if (ownerQQ && ownerQQ !== String(context.creatorQQ || '') && ownerQQ !== String(context.botId || '') &&
      !membersFromMap(context.memberMap).some(member => String(member.user_id) === ownerQQ)) continue
    entries.push({
      kind: kind === 'member_set' || targets.length > 1 ? 'member_set' : 'member_definition',
      subject,
      subjectKey: normalizeKey(subject),
      aliases: ownerQQ ? [`我的${subject}`, subject] : [subject],
      ownerQQ,
      ownerDisplay: ownerQQ === String(context.creatorQQ || '') ? compactText(context.creatorDisplay, 80) : '',
      targetUserIds: targets.map(target => target.userId),
      targets,
      resource: null,
      sourceText: compactText(context.text, 300),
      createdBy: String(context.creatorQQ || ''),
      at: Number(context.now) || Date.now(),
      enabled: true
    })
  }
  return entries
}

function hasOwnerSpecificQuery(text = '') {
  return FIRST_PERSON_POSSESSIVE.test(String(text || ''))
}

function scoreEntry(entry, text, speakerQQ) {
  if (entry?.enabled === false) return -1
  if (hasOwnerSpecificQuery(text) && entry?.ownerQQ && String(entry.ownerQQ) !== String(speakerQQ || '')) return -1
  const query = normalizeKey(text)
  const names = [entry?.subject, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])].map(normalizeKey).filter(Boolean)
  let score = 0
  for (const name of names) {
    if (query.includes(name)) score = Math.max(score, 100 + name.length)
    else {
      let overlap = 0
      for (const char of new Set(name)) if (query.includes(char)) overlap++
      score = Math.max(score, overlap / Math.max(1, new Set(name).size))
    }
  }
  if (entry?.ownerQQ && String(entry.ownerQQ) === String(speakerQQ || '') && hasOwnerSpecificQuery(text)) score += 80
  return score
}

export function selectRelevantGroupKnowledge(entries = [], { text = '', speakerQQ = '', limit = 8 } = {}) {
  return (Array.isArray(entries) ? entries : [])
    .map(entry => ({ entry, score: scoreEntry(entry, text, speakerQQ) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.entry.updatedAt || b.entry.at || 0) - Number(a.entry.updatedAt || a.entry.at || 0))
    .slice(0, Math.max(1, limit))
    .map(item => item.entry)
}

function targetText(entry = {}) {
  return (entry.targets || []).map(item => `${item.displayName || item.userId}(QQ:${item.userId})`).join('、')
}

export function formatGroupKnowledgePrompt(entries = [], { speakerQQ = '' } = {}) {
  if (!entries.length) return ''
  const lines = [
    '【已教会的群知识 - 可回答】',
    '以下是本群成员明确提供的稳定定义。当前问题与其相关时应直接准确回答，不要说没有记录，也不要编造文件内容、成员职责或下载链接。'
  ]
  for (const entry of entries) {
    if (entry.kind === 'group_file') {
      const owner = entry.ownerQQ && String(entry.ownerQQ) === String(speakerQQ || '') ? '当前发言者' : (entry.ownerQQ ? `QQ:${entry.ownerQQ}` : '群内成员')
      const file = entry.resource || {}
      lines.push(`- ${owner} 的“${entry.subject}”对应群文件「${file.fileName || '未知文件名'}」${file.folderPath ? `（路径：${file.folderPath}）` : ''}。`)
    } else {
      const owner = entry.ownerQQ && String(entry.ownerQQ) === String(speakerQQ || '') ? '当前发言者的' : (entry.ownerQQ ? `QQ:${entry.ownerQQ} 的` : '')
      lines.push(`- ${owner}“${entry.subject}”指的是：${targetText(entry)}。`)
    }
  }
  return lines.join('\n')
}

export function formatGroupKnowledgeTeachingPrompt(entries = []) {
  if (!entries.length) return ''
  return [
    '【当前消息群知识教学 - 最高优先级】',
    '用户刚明确教会了一条群内定义，已保存为可回答知识。自然确认记下即可，不要捏造文件内容或额外关系。',
    ...entries.map(entry => entry.kind === 'group_file'
      ? `- “${entry.subject}” = 群文件「${entry.resource?.fileName || ''}」`
      : `- “${entry.subject}” = ${targetText(entry)}`)
  ].join('\n')
}
