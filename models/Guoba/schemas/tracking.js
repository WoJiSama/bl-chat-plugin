export default [
  {
    field: "conversationTrackingEnabled",
    label: "会话追踪开关",
    component: "Switch",
    bottomHelpMessage: "开启后会增加 token 消耗。用户触发对话后自动追踪后续消息判断是否继续对话"
  },
  {
    field: "conversationTrackingTimeout",
    label: "追踪超时（分钟）",
    component: "InputNumber",
    bottomHelpMessage: "用户触发对话后，追踪其后续消息的时间窗口",
    componentProps: { min: 1, max: 30, placeholder: "2" }
  },
  {
    field: "conversationTrackingThrottle",
    label: "节流时间（秒）",
    component: "InputNumber",
    bottomHelpMessage: "同一用户连续发消息时，间隔多少秒才调用 AI 判断",
    componentProps: { min: 1, max: 60, placeholder: "3" }
  },
  {
    field: "batchJudgmentDelay",
    label: "批量判断延迟（秒）",
    component: "InputNumber",
    bottomHelpMessage: "收集多少秒内的消息后批量判断，减少 API 调用次数",
    componentProps: { min: 1, max: 60, placeholder: "10" }
  }
]
