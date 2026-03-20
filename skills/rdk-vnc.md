---
name: rdk-vnc
description: "VNC远程桌面连接。Use when user wants to see screen, remote desktop, vnc, 远程桌面, 屏幕, 画面, 桌面."
version: 1.0.0
metadata: {"rdkstudio":{"category":"remote","icon":"monitor","requires":{"device":true},"tab":"vnc"}}
---

# VNC 远程桌面

## When to Use
- 用户说：远程桌面、VNC、看屏幕、看画面、桌面
- 用户需要查看设备图形界面输出
- 用户在运行带可视化的程序（如 YOLO 检测窗口）

## APIs

### 检查 VNC 服务状态
```
GET /api/devices/{deviceId}/services/vnc
Response: { ok: boolean, active: boolean, output: string }
```

### 启动 VNC 服务
```
POST /api/devices/{deviceId}/services/vnc/start
Response: { ok: boolean, output: string }
```
在设备上启动 x11vnc 或 vncserver。

### 停止 VNC 服务
```
POST /api/devices/{deviceId}/services/vnc/stop
Response: { ok: boolean, output: string }
```

## Client Actions
- 打开远程桌面页面: `navigate:vnc`
- 连接 VNC: `openVnc`

## Notes
- VNC 通过 WebSocket 代理连接（/websockify?target=ip:5900）
- 默认密码为 88888888
- 如果画面空白，可能是设备未启动桌面环境
