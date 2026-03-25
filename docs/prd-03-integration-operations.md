# RDK Studio 产品需求文档 — 集成、安全与运维

> 版本: 1.0 | 日期: 2026-03-25 | 状态: 初稿

---

## 目录

- [1. 外部通道集成](#1-外部通道集成)
  - [1.1 飞书 (Feishu/Lark)](#11-飞书-feishulark)
  - [1.2 微信 (Weixin ClawBot)](#12-微信-weixin-clawbot)
  - [1.3 通道对比](#13-通道对比)
- [2. 生态系统](#2-生态系统)
  - [2.1 生态注册表](#21-生态注册表)
  - [2.2 四大 Provider](#22-四大-provider)
  - [2.3 板端状态同步](#23-板端状态同步)
  - [2.4 设备画像](#24-设备画像)
  - [2.5 技能分发](#25-技能分发)
- [3. 安全体系](#3-安全体系)
  - [3.1 SSO 认证](#31-sso-认证)
  - [3.2 权限守卫](#32-权限守卫)
  - [3.3 审批流](#33-审批流)
  - [3.4 通道安全](#34-通道安全)
  - [3.5 安全审计](#35-安全审计)
- [4. 自治调度](#4-自治调度)
- [5. LLM Token 监控](#5-llm-token-监控)
- [6. 部署形态](#6-部署形态)
- [7. 环境变量与配置](#7-环境变量与配置)

---

## 1. 外部通道集成

RDK Studio 支持通过即时通讯工具远程控制设备。用户无需打开 Web 界面，直接在飞书或微信中给 Agent 发消息即可驱动设备操作。

### 通道架构

```
飞书用户 ──Webhook/WS──▶ server/index.ts ──▶ FeishuChannelAdapter
                                                    │
                                                    ▼
                                              RDKClawApp.streamChat()
                                                    │
                                                    ▼
微信用户 ──iLink Bot轮询──▶ server/agent/channels/weixin.ts
                              │                     │
                              ▼                     ▼
                        WeixinPollingChannel    Agent 执行
                              │                     │
                              ▼                     ▼
                        NotificationHub ──Socket.IO──▶ Web 前端（消息镜像）
```

### 1.1 飞书 (Feishu/Lark)

#### 相关文件

| 文件 | 职责 |
|------|------|
| `server/rdkclaw/feishu-auth-store.ts` | 配对码管理、用户绑定、会话同步 |
| `server/rdkclaw/feishu-config-store.ts` | 运行时配置（开关、模式、密钥） |
| `server/rdkclaw/feishu-channel-adapter.ts` | 消息适配（请求→RDKClaw→响应） |
| `server/rdkclaw/feishu-api-client.ts` | 飞书 API 调用（token 刷新、消息发送） |
| `server/agent/channels/feishu.ts` | 完整通道实现（消息收发、附件、通知） |

#### 接入模式

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| **Webhook** | 飞书主动 POST 到 `POST /api/channels/feishu/webhook` | 公网可达的服务器 |
| **WebSocket** | Studio 主动连接飞书 WS 服务 | 内网环境、无公网 IP |

#### 配对机制

首次使用需将飞书用户与 Studio 会话绑定：

```
1. 用户在 Studio 设置中生成配对码（6位，5分钟有效）
2. 用户在飞书中发送配对码给机器人
3. 系统验证配对码 → 绑定 openId 与 Studio sessionId
4. 后续消息自动路由到对应会话
```

#### DM（私聊）策略

| 策略 | 行为 |
|------|------|
| `pairing` | 仅配对成功的用户可私聊（默认） |
| `allowlist` | 白名单用户可直接私聊 |
| `open` | 所有用户可私聊 |

#### 消息处理

- 输入：飞书消息 → 提取文本 / 图片 / 文件附件
- 处理：`FeishuChannelAdapter` 以 `feishu:<userId>` 为会话键调用 `RDKClawApp.streamChat`
- 输出：聚合 text delta，截断至约 **3500 字**（飞书消息长度限制）
- 同步：通过 `latestUiSession` / `latestUiDevice` 同步最新设备上下文

#### API 端点

| 端点 | 功能 |
|------|------|
| `POST /api/channels/feishu/webhook` | Webhook 入口 |
| `POST /api/rdkclaw/feishu/auth/bind` | 绑定配对码 |
| `GET /api/rdkclaw/feishu/auth/bound` | 查询绑定状态 |
| `GET /api/rdkclaw/feishu/pairing/requests` | 待审批配对请求 |
| `POST .../pairing/approve\|reject` | 审批配对 |
| `GET\|POST /api/rdkclaw/feishu/config` | 配置管理 |
| `GET .../status` | 连接状态 |
| `GET .../runtime` | 运行时信息 |
| `POST .../runtime/start\|stop\|restart` | 运行时控制 |

---

### 1.2 微信 (Weixin ClawBot)

#### 相关文件

| 文件 | 职责 |
|------|------|
| `server/rdkclaw/weixin-account-store.ts` | 多账号管理、导入 |
| `server/rdkclaw/weixin-config-store.ts` | 开关、同步、ack 配置 |
| `server/rdkclaw/weixin-channel-adapter.ts` | 消息适配 |
| `server/rdkclaw/weixin-api-client.ts` | iLink Bot API（长轮询、发送） |
| `server/rdkclaw/weixin-media.ts` | 附件提取与转换 |
| `server/agent/channels/weixin.ts` | 完整通道实现 |

#### 技术方案

基于 **iLink Bot** 平台（`https://ilinkai.weixin.qq.com`）实现微信机器人：

- **消息接收**: `getupdates` 长轮询
- **消息发送**: `sendmessage` / `sendText` / `sendImage` / `sendVideo` / `sendFile`
- **媒体处理**: CDN 加解密上传/下载

#### 扫码绑定流程

```
1. 前端调用 GET /api/rdkclaw/weixin/login（SSE）
2. 服务端生成二维码 URL → SSE 推送到前端
3. 用户微信扫码
4. 后台轮询确认绑定
5. 绑定成功 → 存储账号信息
```

#### 附件处理 (weixin-media.ts)

`extractAttachments(message)`:
- 从微信消息 `item_list` 中提取文本和附件
- 图片: 下载并转为 `RDKClawAttachment`
- 语音: SILK 格式 → WAV 转换
- 视频/文件: 下载并打标

#### 消息限制

- 输出截断至约 **4000 字**（微信消息长度限制）
- `ackStyle` 配置: 发送确认风格

#### API 端点

| 端点 | 功能 |
|------|------|
| `GET\|POST /api/rdkclaw/weixin/config` | 配置管理 |
| `GET .../status` | 连接状态 |
| `GET .../accounts` | 账号列表 |
| `POST .../accounts` | 添加账号 |
| `DELETE .../accounts/:id` | 删除账号 |
| `POST .../restart` | 重启通道 |
| `GET .../login` | 扫码登录（SSE） |
| `POST .../bind-start` | 开始绑定 |

---

### 1.3 通道对比

| 维度 | Web/Electron | 飞书 | 微信 |
|------|-------------|------|------|
| 入口 | 底部 AI Dock | IM 私聊 | IM 私聊 |
| 通信协议 | SSE + Socket.IO | Webhook/WebSocket | iLink Bot 长轮询 |
| 附件支持 | 图片/文件/音视频 (12MB) | 图片/文件 | 图片/语音/视频/文件 |
| 输出长度 | 无限制 | ~3500 字 | ~4000 字 |
| 结构化块 | 全部支持 | 纯文本 | 纯文本 |
| 审批 | UI 按钮 | 自然语言（"同意"/"拒绝"） | 自然语言 |
| 安全策略 | 基础（仅 high 风险审批） | 增强（`channel-safety`） | 增强（`channel-safety`） |
| 消息镜像 | — | 可同步到 Studio | 可同步到 Studio |

---

## 2. 生态系统

### 2.1 生态注册表

**核心文件**: `server/ecosystem/registry.ts`

生态注册表是所有外部能力（应用、模型、ROS 包、OpenClaw 技能）的统一索引。

#### 数据结构 (`EcoSkill`)

```typescript
interface EcoSkill {
  id: string;                    // 唯一标识
  source: EcoSource;             // 来源: nodehub | modelzoo | tros | openclaw_skill
  name: string;                  // 显示名称
  description: string;           // 描述
  platforms: RdkPlatform[];      // 支持的板型
  category: string;              // 分类
  tags: string[];                // 标签
  installCmd?: string;           // 安装命令
  runCmd?: string;               // 运行命令
  stopCmd?: string;              // 停止命令
  uninstallCmd?: string;         // 卸载命令
  boardStatusByDevice: Record<string, BoardStatus>;  // 每设备安装/运行状态
  lastRefreshedAt: string;       // 最后刷新时间
  // ...更多字段因来源而异
}
```

#### 操作

| 操作 | 说明 |
|------|------|
| `upsertSkill` | 插入或更新技能（合并 boardStatusByDevice） |
| `search(query)` | 按来源、平台、分类、标签、关键词、设备状态过滤 |
| `batchUpdateBoardStatus` | 批量更新指定设备的安装/运行状态 |
| `buildAIContext` | 为 AI Dock 生成上下文文本 |
| `findRelevantSkills` | 为委派工具检索相关技能 |
| `flush()` | 写入 `data/ecosystem-registry.json` |

#### 刷新机制

- 启动时 `initEcosystem()` → `refreshAll()`
- 每 **6 小时** 定时自动刷新
- 手动触发: `POST /api/ecosystem/refresh`

---

### 2.2 四大 Provider

#### NodeHub (`server/ecosystem/providers/nodehub.ts`)

| 字段 | 说明 |
|------|------|
| 来源标识 | `nodehub` |
| 数据结构 | `NodeHubSkill`（pkgName, processKey, dependencies） |
| 内容 | 高层应用包（如 NodeHub 社区应用） |
| 操作 | install → run → stop → uninstall |
| 当前状态 | 种子数据 `SEED_APPS`，未来对接 NodeHub API |

#### ModelZoo (`server/ecosystem/providers/modelzoo.ts`)

| 字段 | 说明 |
|------|------|
| 来源标识 | `modelzoo` |
| 数据结构 | `ModelZooSkill`（modelPath, samplePath, processKey） |
| 内容 | rdk_model_zoo AI 模型 |
| 操作 | deploy → run → remove |
| 模型路径 | `/opt/rdk_model_zoo/models/` |

#### TROS (`server/ecosystem/providers/tros.ts`)

| 字段 | 说明 |
|------|------|
| 来源标识 | `tros` |
| 数据结构 | `TrosSkill`（rosNodes, rosTopics） |
| 内容 | ROS2/TROS 功能包 |
| 操作 | install → run (ros2 launch/run) → stop |

#### OpenClaw Skills (`server/ecosystem/providers/openclaw-skills.ts`)

| 字段 | 说明 |
|------|------|
| 来源标识 | `openclaw_skill` |
| 数据结构 | `OpenClawSkillDef`（skillMdContent, requiredBins） |
| 内容 | 板端 OpenClaw 能力（含自动生成的 SKILL.md） |
| 操作 | provision → deprovision |

---

### 2.3 板端状态同步 (Board Sync)

**文件**: `server/ecosystem/board-sync.ts`

#### 同步流程

```
POST /api/ecosystem/sync/:deviceId
  │
  ▼
buildSyncCommand()
  │  构造 bash 脚本，一次 SSH 采集：
  │  - TROS/APT 已安装包名
  │  - /opt/rdk_model_zoo/models 目录列表
  │  - 过滤后的进程列表
  │  - /opt/openclaw/skills 目录
  │  - ros2 node list
  │
  ▼
SSH 执行 → 返回段标记分隔的文本
  │
  ▼
parseSyncOutput()
  │  按 ===TROS=== / ===MODELS=== / ===PROCESSES=== 等段标记解析
  │
  ▼
applyBoardSync(deviceId, output, registry)
  │  将解析结果与 registry 中的 EcoSkill 匹配
  │  更新每个技能在该设备上的 installed / running 状态
  │
  ▼
返回 BoardSyncResult
  │  含 installedPackages, runningProcesses, openclawSkills, rosNodes
```

---

### 2.4 设备画像 (Device Profiles)

**文件**: `server/ecosystem/device-profiles.ts`

支持的板型及其关键参数：

| 板型 | SoC | BPU TOPS | 模型格式 | 说明 |
|------|-----|---------|---------|------|
| **RDK X3** | Sunrise X3 | 5 TOPS | `.bin` (Bernoulli) | 入门级开发板 |
| **RDK X5** | Sunrise X5 | 10 TOPS | `.bin` (Bayes) | 中端开发板 |
| **RDK Ultra** | Sunrise Ultra | 高算力 | `.bin` | 高性能开发板 |
| **RDK S100** | S100 | — | — | 特殊场景板 |

每个画像包含：
- `detectionPatterns`: 板型自动检测规则
- `bpuCmd`: BPU 状态查询命令
- `trosPath`: TROS 安装路径
- `limitations`: 已知限制
- `docBaseUrl`: 文档链接
- `capabilityNotes`: 能力备注

#### 板型自动检测

`POST /api/ecosystem/detect/:deviceId`:
- SSH 执行 `buildBoardDetectionCommand()`
- 读取 device-tree model、board_id、OS 版本、BPU 信息
- `parseBoardDetection(output)` 匹配 `detectionPatterns`
- 返回检测到的 `RdkPlatform`

---

### 2.5 技能分发 (Skill Provisioner)

**文件**: `server/ecosystem/skill-provisioner.ts`

将生态注册表中的任意 `EcoSkill` 转化为板端 OpenClaw 可识别的 SKILL.md 并部署。

#### Provision 流程

```
POST /api/ecosystem/skills/:id/provision
  │
  ├─ validateProvision(skill, platform)     // 校验平台兼容性
  ├─ generateSkillMd(skill)                 // 生成 SKILL.md 内容
  │   └─ YAML frontmatter + Markdown 正文
  ├─ buildProvisionCommands(skill, path)    // 构造部署命令
  │   ├─ mkdir -p /opt/openclaw/skills/<name>/
  │   ├─ heredoc 写入 SKILL.md
  │   └─ openclaw skill reload（或 clawctl skill reload）
  └─ SSH 执行命令序列
```

#### Deprovision 流程

```
POST /api/ecosystem/skills/:id/deprovision
  │
  ├─ buildDeprovisionCommands(skill)
  │   ├─ rm -rf /opt/openclaw/skills/<name>/
  │   └─ reload
  └─ SSH 执行
```

---

## 3. 安全体系

### 安全架构总览

```
请求入口
  │
  ├─ SSO 认证 (ssoAuthMiddleware)         ← 可选，SSO_REQUIRED=1 强制
  │
  ▼
RDKClaw.streamChat
  │
  ├─ 工具组装时: wrapToolWithApproval()
  │   │
  │   ├─ permissionGuard.evaluate()       ← 权限守卫
  │   ├─ channelSafety.check()            ← 通道安全（外部通道）
  │   └─ policyStore.getApprovalMode()    ← 策略配置
  │
  ▼
工具执行前
  │
  ├─ blocked → 拒绝执行 + 审计日志
  ├─ risk: high + 需审批 → 发送 approval 事件 → 等待用户决策
  └─ auto_allow → 直接执行 + 审计日志
```

### 3.1 SSO 认证

**文件**: `server/sso.ts`

| 配置 | 说明 |
|------|------|
| `SSO_BASE_URL` | D-Robotics SSO 地址（默认 `https://sso.d-robotics.cc`） |
| `SSO_CLIENT_ID` | OAuth2 客户端 ID |
| `SSO_CLIENT_SECRET` | OAuth2 客户端密钥 |
| `SSO_REQUIRED` | 设为 `1` 则强制所有 `/api/*` 请求需认证 |

#### 认证流程

```
1. GET /api/sso/login → 返回登录 URL + 状态信息
2. 用户在 SSO 页面登录
3. SSO 回调 → GET /api/sso/callback → 验证 code → 获取用户信息
4. 设置 rdk_sso_session Cookie (HttpOnly, SameSite=Lax)
5. 后续请求携带 Cookie → ssoAuthMiddleware 验证
```

#### 会话管理

- 内存 Map 存储会话
- 定期清理过期会话
- 豁免路径: `/api/sso/*`, `/api/health`

---

### 3.2 权限守卫

**文件**: `server/rdkclaw/permission-guard.ts`

`evaluatePermissionGuard(toolName, args, channel)` 返回 `blocked` 或 `risk` 级别。

#### 检测规则

| 规则类别 | 检测内容 | 结果 |
|---------|---------|------|
| 危险命令 | `rm -rf /`, `dd if=`, `mkfs`, 烧录命令 | `blocked` |
| 宿主机污染 | `exec` 工具对宿主机执行写操作 | `risk: high` |
| 写保护路径 | 写入 `/etc/fstab`, `/boot`, 关键系统目录 | `blocked` |
| 板端路径 | `device_file_write` 写入非白名单路径 | `risk: high` |
| 上传路径 | `device_file_upload_from_local` 目标路径检查 | `risk: medium` |
| 外部通道提升 | 非 studio 通道的 `exec` 类操作 | 风险等级上调 |

---

### 3.3 审批流

#### 审批触发条件

| 通道 | 条件 | 审批方式 |
|------|------|---------|
| Studio (Web/Electron) | `risk: high` 且审批模式非 `auto` | UI `approval` 卡片（批准/拒绝按钮） |
| 飞书 | `channel-safety` 策略的 `force_approval` + 权限守卫 | 飞书消息内自然语言审批 |
| 微信 | 同上 | 微信消息内自然语言审批 |

#### 审批流程

```
工具准备执行
  │
  ▼
checkToolApproval(tool, args)
  │
  ├─ 白名单命中 → 直接放行
  ├─ 不需审批 → 直接放行
  │
  └─ 需要审批
      │
      ├─ 发送 tool_approval_request 事件
      │   (包含工具名、参数、风险等级、原因)
      │
      ├─ Web: 前端渲染 approval 卡片
      │   飞书/微信: 发送审批文本消息
      │
      ├─ 等待用户决策...
      │
      ├─ 批准 → tool_approval_resolved(approved)
      │   └─ AllowlistManager 记住该工具（可选）
      │
      └─ 拒绝 → tool_approval_resolved(rejected)
          └─ 返回拒绝 tool_result 给 LLM
```

#### 自然语言审批

`channel-safety.ts` — `matchTextApproval(text)`:

| 语言 | 批准关键词 | 拒绝关键词 |
|------|----------|----------|
| 中文 | 同意、批准、允许、确认、可以、行、好的 | 拒绝、不行、不允许、取消、否 |
| 英文 | approve, allow, yes, confirm, ok | reject, deny, no, cancel |

---

### 3.4 通道安全

**文件**: `server/rdkclaw/channel-safety.ts`

外部通道（飞书/微信）相比 Studio 有更严格的安全策略：

#### 工具级策略 (`getExternalChannelPolicy`)

| 策略 | 工具 | 说明 |
|------|------|------|
| `block` | `sessions_spawn` | 外部通道禁止生成子代理 |
| `force_approval` | `exec`, `device_exec`, `write`, `edit` | 写操作类工具强制审批 |
| `force_approval` | `device_file_write`, `device_file_upload_from_local` | 文件写入强制审批 |
| `force_approval` | 名称启发式匹配（含 delete/remove/restart 等） | 破坏性操作强制审批 |

#### 文件分类 (`classifyFileKind`)

按扩展名分类，用于附件处理：
- `image`: jpg, png, gif, webp, bmp, svg
- `video`: mp4, webm, avi, mov, mkv
- `document`: pdf, doc, docx, xls, xlsx, ppt, pptx, txt, md, csv

---

### 3.5 安全审计

**文件**: `server/rdkclaw/security-audit-store.ts`

#### 审计记录类型

| 类型 | 说明 |
|------|------|
| `blocked` | 被权限守卫拦截 |
| `auto_allow` | 策略允许自动执行 |
| `approval_required` | 触发审批流 |
| `approval_decision` | 用户做出审批决策 |

#### 存储规格

- 路径: `~/.rdkstudio/rdkclaw-security-audit.json`
- 容量: 最多保留 **500 条**
- 字段: 时间戳、工具名、参数、通道、风险等级、决策结果

#### API

| 端点 | 功能 |
|------|------|
| `GET /api/rdkclaw/security-audit` | 查询审计日志 |
| `POST /api/rdkclaw/security-audit/clear` | 清空审计日志 |

---

## 4. 自治调度

**文件**: `server/rdkclaw/autonomy-scheduler.ts`

自治调度允许创建定时/周期性任务，Agent 按计划自动执行，无需用户实时在线。

### 任务定义

```typescript
interface AutonomyTask {
  id: string;
  name: string;
  description: string;
  mode: 'interval' | 'cron';
  interval?: number;            // 秒（mode=interval 时）
  cron?: string;                // 5 字段 cron 表达式（mode=cron 时）
  message: string;              // 发给 Agent 的消息
  requiresApproval: boolean;    // 每次执行前是否需审批
  status: TaskStatus;
  failCount: number;
  lastRunAt?: string;
  lastResult?: string;
}

type TaskStatus =
  | 'active'
  | 'paused'
  | 'stopped'
  | 'pending_approval'
  | 'circuit_open';
```

### 执行机制

```
AutonomyScheduler.tick()（每秒触发）
  │
  ├─ 遍历 active 任务
  ├─ 检查是否到达执行时间（interval 或 cron 匹配）
  │
  ├─ requiresApproval → 状态设为 pending_approval → 等待
  │
  └─ 执行:
      ├─ RDKClawApp.streamChat({ sessionKey: "auto:<taskId>", userId: "autonomy" })
      ├─ 从 meta 事件取 runId（支持 cancelRun）
      │
      ├─ 成功 → failCount 重置
      └─ 失败 → failCount++
           └─ failCount >= 3 → circuit_open（熔断）
```

### 熔断机制

连续失败 3 次后进入 `circuit_open` 状态，停止自动执行。需手动 resume 恢复。

### 通知

通过 `NotificationHub` 推送以下事件到 Web 前端（Socket.IO `rdkclaw:notify`）：
- 任务开始执行
- 任务成功完成
- 任务执行失败
- 任务被停止/暂停

### 持久化

| 文件 | 内容 |
|------|------|
| `~/.rdkstudio/rdkclaw-autonomy-tasks.json` | 任务定义列表 |
| `~/.rdkstudio/rdkclaw-autonomy-audit.jsonl` | 执行审计日志（JSONL 追加写入） |

### API

| 端点 | 功能 |
|------|------|
| `GET /api/rdkclaw/tasks` | 任务列表 |
| `POST /api/rdkclaw/tasks` | 创建任务 |
| `POST /api/rdkclaw/tasks/:id/approve` | 审批待执行任务 |
| `POST /api/rdkclaw/tasks/:id/pause` | 暂停任务 |
| `POST /api/rdkclaw/tasks/:id/stop` | 停止任务 |
| `POST /api/rdkclaw/tasks/:id/resume` | 恢复任务（含熔断恢复） |

---

## 5. LLM Token 监控

**文件**: `server/monitoring/token-usage.ts`

### 功能

- 每次 Agent 调用完成后记录 token 使用情况
- 存储至 `data/llm-token-usage.json`
- 最多保留约 **4000 条**记录

### 数据结构

```typescript
interface TokenUsageEntry {
  timestamp: string;
  source: 'rdkclaw' | 'openclaw';
  deviceId?: string;
  sessionId?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;        // 是否为估算值
  success: boolean;
}
```

### API

| 端点 | 功能 |
|------|------|
| `GET /api/token-usage/report` | 获取 token 用量报告 |
| `POST /api/token-usage/reset` | 重置用量统计 |

---

## 6. 部署形态

### 6.1 Web 开发模式

```bash
npm run dev
```

- 前端: Vite dev server 在 `:5173`
- 后端: Node.js 在 `:8787`
- 代理: Vite 将 `/api` 请求代理到 `http://localhost:8787`
- 适用: 本地开发调试

### 6.2 Electron 桌面应用

```bash
npm run desktop
```

- 使用 `concurrently` 同时启动 server + client + electron
- Electron 等待前后端就绪后再加载窗口（`scripts/wait-and-launch.mjs`）
- 打包: `electron-builder`，appId `com.rdk.studio`
- 支持平台: Windows / macOS / Linux

#### 桌面端打包内容

| 内容 | 说明 |
|------|------|
| `dist/` | Vite 构建的前端静态文件 |
| `dist-server/` | TypeScript 编译后的服务端代码 |
| `data/` | 数据文件（devices.json, ecosystem-registry.json 等） |
| `agent/` | Agent 人格文件（SOUL.md, TOOLS.md 等） |
| `skills/` | 技能定义（28 个 SKILL.md） |
| `electron/` | Electron 主进程代码 |

#### 桌面端特有能力

- `window.rdkDesktop` API 桥接
- VNC/IDE 使用 `WebContentsView` 替代 iframe
- 数据目录通过 `RDK_DATA_DIR` 注入
- 视图边界动态同步

### 6.3 生产 Web 部署

```bash
npm run build    # tsc + vite build + build:server
npm start        # node dist-server/server/index.js
```

- 后端监听 `:8787`（可通过 `PORT` 环境变量配置）
- 监听地址 `0.0.0.0`（支持容器化部署）

### 6.4 构建脚本

| 脚本 | 用途 |
|------|------|
| `build:desktop:win` | Windows 桌面端打包 |
| `build:desktop:mac` | macOS 桌面端打包 |
| `build:desktop:linux` | Linux 桌面端打包 |
| `verify:desktop:smoke:*` | 桌面端冒烟测试 |
| `verify:desktop:manifest` | 发布清单验证 |
| `verify:modules` | 全模块验证脚本 |

---

## 7. 环境变量与配置

### 核心环境变量

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `PORT` | 后端监听端口 | `8787` |
| `OPENAI_BASE_URL` | LLM API 地址 | — |
| `OPENAI_API_KEY` | LLM API 密钥 | — |
| `OPENAI_MODEL` | 默认模型名 | — |
| `SSO_BASE_URL` | SSO 服务地址 | `https://sso.d-robotics.cc` |
| `SSO_CLIENT_ID` | OAuth2 客户端 ID | — |
| `SSO_CLIENT_SECRET` | OAuth2 客户端密钥 | — |
| `SSO_REQUIRED` | 是否强制 SSO | `0` |
| `RDK_DATA_DIR` | 数据目录路径 | `./data`（Electron 会注入） |
| `RDK_SSH_PASSWORD` | 全局 SSH 默认密码 | — |

### 用户级配置文件

所有用户配置存储在 `~/.rdkstudio/` 目录：

| 文件 | 内容 |
|------|------|
| `agent-config.json` | LLM Provider 配置（多厂商） |
| `rdkclaw-persona.json` | 全局人格配置 |
| `rdkclaw-users.json` | 用户画像列表 |
| `rdkclaw-policy.json` | 策略配置（审批模式、权限等） |
| `feishu-auth.json` | 飞书认证与绑定 |
| `feishu-config.json` | 飞书运行时配置 |
| `weixin-accounts.json` | 微信账号列表 |
| `weixin-config.json` | 微信通道配置 |
| `forum-auth.json` | 论坛认证凭据 |
| `rdkclaw-security-audit.json` | 安全审计日志 |
| `rdkclaw-autonomy-tasks.json` | 自治任务定义 |
| `rdkclaw-autonomy-audit.jsonl` | 自治任务执行日志 |

---

*本文档为 PRD 系列第 3 部分，详见：*
- *[prd-01-product-overview.md](prd-01-product-overview.md) — 产品概述与功能模块*
- *[prd-02-agent-system.md](prd-02-agent-system.md) — Agent 系统深度解析*
- *[prd-04-api-reference.md](prd-04-api-reference.md) — API 端点与数据模型*
