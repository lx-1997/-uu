---
name: RDK Workflow
description: Node-RED 低代码流程编排管理——启动、停止、状态检查、流程验证。触发词：流程编排、Node-RED、工作流、lowcode、workflow、自动化。
version: 1.0.0
trigger: 流程编排,Node-RED,工作流,lowcode,workflow,自动化
risk: low
permissions: workspace_read,device_exec,network
delegate_preference: local
requires_board: true
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Procedure
disableModelInvocation: true
---

# RDK Workflow

## 适用场景
- 用户说：流程编排、Node-RED、工作流、lowcode。
- 用户想创建或管理自动化流程。
- 需要检查 Node-RED 服务状态或执行流程验证。

## 执行流程
1. **检查状态**：调用 `GET /api/devices/{deviceId}/services/node-red`，确认 Node-RED 是否活跃。
2. **启动服务**：若未活跃，调用 `POST /api/devices/{deviceId}/services/node-red/start`。
3. **导航到编排页面**：发出 `navigate:lowcode` 客户端动作，打开 Node-RED 界面。
4. **流程验证**（可选）：发出 `runFlowValidation` 客户端动作，检查 Node-RED、ROS bridge、OpenClaw 的运行状态。
5. **停止服务**（用户要求时）：调用 `POST /api/devices/{deviceId}/services/node-red/stop`。

> **默认端口**：Node-RED 运行在设备的 1880 端口。流程验证会联动检查 Node-RED、ROS bridge、OpenClaw 三者状态。

## 工具映射

| 工具 / API | 用途 | 必需 |
|------------|------|------|
| `GET /api/devices/{deviceId}/services/node-red` | 检查 Node-RED 服务状态 | 是 |
| `POST /api/devices/{deviceId}/services/node-red/start` | 启动 Node-RED | 否 |
| `POST /api/devices/{deviceId}/services/node-red/stop` | 停止 Node-RED | 否 |
| `navigate:lowcode` | 打开编排页面 | 否 |
| `runFlowValidation` | 执行流程验证（多服务联动检查） | 否 |

## 输出要求
- 启动前先告知当前状态（已运行 / 未运行）。
- 启动成功后告知访问地址（设备 IP:1880）。
- 流程验证结果需分项列出各服务状态（Node-RED / ROS bridge / OpenClaw）。

## 禁止事项
- **不跳过状态检查直接启动**：避免重复启动，先确认当前状态。
- **不忽略流程验证中的部分失败**：任何子服务异常都需单独标注。
- **不在服务操作失败时静默**：任何 API 返回失败时必须告知用户并建议排查。
