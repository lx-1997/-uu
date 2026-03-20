---
name: rdk-settings
description: "系统设置与页面导航。Use when user wants to open settings, change preferences, navigate to page, 设置, 偏好, 配置, 打开, 跳转."
version: 1.0.0
metadata: {"rdkstudio":{"category":"system","icon":"settings"}}
---

# 设置与导航

## When to Use
- 用户说：设置、偏好、配置、settings
- 用户说：打开xxx、跳转到xxx、去xxx页面
- 用户想切换语言、主题等

## Client Actions
- 打开设置面板: `openSettings`
- 导航到页面: `navigate:{tab}`

## Available Tabs
- `dashboard` — 主工作台
- `flasher` — 镜像烧录
- `terminal` — SSH 终端
- `files` — 文件管理
- `vnc` — 远程桌面
- `ide` — 代码编辑
- `lowcode` — 流程编排
- `openclaw` — OpenClaw
- `hardware` — 硬件监控
- `examples` — 示例应用
- `ros` — ROS2
- `models` — 模型仓库

## Navigation Patterns
- "打开终端" → `navigate:terminal`
- "去硬件页面" → `navigate:hardware`
- "进入文件管理" → `navigate:files`
- "打开设置" → `openSettings`
