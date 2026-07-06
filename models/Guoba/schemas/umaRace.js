export default [
  {
    component: "SOFT_GROUP_BEGIN",
    label: "赛马娘小游戏"
  },
  {
    field: "umaRace.enabled",
    label: "启用赛马娘小游戏",
    component: "Switch",
    bottomHelpMessage: "开启后可使用 .赛马娘 开始 / 加入 / 开跑 / 积分 / 排行"
  },
  {
    field: "umaRace.minPlayers",
    label: "固定开跑人数",
    component: "InputNumber",
    bottomHelpMessage: "赛马娘当前固定 8 人一局，不足会自动补 NPC。",
    componentProps: { min: 8, max: 8, step: 1, placeholder: "8" }
  },
  {
    field: "umaRace.maxPlayers",
    label: "报名人数上限",
    component: "InputNumber",
    bottomHelpMessage: "赛马娘当前固定最多 8 名真实玩家报名。",
    componentProps: { min: 8, max: 8, step: 1, placeholder: "8" }
  },
  {
    field: "umaRace.lobbySeconds",
    label: "报名超时（秒）",
    component: "InputNumber",
    bottomHelpMessage: "超过这个时间未手动开跑会自动开赛；有人加入或更新策略会刷新计时",
    componentProps: { min: 10, max: 300, step: 10, placeholder: "300" }
  },
  {
    field: "umaRace.cooldownSeconds",
    label: "群内开局冷却（秒）",
    component: "InputNumber",
    bottomHelpMessage: "防止连续刷屏；积分仍然全群互通",
    componentProps: { min: 0, max: 3600, step: 10, placeholder: "30" }
  },
  {
    field: "umaRace.winPoints",
    label: "冠军积分",
    component: "InputNumber",
    componentProps: { min: 0, max: 100000, step: 1, placeholder: "5" }
  },
  {
    field: "umaRace.secondPoints",
    label: "亚军积分",
    component: "InputNumber",
    componentProps: { min: 0, max: 100000, step: 1, placeholder: "2" }
  },
  {
    field: "umaRace.thirdPoints",
    label: "季军积分",
    component: "InputNumber",
    componentProps: { min: 0, max: 100000, step: 1, placeholder: "1" }
  },
  {
    field: "umaRace.rankLimit",
    label: "排行默认人数",
    component: "InputNumber",
    componentProps: { min: 3, max: 50, step: 1, placeholder: "10" }
  },
  {
    field: "umaRace.baseDir",
    label: "积分数据目录",
    component: "Input",
    bottomHelpMessage: "相对插件目录或绝对路径；默认 data/uma_race。积分按 QQ 号全局互通。"
  }
]
