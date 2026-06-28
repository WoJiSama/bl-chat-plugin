export default [
  {
    component: "SOFT_GROUP_BEGIN",
    label: "群管理模块"
  },
  {
    component: "Divider",
    label: "入群审核"
  },
  {
    field: "groupGuard.enabled",
    label: "入群审核开关",
    component: "Switch",
    bottomHelpMessage: "开启后，仅对下方群列表中的群生效；机器人必须是群主或管理员才会发起验证和踢人"
  },
  {
    field: "groupGuard.enabledGroups",
    label: "启用群号",
    component: "GTags",
    bottomHelpMessage: "需要入群验证的群组 ID（按回车添加）。为空时不对任何群生效",
    componentProps: { allowAdd: true, allowDel: true }
  },
  {
    field: "groupGuard.verifyInviteJoin",
    label: "验证邀请入群",
    component: "Switch",
    bottomHelpMessage: "开启后，通过邀请进群的用户也需要答题；关闭后只验证主动申请/普通入群事件"
  },
  {
    field: "groupGuard.timeoutSeconds",
    label: "答题超时（秒）",
    component: "InputNumber",
    bottomHelpMessage: "用户进群后必须在该时间内答对。默认 300 秒",
    componentProps: { min: 30, max: 3600, step: 30, placeholder: "300" }
  },
  {
    field: "groupGuard.questionMaxNumber",
    label: "题目数字范围",
    component: "InputNumber",
    bottomHelpMessage: "生成 0 到该数字范围内的加减法题。10 表示十以内加减法",
    componentProps: { min: 1, max: 100, step: 1, placeholder: "10" }
  },
  {
    field: "groupGuard.questionOperators",
    label: "题型",
    component: "GTags",
    bottomHelpMessage: "可填 add / sub，分别表示加法 / 减法。为空时默认加减法都启用",
    componentProps: { allowAdd: true, allowDel: true }
  },
  {
    field: "groupGuard.maxWrongTimes",
    label: "允许错误次数",
    component: "InputNumber",
    bottomHelpMessage: "达到该次数后按配置踢出。默认 1 次，即答错一次就踢",
    componentProps: { min: 1, max: 5, placeholder: "1" }
  },
  {
    field: "groupGuard.kickOnTimeout",
    label: "超时踢出",
    component: "Switch",
    bottomHelpMessage: "关闭后超时只取消验证，不踢人"
  },
  {
    field: "groupGuard.kickOnWrongAnswer",
    label: "答错踢出",
    component: "Switch",
    bottomHelpMessage: "关闭后答错达到次数只提示失败，不踢人"
  },
  {
    field: "groupGuard.promptTemplate",
    label: "验证提示",
    component: "InputTextArea",
    bottomHelpMessage: "支持变量：{at}、{userId}、{question}、{timeout}"
  },
  {
    field: "groupGuard.passMessage",
    label: "通过提示",
    component: "Input",
    bottomHelpMessage: "用户答对后的提示。留空则不发送"
  },
  {
    field: "groupGuard.retryMessage",
    label: "重试提示",
    component: "InputTextArea",
    bottomHelpMessage: "允许多次错误时，未达到上限的提示。支持变量：{at}、{userId}、{question}、{timeout}、{wrongTimes}、{maxWrongTimes}"
  },
  {
    field: "groupGuard.failMessage",
    label: "答错踢出提示",
    component: "InputTextArea",
    bottomHelpMessage: "答错达到上限后的提示。支持变量：{userId}、{question}"
  },
  {
    field: "groupGuard.timeoutMessage",
    label: "超时踢出提示",
    component: "InputTextArea",
    bottomHelpMessage: "超时后的提示。支持变量：{userId}、{question}、{timeout}"
  }
]
