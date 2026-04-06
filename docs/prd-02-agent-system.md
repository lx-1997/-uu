# RDK Studio 产品需求文档 — Agent 系统深度解析

> 版本: 1.0 | 日期: 2026-03-25 | 状态: 初稿

---

## 目录

- [1. Agent 系统总览](#1-agent-系统总览)
- [2. 双 Agent 协作模型](#2-双-agent-协作模型)
- [3. RDKClaw — Studio 侧 Agent](#3-rdkclaw--studio-侧-agent)
- [4. openclaw-mini 引擎](#4-openclaw-mini-引擎)
- [5. 工具系统](#5-工具系统)
- [6. 技能系统](#6-技能系统)
- [7. 人格系统](#7-人格系统)
- [8. 记忆系统](#8-记忆系统)
- [9. 上下文管理](#9-上下文管理)
- [10. 心跳巡检](#10-心跳巡检)
- [11. 会话管理](#11-会话管理)
- [12. 并发与队列](#12-并发与队列)

---

## 1. Agent 系统总览

RDK Studio 的 Agent 系统是产品的核心智能层。它不是简单的 LLM 聊天封装，而是一个完整的 **自主编排型 AI Agent 框架**，具备：

- 多轮对话与工具调用循环
- 自动委派决策（本地 vs 板端）
- 多通道接入（Web / 飞书 / 微信）
- 分级审批与安全策略
- 持久化记忆与人格进化
- 定时自治任务调度
- 上下文窗口智能管理（压缩 + 裁剪）

### 系统层级

```
┌──────────────────────────────────────────────────────────────┐
│  RDKClaw (server/rdkclaw/app.ts)                             │
│  业务编排层：接收消息、委派决策、工具组装、审批、Token 统计      │
├──────────────────────────────────────────────────────────────┤
│  openclaw-mini (server/agent/)                                │
│  引擎层：Agent Loop、LLM 调用、工具执行、上下文管理             │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐    │
│  │ Session  │ Context  │  Skills  │  Memory  │Heartbeat │    │
│  │ Manager  │  Loader  │ Manager  │ Manager  │ Manager  │    │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘    │
├──────────────────────────────────────────────────────────────┤
│  工具层 (server/agent/tools/)                                 │
│  builtin | rdk-tools | studio-tools | web-tools | forum等    │
├──────────────────────────────────────────────────────────────┤
│  通道层 (server/agent/channels/)                              │
│  飞书 | 微信 | CLI                                           │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. 双 Agent 协作模型

RDK Studio 采用 **Studio 侧 + 板端** 双 Agent 架构：

| 维度 | RDKClaw（Studio 侧） | OpenClaw（板端） |
|------|---------------------|-----------------|
| 运行位置 | 用户 PC / 服务器 | RDK 开发板 |
| 人格 | "小地瓜" | 板端 Agent |
| 定位 | 云端全栈 Agent：独立规划执行 + 为复杂任务精编上下文 | 板端全栈 Agent：独立规划执行 + 硬件现场决策 |
| 通信 | REST API + SSE + Socket.IO | SSH + OpenClaw Gateway (:18789) |
| 规划能力 | 联网检索、文档分析、生态知识整合、跨设备全局视野 | 板端状态感知、本地技能编排、实时异常处理与适配 |
| 执行能力 | device_exec、文件操作、搜索、工作区管理 | GPIO/BPU/摄像头操作、模型推理、进程管理、本地多步执行 |

### 协作原则

引用自 `agent/SOUL.md`：

> OpenClaw 是你在板端的搭档，不是你的下属。你们都是规划 + 执行的全栈 Agent：
> - **你的优势域**：联网检索、文档分析、生态知识、用户意图、跨设备视野、上下文精编
> - **它的优势域**：板端硬件状态、本地规划决策、实时执行、已安装技能、现场异常处理
> - **合力增益**：你精编的上下文（soul.md、guidance、搜索结果）让它的规划执行质量成倍提升

### 委派流程

```
用户消息
  │
  ▼
RDKClaw 接收
  │
  ├─ 技能匹配（skill.trigger）
  ├─ 文本启发式分析
  ├─ 板端能力检测（已安装技能快照）
  │
  ▼
selectDelegateDecision()
  │
  ├─ local_only   → RDKClaw 独立处理
  ├─ collaborative → RDKClaw 主导 + 按需委派板端
  └─ board_primary → 优先交给板端 OpenClaw 执行
```

---

## 3. RDKClaw — Studio 侧 Agent

### 核心文件

`server/rdkclaw/app.ts` — `RDKClawApp` 类

### 职责清单

| 职责 | 说明 |
|------|------|
| 消息接收 | 统一接收来自 Web、飞书、微信的用户消息 |
| 委派决策 | `selectDelegateDecision()` 自动决定任务执行路径 |
| 工具组装 | `createTools()` 根据上下文动态组装可用工具集 |
| 审批包装 | `wrapToolWithApproval()` 为每个工具注入审批检查 |
| 工作区管理 | `UserWorkspaceStore` 管理用户会话/记忆/技能目录 |
| 人格管理 | `PersonaStore` 管理全局人格与用户个性化配置 |
| Token 统计 | 聊天完成后汇总 prompt/completion token 并记录 |
| 设备队列 | `DeviceQueue.acquireSlot()` 保证同设备任务串行 |

### streamChat 核心流程

```
streamChat(request)
  │
  ├─ 1. DeviceQueue.acquireSlot(deviceId)   // 设备串行锁
  ├─ 2. 准备附件（图片/文件/音视频）
  ├─ 3. UserWorkspaceStore.getOrInit()      // 初始化用户工作区
  ├─ 4. SkillRegistry.matchByText()         // 技能匹配
  ├─ 5. selectDelegateDecision()            // 委派决策
  ├─ 6. 注入环境变量（memory/context/skills）
  ├─ 7. 创建 Agent 实例（openclaw-mini）
  ├─ 8. 组装工具集（createTools）
  ├─ 9. Agent.run(sessionKey, message)
  │     └─ (进入 openclaw-mini Agent Loop)
  ├─ 10. 异步 yield 事件流（text/tool/thinking/approval/...）
  └─ 11. done 事件：汇总 token/上下文/委派/性能指标
```

### 委派决策算法 (`selectDelegateDecision`)

输入因素：

| 因素 | 影响 |
|------|------|
| `deviceId` 是否存在 | 无设备 → `local_only` |
| 用户指定 `mode` | `board-preferred` → 倾向 `board_primary` |
| 消息文本启发式 | 包含硬件关键词 → 倾向板端 |
| 匹配技能的 `requiresBoard` | true → 需要板端参与 |
| 板端技能快照 | 有匹配的已安装技能 → 可委派 |

输出：
- `local_only` — RDKClaw 独立处理，不调用板端
- `collaborative` — RDKClaw 主导，通过 `board_openclaw_delegate` 按需委派
- `board_primary` — 优先委派板端执行

### 板端技能快照

`getBoardSkillSnapshot()` 通过 `OpenClawDeploymentManager.getInstalledSkills` 拉取板端已安装技能列表（`===SKILLS===` / `===PLUGINS===` 段），带 TTL 缓存避免频繁 SSH 查询。

---

## 4. openclaw-mini 引擎

### 核心文件

- `server/agent/agent.ts` — `Agent` 类
- `server/agent/agent-loop.ts` — `runAgentLoop()` 函数

### Agent 类五大子系统

| 子系统 | 文件 | 职责 |
|--------|------|------|
| **SessionManager** | `server/agent/session.ts` | JSONL 会话持久化、版本管理、写锁 |
| **MemoryManager** | `server/agent/memory.ts` | 长期记忆存储、BM25 关键词检索 |
| **ContextLoader** | `server/agent/context/loader.ts` | Bootstrap 文件加载、system prompt 构建 |
| **SkillManager** | `server/agent/skills.ts` | 多目录技能加载、匹配、prompt 注入 |
| **HeartbeatManager** | `server/agent/heartbeat.ts` | 定时心跳巡检、唤醒合并 |

### Agent.run() 端到端流程

```
Agent.run(sessionKey, userMessage)
  │
  ├─ 1. resolveSessionKey()                      // 解析会话键
  ├─ 2. enqueueInLane(sessionLane)               // Session 级串行队列
  │     └─ enqueueInLane(globalLane)             // 全局并发控制
  │
  ├─ 3. 加载 JSONL 历史消息
  ├─ 4. 技能 /command 匹配改写用户消息（可选）
  ├─ 5. sessions.append(userMessage)             // 持久化用户消息
  │
  ├─ 6. prepareMessagesForRun()                  // Compaction 预处理
  │     └─ compactHistoryIfNeeded()              // 70% 窗口时触发压缩
  │
  ├─ 7. buildSystemPrompt()                      // 构建 system prompt
  │     ├─ Context Bootstrap 文件
  │     ├─ Skills prompt
  │     ├─ Memory 提示
  │     └─ Sandbox 提示
  │
  ├─ 8. resolveToolsForRun()                     // 工具集解析
  │     ├─ Policy 过滤
  │     ├─ Sandbox 限制
  │     └─ 子代理工具范围 (TOOL_SCOPE_SETS)
  │
  ├─ 9. wrapToolWithAbortSignal()                // 每工具注入中止信号
  │
  ├─ 10. runAgentLoop()                          // 进入核心循环
  │      (详见下方)
  │
  └─ 11. finally: toolResultGuard.flushPendingToolResults()
```

### runAgentLoop 内部循环

`runAgentLoop` 是纯函数，通过参数注入所有依赖：

```
双层循环:

外层: getFollowUpMessages
  │
  └─ 内层: hasMoreToolCalls || pendingMessages.length > 0
       │
       ├─ turn_start 事件
       ├─ 注入 pendingMessages（用户追加、steering 等）
       ├─ pruneContextMessages()              // 三层裁剪
       │   ├─ 软截断：工具结果超长部分截断
       │   ├─ 硬清空：清空最长的工具结果
       │   └─ 丢弃：按预算丢弃整条旧消息
       │
       ├─ 若有 compactionSummary → 置于消息列表前部
       ├─ convertMessagesToPi()               // 转换为 pi-ai 格式
       │
       ├─ streamFn() 流式 LLM 调用
       │   ├─ thinking chunk → 发送 thinking 事件
       │   ├─ text chunk → 发送 text 事件
       │   ├─ tool_call → 收集待执行工具
       │   └─ error → 错误处理
       │
       ├─ 持久化 assistant 消息
       │
       ├─ 工具执行（分组策略）:
       │   ├─ PARALLEL_SAFE_TOOLS → Promise.allSettled 并行
       │   └─ 其余 → 串行执行，含 checkToolApproval
       │
       ├─ 合成 tool_result user 消息 → append
       ├─ steering 检测（steeringQueues 排空）
       └─ turn_end 事件

  外层结束条件: 无 follow-up 消息
```

### 容错机制

| 异常类型 | 处理策略 |
|---------|---------|
| 速率限制 (Rate Limit) | `retryAsync` 自动重试，指数退避 |
| 上下文溢出 (Context Overflow) | 触发一次紧急 compaction 后重试（`context_overflow_compact` 事件） |
| 工具执行失败 | 错误信息封装为 tool_result 返回 LLM 决策下一步 |
| 连接中断 | AbortSignal 传播至所有工具调用 |

### Steering 机制

`Agent.steer(sessionKey, text)` 允许外部在 Agent 运行过程中注入消息（类似中断）。注入的消息在下一个 turn 开始时作为新的 user 消息加入循环，适用于：
- 用户在 Agent 执行中追加指令
- 外部系统需要打断当前流程

---

## 5. 工具系统

### 架构

```
server/agent/tools/
├── types.ts              // Tool 类型定义、ToolContext
├── index.ts              // 统一导出
├── builtin.ts            // 内置基础工具
├── abort.ts              // 中止信号包装
├── plan-tool.ts          // 任务规划工具
├── device-manager-tools.ts  // 设备管理工具
├── rdk-tools.ts          // RDK 板端操作工具
├── rdk-ssh-helper.ts     // SSH 执行封装
├── studio-tools.ts       // Studio 侧工具
├── web-tools.ts          // 联网搜索/抓取
├── forum-tools.ts        // 论坛工具
└── attachment-tools.ts   // 附件处理工具
```

### ToolContext

每个工具执行时接收标准上下文：

```typescript
interface ToolContext {
  workspace: string;       // 工作区根目录
  bootstrap: string[];     // Bootstrap 文件列表
  extraRoots: string[];    // 额外允许的路径
  session: SessionInfo;    // 当前会话信息
  memory: MemoryManager;   // 记忆管理器
  spawnSubagent: Function; // 子代理生成器
  abortSignal: AbortSignal; // 中止信号
}
```

### 完整工具清单

#### 内置基础工具 (builtin.ts)

| 工具名 | 功能 | 安全级别 |
|--------|------|---------|
| `read` | 读取工作区文件 | 只读，PARALLEL_SAFE |
| `write` | 写入工作区文件 | 写操作 |
| `edit` | 编辑工作区文件（查找替换） | 写操作 |
| `exec` | 执行本地 shell 命令 | 高风险 |
| `list` | 列出目录内容 | 只读，PARALLEL_SAFE |
| `grep` | 搜索文件内容 | 只读，PARALLEL_SAFE |
| `memory_search` | 搜索记忆（BM25） | 只读 |
| `memory_get` | 获取指定记忆 | 只读 |
| `memory_save` | 保存记忆 | 写操作 |
| `sessions_spawn` | 生成子代理 | 高风险 |

路径安全: 所有文件操作经过 `sandbox-paths.ts` 校验，限制在 workspace 和 extraRoots 范围内。

#### 设备操作工具 (rdk-tools.ts)

| 工具名 | 功能 | 风险 |
|--------|------|------|
| `device_exec` | 在设备上执行 shell 命令 | 中-高 |
| `device_file_read` | 读取设备端文件 | 低 |
| `device_file_write` | 写入设备端文件 | 中 |
| `device_file_list` | 列出设备端目录 | 低 |
| `device_file_download_to_local` | 设备→本地下载文件 | 低 |
| `device_file_upload_from_local` | 本地→设备上传文件 | 中 |
| `device_diagnose` | 硬件全面诊断 | 低 |

所有设备工具底层通过 `rdk-ssh-helper.ts` 的 `execOnDevice` / `readDeviceFile` 调用 SSH。

#### 板端 OpenClaw 工具 (server/rdkclaw/tools/)

| 工具名 | 功能 | 说明 |
|--------|------|------|
| `board_openclaw_assess` | 评估板端是否能处理任务 | 发送评估请求到 OpenClaw，解析 JSON 得到 canHandle/confidence/reason |
| `board_openclaw_delegate` | 委派复杂任务给板端执行 | 拼装 task/context/guidance，流式 onProgress，支持重试与恢复 |
| `propose_soul_update` | 提议更新 SOUL.md | 不直接写文件，发出 `soul_update_proposal` 事件等待用户确认 |

#### Studio 侧工具 (studio-tools.ts)

配置管理、自治任务创建等 Studio 级操作。

#### 联网工具 (web-tools.ts)

| 工具名 | 功能 |
|--------|------|
| `web_search` | 联网搜索（结论标注来源） |
| `web_fetch` | 抓取指定 URL 内容 |

#### 设备管理工具 (device-manager-tools.ts)

| 工具名 | 功能 |
|--------|------|
| `device_list` | 列出已保存设备 |
| `device_scan` | 扫描局域网设备 |
| `device_connect` | 连接设备 |
| `device_remove` | 移除设备 |
| `switchDeviceTool` | 切换当前活动设备 |

#### 其他

| 工具组 | 说明 |
|--------|------|
| `forum-tools.ts` | D-Robotics 论坛发帖/查帖 |
| `attachment-tools.ts` | 会话附件上传/下载/处理 |
| `plan-tool.ts` | 创建/更新执行计划 |

### 工具策略 (Tool Policy)

`server/agent/tool-policy.ts` — `filterToolsByPolicy(tools, policy)`

策略支持 allow/deny + glob 匹配：
- **allow**: 白名单模式，仅允许列出的工具
- **deny**: 黑名单模式，排除指定工具
- 支持通配符（如 `device_*` 匹配所有设备工具）

### 工具审批

`server/agent/tool-approval.ts`

- `requiresApproval(tool, args)` — 判断是否需要审批
- `ApprovalConfig` — 审批配置（模式、白名单等）
- `AllowlistManager` — 一次允许后记住，避免重复审批
- 事件: `tool_approval_request` → 等待 → `tool_approval_resolved`

### 工具执行分组

Agent Loop 中工具按安全性分组执行：
- **PARALLEL_SAFE_TOOLS**（只读工具: read, list, grep, memory_search 等）→ `Promise.allSettled` 并行
- **其他工具** → 严格串行，每个工具执行前检查审批

---

## 6. 技能系统

### 架构

```
skills/                          # 仓库根目录技能
├── rdk-ecosystem/SKILL.md
├── rdk-device/SKILL.md
├── rdk-openclaw-bridge/SKILL.md
├── rdk-token-usage/SKILL.md
├── rdk-skill-authoring-guide/SKILL.md
└── ... (共 28 个)

agent/skills/                    # Agent 级技能
~/.rdkstudio/rdkclaw-workspaces/<id>/skills/  # 用户级技能
```

### 技能定义格式 (SKILL.md)

每个技能为一个 Markdown 文件，包含 YAML frontmatter 和正文：

```yaml
---
name: rdk-example-skill
description: 示例：通过联网与板端 assess 完成知识准备
version: "1.0"
trigger: 示例|演示
risk: low
permissions:
  - web_search
  - web_fetch
delegate_preference: local
requires_board: false
approval_level: auto
cooldown_seconds: 0
scheduler_template: null
category: example
---

## 适用场景
...

## 执行流程
1. 调用 web_search / web_fetch 获取文档...
2. 需要时调用 board_openclaw_assess 评估板端能力...

## 工具映射
- web_search / web_fetch → 联网工具；板型与探测 → POST /api/devices/:id/board/detect

## 输出要求
...

## 禁止事项
...
```

### Frontmatter 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 技能唯一标识 |
| `description` | string | 简短描述 |
| `version` | string | 版本号 |
| `trigger` | string | 触发关键词（`|` 分隔） |
| `risk` | `low\|medium\|high` | 风险等级 |
| `permissions` | string[] | 所需工具权限 |
| `delegate_preference` | `local\|board\|collaborative` | 委派偏好 |
| `requires_board` | boolean | 是否需要板端 |
| `approval_level` | `auto\|manual` | 审批级别 |
| `cooldown_seconds` | number | 最小执行间隔 |
| `scheduler_template` | object\|null | 自治任务模板 |
| `category` | string | 分类标签 |

### 技能匹配机制

`SkillManager.match(text)`:
1. 遍历所有已加载技能
2. 将 `trigger` 字段按 `|` 分割为关键词
3. 检查用户消息是否包含任意关键词
4. 返回匹配的技能列表

### 技能调用策略

`resolveInvocationPolicy(skill)`:
- `user-invocable`: 仅用户主动触发（斜杠命令）
- `disable-model-invocation`: 禁止 LLM 自动调用
- 默认: 匹配后自动加载 SKILL.md 内容指导 LLM

### /command 匹配

用户消息以 `/` 开头时，匹配技能的 `name` 字段：
- `/rdk-ecosystem` → 直接触发 rdk-ecosystem 技能
- 匹配成功后，用户消息被改写为技能要求的格式

### 三层能力模型

技能系统体现了 Agent 的三层能力架构：

| 层级 | 能力来源 | 示例 |
|------|---------|------|
| **L1 — Agent 自身** | 决策、编排、文件操作 | 分析用户意图、制定执行计划 |
| **L2 — 外脑知识** | `web_search` + `web_fetch` | 搜索并拉取官方文档；平台与板卡信息以设备记录与板端 assess 为准 |
| **L3 — 板端执行** | `board_openclaw_delegate` + `device_exec` | 模型部署、硬件操作、进程管理 |

---

## 7. 人格系统

### SOUL.md — 人格定义

**文件**: `agent/SOUL.md`

人格名称: **"小地瓜"**

#### 核心人格特征

| 维度 | 设定 |
|------|------|
| 身份 | RDK Studio 的 AI 搭档，云端全栈 Agent |
| 性格 | 聪明、可靠、轻松有梗但不油腻 |
| 做事原则 | 先动手再解释、有证据说话、灵活应变 |
| 说话风格 | 中文为主、首句给结论、技术术语保留英文 |
| 安全意识 | 破坏性操作先确认、不泄露敏感信息 |

#### 行为规则

1. **结果导向**: 用户要的是结果而非方案报告。能跑先跑、能验证先验证
2. **失败透明**: 失败原因、影响范围、下一步，三句话说完
3. **最少提问**: 不确定时只问一个最关键的问题，不连环追问
4. **不虚构**: 设备状态用工具查、文件内容用工具读，不靠记忆
5. **不教条**: 简单事别搞复杂（`ls` 直接 `device_exec` 跑就行）

### SOUL 自学习机制

`propose_soul_update` 工具实现人格动态进化：

```
用户表达长期偏好
  │
  ▼
Agent 识别偏好类型
  │ （风格、输出格式、禁止项、行为规则等）
  │
  ▼
判断是否属于长期偏好
  │ （一次性指令不写入 SOUL）
  │
  ▼
调用 propose_soul_update
  │ （section, action: add|modify|remove, content, reason）
  │
  ▼
前端展示 soul-update 卡片
  │
  ├─ 用户接受 → applySoulUpdate() → 写入 SOUL.md 对应段落
  └─ 用户拒绝 → 丢弃提议
```

触发示例:
- "以后回复简洁点" → modify output_contract
- "不要用表情" → add do_not
- "涉及刷机先问我" → add behavior_rules

不触发:
- "这次用英文回复" → 一次性指令
- "帮我查个东西" → 任务请求

### 人格配置 (PersonaStore)

`server/rdkclaw/persona-store.ts`

- 全局人格: `~/.rdkstudio/rdkclaw-persona.json`
- 用户级配置: `~/.rdkstudio/rdkclaw-users.json` (`UserProfile`)
- 前端通过设置面板可修改人格参数
- API: `GET|POST /api/rdkclaw/persona`

---

## 8. 记忆系统

### 架构

```
~/.rdkstudio/rdkclaw-workspaces/<userId>/
├── memory/
│   ├── 2026-03-24.md    # 日记（按天）
│   ├── 2026-03-25.md
│   └── ...
└── MEMORY.md            # 长期记忆
```

### MemoryManager

`server/agent/memory.ts`

| 方法 | 功能 |
|------|------|
| `memory_search(query)` | BM25 关键词评分搜索记忆 |
| `memory_get(key)` | 获取指定日期或主题的记忆 |
| `memory_save(key, content)` | 写入/更新记忆 |

### 记忆策略

引用自 `agent/AGENTS.md`：

1. **日记** (`memory/YYYY-MM-DD.md`): 当天发生的事件原始记录
2. **长期记忆** (`MEMORY.md`): 提炼后的关键决策、偏好、约束
3. **仅主会话使用**: 不在共享场景（Discord、群聊）中使用长期记忆
4. **定期汇入**: 回顾每日文件，把值得保留的内容汇入 MEMORY.md

### 会话启动时的记忆加载

每次会话开始，Agent 按顺序读取：
1. `SOUL.md` — 人格定义
2. `USER.md` — 用户信息
3. `memory/YYYY-MM-DD.md`（今天 + 昨天）— 最近上下文
4. `MEMORY.md` — 长期记忆（仅主会话）

---

## 9. 上下文管理

### 模块结构

```
server/agent/context/
├── index.ts          # 统一导出
├── loader.ts         # ContextLoader: Bootstrap 文件加载
├── bootstrap.ts      # Bootstrap 文件扫描规则
├── pruning.ts        # 上下文裁剪（三层策略）
├── compaction.ts     # 上下文压缩（摘要）
└── tokens.ts         # Token 估算
```

### Bootstrap 文件

`bootstrap.ts` 定义了 Agent 启动时需要加载的文件：

| 文件 | 用途 |
|------|------|
| `AGENTS.md` | 工作区总则 |
| `SOUL.md` | 人格定义 |
| `TOOLS.md` | 工具手册 |
| `USER.md` | 用户信息 |
| `HEARTBEAT.md` | 心跳巡检项 |
| `MEMORY.md` | 长期记忆 |
| `IDENTITY.md` | 身份信息 |
| `BOOTSTRAP.md` | 首次启动说明 |

加载时有字符上限保护，避免单个文件撑爆上下文。

### 三层裁剪 (Pruning)

`pruning.ts` — `pruneContextMessages(messages, budget)`

裁剪在每个 turn 开始时执行：

| 层级 | 策略 | 效果 |
|------|------|------|
| L1 软截断 | 超长 tool_result 截断为前 N 字符 + 摘要 | 保留工具结果的关键信息 |
| L2 硬清空 | 清空最长的 tool_result 内容 | 释放大量 token |
| L3 丢弃 | 按预算从最旧消息开始丢弃整条 | 保证总量在窗口范围内 |

### 上下文压缩 (Compaction)

`compaction.ts` — `compactHistoryIfNeeded()`

- **触发条件**: 上下文窗口占用达到 70%
- **执行过程**: 调用 LLM 生成结构化摘要，替换历史消息
- **持久化**: 写入 `CompactionEntry` 到 JSONL 文件
- **摘要格式**: 固定前缀/后缀，与 OpenClaw 对齐

### 窗口守卫

`server/agent/context-window-guard.ts`

| 阈值 | 行为 |
|------|------|
| \> 70% 窗口 | 触发 compaction |
| \< 32k 剩余 | 发出警告 |
| \< 16k 剩余 | 硬性错误，拒绝继续 |

---

## 10. 心跳巡检

### HeartbeatManager

`server/agent/heartbeat.ts`

**功能**: 定时读取 `HEARTBEAT.md` 中的巡检项，执行检查并报告异常。

### 巡检项 (HEARTBEAT.md)

引用自 `agent/HEARTBEAT.md`：

| 巡检项 | 检查内容 | 异常动作 |
|--------|---------|---------|
| 温度 | CPU/BPU 温度是否过高 | 告警 + 建议降温措施 |
| 磁盘 | 根分区使用率 | 告警 + 清理建议 |
| 内存 | 内存使用率 | 告警 + 进程排查 |
| OpenClaw Gateway | 18789 端口是否监听 | 尝试 `systemctl --user restart openclaw-gateway` |

### 行为特性

- 唤醒合并 (coalesce): 短时间内多次唤醒合并为一次
- 活跃时段控制: 可配置巡检活跃时间窗口
- 重复抑制: 同一问题不重复报告
- 回调返回 `{ text }` 或 `null`（OK），由调用方决定是否再调 LLM

### DeviceHealthMonitor

`server/rdkclaw/device-health-monitor.ts`

更完整的设备健康监控：
- SSH 到板端采集温度、根分区磁盘、内存、gateway 状态
- 异常分级
- Gateway down 时尝试自愈（重启服务）
- `formatForAgent` 方法供心跳使用

---

## 11. 会话管理

### SessionManager

`server/agent/session.ts`

#### JSONL 持久化格式

每个会话为一个 `.jsonl` 文件，文件名为 `encodeURIComponent(sessionKey)` 防路径注入。

条目类型：
- `SessionHeaderEntry` — 会话元数据（版本、创建时间）
- `MessageEntry` — 用户或 assistant 消息
- `CompactionEntry` — 压缩摘要标记

当前版本: `CURRENT_SESSION_VERSION = 3`

#### 会话键规则

`server/agent/session-key.ts`:
- 主会话: `buildAgentMainSessionKey(userId)` → `rdkclaw:<userId>`
- 子代理: `isSubagentSessionKey(key)` → `sub:<parentKey>:<subId>`
- 外部通道: `feishu:<openId>` / `weixin:<userId>` / `auto:<taskId>`

#### 写锁

`server/agent/session-write-lock.ts`:
- 独占文件锁（Node.js `fs.open` 的 `wx` flag）
- PID 存活检测（防止进程崩溃后锁未释放）
- 超时与 stale 锁清理

#### Tool Result Guard

`server/agent/session-tool-result-guard.ts`:
- hook `SessionManager.append`，追踪未闭合的 `tool_use`
- Agent.run 的 `finally` 中调用 `flushPendingToolResults`
- 确保每个 `tool_use` 都有对应的 `tool_result`（即使异常退出）

---

## 12. 并发与队列

### 双层队列模型

`server/agent/command-queue.ts`

```
用户请求
  │
  ▼
enqueueInLane(sessionLane)      // session:<key>, 严格串行
  │                              // 同一会话的请求排队
  └─▶ enqueueInLane(globalLane)  // main, 可配置并发数
       │                         // 全局并发控制
       └─▶ 实际执行 Agent Loop
```

| Lane | 类型 | 说明 |
|------|------|------|
| `session:<key>` | 串行 | 保证同一会话内消息顺序执行 |
| `main` | 并发 | 全局并发上限（`setLaneConcurrency` 可调） |
| `device:<id>` | 串行 | 设备级串行（DeviceQueue 使用） |
| `local` | 并发 | 无设备的本地任务 |

### DeviceQueue

`server/rdkclaw/device-queue.ts`

- 基于 `command-queue.ts` 的 `enqueueInLane`
- `acquireSlot(deviceId)` → 同设备串行、无设备走 `local` lane
- 在 `streamChat` 开始时获取、结束时释放
- `queue_status` 元信息供前端展示排队状态

---

*本文档为 PRD 系列第 2 部分，详见：*
- *[prd-01-product-overview.md](prd-01-product-overview.md) — 产品概述与功能模块*
- *[prd-03-integration-operations.md](prd-03-integration-operations.md) — 集成、安全与运维*
- *[prd-04-api-reference.md](prd-04-api-reference.md) — API 端点与数据模型*
