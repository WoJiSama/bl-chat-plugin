export default [
  {
    component: "SOFT_GROUP_BEGIN",
    label: "长期记忆系统 (memorySystem)"
  },
  {
    field: "memorySystem.enabled",
    label: "长期记忆开关",
    component: "Switch",
    bottomHelpMessage: "开启前需在「AI 模型配置」页填好 memoryAiConfig。每个群的每个用户独立记忆,群记忆作为群共识独立维护"
  },
  {
    field: "memorySystem.maxEntitiesPerGroup",
    label: "每群最大实体数",
    component: "InputNumber",
    bottomHelpMessage: "每个群最多记录多少个实体(人/物),超过会按权重淘汰",
    componentProps: { min: 10, max: 2000, placeholder: "200" }
  },
  {
    field: "memorySystem.maxFactsPerGroup",
    label: "每群最大记忆条数",
    component: "InputNumber",
    bottomHelpMessage: "每个群的全局共识记忆最多保存多少条(所有类别总计)",
    componentProps: { min: 10, max: 1000, placeholder: "50" }
  },
  {
    field: "memorySystem.maxFactsPerEntity",
    label: "每实体最大记忆条数",
    component: "InputNumber",
    bottomHelpMessage: "每个实体最多保存多少条记忆,超过会按重要性淘汰",
    componentProps: { min: 1, max: 200, placeholder: "20" }
  },
  {
    field: 'memorySystem.saveStrictness',
    label: '记忆保存严格度',
    component: 'Select',
    bottomHelpMessage: 'off=AI 全权决定;normal=代码边界过滤+AI;strict=最严格过滤',
    componentProps: { options: [
      { label: '宽松(off)', value: 'off' },
      { label: '正常(normal)', value: 'normal' },
      { label: '严格(strict)', value: 'strict' }
    ] }
  },
  {
    field: "memorySystem.userExtractDebounceSeconds",
    label: "用户记忆提取防抖（秒）",
    component: "InputNumber",
    bottomHelpMessage: "用户对话结束后，等待 N 秒再触发记忆提取，避免短时间重复调用",
    componentProps: { min: 0, max: 600, placeholder: "90" }
  },
  {
    field: "memorySystem.userExtractMaxBatchMessages",
    label: "用户记忆批量大小",
    component: "InputNumber",
    bottomHelpMessage: "用户记忆每次提取时一次性分析的消息条数",
    componentProps: { min: 1, max: 50, placeholder: "6" }
  },
  {
    field: "memorySystem.groupExtractMinIntervalMinutes",
    label: "群记忆最小整理间隔（分钟）",
    component: "InputNumber",
    bottomHelpMessage: "群记忆两次整理之间至少间隔 N 分钟",
    componentProps: { min: 1, max: 120, placeholder: "10" }
  },
  {
    field: "memorySystem.groupExtractMaxBatchMessages",
    label: "群记忆触发条数",
    component: "InputNumber",
    bottomHelpMessage: "群累计多少条消息后立即整理一次",
    componentProps: { min: 1, max: 100, placeholder: "12" }
  },
  {
    field: "memorySystem.promptMaxGroupFacts",
    label: "注入群记忆最大条数",
    component: "InputNumber",
    bottomHelpMessage: "每次对话时注入 prompt 的群共识记忆条数上限",
    componentProps: { min: 0, max: 50, placeholder: "6" }
  },
  {
    field: "memorySystem.promptMaxChars",
    label: "记忆 prompt 字符上限",
    component: "InputNumber",
    bottomHelpMessage: "记忆部分注入 system prompt 的总字符上限，控制 token 消耗",
    componentProps: { min: 100, max: 8000, placeholder: "1200" }
  }
]
