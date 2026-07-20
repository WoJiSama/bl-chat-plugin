const TONE_CORRECTION_PATTERNS = [
  /阴阳怪气|夹枪带棒|嘲讽|挤兑|酸我|讽刺/i,
  /(?:语气|口气|态度).{0,10}(?:不对|不太对|怪|奇怪|差|冲|欠|阴阳|不好|有问题)/i,
  /(?:怎么|咋|为什么).{0,8}(?:这样|这么).{0,8}(?:说话|讲话|回复|回我)/i,
  /你.{0,8}(?:什么态度|怎么说话|跟谁学的|哪学的)/i,
  /(?:别|不要|能不能别).{0,8}(?:顶嘴|顶着说|犟|抬杠|调情|恶心我)/i,
  /(?:我不喜欢|听着不舒服|让人不舒服|感觉很怪).{0,12}(?:你|这样|这种|语气|口气)?/i
]

export function isToneCorrectionMessage(text = "") {
  const content = String(text || "").replace(/\[CQ:[^\]]+\]/g, " ").replace(/\s+/g, " ").trim()
  return Boolean(content && TONE_CORRECTION_PATTERNS.some(pattern => pattern.test(content)))
}

export function hasMeaningfulUserText(text = "") {
  return Boolean(String(text || "")
    .replace(/\[CQ:[^\]]+\]/g, " ")
    .replace(/^\s*希洛(?:希洛)?[，,。.!！?？：:\s]*/i, "")
    .replace(/[\s，,。.!！?？：:~～]+/g, "")
    .trim())
}

export function buildGenericChatFailureReply(userText = "", { isGreeting = false, failureKind = "unknown" } = {}) {
  if (isToneCorrectionMessage(userText)) {
    return "你说得对，刚才那几句有点顶着你说了，听着确实不舒服。我收一下。"
  }
  if (!hasMeaningfulUserText(userText)) {
    return "这条消息里没有读到可处理的文字内容。你补一句具体要我做什么，我再处理。"
  }
  if (isGreeting) {
    return "我在。你的消息已经收到了，只是这次回答服务没有正常返回。"
  }
  if (failureKind === "rate_limit") {
    return "你的问题我完整收到了，但回答服务现在请求过多，这次没能完成。原问题没有丢，我不会让你重复输入。"
  }
  if (failureKind === "timeout" || failureKind === "network") {
    return "你的问题我完整收到了，但回答服务这次连接超时，没能完成回答。不是你这边消息的问题。"
  }
  if (failureKind === "upstream") {
    return "你的问题我完整收到了，但回答服务这次暂时不可用，没能完成回答。不是你这边消息的问题。"
  }
  return "你的问题我完整收到了，但回答服务这次请求失败，没能完成回答。不是你这边消息的问题。"
}
