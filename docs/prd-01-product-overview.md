# RDK Studio 产品需求文档 — 产品概述与功能模块

> 版本: 1.1 | 日期: 2026-03-25 | 状态: 迭代中（新增技能创建/编辑、多板卡协作、云端整合规划）

---

## 目录

- [1. 产品定位](#1-产品定位)
- [2. 产品愿景与核心理念](#2-产品愿景与核心理念)
- [3. 目标用户](#3-目标用户)
- [4. 技术架构概览](#4-技术架构概览)
- [5. 产品形态与交互框架](#5-产品形态与交互框架)
- [6. 功能模块详情](#6-功能模块详情)
  - [6.1 工作台 (Dashboard)](#61-工作台-dashboard)
  - [6.2 新手引导 (Onboarding Wizard)](#62-新手引导-onboarding-wizard)
  - [6.3 AI 对话坞 (AI Dock)](#63-ai-对话坞-ai-dock)
  - [6.4 终端 (Terminal)](#64-终端-terminal)
  - [6.5 文件管理 (Files)](#65-文件管理-files)
  - [6.6 远程桌面 (VNC)](#66-远程桌面-vnc)
  - [6.7 在线 IDE](#67-在线-ide)
  - [6.8 OpenClaw 管理](#68-openclaw-管理)
  - [6.9 技能工坊 (Skill Browser)](#69-技能工坊-skill-browser)
  - [6.10 系统烧录 (Flasher)](#610-系统烧录-flasher)
  - [6.11 硬件监控 (Hardware)](#611-硬件监控-hardware)
  - [6.12 ROS 集成](#612-ros-集成)
  - [6.13 设备管理](#613-设备管理)
  - [6.14 设置面板 (Settings)](#614-设置面板-settings)
  - [6.15 多板卡协作 (Fleet Dispatch)](#615-多板卡协作fleet-dispatch)
- [7. 待完成 / 规划中功能](#7-待完成--规划中功能)

---

## 1. 产品定位

RDK Studio 是面向 **D-Robotics（地平线）RDK 系列机器人开发板** 的 **AI Native 全栈工作台**，以 Web 应用 + Electron 桌面客户端双形态交付。

它将传统嵌入式开发中的多项离散工作流——SSH 终端、文件管理、硬件监控、模型部署、系统烧录、ROS 可视化——统一集成到一个带有 AI Agent 的可视化工作台中。用户可以在一个界面内完成从"开箱烧录"到"模型上板推理"的全部流程，并随时通过自然语言与 AI Agent "小地瓜"对话来驱动设备操作。

**一句话定义**：RDK Studio = AI 驱动的机器人开发板一站式工作台。

### 核心差异化

| 维度 | 传统方式 | RDK Studio |
|------|---------|------------|
| 设备连接 | 手动 SSH + 记住 IP 和密码 | 局域网扫描 + 一键连接 + 密码缓存 |
| 命令执行 | 逐条敲 shell 命令 | 自然语言描述意图，Agent 自动编排 |
| 模型部署 | 查文档 → 下载 → scp → 配置 → 运行 | 对话下达 → Agent 自动完成全链路 |
| 设备监控 | 手动 top/htop/sensor 命令 | 仪表盘实时可视化 + 心跳自动巡检 |
| 问题排查 | 查日志、查文档、逐项排除 | Agent 自动诊断 + OpenClaw 板端自愈 |
| 多通道接入 | 仅 SSH | Web + 桌面端 + 飞书 + 微信 |

---

## 2. 产品愿景与核心理念

### 愿景

> "让机器人开发像对话一样简单"

### 核心理念

1. **AI Native**：AI Agent 不是附加功能，而是产品的核心交互方式。用户的每一个操作都可以通过自然语言完成，Agent 负责编排、执行、验证。

2. **双 Agent 协作**：Studio 侧的 RDKClaw（"小地瓜"）负责全局调度与知识整合，板端的 OpenClaw 负责硬件层操作执行。两者互补而非主从。

3. **降低门槛**：通过新手引导向导、AI 辅助、一键操作，让入门用户也能完成从烧录到模型部署的全流程。

4. **生态联通**：一站式集成 NodeHub 应用、ModelZoo 模型、TROS ROS2 包、OpenClaw 技能四大生态，避免开发者在多个平台间切换。

5. **安全可控**：分级审批、权限守卫、安全审计，确保 AI Agent 的每一步操作都在可控范围内，尤其是通过外部通道（飞书/微信）下达的指令。

---

## 3. 目标用户

### 用户画像

| 角色 | 典型场景 | 核心需求 | 使用频率 |
|------|---------|---------|---------|
| **RDK 嵌入式开发者** | 使用 RDK X3/X5/Ultra/S100 开发机器人应用 | 设备管理、远程开发、模型部署、ROS 集成 | 每日 |
| **AI 应用开发者** | 基于 BPU 加速器做 AI 推理应用 | 模型部署、示例运行、推理效果验证、日志分析 | 每日 |
| **机器人爱好者** | 首次接触 RDK 开发板 | 烧录系统、新手引导、AI 辅助操作 | 初期高频，后期降低 |
| **运维人员** | 管理多台 RDK 设备 | 设备健康监控、自治定时任务、批量操作 | 每日 |
| **远程协作者** | 通过 IM 远程操控设备 | 飞书/微信通道控制设备 | 按需 |

### 用户旅程

```
首次使用:
  选板型 → 烧录系统 → 连接设备 → 安装 OpenClaw → 配置 AI 引擎 → 开始使用

日常使用:
  打开工作台 → 确认设备状态 → 通过 AI Dock 下达任务 → 查看执行结果
  或: 飞书/微信发消息 → Agent 执行 → 结果回传 IM
```

---

## 4. 技术架构概览

### 技术栈

| 层级 | 技术选型 |
|------|---------|
| **前端** | React 19 + TypeScript + Vite 6 + 自定义 CSS（双主题） |
| **桌面端** | Electron + electron-builder（Win/Mac/Linux） |
| **后端** | Node.js (ESM) + Express + Socket.IO |
| **Agent 引擎** | 自研 openclaw-mini 框架 + @mariozechner/pi-ai |
| **设备通信** | SSH (ssh2) + WebSocket (VNC 代理) |
| **数据存储** | JSON 文件 + JSONL（会话） + Markdown（记忆） |
| **外部通道** | 飞书开放平台 + 微信 iLink Bot |

### 分层架构

```
┌─────────────────────────────────────────────────────┐
│                    客户端层                           │
│  Web UI (React 19 + Vite 6)  |  Electron 桌面端      │
├─────────────────────────────────────────────────────┤
│                   服务端层 (:8787)                    │
│  REST API  |  Socket.IO (终端/通知)  |  WS VNC 代理   │
├─────────────────────────────────────────────────────┤
│                   Agent 层                           │
│  RDKClaw (编排)  |  openclaw-mini 引擎  |  技能/记忆   │
├─────────────────────────────────────────────────────┤
│                   设备层                              │
│  SSH 通道  |  板端 OpenClaw Agent  |  BPU  |  ROS2   │
├─────────────────────────────────────────────────────┤
│                   外部通道层                          │
│  飞书机器人  |  微信 ClawBot                          │
└─────────────────────────────────────────────────────┘
```

### 数据流概要

- **用户操作** → REST API / Socket.IO → 服务端路由分发
- **AI 对话** → `POST /api/agent/chat` (SSE) → RDKClaw → openclaw-mini Agent Loop → 工具执行 → 流式结果回传
- **设备操作** → SSH (`runRemoteCommands`) / OpenClaw 网关 → 板端执行 → 结果回传
- **外部通道** → 飞书 Webhook/WS 或 微信长轮询 → RDKClaw → 结果回传 IM

---

## 5. 产品形态与交互框架

### 5.1 应用外壳 (AppShell)

**入口文件**: `src/App.tsx`

应用采用 **Tab 状态机** 驱动视图切换（非 URL 路由），核心结构：

```
SSOGate（可选 SSO 认证门）
  └── AppProvider（全局状态嵌套: Toast → Device → UI → Terminal → AIChat）
        └── AppShell
              ├── IconRail（左侧导航栏）
              ├── TopToolbar（顶栏：设备信息 + 工具按钮）
              ├── MainContent（主内容区）
              │     ├── 标准页面（Dashboard/Flasher/Files/Hardware/Ros/Skills）
              │     └── 持久化面板（OpenClaw/Terminal/VNC/IDE，切换时不卸载）
              ├── AIDock（底部 AI 对话坞，常驻）
              ├── Toasts（全局提示）
              ├── AddDeviceModal（添加设备弹窗）
              ├── SettingsPanel（设置侧栏）
              └── ConfirmDialog（确认对话框）
```

### 5.2 导航结构

左侧 IconRail 将功能分为三组：

| 分组 | 标签页 | 说明 |
|------|-------|------|
| **核心** | 工作台、OpenClaw、技能工坊 | 主要工作区域 |
| **连接** | 终端、文件、远程桌面、IDE | 设备远程访问类 |
| **能力** | 硬件监控、烧录工具、ROS | 硬件与系统工具类 |

导航栏可展开/收起，展开时显示文字标签。底部有设备列表、主题切换、设置入口。

### 5.3 主题系统

支持两套视觉主题，通过 `data-theme` 属性切换：
- **Aurora**：偏暖色调
- **Cyber**：偏冷科技风

### 5.4 Electron 桌面端适配

通过 `window.rdkDesktop` API 桥接：
- VNC 和 IDE 使用 Electron `WebContentsView` 而非 iframe（性能更好）
- 视图边界动态同步（`updateViewBounds`）
- Tab 切换时自动隐藏/显示嵌入视图（`setActiveUrl` / `hideUrl`）
- 数据目录通过 `RDK_DATA_DIR` 环境变量注入

---

## 6. 功能模块详情

### 6.1 工作台 (Dashboard)

**实现文件**: `src/components/Dashboard.tsx`

**功能定位**: 用户登录后的首页，提供设备状态总览、快捷操作入口和系统健康概览。

#### 功能清单

| 功能 | 描述 | 数据来源 |
|------|------|---------|
| 设备信息展示 | 当前设备名称、IP、连接状态 | `useDeviceStore` |
| OpenClaw 状态 | 网关在线/离线指示 | `fetchDeviceOpenClawHealth` API |
| RDKClaw 状态 | Agent 运行状态指示 | 前端状态 |
| 资源指标条 | CPU/内存/温度/磁盘使用率 | `fetchDeviceDiagnostics` + `parseMetrics` |
| 快捷按钮 | 一句话开发、设备体检、打开终端等 | 触发 `setActiveTab` 或填充 AI Dock 输入 |
| 工作区健康 | IDE/VNC/ROS 等模块就绪情况 | `fetchDeviceWorkspaceHealth` API |
| 动效背景 | Canvas 流动渐变动画 | 纯前端 `FlowingGradientBg` |
| 新手引导 | 首次使用或手动触发时展示向导 | 内嵌 `OnboardingWizard` 组件 |

#### 交互规格

- 无设备连接时，仪表盘显示占位状态并引导用户添加设备
- 资源指标条自动定时刷新
- 快捷按钮中的"一句话开发"会将预设文案填入 AI Dock 输入框并触发发送
- Dashboard 为 `standardViews` 类型，切换到其他 Tab 时会卸载

---

### 6.2 新手引导 (Onboarding Wizard)

**实现文件**: `src/components/OnboardingWizard.tsx`

**功能定位**: 多步向导，引导新用户从零开始完成完整的环境配置。

#### 向导步骤

| 步骤 | 名称 | 动作 | 跳转 |
|------|------|------|------|
| 1 | 选择板型 | 选择 RDK X3 / X5 / Ultra / S100 | — |
| 2 | 系统烧录 | 引导进行 TF 卡镜像写入 | `setActiveTab('flasher')` |
| 3 | 设备连接 | 配置 SSH 凭据（IP/端口/用户/密码） | 打开 AddDeviceModal |
| 4 | 模型环境 | BPU 模型相关基础检查 | — |
| 5 | OpenClaw 安装 | 板端 Agent 部署 | `setActiveTab('openclaw')` |
| 6 | RDKClaw 配置 | Studio 侧 AI 引擎设置 | 打开 SettingsPanel |

#### 行为规格

- 向导可从工作台进入，也可从 IconRail 底部按钮返回到中断的步骤
- 每步完成可跳转到对应功能页面执行实际操作，完成后返回向导继续
- 通过 `obReturnStep` 状态管理向导恢复位置

---

### 6.3 AI 对话坞 (AI Dock)

**实现文件**: `src/components/AIDock.tsx`, `src/hooks/useAIChatStore.ts`

**功能定位**: 底部常驻的 AI 对话面板，是用户与 Agent "小地瓜"交互的主入口。这是 RDK Studio 最核心的功能。

#### 功能清单

| 功能 | 描述 |
|------|------|
| 自然语言聊天 | **生成**：SSE 流式 token 输出，语境与逻辑由模型与提示词保证。**展示**：正文按拟人节奏揭示（标点略停、缓冲积压时略加速，非固定匀速）；支持流式 Markdown（含未闭合 `**` 加粗等）；目标为实时流出、降低空等感、提升对话体验。 |
| 附件发送 | 支持图片、文件、音频、视频（上限 12MB） |
| Office 文档 | 支持 .docx / .pptx 等格式上传 |
| 语音输入 | 浏览器 SpeechRecognition API |
| Markdown 渲染 | 代码块语法高亮、图片、链接 |
| 展开/折叠 | 对话坞可在底部精简模式与全屏模式间切换 |
| 历史持久化 | 聊天记录保存到 localStorage |

#### 结构化消息块 (ChatBlock)

AI 返回的消息不仅有纯文本，还支持以下富交互块：

| 块类型 | 渲染形态 | 用户交互 |
|--------|---------|---------|
| `code` | 带语言高亮的代码块 | 复制按钮 |
| `terminal` | 终端输出（可折叠，支持预览行数限制） | 展开/折叠 |
| `status` | 状态指标表（label/value/ok 三元组） | 折叠/展开 |
| `confirm` | 确认操作卡片 | 确认/取消按钮 |
| `approval` | 工具审批卡片（含风险等级、执行者） | 批准/拒绝按钮 |
| `progress` | 多步骤进度条（done/running/pending） | 只读查看 |
| `task-result` | 任务执行结果（成功/失败 + 详情） | 只读查看 |
| `recommendation` | 方案推荐选择卡片（多选项 + 推荐标记） | 选择按钮 |
| `soul-update` | 人格更新提议（section/action/content/reason） | 接受/拒绝按钮 |

#### 通信协议

- 主聊天链路: `POST /api/agent/chat`，SSE（Server-Sent Events）流式响应
- OpenClaw 聊天: Socket.IO `openclaw:start` / `openclaw:send` / `openclaw:stop`
- 附件上传: 先 base64 编码，随消息体一并发送（`AgentAttachmentPayload`）

---

### 6.4 终端 (Terminal)

**实现文件**: `src/components/Terminal.tsx`

**功能定位**: 基于 Web 的多会话 SSH 交互式终端。

#### 功能清单

| 功能 | 描述 |
|------|------|
| xterm.js 终端 | 完整的终端模拟器，支持 ANSI 转义、256 色、中文等 |
| Socket.IO PTY | 通过 WebSocket 实时传输终端数据 |
| 多会话 | 支持同时打开多个终端会话 |
| 自适应尺寸 | 窗口 resize 时自动调整终端列数和行数 |
| 设备关联 | 自动使用当前设备的凭据建立 SSH 连接 |

#### 技术细节

- 前端通过 `io(resolveSocketUrl())` 建立 Socket.IO 连接
- 发送 `init` 事件携带 `deviceId` 和密码建立 SSH shell
- 数据传输: `data` 事件双向传输终端输入/输出
- 服务端使用 `ssh2` 的 `client.shell()` 建立交互式 shell（非 `exec`）
- Terminal 为 `persistent-pane`，切换 Tab 时不卸载，保持会话状态

---

### 6.5 文件管理 (Files)

**实现文件**: `src/components/Files.tsx`

**功能定位**: 设备端远程文件浏览、编辑、传输工具。

#### 功能清单

| 功能 | 描述 | API |
|------|------|-----|
| 目录浏览 | 树形/列表视图展示远程目录结构 | `GET /api/devices/:id/files/list` |
| 文件查看/编辑 | 内置 Monaco Editor 在线编辑 | `GET .../files/read` + `POST .../files/write` |
| 文件上传 | 本地文件上传到设备 | `POST .../files/upload` |
| 文件下载 | 从设备下载文件到本地 | `GET .../files/download` |
| 文件搜索 | 按文件名搜索 | 前端过滤 |

#### 前置条件

- 必须已连接设备，否则展示 `DeviceGuard` 组件引导用户添加设备

---

### 6.6 远程桌面 (VNC)

**实现文件**: `src/components/Vnc.tsx`

**功能定位**: 通过 noVNC 协议访问设备的图形桌面。

#### 功能清单

| 功能 | 描述 |
|------|------|
| VNC 服务检测 | 检查设备端 VNC 服务是否启动 |
| WebSocket 代理 | 服务端桥接浏览器 WS 与设备端 TCP VNC |
| 安全校验 | 仅允许私网 IP + 指定端口范围 |
| 桌面端优化 | Electron 环境使用 WebContentsView 而非 iframe |
| 连接日志 | 展示连接状态与错误信息 |

#### 技术细节

- 服务端使用原生 `ws` 的 `WebSocketServer`（非 Socket.IO）
- HTTP upgrade 路径为 `/websockify`
- 代理会验证目标 IP 为私网地址，防止 SSRF

---

### 6.7 在线 IDE

**实现文件**: `src/components/IDE.tsx`

**功能定位**: 在设备上运行 code-server，提供完整的 VS Code 编辑器体验。

#### 功能清单

| 功能 | 描述 |
|------|------|
| code-server 检测 | 检查设备端 9888 端口是否有 code-server 服务 |
| 一键安装 | 提供安装 code-server 的命令引导 |
| iframe 嵌入 | Web 环境下通过 iframe 加载 code-server 页面 |
| WebContentsView | Electron 环境下使用独立视图加载（性能更优） |
| 回退方案 | 无 code-server 时可打开 vscode.dev |

#### 持久化

- IDE 为 `persistent-pane`，切换 Tab 时不卸载，避免重新加载

---

### 6.8 OpenClaw 管理

**实现文件**: `src/components/OpenClaw.tsx`

**功能定位**: 板端 OpenClaw Agent 的完整生命周期管理界面。

#### 功能清单

| 功能 | 描述 |
|------|------|
| 网关状态 | 显示 OpenClaw Gateway 运行状态（在线/离线/异常） |
| 模型网关配置 | LLM 模型选择与配置 |
| 飞书集成 | 飞书机器人应用绑定与配置 |
| 技能管理 | 已安装技能列表、健康检查、启用/禁用 |
| 安装/升级 | 流式安装 OpenClaw 到板端，带进度展示 |
| 卸载 | 从板端移除 OpenClaw |
| 重启网关 | 重启 OpenClaw Gateway 服务 |
| 诊断修复 | 一键执行 `doctor` 命令自动修复常见问题 |
| 日志查看 | 查看 OpenClaw 运行日志 |
| 交互式聊天 | 通过 Socket.IO 与板端 OpenClaw 直接对话 |

#### 子标签页结构

```
OpenClaw 管理
├── 模型网关 (model)    — LLM 模型配置
├── 飞书集成 (feishu)   — 飞书应用绑定
└── 技能管理 (skills)   — 已安装技能列表
```

#### 持久化

- OpenClaw 为 `persistent-pane`，切换 Tab 时不卸载，保持 Socket 连接

---

### 6.9 技能工坊 (Skill Browser)

**实现文件**: `src/components/SkillBrowser.tsx`

**功能定位**: OpenClaw 技能的浏览、创建、编辑、部署工具。三标签页设计。

#### 功能清单

| 功能 | 描述 |
|------|------|
| 查看/编辑 | 查看板端已安装技能的 SKILL.md 内容，可直接编辑并保存回板端 |
| 创建技能 | 提供 SKILL.md 模板编辑器，填写技能名和内容后一键部署到板端 |
| 链接转技能 | AI 辅助：输入 GitHub/NodeHub/网页 URL，AI 分析并生成技能定义 |
| 部署确认 | 所有写入板端操作均需用户确认（弹窗显示技能名和路径） |
| 板端技能列表 | 左侧栏展示设备已安装技能，解析 pipe-delimited 格式显示清晰名称 |
| OpenClaw 状态 | 显示网关运行状态 |

#### 后端 API

| API | 方法 | 描述 |
|-----|------|------|
| `/api/devices/:id/openclaw/skills` | GET | 获取板端已安装技能列表 |
| `/api/devices/:id/openclaw/skill-content` | GET | 读取指定技能的 SKILL.md 内容 |
| `/api/devices/:id/openclaw/skill-write` | POST | 将 SKILL.md 内容写入板端（参数: skillId, content） |

---

### 6.10 系统烧录 (Flasher)

**实现文件**: `src/components/Flasher.tsx`

**功能定位**: TF 卡系统镜像烧录工具。

#### 功能清单

| 功能 | 描述 |
|------|------|
| 镜像选择 | 选择目标系统镜像 |
| 镜像验证 | 校验镜像完整性 |
| 烧录执行 | 写入镜像到 TF 卡 |
| 进度追踪 | 实时显示烧录进度 |
| 完成引导 | 烧录完成后引导用户进入下一步（终端/硬件/技能） |
| 备份功能 | 备份现有系统 |

#### 关键 API

- `POST /api/devices/:id/flash/execute` — 执行烧录
- `GET /api/devices/:id/flash/backup/*` — 备份相关

---

### 6.11 硬件监控 (Hardware)

**实现文件**: `src/components/Hardware.tsx`

**功能定位**: 设备硬件状态实时监控仪表盘。

#### 监控指标

| 指标 | 来源 | 可视化 |
|------|------|--------|
| CPU 温度 | `DIAGNOSTIC_COMMANDS` | 环形仪表盘 |
| BPU 温度 | 同上 | 环形仪表盘 |
| 内存使用率 | 同上 | 环形仪表盘 |
| 磁盘使用率 | 同上 | 环形仪表盘 |
| 系统负载 | 同上 | 数值展示 |

#### 行为规格

- 自动定时刷新（周期可配置）
- 数据通过 `fetchDeviceDiagnostics` API 获取，由 `parseMetrics` 解析为结构化指标
- 无设备连接时展示 `DeviceGuard`

---

### 6.12 ROS 集成

**实现文件**: `src/components/Ros.tsx`

**功能定位**: ROS2/TROS 工具集成，为机器人开发者提供可视化 ROS 工具。

#### 功能清单

| 功能 | 描述 | API |
|------|------|-----|
| rosbridge 检测 | 检测设备端 rosbridge 服务状态 | `GET /api/devices/:id/ros/status` |
| rosbridge 启动 | 远程启动 rosbridge_server | `POST .../ros/start` |
| 话题列表 | 列出当前 ROS2 话题 | `GET .../ros/topics` |
| 节点列表 | 列出当前 ROS2 节点 | `GET .../ros/nodes` |
| Webviz 可视化 | iframe 嵌入 Webviz 工具 | 前端 iframe |
| 话题录制 | 录制指定话题的数据 | `POST .../ros/record/*` |

#### 前置条件

- 设备需已安装 ROS2 基础包
- rosbridge_server 需启动后才能使用 Webviz

---

### 6.13 设备管理

**实现文件**: `src/components/AddDeviceModal.tsx`, `src/components/IconRail.tsx`, `src/hooks/useDeviceStore.ts`

**功能定位**: SSH 设备的添加、连接、管理功能。

#### 功能清单

| 功能 | 描述 |
|------|------|
| 手动添加 | 输入 IP、端口（默认 22）、用户名、密码 |
| 局域网扫描 | 自动扫描局域网内的 RDK 设备 |
| USB 串口 | 检测串口连接并提供提示 |
| 连接验证 | 实际 SSH 登录验证凭据是否正确 |
| 设备列表 | IconRail 底部弹层管理多设备切换 |
| 删除设备 | 从列表中移除设备 |
| 密码缓存 | 密码存入 sessionStorage，API 请求通过 `x-device-password` 头传递 |
| 持久化 | 设备信息写入 `data/devices.json`（密码脱敏展示） |

#### 密码解析优先级

服务端按以下顺序尝试密码：
1. 请求体中的密码
2. `devicePasswordCache` 内存缓存
3. `device.password` 存储的密码
4. `RDK_SSH_PASSWORD` 环境变量
5. 用户名相关候选密码（如 `sunrise/sunrise`）

---

### 6.14 设置面板 (Settings)

**实现文件**: `src/components/SettingsPanel.tsx`

**功能定位**: 全局配置中心，覆盖 AI 引擎、Agent 行为、外部通道、安全等所有配置项。

#### 配置分区

| 分区 | 配置内容 | 后端 API |
|------|---------|---------|
| **AI 引擎** | 多厂商 LLM 预设（OpenAI / Claude / DeepSeek / 通义千问 / 本地等），baseUrl / apiKey / model | `GET\|POST /api/agent/config` |
| **RDKClaw 人格** | "小地瓜"名称、性格、说话风格、行为规则 | `GET\|POST /api/rdkclaw/persona` |
| **策略配置** | 审批模式（auto/manual）、权限开关、记忆开关、联网开关、上下文窗口参数 | `GET\|POST /api/rdkclaw/policy` |
| **飞书集成** | 应用密钥、Webhook/WebSocket 模式、DM 策略、配对码 | `GET\|POST /api/rdkclaw/feishu/config` |
| **微信集成** | 账号列表、扫码绑定、消息同步配置 | `GET\|POST /api/rdkclaw/weixin/config` |
| **设备连接** | 默认连接参数配置 | 前端本地 |
| **论坛凭证** | D-Robotics 论坛用户名/密码/Cookie | `GET\|POST /api/rdkclaw/forum/auth` |
| **安全审计** | 审计日志列表查看、清理 | `GET /api/rdkclaw/security-audit` |

---

### 6.15 多板卡协作（Fleet Dispatch）

**实现文件**: `server/rdkclaw/tools/fleet-dispatch.ts`

**功能定位**: AI Agent 工具层实现的多板卡调度与协作能力。

#### 功能清单

| 工具 | 描述 |
|------|------|
| `fleet_board_list` | 列出所有板卡，含硬件画像（型号/BPU/内存/CPU）、去重检测、当前任务状态 |
| `fleet_board_delegate` | 向指定板卡的 OpenClaw 委派任务，支持角色分配（executor/reviewer/advisor） |
| `fleet_board_broadcast` | 向多个板卡并行广播任务并汇总结果，自动 IP 去重 |

#### 协调机制

- **IP 去重检测**：自动识别同 IP 的重复注册，警告并在广播时自动去重
- **冲突拦截**：委派前检查目标板卡是否忙碌，同 IP 设备已有任务时拒绝并发
- **任务追踪**：全局 `fleetTaskLog` 记录所有跨板任务状态
- **硬件感知调度**：根据 BPU 算力、内存大小等硬件画像智能分配任务
- **模型兼容提示**：不同板型（X3 Bernoulli2 / X5 Bayes / S100 Nash）模型不通用

---

## 7. 待完成 / 规划中功能

代码审查发现以下组件已实现但未接入主界面（`App.tsx` 的 `MainContent` 中未渲染）：

| 组件 | 文件 | 状态 | 说明 |
|------|------|------|------|
| **Models 页面** | `src/components/Models.tsx` | 类型已定义 (`models` tab) | ModelZoo 模型卡片，支持部署/运行/卸载。`Tab` 联合类型中有 `models`，但 `App.tsx` 的 `standardViews` 和 `persistent-pane` 中均未包含 |
| **Examples 页面** | `src/components/Examples.tsx` | 类型已定义 (`examples` tab) | NodeHub 示例应用列表，支持安装/运行/卸载。同样有 import 但未在视图中渲染 |
| **Sidebar 组件** | `src/components/Sidebar.tsx` | 无引用 | 另一套侧栏导航实现，仓库内无其它文件 import，疑似遗留代码或早期实验 |
| **Low-code 页面** | Tab 类型含 `lowcode` | 无对应组件 | `Tab` 类型中定义了 `lowcode`（Node-RED），但无对应前端组件实现 |
| **云端技能仓库** | 无 | 规划中 | 远程技能同步与热更新，详见 [prd-05-cloud-integration.md](prd-05-cloud-integration.md) |
| **课程技能包** | 无 | 规划中 | 教学场景的技能化沉淀，详见 [prd-05-cloud-integration.md](prd-05-cloud-integration.md) |

---

*本文档为 PRD 系列第 1 部分，详见：*
- *[prd-02-agent-system.md](prd-02-agent-system.md) — Agent 系统深度解析*
- *[prd-03-integration-operations.md](prd-03-integration-operations.md) — 集成、安全与运维*
- *[prd-04-api-reference.md](prd-04-api-reference.md) — API 端点与数据模型*
