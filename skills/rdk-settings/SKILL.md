---
name: RDK Settings
description: 系统设置与 UI 页面导航路由表。触发词：设置、偏好、配置、打开、跳转、导航、settings、navigate、open page。
version: 1.0.0
trigger: 设置,偏好,配置,打开,跳转,导航,settings,navigate,open page
risk: low
permissions: workspace_read
delegate_preference: local
requires_board: true
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Knowledge
disableModelInvocation: true
---

# RDK Settings

## 适用场景
- 用户说：设置、偏好、配置、settings。
- 用户说：打开 xxx、跳转到 xxx、去 xxx 页面。
- 用户想切换语言、主题等系统偏好。
- 需要导航到特定功能页面。

## 执行流程
1. **识别意图**：判断用户是要打开设置面板还是导航到特定页面。
2. **匹配路由**：根据用户描述匹配下方路由表中的 tab 名称。
3. **发出导航动作**：调用 `navigate:{tab}` 或 `openSettings` 客户端动作。

> **路由表**
>
> | Tab 名称 | 页面 | 导航动作 |
> |----------|------|----------|
> | `dashboard` | 主工作台 | `navigate:dashboard` |
> | `flasher` | 镜像烧录 | `navigate:flasher` |
> | `terminal` | SSH 终端 | `navigate:terminal` |
> | `files` | 文件管理 | `navigate:files` |
> | `vnc` | 远程桌面 | `navigate:vnc` |
> | `ide` | 代码编辑 | `navigate:ide` |
> | `lowcode` | 流程编排 | `navigate:lowcode` |
> | `openclaw` | OpenClaw | `navigate:openclaw` |
> | `hardware` | 硬件监控 | `navigate:hardware` |
> | `examples` | 示例应用 | `navigate:examples` |
> | `ros` | ROS2 | `navigate:ros` |
> | `models` | 模型仓库 | `navigate:models` |

> **常见导航模式**
> - "打开终端" → `navigate:terminal`
> - "去硬件页面" → `navigate:hardware`
> - "进入文件管理" → `navigate:files`
> - "打开设置" → `openSettings`

## 工具映射

| 工具 / 动作 | 用途 | 必需 |
|-------------|------|------|
| `navigate:{tab}` | 导航到指定页面 | 是 |
| `openSettings` | 打开设置面板 | 否 |

## 输出要求
- 导航后告知用户已跳转到目标页面。
- 若用户描述模糊无法匹配路由，列出可用页面供选择。
- 设置变更后确认变更结果。

## 禁止事项
- **不猜测不存在的路由**：只使用路由表中已定义的 tab 名称。
- **不在导航失败时静默**：客户端动作未生效时需告知用户。
- **不跳过意图确认直接导航**：用户描述模糊时先确认目标页面。
