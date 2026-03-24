---
name: RDK OpenClaw API
description: OpenClaw AI Agent 网关的 Studio HTTP API 管理：安装、配置、启停、模型切换、状态查询。触发词：openclaw、小龙虾、网关、agent、启动 openclaw、切换模型、WiFi 配置。
version: 1.0.0
trigger: openclaw,小龙虾,网关,agent gateway,启动openclaw,切换模型,wifi配置,openclaw api
risk: medium
permissions: device_exec,network
delegate_preference: local
requires_board: true
approval_level: confirm
cooldown_seconds: 0
scheduler_template: none
category: Procedure
---

# RDK OpenClaw API

> **互补关系**：本技能专注于 RDK Studio 侧的 OpenClaw HTTP API 调用。
> - 生命周期操作（安装、升级、卸载、重启、配对等工具链路）请参考 → `rdk-openclaw-lifecycle/SKILL.md`
> - 软件端与板端协同桥接请参考 → `rdk-openclaw-bridge/SKILL.md`

## 适用场景
- 用户说：OpenClaw、小龙虾、网关、Agent。
- 用户想通过 Studio HTTP 接口启动/停止/查看 OpenClaw 状态。
- 用户想切换 AI 模型或配置 LLM Provider。
- 用户想安装、升级或卸载 OpenClaw。
- 用户想管理设备 WiFi 连接。

## 执行流程
1. **检查部署环境**：调用 `POST /api/devices/{deviceId}/openclaw/check` 确认设备环境就绪。
2. **获取状态**：调用 `GET /api/devices/{deviceId}/openclaw/status` 查看当前运行状态和配置。
3. **执行操作**：根据用户意图调用相应 API（安装/升级/卸载/配置/重启等）。
4. **验证结果**：操作后再次调用 status 确认变更生效。

## 工具映射

| API | 用途 | 必需 |
|-----|------|------|
| `POST .../openclaw/agent-action` | 执行 Agent 操作（启动/状态/切换/安装/日志） | 否 |
| `POST .../openclaw/check` | 检查部署环境 | 是 |
| `POST .../openclaw/install` | 安装 OpenClaw | 否 |
| `POST .../openclaw/upgrade` | 升级 OpenClaw | 否 |
| `POST .../openclaw/uninstall` | 卸载 OpenClaw | 否 |
| `POST .../openclaw/onboard` | 配置 LLM Provider | 否 |
| `GET .../openclaw/status` | 获取网关状态 | 否 |
| `GET/POST .../openclaw/config` | 获取/更新配置 | 否 |
| `POST .../openclaw/restart-gateway` | 重启网关 | 否 |
| `GET .../openclaw/version` | 获取版本 | 否 |
| `GET .../openclaw/wifi-list` | 获取 WiFi 列表 | 否 |
| `POST .../openclaw/wifi-connect` | 连接 WiFi | 否 |

### API 详细参数

**执行 Agent 操作**
```
POST /api/openclaw/agent-action
Body: { action: "start" | "status" | "switch" | "install" | "logs", modelName?: string, host?: string, username?: string }
Response: { ok: boolean, action: string, host: string, username: string, output: string }
```

**检查部署环境**
```
POST /api/devices/{deviceId}/openclaw/check
Response: { ok: boolean, output: string }
```

**安装 OpenClaw**
```
POST /api/devices/{deviceId}/openclaw/install
Response: { ok: boolean, output: string }
```

**升级 OpenClaw**
```
POST /api/devices/{deviceId}/openclaw/upgrade
Response: { ok: boolean, output: string }
```

**卸载 OpenClaw**
```
POST /api/devices/{deviceId}/openclaw/uninstall
Response: { ok: boolean, output: string }
```

**配置 LLM Provider**
```
POST /api/devices/{deviceId}/openclaw/onboard
Body: { provider: string, apiKey: string, modelId?: string }
Response: { ok: boolean, output: string }
```

**获取网关状态**
```
GET /api/devices/{deviceId}/openclaw/status
Response: { running: boolean, port: number, model: string, ... }
```

**获取/更新配置**
```
GET /api/devices/{deviceId}/openclaw/config
POST /api/devices/{deviceId}/openclaw/config
Body: { config: object }
```

**重启网关**
```
POST /api/devices/{deviceId}/openclaw/restart-gateway
Response: { ok: boolean, output: string }
```

**获取版本**
```
GET /api/devices/{deviceId}/openclaw/version
Response: { ok: boolean, version: string }
```

**WiFi 管理**
```
GET /api/devices/{deviceId}/openclaw/wifi-list
POST /api/devices/{deviceId}/openclaw/wifi-connect
Body: { wifiName: string, wifiPassword?: string }
```

### Client Actions
- 打开 OpenClaw 页面: `navigate:openclaw`

## 输出要求
- 操作前后展示状态对比（running/model/version 变化）。
- 安装/升级/卸载需报告执行结果和版本信息。
- LLM Provider 配置成功后需验证连通性。

## 禁止事项
- **模型切换会影响所有 Agent 对话**：切换前必须告知用户影响范围并获得确认。
- **安装/卸载操作需要 root 权限**：确认设备权限充足后再执行。
- **不在设备离线时调用 API**：先确认设备连接状态。
- **不将 API Key 回显到输出中**：LLM Provider 的 apiKey 属于敏感信息。
