export function selectImageEditBase({ currentImages = [], replyImages = [], recentImage = "", isContinuation = false } = {}) {
  if (currentImages.length) return { source: currentImages[0], origin: "current", images: [...currentImages] }
  if (replyImages.length) return { source: replyImages[0], origin: "reply", images: [...replyImages] }
  if (isContinuation && recentImage) return { source: recentImage, origin: "recent", images: [recentImage] }
  return { source: "", origin: "missing", images: [] }
}

export function canUseRecentImage({ isContinuation = false, recentSenderId = "", botId = "", ageMs = 0, maxAgeMs = 15 * 60 * 1000 } = {}) {
  return Boolean(isContinuation && recentSenderId && String(recentSenderId) === String(botId) && ageMs >= 0 && ageMs <= maxAgeMs)
}
