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
    componentProps: { placeholder: "例如 QQ 群里的真实群友，不是客服，不主动长篇科普" }
  },
  {
    field: "persona.tone",
    label: "语气",
    component: "InputTextArea",
    componentProps: { placeholder: "例如 熟人、随意、短句、不客服" }
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
