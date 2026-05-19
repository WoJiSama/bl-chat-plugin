export default [
  {
    component: "SOFT_GROUP_BEGIN",
    label: "AI 核心设置"
  },
  {
    field: "systemContent",
    label: "系统提示词",
    component: "InputTextArea",
    bottomHelpMessage: "定义 AI 的个性和行为准则",
    componentProps: { rows: 8, placeholder: "你的名字叫哈基米..." }
  },
  {
    field: "providers",
    label: "服务提供商",
    component: "Input",
    bottomHelpMessage: "默认 oneapi 不要修改",
    componentProps: { placeholder: "oneapi" }
  },
  {
    field: "useTools",
    label: "工具调用开关",
    component: "Switch",
    bottomHelpMessage: "是否启用扩展功能工具"
  },
  {
    field: "maxToolRounds",
    label: "最大工具调用轮次",
    component: "InputNumber",
    bottomHelpMessage: "单次对话中调用工具的最大次数",
    componentProps: { min: 1, max: 20, placeholder: "5" }
  },
  {
    field: "openai_tool_choice",
    label: "工具选择模式",
    component: "Select",
    bottomHelpMessage: "auto 自动选择适用的工具",
    componentProps: {
      options: [
        { label: "auto", value: "auto" },
        { label: "none", value: "none" },
        { label: "required", value: "required" }
      ]
    }
  }
]
