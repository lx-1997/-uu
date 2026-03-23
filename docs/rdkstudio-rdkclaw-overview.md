# RDK Studio 产品状态、技术架构与未来规划

## 一、产品定位与当前状态

### 1.1 RDK Studio 是什么

RDK Studio 是 D-Robotics（地瓜机器人）推出的面向 RDK 系列机器人开发板（RDK X3 / X5 / Ultra）的 **AI Native 一体化工作台**。它把设备接入、远程调试、能力验证、AI 对话协作、板端 AI 部署统一到一个 Web/Electron 入口，目标是让机器人开发者从"设备开箱到智能能力落地"在一个界面内完成。

与 D-Robotics 官网提供的桌面版 RDK Studio（侧重板卡管理、镜像烧写、示例运行）不同，本项目进一步集成了 AI Agent 编排能力（RDKCLAW）和板端智能体运行时（OpenClaw），形成了"工具台 + AI 中枢 + 板端执行体"的三层架构。

### 1.2 硬件基座：RDK X5

RDK X5 是当前主要适配的硬件平台，核心规格如下：

| 项目 | 参数 |
|---|---|
| AI 算力 | 10 TOPS（BPU 贝叶斯架构） |
| CPU | 8 核 ARM Cortex-A55 @ 1.5GHz |
| 内存 | 4GB / 8GB LPDDR4 |
| 连接 | Wi-Fi 6、蓝牙 5.4、千兆以太网（PoE）、4×USB 3.0、CAN FD |
| 摄像头 | 2 路 MIPI Camera |
| OS | Ubuntu 22.04，原生 ROS 2 支持 |
| 算法生态 | 200+ 开源算法方案，支持 YOLO / SLAM / 物体追踪 等 |

### 1.3 当前产品交付状态

| 能力维度 | 状态 | 说明 |
|---|---|---|
| 设备连接与管理 | 可用 | 真实 SSH 校验，设备持久化，密码会话级保护 |
| 远程终端 | 可用 | Web Terminal（xterm），实时交互 |
| 远程桌面 | 可用 | noVNC 集成，浏览器内实时画面 |
| 文件管理 | 可用 | 设备端文件浏览、读写、上传下载 |
| ROS 2 话题/节点查看 | 可用 | 在线查看并管理 ROS 2 系统 |
| AI 对话（RDKCLAW） | 可用 | 流式 SSE 事件、工具调用、审批、多模态附件 |
| OpenClaw 板端部署 | 可用 | 安装/升级/卸载/配置/健康/日志 全生命周期 |
| 板端委派执行 | 可用 | RDKCLAW 可将任务委派给板端 OpenClaw 执行 |
| 飞书渠道接入 | 可用 | 飞书消息与 Studio 共享会话上下文 |
| 自治任务调度 | 可用 | 定时/Cron 任务自动进入 RDKCLAW 编排 |
| 生态技能注册与下发 | 基础可用 | 种子技能已注册，板端技能安装链路已通 |
| 桌面客户端 | 可用 | Electron 打包，支持 Windows / macOS / Linux |

---

## 二、核心技术架构

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                     用户侧（Web / Electron）                       │
│  React 19 · TypeScript · Vite 6 · Monaco · xterm · noVNC        │
│  状态管理: Context Store 组合（非 Redux）                          │
│  通信: HTTP API · SSE（Agent 事件流）· Socket.IO（通知/终端）      │
└─────────────────────────────┬────────────────────────────────────┘
                              │
                   ┌──────────▼──────────┐
                   │  Express 统一 API 层  │
                   │  port 8787 (默认)     │
                   └──┬──────┬──────┬─────┘
                      │      │      │
         ┌────────────▼┐  ┌──▼────┐ ┌▼──────────────┐
         │  RDKCLAW     │  │ 设备  │ │ Ecosystem     │
         │  编排核心     │  │ 路由  │ │ 生态注册表     │
         │  (app.ts)    │  │ SSH   │ │ 技能发现与下发  │
         └───┬──────┬───┘  └──────┘ └───────────────┘
             │      │
    ┌────────▼┐  ┌──▼──────────────┐
    │ 本地工具 │  │ 板端 OpenClaw    │
    │ 执行     │  │ 委派执行         │
    │(Studio/  │  │(assess/delegate)│
    │ Attach/  │  │       │         │
    │ Web/     │  │  ┌────▼─────┐   │
    │ Forum)   │  │  │板端 Agent │   │
    └─────────┘  │  │ Gateway   │   │
                  │  │ :18789    │   │
                  │  └──────────┘   │
                  └─────────────────┘
```

### 2.2 技术栈总览

| 层面 | 技术选型 |
|---|---|
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite 6（`base: './'` 适配 Electron file:// 协议） |
| 桌面客户端 | Electron 35 + electron-builder |
| 后端 | Express + Socket.IO + ws |
| 设备交互 | ssh2（SSH 连接池） |
| AI Agent 基础 | `@mariozechner/pi-ai`（Mini Agent 框架） |
| AI 中枢 | RDKCLAW（自研编排层） |
| 板端运行时 | OpenClaw（开源 AI Agent Gateway） |
| 代码编辑器 | Monaco Editor |
| 终端 | xterm.js |
| 远程桌面 | noVNC |
| 消息渠道 | 飞书 SDK（`@larksuiteoapi/node-sdk`） |
| 图标 | Lucide React + Material Symbols |
| 样式 | 纯 CSS 分层体系（tokens / shell / pages） |

### 2.3 核心数据流

**AI 对话主链路：**

```
用户输入
  → POST /api/agent/chat（SSE 长连接）
    → RDKClawApp.streamChat()
      → 附件预处理 & 音频转写
      → 委派策略计算（selectDelegateDecision）
      → 动态工具装配（设备/附件/网络/论坛/板端）
      → 所有工具包裹审批逻辑（wrapToolWithApproval）
      → Agent 多轮执行 + 事件映射（mapMiniEvent）
    → SSE 事件流回传
  → 前端 useAIChatStore 实时渲染
    → meta/text/tool_start/tool_progress/tool_result/approval
```

---

## 三、RDKCLAW 详解——Studio 侧 AI 编排中枢

### 3.1 RDKCLAW 是什么

RDKCLAW（RDK Studio Claw）是 RDK Studio 的 **AI 任务编排内核**。它不是简单的"聊天接口"，而是一个完整的编排层，负责：

- **意图理解与策略决策**：根据用户输入、技能匹配、策略配置，决定任务应该在 Studio 侧本地执行还是委派给板端 OpenClaw。
- **工具动态装配**：按请求上下文组装工具集（不是固定清单）。
- **风险治理与审批**：对高风险操作自动触发人工确认流程。
- **事件回传与可观测性**：执行全程产生结构化事件流，前端实时可视化。
- **跨渠道协同**：Studio 与飞书共享同一编排能力。
- **自治任务调度**：通过 AutonomyScheduler 支持定时/Cron 触发的无人值守任务。

### 3.2 RDKCLAW 核心组件

| 组件 | 文件 | 职责 |
|---|---|---|
| 编排主体 | `server/rdkclaw/app.ts` | `RDKClawApp`：`streamChat` 入口、工具装配、策略决策、审批包装 |
| 类型定义 | `server/rdkclaw/types.ts` | 执行模式、事件类型、策略类型、人格类型、技能元数据 |
| 策略存储 | `server/rdkclaw/policy-store.ts` | `RDKClawPolicy` 持久化（审批/委派/网络/记忆/调度） |
| 人格存储 | `server/rdkclaw/persona-store.ts` | Agent 人格与用户画像持久化 |
| 技能注册表 | `server/rdkclaw/skills/registry.ts` | 扫描工作区 `SKILL.md` 文件，按触发词匹配技能 |
| 自治调度 | `server/rdkclaw/autonomy-scheduler.ts` | 定时/Cron 任务调度，自动进入 `streamChat` |
| 通知中枢 | `server/rdkclaw/notification-hub.ts` | Socket.IO 推送 `rdkclaw:notify` 事件 |
| 板端评估 | `server/rdkclaw/tools/board-openclaw-assess.ts` | 委派前评估板端可执行性 |
| 板端委派 | `server/rdkclaw/tools/board-openclaw-delegate.ts` | 将任务下发到板端 OpenClaw 网关 |
| 飞书适配 | `server/rdkclaw/feishu-channel-adapter.ts` | 飞书消息入站适配与会话管理 |
| 飞书 API | `server/rdkclaw/feishu-api-client.ts` | 飞书 API 交互 |
| 飞书配置 | `server/rdkclaw/feishu-config-store.ts` | 飞书连接配置持久化 |
| 飞书认证 | `server/rdkclaw/feishu-auth-store.ts` | 飞书用户绑定与配对 |

### 3.3 RDKCLAW 的 Agent 基础

RDKCLAW 底层基于一个名为 **Mini Agent** 的极简框架，该框架的分层设计如下：

- **核心层（任何 Agent 必备）**：Agent Loop（双层循环 + EventStream）、Session（JSONL 会话持久化）、Context（上下文加载/裁剪/摘要压缩）、Tools（工具抽象 + 内置工具）、Provider（多模型适配）
- **扩展层（OpenClaw 特有）**：Memory（长期记忆/关键词检索）、Skills（SKILL.md 触发词匹配）、Heartbeat（主动唤醒/定时驱动）
- **工程层（生产级防护）**：Tool Policy 三级控制、Command Queue 并发控制、Sandbox 路径隔离、Context Window 与 Tool Result 守卫

### 3.4 委派策略机制

RDKCLAW 的核心治理能力之一是 **委派策略**（Delegation Decision），由 `selectDelegateDecision()` 实现：

**输入信号（按优先级）：**
1. 用户显式指定 mode（`board` / `local` / `board-preferred`）
2. 文本规则匹配（如"板端""部署""OpenClaw"等关键词）
3. 技能策略匹配（`requiresBoard` 标记）
4. 策略面板配置（`board-first` / `local-first` / `hybrid`）
5. 人格配置（delegationBias / boardDelegationBias）

**输出结果：**
- `forceBoard`：是否强制板端执行
- `preferBoard`：是否优先板端
- `source`：决策来源（便于审计）
- `confidence`：置信度（便于前端展示）

当 `preferBoard` 为 `true` 时，设备工具集会被过滤为只读子集（`filterRdkToolsForBoardPreferred`），把写操作交给板端 OpenClaw。

### 3.5 工具体系

RDKCLAW 在每次请求时动态装配工具集，分为五大类：

| 类别 | 示例工具 | 来源文件 |
|---|---|---|
| Studio 任务工具 | `rdkclaw_task_create`、`rdkclaw_memory_append_daily` | `studio-tools.ts` |
| 附件工具 | `attachment_list`、`attachment_describe_image`、`attachment_get_audio_transcript` | `attachment-tools.ts` |
| 设备工具 | `device_exec`、`device_file_read/write`、`ros_topics`、`vnc_status`、`text_to_speech`、`speech_to_text`、`board_openclaw_*`（20+ 工具） | `rdk-tools.ts` |
| 网络与论坛工具 | `web_search`、`web_fetch`、`forum_drobotics_latest` | `web-tools.ts`、`forum-tools.ts` |
| 板端委派工具 | `board_openclaw_assess`、`board_openclaw_delegate` | `board-openclaw-*.ts` |

### 3.6 审批治理

所有工具在执行前经 `wrapToolWithApproval()` 包装，实现风险可控：

- **风险识别**：`resolveToolRisk()` 根据工具名称映射为 `low` / `medium` / `high`。例如 `device_exec` = high，`ros_topics` = low，`web_fetch` = high。
- **策略判断**：根据全局审批模式（`auto` / `risk-based` / `always`）、风险阈值、会话级自动放行等条件决定是否拦截。
- **用户决策**：前端展示审批卡片，用户可选择 `allow_once` / `allow_session_auto` / `allow_global_auto` / `deny`。

### 3.7 自治任务调度

`AutonomyScheduler` 支持无人值守场景：

- 支持 **interval（间隔触发）** 和 **cron（定时表达式）** 两种模式。
- 任务直接进入 `app.streamChat()`，复用完整的 RDKCLAW 编排能力。
- 内置 **熔断机制**：连续失败 3 次自动 `circuit_open` 暂停。
- 所有执行记录写入 **审计日志**（`rdkclaw-autonomy-audit.jsonl`）。
- 执行结果通过 `NotificationHub` 实时推送到前端。

---

## 四、OpenClaw 详解——板端 AI Agent 运行时

### 4.1 OpenClaw 是什么

OpenClaw 是一个开源的、自托管的 **AI Agent Gateway**（MIT 许可证），由社区维护，已在全球范围内获得广泛关注。它不是 RDK Studio 自研的组件，而是一个独立的开源项目，RDK Studio 选择将其作为板端 AI 执行体进行深度集成。

**OpenClaw 的核心特征：**

- **WebSocket Gateway 架构**：单进程 daemon，默认监听 `127.0.0.1:18789`，管理所有消息路由、会话、Agent 生命周期。
- **多渠道支持**：可同时连接 WhatsApp、Telegram、Discord、Slack、Signal、iMessage、飞书等消息平台。
- **Agent-Native**：原生支持工具调用、会话记忆、多 Agent 路由、SKILL.md 技能系统。
- **模型无关**：支持 Anthropic Claude、OpenAI、Google Gemini、DeepSeek、Ollama 等多种 LLM Provider。
- **插件体系**：通过 Plugin 扩展渠道、模型、工具、语音、图像等能力。
- **设备配对与安全**：Ed25519 密钥签名、Challenge-Response 握手、设备配对审批机制。

### 4.2 OpenClaw 在 RDK Studio 中的角色

在 RDK Studio 体系中，OpenClaw 运行在 **RDK 开发板上**，作为板端 AI 执行体。它：

- 直接接触板端硬件环境（摄像头、GPIO、BPU、文件系统、ROS 2 等）。
- 拥有板端本地上下文，能直接复用已安装的脚本、pipeline、工程目录。
- 可以独立响应来自飞书等渠道的消息（如果板端配置了渠道连接）。

RDKCLAW 通过 SSH 连接到板端后，使用 OpenClaw 的 WebSocket API（`ws://127.0.0.1:18789`）与板端 Agent 进行结构化通信。

### 4.3 OpenClaw 生命周期管理

RDK Studio 通过 `OpenClawDeploymentManager` 管理板端 OpenClaw 的全生命周期：

| 操作 | 说明 |
|---|---|
| `check` | 诊断板端环境：OpenClaw 版本、Gateway 状态、Node/NPM |
| `prepare` | 环境准备：检查依赖、创建目录、配置 npm |
| `install` | 安装 OpenClaw：优先官方脚本，失败回退 npm，自动 ClawHub 登录、Gateway 模式配置、Doctor 修复 |
| `upgrade` | 升级 OpenClaw：优先 CLI update，失败回退 npm |
| `uninstall` | 完整卸载：停服务、卸载包、清配置/日志/缓存/npm 全局包 |
| `config` | 读写板端配置：模型 Provider、API Key、飞书渠道、插件白名单 |
| `health` | 深度健康检查：安装状态、网关运行、Token 有效性、AI 就绪度 |
| `restart-gateway` | 重启 Gateway 并等待端口就绪 |
| `doctor` | 运行 OpenClaw 自动修复 |
| `model-test` | 端到端模型连通测试：通过 WebSocket 发送 prompt 并验证响应 |
| `logs` | 收集日志：OpenClaw CLI 日志 + journalctl + 文件日志 |
| `skills` | 查看板端已安装技能与插件 |
| `pairing` | 设备配对管理（list / approve / reject） |
| `wifi` | 板端 WiFi 扫描与连接 |

---

## 五、RDKCLAW 与 OpenClaw 的关系

### 5.1 一句话总结

**RDKCLAW 是调度与治理层（"大脑"），OpenClaw 是板端执行层（"双手"）。**

### 5.2 职责边界

| 维度 | RDKCLAW（Studio 侧） | OpenClaw（板端） |
|---|---|---|
| 运行位置 | PC / 服务器 | RDK 开发板 |
| 核心职责 | 理解意图、策略决策、工具编排、审批治理 | 在板端环境中执行任务 |
| 模型调用 | 通过 Studio 侧配置的 LLM 完成推理 | 通过板端配置的 LLM 独立推理 |
| 工具范围 | 设备 SSH 工具 + 附件 + 网络 + 论坛 + Studio 任务 | 板端本地工具 + 已安装技能 + 插件 |
| 渠道接入 | Studio UI + 飞书（Studio 侧） | 飞书/WhatsApp/Telegram 等（板端独立） |
| 会话管理 | Session 持久化在 PC 上 | Session 持久化在板端 |
| 安全模型 | 审批机制 + 策略面板 | Gateway Auth + 设备配对 |

### 5.3 协同流程

```
用户输入 "帮我在板端启动目标检测"
  ↓
RDKCLAW 分析意图
  → selectDelegateDecision → preferBoard = true
  ↓
RDKCLAW 调用 board_openclaw_assess（评估）
  → SSH → 板端 OpenClaw Gateway → 返回可执行性评估
  ↓
如果 canHandle = true:
  RDKCLAW 调用 board_openclaw_delegate（委派）
    → SSH → 板端 OpenClaw Gateway → 板端 Agent 执行任务
    → 板端实时输出流式回传 → RDKCLAW 事件映射 → 前端可视化
  ↓
如果 canHandle = false:
  RDKCLAW 回退使用本地 device_exec 等工具直接 SSH 操作
```

### 5.4 双执行器语义

前端可以清晰区分任务由谁执行：

- `rdkclaw_local`：Studio 侧工具执行
- `board_openclaw`：板端 OpenClaw 执行

每一步的执行主体、耗时、结果都在 UI 时间线中可追踪。

### 5.5 为什么不是重复建设

RDKCLAW 和 OpenClaw 的关系类似"项目经理与现场工程师"：

- RDKCLAW 掌控全局：知道用户要什么、有哪些资源可用、该走什么审批、结果怎么呈现。
- OpenClaw 精通现场：直接接触硬件、熟悉板端环境、能复用已部署的脚本和 pipeline。

当板端已经有现成的能力（脚本、ROS pipeline、OpenClaw 技能），RDKCLAW 会直接委派给 OpenClaw 复用，**避免在 Studio 侧重复实现**。

---

## 六、多模态与语音能力

语音能力（STT/TTS）在系统中有三条互补路径：

| 路径 | 触发场景 | 实现方式 | 定位 |
|---|---|---|---|
| 会话附件转写 | 用户上传音频附件 | `ensureAudioAttachmentTranscripts` | 让语音进入推理语义上下文 |
| 设备工具 | Agent 主动调用 | `text_to_speech` / `speech_to_text`（板端 Python 执行） | 板端即时语音执行能力 |
| 生态技能 | 技能目录与安装 | `openclaw.tts` / `openclaw.stt`（种子技能元数据） | 可发现、可安装、可治理的能力目录 |

**三者关系：即时理解 + 即时执行 + 能力治理，分层互补。**

---

## 七、渠道协同——飞书集成

RDKCLAW 支持飞书作为一等渠道：

- 飞书用户通过配对码绑定到 RDK Studio 实例。
- 飞书消息通过 `FeishuChannelAdapter` 转化为 `streamChat` 请求，**复用完整的 RDKCLAW 编排能力**。
- 飞书侧的执行进度可以镜像到 Studio UI（工具调用、审批、结果）。
- Studio 侧的会话上下文可以与飞书共享。

这意味着：即使不打开 RDK Studio 界面，用户也能通过飞书消息驱动设备操作。

---

## 八、未来规划

### 8.1 短期（1-3 个月）：稳定与可信

| 方向 | 具体动作 | 预期结果 |
|---|---|---|
| 质量门禁 | 建立 CI（类型检查 + 构建 + 核心路径烟测） | 回归风险大幅降低 |
| 委派稳定性 | 增加预检门禁与失败自动回退 | 委派成功率提升到 90% 以上 |
| 可观测性 | 统一日志标准（runId/sessionId/deviceId/executor） | 故障定位时间缩短 |
| 文档对齐 | 技能/API/事件格式文档化 | 降低跨团队对接成本 |

### 8.2 中期（3-9 个月）：效率与规模

| 方向 | 具体动作 | 预期结果 |
|---|---|---|
| 架构解耦 | 后端路由按域拆分，消除 index.ts 单体风险 | 研发效率提升 |
| 链路收敛 | 收敛双聊天路径，统一到 `/api/agent/chat` | 认知与维护成本降低 |
| 生态打通 | 板端已安装技能可被 RDKCLAW 感知和路由 | 委派策略更精准 |
| OpenClaw 上游跟进 | 与 OpenClaw 社区版本对齐，减少分叉 | 长期可维护性保障 |

### 8.3 长期（9 个月+）：平台化与生态化

| 方向 | 具体动作 | 预期结果 |
|---|---|---|
| 多设备协同 | 支持多板卡同时接入与任务分发 | 从"单机工具"到"设备编排平台" |
| 离线能力 | 离线 STT/TTS、策略模板、技能镜像 | 满足政企合规与断网场景 |
| 企业级治理 | 多租户、审计日志、权限分级 | 支持规模化交付 |
| OpenClaw + 机器人本体 | 与 ROS 2 深度集成，支持具身智能场景 | 从"开发工具"到"机器人 AI 能力平台" |

---

## 九、总结

```
┌─────────────────────────────────────────────────────────┐
│              RDK Studio 三层架构定位                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   [用户层]  Web / Electron / 飞书                        │
│       ↕                                                 │
│   [编排层]  RDKCLAW — AI 任务编排中枢                     │
│             策略 · 审批 · 工具 · 会话 · 调度              │
│       ↕                                                 │
│   [执行层]  OpenClaw — 板端 AI Agent Gateway             │
│             设备能力 · 技能复用 · 独立推理                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**一句话：RDK Studio 通过 RDKCLAW 编排智能、通过 OpenClaw 执行智能，形成了"理解-决策-执行-反馈"的完整闭环。当前能力已可用于演示与试点，下一步核心是把可用变成可复制、可规模化交付。**
