function scoreParchmentChatTail(text = "") {
  const content = String(text || "").trim()
  if (!content || content.length > 120) return 0
  if (/```|(?:^|\n)\s*(?:[-*+•]|\d+\.)\s+\S/.test(content)) return 0
  if (isSelfConsciousFillerTail(content)) return 0

  let score = 0
  if (/(?:\d{1,2}\s*[号日]|今天|明天|后天|周[一二三四五六日天]|星期[一二三四五六日天])?.{0,16}(?:交作业|作业|ddl|deadline).{0,30}(?:来得及|不急|别慌|不用慌|没问题|稳|呀|啦|哦|嘛|呢|~|～)?/i.test(content)) score += 4
  if (/(?:别慌|先别急|不用慌|不用太慌|放心|没事|问题不大|不难|来得及|稳的|还行|可以的)/.test(content)) score += 2
  if (/(?:要是|如果|回头|之后).{0,28}(?:再|还).{0,28}(?:发我|给我|我帮你|我再|我看看|继续看|帮你看)/.test(content)) score += 2
  if (/(?:我帮你|我再|我看看|我来|我盯着|给我看|发我)/.test(content)) score += 1
  if (/[呀啦哦呢嘛呗吧]|[~～]$/.test(content)) score += 1

  return score
}

function isParchmentChatTail(text = "") {
  return scoreParchmentChatTail(text) >= 3
}

function normalizeParchmentMainText(text = "") {
  const content = String(text || "")
    .trim()
    .replace(/[，,]\s*$/, "")
    .replace(/[.．…·•\s-]+$/, "")
    .trim()
  if (!content) return ""
  if (/[。！？!?；;：:]$/.test(content) || /```$/.test(content)) return content
  return `${content}。`
}

function isSelfConsciousFillerTail(text = "") {
  return /^(?:唔|呜|嗯|诶|欸|啊|呃|哎呀?|嘛|那个)?[，,、\s]*(?:我)?(?:是不是|好像|感觉)?(?:说(?:得|的)?有点多了|说多了|讲多了|说太多了|有点啰嗦|有点话多|扯远了|跑题了)[。！？!?~～…\s]*$/.test(String(text || "").trim())
}

function extractSelfConsciousFillerTail(content = "") {
  const match = String(content || "").match(/^([\s\S]{120,}?)(?:[.．…·•\s\-—]*)(唔|呜|嗯|诶|欸|啊|呃|哎呀?|嘛|那个)?[，,、\s]*(我?(?:是不是|好像|感觉)?(?:说(?:得|的)?有点多了|说多了|讲多了|说太多了|有点啰嗦|有点话多|扯远了|跑题了))[。！？!?~～…\s]*$/)
  if (!match) return null
  const main = match[1].trim()
  const chatText = `${match[2] ? `${match[2]}，` : ""}${match[3]}`.trim()
  if (main.length < 120 || !isSelfConsciousFillerTail(chatText)) return null
  return {
    imageText: normalizeParchmentMainText(main),
    chatText: ""
  }
}

export function splitParchmentReplyText(text = "") {
  const content = String(text || "").trim()
  if (content.length < 180) return { imageText: content, chatText: "" }

  const selfConsciousTail = extractSelfConsciousFillerTail(content)
  if (selfConsciousTail) return selfConsciousTail

  const blankMatches = [...content.matchAll(/\n\s*\n/g)]
  const lastBlank = blankMatches.at(-1)
  if (lastBlank) {
    const candidate = content.slice(lastBlank.index + lastBlank[0].length).trim()
    const main = content.slice(0, lastBlank.index).trim()
    if (main.length >= 120 && isSelfConsciousFillerTail(candidate)) {
      return {
        imageText: normalizeParchmentMainText(main),
        chatText: ""
      }
    }
    if (main.length >= 120 && isParchmentChatTail(candidate)) {
      return {
        imageText: normalizeParchmentMainText(main),
        chatText: candidate
      }
    }
  }

  const boundaries = [...content.matchAll(/[。！？!?；;，,]\s*/g)]
  for (let index = boundaries.length - 1; index >= 0; index--) {
    const boundary = boundaries[index]
    const candidate = content.slice(boundary.index + boundary[0].length).trim()
    const main = content.slice(0, boundary.index).trim()
    if (main.length < 120) break
    if (isSelfConsciousFillerTail(candidate)) {
      return {
        imageText: normalizeParchmentMainText(main),
        chatText: ""
      }
    }
    if (isParchmentChatTail(candidate)) {
      return {
        imageText: normalizeParchmentMainText(main),
        chatText: candidate
      }
    }
  }

  return { imageText: content, chatText: "" }
}

export { scoreParchmentChatTail }
