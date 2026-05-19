function makeAiBlock(groupLabel, prefix, urlField, modelField, keyField, urlPlaceholder, modelPlaceholder, usageHint) {
  return [
    {
      component: "SOFT_GROUP_BEGIN",
      label: groupLabel
    },
    {
      field: `${prefix}.${urlField}`,
      label: "API URL",
      component: "Input",
      bottomHelpMessage: `${usageHint}。完整 endpoint URL`,
      componentProps: { placeholder: urlPlaceholder }
    },
    {
      field: `${prefix}.${modelField}`,
      label: "模型名",
      component: "Input",
      bottomHelpMessage: `${usageHint}。模型名称（OneAPI/中转站根据自身路由表填写）`,
      componentProps: { placeholder: modelPlaceholder }
    },
    {
      field: `${prefix}.${keyField}`,
      label: "API Key",
      component: "InputPassword",
      bottomHelpMessage: `${usageHint}。OpenAI 兼容的 Bearer Token`,
      componentProps: { placeholder: "sk-xxxxx" }
    }
  ]
}

export default [
  ...makeAiBlock(
    "聊天追踪判断模型 (trackAiConfig)",
    "trackAiConfig",
    "trackAiUrl", "trackAiModel", "trackAiApikey",
    "https://api.openai.com/v1/chat/completions",
    "gpt-4o-mini",
    "用于会话追踪时判断用户是否在和 bot 继续对话，推荐用快速小模型"
  ),
  ...makeAiBlock(
    "工具调用模型 (toolsAiConfig)",
    "toolsAiConfig",
    "toolsAiUrl", "toolsAiModel", "toolsAiApikey",
    "https://api.openai.com/v1/chat/completions",
    "gemini-2.5-flash",
    "用于工具决策（如何时调用工具、表情包满额替换决策等），推荐中等模型"
  ),
  ...makeAiBlock(
    "主对话模型 (chatAiConfig)",
    "chatAiConfig",
    "chatApiUrl", "chatApiModel", "chatApiKey",
    "https://api.openai.com/v1/chat/completions",
    "gemini-2.5-pro",
    "主对话使用的模型，决定 bot 回复质量，推荐强模型"
  ),
  ...makeAiBlock(
    "图像编辑模型 (imageEditAiConfig)",
    "imageEditAiConfig",
    "imageEditApiUrl", "imageEditApiModel", "imageEditApiKey",
    "https://api.openai.com/v1/chat/completions",
    "gemini-3-pro-image-preview",
    "用于 googleImageEditTool（图生图）、bananaTool（文生图）等图片生成工具"
  ),
  ...makeAiBlock(
    "图像识别/VLM 模型 (analysisAiConfig)",
    "analysisAiConfig",
    "analysisApiUrl", "analysisApiModel", "analysisApiKey",
    "https://api.openai.com/v1/chat/completions",
    "gemini-3-pro-preview",
    "用于 googleImageAnalysisTool 识图、表情包系统的 VLM 打标和内容审查。必须支持视觉输入"
  ),
  ...makeAiBlock(
    "联网搜索模型 (searchAiConfig)",
    "searchAiConfig",
    "searchApiUrl", "searchApiModel", "searchApiKey",
    "https://api.openai.com/v1/chat/completions",
    "deepseek-r1-search",
    "用于 searchInformationTool 联网搜索，建议使用带搜索能力的模型"
  ),
  ...makeAiBlock(
    "记忆提取模型 (memoryAiConfig)",
    "memoryAiConfig",
    "memoryAiUrl", "memoryAiModel", "memoryAiApikey",
    "https://api.openai.com/v1/chat/completions",
    "gpt-4o-mini",
    "用于长期记忆提取、表达学习的 AI 场景化学习，推荐小模型省钱"
  ),
  ...makeAiBlock(
    "Embedding 模型 (embeddingAiConfig)",
    "embeddingAiConfig",
    "embeddingApiUrl", "embeddingApiModel", "embeddingApiKey",
    "https://api.openai.com/v1/embeddings",
    "text-embedding-3-small",
    "用于知识库语义检索、表情包系统 embedding 召回。URL 是 /v1/embeddings 不是 chat/completions"
  )
]
