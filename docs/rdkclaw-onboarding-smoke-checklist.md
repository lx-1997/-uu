# RDKClaw 对话与引导改造 Smoke 清单

## 1) 新电脑模型迁移

- 在旧机器打开设置页 `AI 模型`，点击“导出配置”生成 JSON。
- 在新机器打开同页面，点击“导入配置”并选择 JSON。
- 期望：导入后出现已保存模型，且可直接切换为当前模型。
- 期望：无需再次手填 provider / model / key 即可发起对话。

## 2) Onboarding 模型先填阻断

- 进入 onboarding，走到 `连接设备` 后应进入 `模型配置` 步骤。
- 模型未保存时，无法继续 OpenClaw 部署。
- 填写并保存模型后，可进入 OpenClaw 一键部署。

## 3) 一键部署 + 自动验通

- 在 `OpenClaw` 步骤点击“一键部署 OpenClaw”。
- 期望：展示部署日志并轮询任务状态。
- 部署完成后自动执行验通（网关健康 + 模型调用测试）。
- 期望：验通通过时 `OpenClaw 已就绪`，可进入下一步。

## 4) 对话性能与上下文策略可观测

- 发起一轮 RDKClaw 对话。
- 期望：完成后“本轮资源消耗”中可看到：
  - 首事件耗时 / 首文本耗时 / 总耗时 / 准备阶段耗时
  - 上下文压缩次数、超限恢复次数
  - 上下文策略快照（预算、历史占比、soft/hard 阈值、保留助手条数）

## 5) 关键错误码与前端提示

- `INVALID_DEPLOY_CONFIG`：提示先完成模型配置。
- `OPENCLAW_DEPLOY_JOB_NOT_FOUND`：提示任务过期需重新发起部署。
- `INVALID_AGENT_CONFIG_IMPORT`：提示导入文件缺少 `registry.entries`。
- `EMPTY_AGENT_CONFIG_IMPORT`：提示导入文件无有效模型配置。
