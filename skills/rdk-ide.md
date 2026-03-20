---
name: rdk-ide
description: "代码编辑器：嵌入code-server在线IDE。Use when user wants to edit code, open editor, code-server, 代码编辑, 写代码, IDE."
version: 1.0.0
metadata: {"rdkstudio":{"category":"development","icon":"code","requires":{"device":true},"tab":"ide"}}
---

# 代码编辑器

## When to Use
- 用户说：写代码、编辑代码、打开编辑器、IDE、code-server
- 用户想在设备上开发程序

## APIs

### 执行安装 code-server
```
POST /api/devices/{deviceId}/exec
Body: { command: "curl -fsSL https://code-server.dev/install.sh | sh" }
Response: { ok: boolean, output: string }
```

### 启动 code-server
```
POST /api/devices/{deviceId}/exec
Body: { command: "code-server --bind-addr 0.0.0.0:8080 --auth none &" }
Response: { ok: boolean, output: string }
```

### 检查 code-server 状态
```
POST /api/devices/{deviceId}/exec
Body: { command: "pgrep -af code-server || echo NOT_RUNNING" }
Response: { ok: boolean, output: string }
```

## Client Actions
- 打开 IDE 页面: `navigate:ide`

## Notes
- code-server 默认运行在设备的 8080 端口
- 通过 iframe 嵌入到 RDK Studio 界面
- 首次使用需要先安装 code-server
