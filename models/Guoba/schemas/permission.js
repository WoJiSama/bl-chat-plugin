export default [
  {
    component: "SOFT_GROUP_BEGIN",
    label: "权限控制"
  },
  {
    field: "enableGroupWhitelist",
    label: "群聊白名单开关",
    component: "Switch",
    bottomHelpMessage: "建议开启防止滥用"
  },
  {
    field: "allowedGroups",
    label: "白名单群号",
    component: "GTags",
    bottomHelpMessage: "允许使用 AI 功能的群组 ID（按回车添加）",
    componentProps: { allowAdd: true, allowDel: true }
  },
  {
    field: "whitelistRejectMsg",
    label: "拒绝提示",
    component: "Input",
    bottomHelpMessage: "非白名单群组的提示消息",
    componentProps: { placeholder: "本群未开启此功能哦~" }
  }
]
