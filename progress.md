# 进度

## 2026-06-12
- 建立本轮计划文件。
- 用户确认不做高成本网页 CRUD，改做记忆抽取、召回、人设注入稳定性。
- 已完成阶段 1 梳理：重点风险是召回相关性过滤不足、prompt 数量 0 配置失效、画像注入缺少长度保护。
- 已完成稳定性改动：召回相关性阈值、允许注入条数为 0、低信号内容过滤、画像注入长度上限和近期发言去重。
- `node --check` 已通过：`utils/MemoryManager.js`、`utils/PersonProfileInjector.js`、`models/Guoba/schemas/memory.js`、`models/Guoba/schemas/tracking.js`。
- `git diff --check` 已通过。
- 已同步远端 `/opt/trss-yunzai/plugins/bl-chat-plugin` 对应文件，并删除误同步到插件根目录的临时 basename 文件。
- 已重启 `trss-yunzai.service`，服务状态 `active`，Guoba 启动成功。
- 远端部署路径再次执行 `node --check` 通过，`systemctl is-active trss-yunzai.service` 返回 `active`。
