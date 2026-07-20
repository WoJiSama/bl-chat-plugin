import { getMentionTargetId } from "./mentionTargets.js"
import { safeTruncateUnicode } from "./unicodeText.js"

function compactText(text = "", maxLength = 6000) {
  return safeTruncateUnicode(String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim(), maxLength)
}

function parseForwardJsonPayload(value) {
  if (!value) return null
  if (typeof value === "string") {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  return typeof value === "object" ? value : null
}

export function getSegmentData(segment = {}) {
  const data = segment?.data
  return data && typeof data === "object" && !Array.isArray(data) ? data : {}
}

export function normalizeMessageSegments(message) {
  if (Array.isArray(message)) return message
  if (Array.isArray(message?.message)) return message.message
  if (Array.isArray(message?.content)) return message.content
  return []
}

export function normalizeForwardMessageList(payload) {
  const data = payload?.data || payload
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.messages)) return data.messages
  if (Array.isArray(data?.nodes)) return data.nodes
  return []
}

export function extractForwardIdFromSegment(segment = {}) {
  const data = getSegmentData(segment)
  if (segment?.type === "forward") {
    return segment.id || data.id || segment.resid || data.resid || segment.file || data.file || ""
  }
  if (segment?.type === "json") {
    const jsonData = parseForwardJsonPayload(data.data ?? segment.data)
    if (jsonData?.app === "com.tencent.multimsg") {
      return jsonData.meta?.detail?.resid || jsonData.meta?.detail?.uniseq || ""
    }
  }
  return ""
}

export function extractForwardIdsFromSegments(segments = []) {
  const ids = []
  for (const segment of normalizeMessageSegments(segments)) {
    const id = String(extractForwardIdFromSegment(segment) || "").trim()
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

export function getForwardSenderName(message = {}) {
  return message.sender?.card ||
    message.sender?.nickname ||
    message.nickname ||
    message.user_name ||
    message.name ||
    "未知"
}

export function getReplyTargetUserId(reply = {}) {
  return reply?.sender?.user_id ||
    reply?.sender?.qq ||
    reply?.sender_id ||
    reply?.user_id ||
    reply?.qq ||
    reply?.data?.sender?.user_id ||
    reply?.data?.sender?.qq ||
    ""
}

export function extractReadableTextFromSegments(segments = [], fallback = "") {
  const parts = []
  for (const segment of normalizeMessageSegments(segments)) {
    const data = getSegmentData(segment)
    if (segment?.type === "text") {
      const text = segment.text ?? data.text
      if (text) parts.push(String(text))
      continue
    }
    if (segment?.type === "at") {
      const qq = getMentionTargetId(segment)
      if (qq && String(qq) !== "all") parts.push(`@${qq}`)
      continue
    }
    if (segment?.type === "image") parts.push("[图片]")
    if (segment?.type === "video") parts.push("[视频]")
    if (segment?.type === "record" || segment?.type === "voice") parts.push("[语音]")
    if (segment?.type === "file") {
      const fileName = segment.name || data.name || segment.file || data.file
      parts.push(`[文件${fileName ? `:${fileName}` : ""}]`)
    }
  }
  return compactText(parts.join("")) || compactText(fallback)
}

function normalizeMediaSource(value = "", type = "image") {
  const source = String(value || "").replace(/&amp;/g, "&").trim()
  if (!source) return ""
  if (/^(?:https?:\/\/|base64:\/\/|file:\/\/)/i.test(source)) return source
  if (type === "image" && /^data:image\//i.test(source)) return source
  return ""
}

function mediaLabel(type = "image") {
  return { image: "图片", video: "视频", record: "语音", voice: "语音", file: "文件" }[type] || "媒体"
}

function mediaUnit(type = "image") {
  return { image: "张", video: "段", record: "段", file: "个" }[type] || "个"
}

export function extractMediaAssetsFromSegments(segments = [], meta = {}) {
  const assets = []
  const typeCounts = new Map()
  for (const segment of normalizeMessageSegments(segments)) {
    const type = segment?.type === "voice" ? "record" : segment?.type
    if (!["image", "video", "record", "file"].includes(type)) continue
    const data = getSegmentData(segment)
    const fileName = type === "file"
      ? String(segment.name || data.name || segment.file_name || data.file_name || segment.file || data.file || "").trim()
      : ""
    const fileId = type === "file"
      ? String(segment.file_id || segment.fid || data.file_id || data.fid || data.id || "").trim()
      : ""
    const source = normalizeMediaSource(
      segment.url || segment.file_url || data.url || data.file_url || segment.file || data.file,
      type
    )
    if (!source && !(type === "file" && fileId)) continue
    const index = (typeCounts.get(type) || 0) + 1
    typeCounts.set(type, index)
    assets.push({
      source,
      fileName,
      name: fileName,
      fileId,
      type,
      origin: meta.origin || "message",
      senderName: meta.senderName || "",
      senderUserId: meta.senderUserId ? String(meta.senderUserId) : "",
      forwardId: meta.forwardId || "",
      label: meta.label || `${meta.origin === "reply" ? "引用消息" : "当前消息"}第${index}${mediaUnit(type)}${mediaLabel(type)}${fileName ? `:${fileName}` : ""}`
    })
  }
  return assets
}

export function extractImageAssetsFromSegments(segments = [], meta = {}) {
  return extractMediaAssetsFromSegments(segments, meta).filter(asset => asset.type === "image")
}

function dedupeAssets(assets = [], maxItems = 12) {
  const result = []
  const seen = new Set()
  for (const asset of assets) {
    const source = String(asset?.source || "").trim()
    const fileId = String(asset?.fileId || "").trim()
    const key = `${asset?.type || "image"}:${source || fileId}`
    if ((!source && !fileId) || seen.has(key)) continue
    seen.add(key)
    result.push({ ...asset, source, position: result.length + 1 })
    if (result.length >= maxItems) break
  }
  return result
}

export async function collectForwardContext(group, segments = [], options = {}) {
  const maxDepth = Math.max(1, Number(options.maxDepth) || 3)
  const maxLines = Math.max(1, Number(options.maxLines) || 80)
  const maxImages = Math.max(1, Number(options.maxImages) || 12)
  const lines = []
  const images = []
  const media = []
  const visited = new Set()

  const visit = async (forwardId, depth = 0) => {
    const id = String(forwardId || "").trim()
    if (!id || depth >= maxDepth || lines.length >= maxLines || visited.has(id) || !group?.getForwardMsg) return
    visited.add(id)

    let messages = []
    try {
      messages = normalizeForwardMessageList(await group.getForwardMsg(id))
    } catch {
      return
    }

    const indent = "  ".repeat(depth)
    for (const message of messages) {
      if (lines.length >= maxLines) break
      const messageSegments = normalizeMessageSegments(message)
      const senderName = getForwardSenderName(message)
      const senderUserId = getReplyTargetUserId(message)
      const text = extractReadableTextFromSegments(
        messageSegments,
        message.raw_message || message.message_text || message.content_text || ""
      )
      if (text) lines.push(`${indent}${senderName}: ${text}`)

      if (media.length < maxImages * 2) {
        const messageMedia = extractMediaAssetsFromSegments(messageSegments, {
          origin: "forward",
          senderName,
          senderUserId,
          forwardId: id
        })
        for (const asset of messageMedia) {
          const sameTypeIndex = media.filter(item => item.type === asset.type && item.senderName === senderName).length + 1
          const labeled = {
            ...asset,
            label: `合并转发中 ${senderName} 的第${sameTypeIndex}${mediaUnit(asset.type)}${mediaLabel(asset.type)}`
          }
          media.push(labeled)
          if (asset.type === "image") images.push(labeled)
          if (images.length >= maxImages && media.length >= maxImages * 2) break
        }
      }

      for (const nestedId of extractForwardIdsFromSegments(messageSegments)) {
        if (lines.length < maxLines) lines.push(`${indent}${senderName}: [嵌套转发记录]`)
        await visit(nestedId, depth + 1)
      }
    }
  }

  for (const forwardId of extractForwardIdsFromSegments(segments)) {
    await visit(forwardId, 0)
  }

  return {
    text: compactText(lines.join("\n"), Number(options.maxText) || 6000),
    lines,
    images: dedupeAssets(images, maxImages),
    media: dedupeAssets(media, maxImages * 2),
    forwardIds: [...visited]
  }
}

export async function resolveGroupContextAssets({ e = {}, group = null, reply = null, maxImages = 12 } = {}) {
  const activeGroup = group || e?.group || null
  const currentSegments = normalizeMessageSegments(e?.message)
  const replySegments = normalizeMessageSegments(reply)
  const currentMedia = extractMediaAssetsFromSegments(currentSegments, {
    origin: "current",
    senderName: e?.sender?.card || e?.sender?.nickname || "当前发言者",
    senderUserId: e?.user_id
  })
  const quotedMedia = extractMediaAssetsFromSegments(replySegments, {
    origin: "reply",
    senderName: reply?.sender?.card || reply?.sender?.nickname || "被引用用户",
    senderUserId: getReplyTargetUserId(reply)
  })
  const currentImages = currentMedia.filter(asset => asset.type === "image")
  const quotedImages = quotedMedia.filter(asset => asset.type === "image")

  const [currentForward, quotedForward] = await Promise.all([
    collectForwardContext(activeGroup, currentSegments, { maxImages, maxText: 5000 }),
    collectForwardContext(activeGroup, replySegments, { maxImages, maxText: 5000 })
  ])
  const images = dedupeAssets([
    ...currentImages,
    ...quotedImages,
    ...currentForward.images,
    ...quotedForward.images
  ], maxImages)
  const media = dedupeAssets([
    ...currentMedia,
    ...quotedMedia,
    ...currentForward.media,
    ...quotedForward.media
  ], maxImages * 2)

  return {
    reply,
    replyTargetUserId: String(getReplyTargetUserId(reply) || ""),
    replyTargetLabel: reply?.sender?.card || reply?.sender?.nickname || "",
    currentImages: dedupeAssets(currentImages, maxImages),
    quotedImages: dedupeAssets(quotedImages, maxImages),
    forwardImages: dedupeAssets([...currentForward.images, ...quotedForward.images], maxImages),
    images,
    media,
    videos: media.filter(asset => asset.type === "video"),
    records: media.filter(asset => asset.type === "record"),
    files: media.filter(asset => asset.type === "file"),
    currentForwardText: currentForward.text,
    quotedForwardText: quotedForward.text,
    forwardText: compactText([currentForward.text, quotedForward.text].filter(Boolean).join("\n"), 8000)
  }
}

export function formatGroupContextImagePrompt(assets = []) {
  if (!Array.isArray(assets) || !assets.length) return ""
  return [
    "群内图片素材来源（顺序必须保留）：",
    ...assets.map(asset => `第${asset.position}张：${asset.label || asset.origin || "群内图片"}`),
    "用户说“这张/他的/转发里的第几张”时，必须按上述来源和顺序消解指代；不要把群友头像或转发图片认成当前发言者本人。"
  ].join("\n")
}
