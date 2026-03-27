---
name: RDK Terminal
description: SSH 终端会话管理与命令执行，支持 exec 单次执行和 PTY 交互两种模式。触发词：终端、命令行、terminal、ssh、执行命令、run。
version: 1.0.1
trigger: 终端,命令行,terminal,ssh,执行命令,run,exec,控制台,shell
risk: medium
permissions: device_exec
delegate_preference: local
requires_board: true
approval_level: confirm
cooldown_seconds: 0
scheduler_template: none
category: Procedure
disableModelInvocation: true
---

# RDK Terminal

## 适用场景
- 用户说：打开终端、terminal、ssh、命令行、控制台。
- 用户说：执行、运行、run、exec + 具体命令。
- 用户直接输入 shell 命令（ls、top、cat、ros2 等）。

> **ros2 / TROS**：板上多为 **TROS**（`/opt/tros/.../setup.bash`）。非交互 exec 若未先 `source`，`ros2` 可能不在 PATH；勿据此断言「无 ROS」。见 `rdk-ros` 技能。

## 执行流程

### exec 模式（单次命令执行）
1. **识别命令**：如果用户输入看起来像 shell 命令（以 ls/cat/top/ros2/pip 等开头），提取命令部分。若用户要跑 `ros2 ...`，可建议命令前缀 `bash -lc 'source /opt/tros/humble/setup.bash 2>/dev/null; ros2 ...'`（路径以板上存在为准）。
2. **执行命令**：调用 `POST /api/devices/{deviceId}/exec` 执行单条命令，或 `POST /api/devices/{deviceId}/batch-exec` 批量执行。
3. **返回结果**：展示命令输出。

> exec 模式适用于短时命令，命令执行完毕后连接立即关闭。

### PTY 模式（交互式终端）
1. **创建会话**：调用 `POST /api/devices/{deviceId}/terminal/create` 获取 sessionId。
2. **建立连接**：前端通过 Socket.IO `init` 事件建立 PTY 连接。
3. **交互操作**：用户在终端中实时输入输出。

> PTY 模式适用于长时间运行的命令（top、htop、vim 等），或需要交互式输入的场景。

### 模式选择策略
- **对于 "执行 xxx" / "运行 xxx" 格式**：提取命令部分调用 exec API。
- **长时间运行的命令**：建议用户在终端交互式执行（PTY 模式）。
- **需要交互式输入的命令**：引导用户打开终端（PTY 模式）。

## 工具映射

| API | 用途 | 必需 |
|-----|------|------|
| `POST /api/devices/{deviceId}/terminal/create` | 创建终端会话（PTY 模式） | 否 |
| `POST /api/devices/{deviceId}/exec` | 执行单条命令（exec 模式） | 是 |
| `POST /api/devices/{deviceId}/batch-exec` | 批量执行命令 | 否 |

### API 详细参数

**创建终端会话**
```
POST /api/devices/{deviceId}/terminal/create
Response: { ok: boolean, sessionId: string, device: Device }
```

**执行单条命令**
```
POST /api/devices/{deviceId}/exec
Body: { command: string }
Response: { ok: boolean, output: string, device: Device, command: string }
```

**批量执行命令**
```
POST /api/devices/{deviceId}/batch-exec
Body: { commands: string[] }
Response: { ok: boolean, output: string, device: Device, commandCount: number }
```

### Client Actions
- 打开终端页面: `navigate:terminal`
- 创建新会话: `createTerminal`

## 输出要求
- exec 模式：直接展示命令输出，标注命令和目标设备。
- PTY 模式：告知用户已创建会话并引导到终端页面。
- 批量执行：逐条展示命令及其输出。

## 禁止事项
- **不执行未经用户确认的危险命令**：如 `rm -rf /`、`dd`、`mkfs` 等破坏性操作须二次确认。
- **不在设备离线时执行命令**：先确认设备连接状态。
- **不对长时间运行的命令使用 exec 模式**：exec 模式会阻塞等待完成，长时间任务应引导用户使用 PTY 终端。
