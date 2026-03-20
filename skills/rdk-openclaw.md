---
name: rdk-openclaw
description: "OpenClaw AI Agent网关管理：安装、配置、启停、模型切换、聊天。Use when user mentions openclaw, 小龙虾, agent gateway, 网关, 启动openclaw, 切换模型."
version: 1.0.0
metadata: {"rdkstudio":{"category":"ai","icon":"bot","requires":{"device":true},"tab":"openclaw"}}
---

# OpenClaw 管理

## When to Use
- 用户说：OpenClaw、小龙虾、网关、Agent
- 用户想启动/停止/查看 OpenClaw 状态
- 用户想切换 AI 模型
- 用户想安装或配置 OpenClaw

## APIs

### 执行 Agent 操作（启动/状态/切换/安装/日志）
```
POST /api/openclaw/agent-action
Body: { action: "start" | "status" | "switch" | "install" | "logs", modelName?: string, host?: string, username?: string }
Response: { ok: boolean, action: string, host: string, username: string, output: string }
```
CAUTION: switch 操作会切换底层模型，建议先确认。

### 检查部署环境
```
POST /api/devices/{deviceId}/openclaw/check
Response: { ok: boolean, output: string }
```

### 安装 OpenClaw
```
POST /api/devices/{deviceId}/openclaw/install
Response: { ok: boolean, output: string }
```

### 升级 OpenClaw
```
POST /api/devices/{deviceId}/openclaw/upgrade
Response: { ok: boolean, output: string }
```

### 卸载 OpenClaw
```
POST /api/devices/{deviceId}/openclaw/uninstall
Response: { ok: boolean, output: string }
```

### 配置 LLM Provider
```
POST /api/devices/{deviceId}/openclaw/onboard
Body: { provider: string, apiKey: string, modelId?: string }
Response: { ok: boolean, output: string }
```

### 获取网关状态
```
GET /api/devices/{deviceId}/openclaw/status
Response: { running: boolean, port: number, model: string, ... }
```

### 获取/更新配置
```
GET /api/devices/{deviceId}/openclaw/config
POST /api/devices/{deviceId}/openclaw/config
Body: { config: object }
```

### 重启网关
```
POST /api/devices/{deviceId}/openclaw/restart-gateway
Response: { ok: boolean, output: string }
```

### 获取版本
```
GET /api/devices/{deviceId}/openclaw/version
Response: { ok: boolean, version: string }
```

### WiFi 管理
```
GET /api/devices/{deviceId}/openclaw/wifi-list
POST /api/devices/{deviceId}/openclaw/wifi-connect
Body: { wifiName: string, wifiPassword?: string }
```

## Client Actions
- 打开 OpenClaw 页面: `navigate:openclaw`

## Safety
- 模型切换会影响所有 Agent 对话
- 安装/卸载操作需要 root 权限
