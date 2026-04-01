---
name: RDK OpenClaw (Studio)
description: 在 RDK Studio 侧管理板端 OpenClaw：HTTP API（安装/配置/状态/WiFi）与工具链（状态/日志/生命周期/配对/飞书等）。一条技能覆盖原 API + Lifecycle，按场景选「REST」或「board_openclaw_* 工具」。
version: 2.0.0
trigger: openclaw,小龙虾,网关,agent gateway,启动openclaw,切换模型,wifi配置,openclaw api,openclaw安装,openclaw卸载,openclaw升级,gateway重启,openclaw状态,配对,feishu配置,model切换
risk: high
permissions: device_exec,network
delegate_preference: hybrid
requires_board: true
approval_level: strict
cooldown_seconds: 3
scheduler_template: openclaw_lifecycle_maintenance
category: Procedure
---

# RDK OpenClaw（Studio 侧统一入口）

> **互补**：与板端协同编排见 **`rdk-openclaw-bridge`**；仅委派给板端 Agent 见 **`rdk-board-delegate`**。

## 何时用 HTTP API，何时用工具

| 场景 | 优先 |
|------|------|
| 安装/升级/卸载、WiFi、onboard LLM、部分网关操作 | `POST/GET .../api/devices/{deviceId}/openclaw/*`（见下表） |
| 日常状态摘要 | `board_openclaw_status` |
| 排障、JSON 健康、装升重启后验收 | `board_openclaw_health`（非例行滥用） |
| 安装/升级/卸载/重启网关/模型切换/飞书/配对 | `board_openclaw_install` 等工具链（见生命周期表） |
| 复杂修复 | `board_openclaw_assess` → `board_openclaw_delegate` |

## A. HTTP API（Studio → 设备上的 OpenClaw 服务）

1. **检查环境**：`POST /api/devices/{deviceId}/openclaw/check`
2. **状态**：`GET /api/devices/{deviceId}/openclaw/status`
3. **操作**：按需调用 install / upgrade / uninstall / onboard / restart-gateway / config / version / wifi-list / wifi-connect 等（与旧版 `rdk-openclaw-api` 一致）。
4. **验证**：变更后再次 `status` 或 `check`。

| API | 用途 |
|-----|------|
| `POST .../openclaw/agent-action` | 启动/状态/切换/安装/日志等聚合操作 |
| `POST .../openclaw/check` | 部署环境检查 |
| `POST .../openclaw/install` \| `upgrade` \| `uninstall` | 生命周期 |
| `POST .../openclaw/onboard` | 配置 LLM Provider |
| `GET .../openclaw/status` | 网关状态 |
| `GET/POST .../openclaw/config` | 读/写配置 |
| `POST .../openclaw/restart-gateway` | 重启网关 |
| `GET .../openclaw/version` | 版本 |
| `GET .../openclaw/wifi-list` \| `POST .../wifi-connect` | WiFi |

客户端可 `navigate:openclaw` 打开相关界面。

## B. 工具链（Lifecycle / 运维）

| 工具 | 用途 |
|------|------|
| `board_openclaw_status`、`board_openclaw_logs`、`board_openclaw_read_config` | 诊断 |
| `board_openclaw_install`、`upgrade`、`uninstall`、`board_openclaw_restart_gateway` | 生命周期 |
| `board_openclaw_model_switch`、`board_openclaw_feishu_config`、配对 list/approve/reject | 配置与接入 |
| `board_openclaw_check`、`board_openclaw_doctor` | 深度体检 / 修复 |
| `board_openclaw_assess`、`board_openclaw_delegate` | 板端复杂任务 |

## 执行顺序（建议）

1. **先读后改**：先看 status / logs / config，再安装或改配置。
2. **最小副作用**：优先重启、改模型，再升级或卸载重装。
3. **变更后复核**：每次变更后检查状态并报告。
4. **可回退**：卸载、改配置前说明风险与回退思路。

## 输出要求

- 操作前后对比（running / model / version）。
- 高风险步骤区分「已执行」与「仅建议」。
- LLM Provider 的 apiKey 不回显。

## 禁止事项

- 未体检即卸载或覆盖配置。
- 模型切换不告知影响范围。
- 设备离线仍调安装类 API。
- 对权限/网关错误无限重试同一动作。
