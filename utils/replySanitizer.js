const CHAT_LOG_TIME_PREFIX_RE = /^[\[【]\s*(?:\d{4}-\d{2}-\d{2}\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*[\]】]\s*/
const CHAT_LOG_SPEAKER_PREFIX_RE = /^.{1,80}?\((?:QQ号|qq号|QQ|qq)[:：]\s*\d{4,12}\)\s*(?:\[[^\]\n]{1,40}\]\s*)*[:：]\s*(?:在群里说[:：]\s*)?/i
const CHAT_LOG_SPEAKER_WITH_TIME_RE = /^(?:\d{4}-\d{2}-\d{2}\s+)?\d{1,2}:\d{2}(?::\d{2})?\s+.{1,80}?\((?:QQ号|qq号|QQ|qq)[:：]\s*\d{4,12}\)\s*(?:\[[^\]\n]{1,40}\]\s*)*[:：]\s*(?:在群里说[:：]\s*)?/i

export function stripChatLogSpeakerPrefix(text = "") {
  let output = String(text || "").trim()
  if (!output) return ""

  for (let i = 0; i < 3; i++) {
    const before = output
    output = output.replace(CHAT_LOG_TIME_PREFIX_RE, "")
    output = output.replace(CHAT_LOG_SPEAKER_PREFIX_RE, "")
    output = output.replace(CHAT_LOG_SPEAKER_WITH_TIME_RE, "")
    output = output.trim()
    if (output === before) break
  }

  return output
}

export function stripChatLogSpeakerPrefixes(text = "") {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(line => stripChatLogSpeakerPrefix(line))
    .join("\n")
}
