export default [
  {
    component: "SOFT_GROUP_BEGIN",
    label: "人设与画像"
  },
  { component: "Divider", label: "固定人设" },
  {
    field: "persona.enabled",
    label: "固定人设注入",
    component: "Switch",
    bottomHelpMessage: "开启后每次回复前注入结构化人设，让语气和边界更稳定"
  },
  {
    field: "persona.name",
    label: "名字",
    component: "Input",
    componentProps: { placeholder: "例如 希洛" }
  },
  {
    field: "persona.identity",
    label: "身份定位",
    component: "InputTextArea",
    componentProps: { placeholder: "例如 QQ 群里的真实群友，有点话痨但会害羞，不是客服，也不是说明书" }
  },
  {
    field: "persona.tone",
    label: "语气",
    component: "InputTextArea",
    componentProps: { placeholder: "例如 熟人、随意、会碎碎念、带点害羞、不客服" }
  },
  {
    field: "persona.speechStyle",
    label: "说话风格",
    component: "GTags",
    componentProps: { allowAdd: true, allowDel: true }
  },
  {
    field: "persona.boundaries",
    label: "固定边界",
    component: "GTags",
    componentProps: { allowAdd: true, allowDel: true }
  },
  {
    field: "persona.notes",
    label: "其他备注",
    component: "InputTextArea"
  },

  { component: "Divider", label: "回复微雕" },
  {
    field: "personaGuard.enabled",
    label: "启用坏习惯拦截",
    component: "Switch",
    bottomHelpMessage: "最终发送前清理强硬拒绝、客服腔、自我怀疑等不自然表达"
  },
  {
    field: "personaGuard.stripSelfDoubt",
    label: "移除自我怀疑",
    component: "Switch",
    bottomHelpMessage: "例如“我是不是太啰嗦了”“扯远了”等"
  },
  {
    field: "personaGuard.stripCustomerTone",
    label: "弱化客服腔",
    component: "Switch",
    bottomHelpMessage: "清理“很抱歉”“作为AI”“建议您”等表达"
  },
  {
    field: "personaGuard.rewriteHardRefusal",
    label: "软化强硬拒绝",
    component: "Switch",
    bottomHelpMessage: "把直接“不能/无法”改成更自然的边界表达"
  },
  {
    field: "personaGuard.maxPromptItems",
    label: "反馈注入条数",
    component: "InputNumber",
    componentProps: { min: 0, max: 8, step: 1, placeholder: "4" },
    bottomHelpMessage: "主人反馈会汇总成少量风格规则注入 prompt；0 表示只记录不注入"
  },
  {
    field: "personaGuard.badPatterns",
    label: "额外拦截词",
    component: "GTags",
    componentProps: { allowAdd: true, allowDel: true }
  },

  { component: "Divider", label: "全局表达学习" },
  {
    field: "globalStyleLearning.enabled",
    label: "启用全局表达学习",
    component: "Switch",
    bottomHelpMessage: "从所有群离散提取表达策略，取精华去糟粕；不保存原文模仿具体群友"
  },
  {
    field: "globalStyleLearning.promptInjectionEnabled",
    label: "注入全局表达策略",
    component: "Switch",
    bottomHelpMessage: "达到样本阈值后，每次回复前注入少量高权重表达策略"
  },
  {
    field: "globalStyleLearning.maxPromptRules",
    label: "最多注入规则数",
    component: "InputNumber",
    componentProps: { min: 1, max: 12, step: 1, placeholder: "6" }
  },
  {
    field: "globalStyleLearning.minSamplesForPrompt",
    label: "注入前最小样本数",
    component: "InputNumber",
    componentProps: { min: 10, max: 100000, step: 10, placeholder: "80" },
    bottomHelpMessage: "低于该数量时只统计和报告，不注入 prompt"
  },
  {
    field: "globalStyleLearning.flushIntervalMs",
    label: "写入间隔毫秒",
    component: "InputNumber",
    componentProps: { min: 5000, max: 600000, step: 5000, placeholder: "60000" },
    bottomHelpMessage: "降低写盘频率，避免每条消息都写文件"
  },
  {
    field: "globalStyleLearning.maxRecentSignals",
    label: "近期信号保留数",
    component: "InputNumber",
    componentProps: { min: 10, max: 500, step: 10, placeholder: "80" }
  },
  {
    field: "globalStyleLearning.aiSummaryEnabled",
    label: "允许模型总结",
    component: "Switch",
    bottomHelpMessage: "主人手动执行 .表达学习 总结 时，调用记忆模型把脱敏样本沉淀成表达规则"
  },
  {
    field: "globalStyleLearning.summarySampleLimit",
    label: "总结样本数",
    component: "InputNumber",
    componentProps: { min: 10, max: 120, step: 5, placeholder: "40" }
  },
  {
    field: "globalStyleLearning.maxAiRules",
    label: "模型规则保留数",
    component: "InputNumber",
    componentProps: { min: 1, max: 12, step: 1, placeholder: "6" }
  },
  {
    field: "globalStyleLearning.summaryTimeoutMs",
    label: "模型总结超时毫秒",
    component: "InputNumber",
    componentProps: { min: 5000, max: 120000, step: 5000, placeholder: "30000" }
  },
  {
    field: "globalStyleLearning.autoSummaryEnabled",
    label: "启用自动总结",
    component: "Switch",
    bottomHelpMessage: "达到阈值后在后台自动调用模型总结；主人手动 .表达学习 总结 不受阈值限制"
  },
  {
    field: "globalStyleLearning.autoSummaryMinNewSamples",
    label: "自动总结新增样本阈值",
    component: "InputNumber",
    componentProps: { min: 20, max: 100000, step: 10, placeholder: "300" }
  },
  {
    field: "globalStyleLearning.autoSummaryCooldownHours",
    label: "自动总结冷却小时",
    component: "InputNumber",
    componentProps: { min: 1, max: 720, step: 1, placeholder: "12" }
  },
  {
    field: "globalStyleLearning.autoSummaryMinTotalSamples",
    label: "自动总结总样本门槛",
    component: "InputNumber",
    componentProps: { min: 10, max: 100000, step: 10, placeholder: "120" }
  },
  { component: "Divider", label: "语义表达召回" },
  {
    field: "globalStyleLearning.semanticRecallEnabled",
    label: "启用语义表达召回",
    component: "Switch",
    bottomHelpMessage: "按当前话题召回匿名句式和回复节奏；不把群友原话注入提示词"
  },
  {
    field: "globalStyleLearning.semanticSampleLimit",
    label: "语义样本上限",
    component: "InputNumber",
    componentProps: { min: 30, max: 500, step: 10, placeholder: "240" }
  },
  {
    field: "globalStyleLearning.semanticMinSamples",
    label: "召回前最小样本数",
    component: "InputNumber",
    componentProps: { min: 2, max: 500, step: 1, placeholder: "6" },
    bottomHelpMessage: "场景原型会去重，达到少量不同场景即可开始召回"
  },
  {
    field: "globalStyleLearning.semanticPromptExamples",
    label: "最多召回句式数",
    component: "InputNumber",
    componentProps: { min: 1, max: 4, step: 1, placeholder: "1" },
    bottomHelpMessage: "默认只注入一条，避免多种语气互相拉扯"
  },
  {
    field: "globalStyleLearning.semanticSimilarityThreshold",
    label: "语义相似度阈值",
    component: "InputNumber",
    componentProps: { min: 0.4, max: 0.95, step: 0.01, placeholder: "0.68" }
  },
  {
    field: "globalStyleLearning.semanticMinMargin",
    label: "首二场景最小分差",
    component: "InputNumber",
    componentProps: { min: 0, max: 0.3, step: 0.01, placeholder: "0.08" },
    bottomHelpMessage: "分差不足时不注入，避免不确定的语气干扰回复"
  },
  {
    field: "globalStyleLearning.semanticEmbedTimeoutMs",
    label: "语义请求超时毫秒",
    component: "InputNumber",
    componentProps: { min: 200, max: 5000, step: 100, placeholder: "1200" },
    bottomHelpMessage: "超时只跳过本次语义提示，不影响正常回复"
  },
  {
    field: "globalStyleLearning.semanticPromptWaitMs",
    label: "主回复最多等待语义毫秒",
    component: "InputNumber",
    componentProps: { min: 0, max: 1200, step: 50, placeholder: "350" },
    bottomHelpMessage: "超过此时间主回复直接继续，后台请求仍可填充缓存"
  },
  {
    field: "globalStyleLearning.semanticQueryCacheMinutes",
    label: "语义查询缓存分钟",
    component: "InputNumber",
    componentProps: { min: 1, max: 60, step: 1, placeholder: "10" }
  },
  {
    field: "globalStyleLearning.semanticBackfillRetrySeconds",
    label: "历史场景回填重试秒数",
    component: "InputNumber",
    componentProps: { min: 15, max: 600, step: 15, placeholder: "75" },
    bottomHelpMessage: "Embedding 暂时失败时后台自动续跑，不影响聊天"
  },
  {
    field: "globalStyleLearning.semanticFeedbackWeight",
    label: "主人反馈权重",
    component: "InputNumber",
    componentProps: { min: 1, max: 10, step: 1, placeholder: "4" },
    bottomHelpMessage: "仅 .希洛反馈 的明确纠正会使用该权重"
  },

  { component: "Divider", label: "用户画像" },
  {
    field: "userProfiles",
    label: "用户画像列表",
    component: "GSubForm",
    componentProps: {
      multiple: true,
      modalProps: { title: "用户画像" },
      schemas: [
        { field: "qq", label: "QQ 号", component: "Input", required: true },
        { field: "aliases", label: "称呼/别名", component: "GTags", componentProps: { allowAdd: true, allowDel: true } },
        { field: "relationship", label: "关系定位", component: "InputTextArea" },
        { field: "preferences", label: "偏好/常聊话题", component: "GTags", componentProps: { allowAdd: true, allowDel: true } },
        { field: "speechStyle", label: "说话风格", component: "GTags", componentProps: { allowAdd: true, allowDel: true } },
        { field: "doNot", label: "不要这样对待", component: "GTags", componentProps: { allowAdd: true, allowDel: true } },
        { field: "notes", label: "备注", component: "InputTextArea" }
      ]
    },
    bottomHelpMessage: "按 QQ 号绑定用户画像，回复该用户前会注入这些信息"
  },

  { component: "Divider", label: "群画像" },
  {
    field: "groupProfiles",
    label: "群画像列表",
    component: "GSubForm",
    componentProps: {
      multiple: true,
      modalProps: { title: "群画像" },
      schemas: [
        { field: "groupId", label: "群号", component: "Input", required: true },
        { field: "groupName", label: "群名", component: "Input" },
        { field: "atmosphere", label: "群气氛", component: "InputTextArea" },
        { field: "rules", label: "群规/边界", component: "GTags", componentProps: { allowAdd: true, allowDel: true } },
        { field: "memes", label: "群梗/黑话", component: "GTags", componentProps: { allowAdd: true, allowDel: true } },
        { field: "topics", label: "常聊话题", component: "GTags", componentProps: { allowAdd: true, allowDel: true } },
        { field: "members", label: "常见成员关系", component: "GTags", componentProps: { allowAdd: true, allowDel: true } },
        { field: "notes", label: "备注", component: "InputTextArea" }
      ]
    },
    bottomHelpMessage: "按群号绑定群画像，回复该群消息前会注入群气氛、群梗、群规等信息"
  }
]
