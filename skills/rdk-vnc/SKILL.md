---
name: RDK VNC
description: VNC 远程桌面管理——启动、停止、状态检查。触发词：远程桌面、VNC、看屏幕、看画面、桌面、remote desktop、screen。
version: 1.0.0
trigger: 远程桌面,VNC,看屏幕,看画面,桌面,remote desktop,screen
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

# RDK VNC

## 适用场景
- 用户说：远程桌面、VNC、看屏幕、看画面、桌面。
- 用户需要查看设备图形界面输出（如 YOLO 检测窗口等可视化程序）。
- 需要启动、停止或检查 VNC 服务状态。

## 执行流程
1. **检查状态**：调用 `GET /api/devices/{deviceId}/services/vnc`，确认 VNC 服务是否活跃。
2. **启动服务**：若未活跃，调用 `POST /api/devices/{deviceId}/services/vnc/start`，在设备上启动 x11vnc 或 vncserver。
3. **导航到远程桌面页面**：发出 `navigate:vnc` 客户端动作，通过 WebSocket 代理连接。
4. **停止服务**（用户要求时）：调用 `POST /api/devices/{deviceId}/services/vnc/stop`。

> **连接参数**：WebSocket 代理路径 `/websockify?target=ip:5900`，默认密码 `88888888`。

## 工具映射

| 工具 / API | 用途 | 必需 |
|------------|------|------|
| `GET /api/devices/{deviceId}/services/vnc` | 检查 VNC 服务状态 | 是 |
| `POST /api/devices/{deviceId}/services/vnc/start` | 启动 VNC 服务 | 否 |
| `POST /api/devices/{deviceId}/services/vnc/stop` | 停止 VNC 服务 | 否 |
| `navigate:vnc` | 打开远程桌面页面 | 否 |
| `openVnc` | 触发 VNC 连接 | 否 |

## 输出要求
- 启动前先告知当前状态（已运行 / 未运行）。
- 启动成功后告知连接方式和默认密码。
- 画面空白时主动提示可能原因（设备未启动桌面环境）。

## 禁止事项
- **不跳过状态检查直接启动**：避免重复启动，先确认当前状态。
- **不忽略画面空白问题**：若用户反馈空白，需引导检查桌面环境是否启动。
- **不在服务操作失败时静默**：任何 API 返回失败时必须告知用户。
