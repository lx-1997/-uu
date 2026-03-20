---
name: rdk-terminal
description: "SSH终端会话管理与命令执行。Use when user wants to open terminal, run command, execute, ssh, 终端, 命令行, 执行命令."
version: 1.0.0
metadata: {"rdkstudio":{"category":"development","icon":"terminal","requires":{"device":true},"tab":"terminal"}}
---

# SSH 终端

## When to Use
- 用户说：打开终端、terminal、ssh、命令行、控制台
- 用户说：执行、运行、run、exec + 具体命令
- 用户直接输入 shell 命令（ls、top、cat、ros2 等）

## APIs

### 创建终端会话
```
POST /api/devices/{deviceId}/terminal/create
Response: { ok: boolean, sessionId: string, device: Device }
```
返回 sessionId，前端通过 Socket.IO `init` 事件建立 PTY 连接。

### 执行单条命令
```
POST /api/devices/{deviceId}/exec
Body: { command: string }
Response: { ok: boolean, output: string, device: Device, command: string }
```

### 批量执行命令
```
POST /api/devices/{deviceId}/batch-exec
Body: { commands: string[] }
Response: { ok: boolean, output: string, device: Device, commandCount: number }
```

## Client Actions
- 打开终端页面: `navigate:terminal`
- 创建新会话: `createTerminal`

## Patterns
- 如果用户输入看起来像 shell 命令（以 ls/cat/top/ros2/pip 等开头），直接通过 exec API 执行
- 对于 "执行 xxx" / "运行 xxx" 格式，提取命令部分调用 exec
- 长时间运行的命令建议用户在终端交互式执行
