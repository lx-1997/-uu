---
name: RDK VNC & 实时画面
description: VNC 远程桌面和摄像头实时画面管理。支持 VNC 桌面查看、YOLO/检测/分割等 AI 推理的 Web 可视化画面、摄像头实时流。
version: 1.1.0
trigger: 远程桌面,VNC,看屏幕,看画面,桌面,remote desktop,screen,摄像头,camera,实时画面,实时视频,推理画面,检测画面,yolo画面,web可视化,8000端口,websocket推流
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

# RDK VNC & 实时画面

## 适用场景
- 用户说：远程桌面、VNC、看屏幕、看画面、桌面。
- 用户需要查看设备图形界面输出（如 YOLO 检测窗口等可视化程序）。
- 用户想看摄像头实时画面、AI 推理结果可视化。
- 需要启动、停止或检查 VNC 服务状态。

## 两种实时画面方式

### 方式一：VNC 远程桌面（通用）
适用于查看设备桌面上的任何图形界面程序。

1. **检查状态**：调用 `GET /api/devices/{deviceId}/services/vnc`
2. **启动服务**：若未活跃，调用 `POST /api/devices/{deviceId}/services/vnc/start`
3. **导航到远程桌面页面**：发出 `[[action:openVnc]]` 或 `[[action:navigate:vnc]]`
4. **停止服务**（用户要求时）：调用 `POST /api/devices/{deviceId}/services/vnc/stop`

> **连接参数**：WebSocket 代理路径 `/websockify?target=ip:5900`，默认密码 `88888888`。

### 方式二：Web 可视化推流（AI 推理专用）
适用于 TROS 的 AI 推理节点（YOLO 检测、分割、跟踪等），通过 WebSocket 推流到浏览器。

1. **启动推理+推流**：
```bash
source /opt/tros/humble/setup.bash
# YOLO 检测 + Web 可视化
ros2 launch dnn_node_example dnn_node_example.launch.py
# 或使用 hobot_websocket 推流
ros2 launch hobot_websocket hobot_websocket.launch.py
```

2. **告知用户访问地址**：
   - 浏览器打开 `http://<设备IP>:8000` 查看实时画面
   - 如果在 RDK Studio 中，可以通过 VNC 桌面查看

3. **检查推流状态**：
```bash
# 检查 8000 端口是否在监听
ss -tlnp | grep :8000
# 检查 ROS2 节点是否运行
ros2 node list
```

## 摄像头快速检测
```bash
# 列出摄像头设备
ls /dev/video*
v4l2-ctl --list-devices
# 检查 MIPI 摄像头
cat /sys/class/video4linux/video*/name
```

## 工具映射

| 工具 / API | 用途 | 必需 |
|------------|------|------|
| `GET /api/devices/{deviceId}/services/vnc` | 检查 VNC 服务状态 | 是 |
| `POST /api/devices/{deviceId}/services/vnc/start` | 启动 VNC 服务 | 否 |
| `POST /api/devices/{deviceId}/services/vnc/stop` | 停止 VNC 服务 | 否 |
| `navigate:vnc` | 打开远程桌面页面 | 否 |
| `openVnc` | 触发 VNC 连接 | 否 |
| `device_exec` | 启动推理/推流/检查摄像头 | 否 |

## 输出要求
- 启动前先告知当前状态（已运行 / 未运行）。
- 启动成功后告知连接方式和默认密码。
- AI 推理画面：告知用户浏览器访问 `http://<设备IP>:8000`。
- 画面空白时主动提示可能原因（设备未启动桌面环境/摄像头未连接）。

## 禁止事项
- **不跳过状态检查直接启动**：避免重复启动，先确认当前状态。
- **不忽略画面空白问题**：若用户反馈空白，需引导检查桌面环境或摄像头。
- **不在服务操作失败时静默**：任何 API 返回失败时必须告知用户。
