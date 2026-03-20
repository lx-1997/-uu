---
name: rdk-workflow
description: "低代码流程编排：Node-RED工作流管理与验证。Use when user mentions workflow, node-red, 流程, 编排, lowcode, 工作流."
version: 1.0.0
metadata: {"rdkstudio":{"category":"development","icon":"git-branch","requires":{"device":true},"tab":"lowcode"}}
---

# 流程编排

## When to Use
- 用户说：流程编排、Node-RED、工作流、lowcode
- 用户想创建或管理自动化流程
- 用户想检查 Node-RED 服务状态

## APIs

### 检查 Node-RED 状态
```
GET /api/devices/{deviceId}/services/node-red
Response: { ok: boolean, active: boolean, output: string }
```

### 启动 Node-RED
```
POST /api/devices/{deviceId}/services/node-red/start
Response: { ok: boolean, output: string }
```

### 停止 Node-RED
```
POST /api/devices/{deviceId}/services/node-red/stop
Response: { ok: boolean, output: string }
```

## Client Actions
- 打开编排页面: `navigate:lowcode`
- 执行流程验证: `runFlowValidation`

## Notes
- Node-RED 默认运行在设备的 1880 端口
- 流程验证会检查 Node-RED、ROS bridge、OpenClaw 的运行状态
