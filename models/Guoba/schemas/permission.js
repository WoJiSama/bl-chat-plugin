export default [
  {
    field: "enableGroupWhitelist",
    label: "群聊白名单开关",
    component: "Switch",
    bottomHelpMessage: "建议开启防止滥用。关闭时所有群都可使用 AI 对话功能"
  },
  {
    field: "allowedGroups",
    label: "白名单群号",
    component: "GTags",
    bottomHelpMessage: "允许使用 AI 功能的群组 ID（按回车添加）",
    componentProps: { allowAdd: true, allowDel: true }
  },
  {
    field: "userBlacklist.enabled",
    label: "用户黑名单开关",
    component: "Switch",
    bottomHelpMessage: "开启后，黑名单 QQ 用户的消息会被静默忽略，不触发对话、工具、记忆或表达学习"
  },
  {
    field: "userBlacklist.users",
    label: "黑名单 QQ",
    component: "GTags",
    bottomHelpMessage: "需要屏蔽的 QQ 号（按回车添加）",
    componentProps: { allowAdd: true, allowDel: true }
  }
]
