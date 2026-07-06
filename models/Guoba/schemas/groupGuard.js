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
  },
  {
    component: "Divider",
    label: "复合群管"
  },
  {
    field: "groupModeration.enabled",
    label: "复合群管开关",
    component: "Switch",
    bottomHelpMessage: "检测低活跃成员的广告、外链、招募话术等风险"
  },
  {
    field: "groupModeration.enabledGroups",
    label: "启用群号",
    component: "GTags",
    bottomHelpMessage: "需要启用复合群管的群组 ID（按回车添加）。为空时不生效",
    componentProps: { allowAdd: true, allowDel: true }
  },
  {
    field: "groupModeration.globalAdmins",
    label: "全局管理员 QQ",
    component: "GTags",
    bottomHelpMessage: "所有启用群都会向这些 QQ 私聊转发证据；这些用户本身不会被检测",
    componentProps: { allowAdd: true, allowDel: true }
  },
  {
    field: "groupModeration.groupAdmins",
    label: "每群管理员",
    component: "GSubForm",
    bottomHelpMessage: "可为不同群单独配置接收证据的管理员；群原生群主/管理员也会被跳过检测",
    componentProps: {
      multiple: true,
      schemas: [
        { field: "groupId", label: "群号", component: "Input" },
        {
          field: "admins",
          label: "管理员 QQ",
          component: "GTags",
          componentProps: { allowAdd: true, allowDel: true }
        }
      ]
    }
  },
  {
    field: "groupModeration.minActiveLevel",
    label: "低活跃等级阈值",
    component: "InputNumber",
    bottomHelpMessage: "默认检测群活跃等级小于等于 5 的成员",
    componentProps: { min: 0, max: 100, step: 1, placeholder: "5" }
  },
  {
    field: "groupModeration.inspectLowLevelOnly",
    label: "只检测低活跃成员",
    component: "Switch",
    bottomHelpMessage: "开启后，活跃等级高于阈值的普通成员不会进入广告检测"
  },
  {
    field: "groupModeration.publicReportEnabled",
    label: "群内提醒",
    component: "Switch",
    bottomHelpMessage: "命中报告阈值后在群内发自然语言提醒"
  },
  {
    field: "groupModeration.forwardEvidenceToAdmins",
    label: "私聊转发证据",
    component: "Switch",
    bottomHelpMessage: "命中后把证据私聊转发给全局管理员和本群管理员"
  },
  {
    field: "groupModeration.modelReviewEnabled",
    label: "启用模型复核",
    component: "Switch",
    bottomHelpMessage: "开启后使用 toolsAiConfig 对疑似内容做语义复核，会增加模型调用量"
  },
  {
    field: "groupModeration.adTemplates",
    label: "广告判重模板",
    component: "GTags",
    bottomHelpMessage: "把漏判广告的核心话术填进来；系统会做去符号、去联系方式后的相似匹配",
    componentProps: { allowAdd: true, allowDel: true }
  },
  {
    field: "groupModeration.adTemplateSimilarityThreshold",
    label: "模板相似阈值",
    component: "InputNumber",
    bottomHelpMessage: "越低越容易命中相似广告，默认 0.58",
    componentProps: { min: 0, max: 1, step: 0.01, placeholder: "0.58" }
  },
  {
    field: "groupModeration.adTemplateWeight",
    label: "模板命中加权",
    component: "InputNumber",
    bottomHelpMessage: "命中广告模板后增加的置信度，默认 0.55",
    componentProps: { min: 0, max: 1, step: 0.01, placeholder: "0.55" }
  },
  {
    field: "groupModeration.thresholds.report",
    label: "提醒阈值",
    component: "InputNumber",
    componentProps: { min: 0, max: 1, step: 0.01, placeholder: "0.70" }
  },
  {
    field: "groupModeration.thresholds.recall",
    label: "撤回阈值",
    component: "InputNumber",
    componentProps: { min: 0, max: 1, step: 0.01, placeholder: "0.85" }
  },
  {
    field: "groupModeration.thresholds.mute",
    label: "禁言阈值",
    component: "InputNumber",
    componentProps: { min: 0, max: 1, step: 0.01, placeholder: "0.90" }
  },
  {
    field: "groupModeration.thresholds.kick",
    label: "踢出阈值",
    component: "InputNumber",
    componentProps: { min: 0, max: 1, step: 0.01, placeholder: "0.97" }
  },
  {
    field: "groupModeration.actions.recallEnabled",
    label: "允许自动撤回",
    component: "Switch",
    bottomHelpMessage: "默认关闭。开启后达到撤回阈值会尝试撤回消息"
  },
  {
    field: "groupModeration.actions.muteEnabled",
    label: "允许自动禁言",
    component: "Switch",
    bottomHelpMessage: "默认关闭。开启后达到禁言阈值会尝试禁言"
  },
  {
    field: "groupModeration.actions.kickEnabled",
    label: "允许自动踢出",
    component: "Switch",
    bottomHelpMessage: "默认关闭。开启后达到踢出阈值会尝试踢人"
  },
  {
    field: "groupModeration.actions.muteSeconds",
    label: "禁言秒数",
    component: "InputNumber",
    componentProps: { min: 60, max: 2592000, step: 60, placeholder: "600" }
  },
  {
    field: "groupModeration.reportTemplate",
    label: "群内提醒模板",
    component: "InputTextArea",
    bottomHelpMessage: "支持变量：{rules}、{confidence}、{action}、{actionText}、{evidenceText}"
  }
]
