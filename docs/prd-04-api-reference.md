# RDK Studio 产品需求文档 — API 端点与数据模型

> 版本: 1.0 | 日期: 2026-03-25 | 状态: 初稿

---

## 目录

- [1. API 总览](#1-api-总览)
- [2. 设备管理 API](#2-设备管理-api)
- [3. 设备操作 API](#3-设备操作-api)
- [4. OpenClaw 管理 API](#4-openclaw-管理-api)
- [5. Agent 聊天 API](#5-agent-聊天-api)
- [6. RDKClaw 配置 API](#6-rdkclaw-配置-api)
- [7. 飞书集成 API](#7-飞书集成-api)
- [8. 微信集成 API](#8-微信集成-api)
- [9. 板卡探测与设备扩展 API](#9-板卡探测与设备扩展-api)
- [10. 自治调度 API](#10-自治调度-api)
- [11. 认证与运维 API](#11-认证与运维-api)
- [12. WebSocket / Socket.IO 协议](#12-websocket--socketio-协议)
- [13. 数据持久化模型](#13-数据持久化模型)
- [14. 前端类型定义](#14-前端类型定义)

---

## 1. API 总览

### 基础信息

| 项目 | 值 |
|------|-----|
| 基础路径 | `http://localhost:8787` |
| 内容类型 | `application/json`（body 限制 50MB） |
| 认证 | Cookie `rdk_sso_session`（SSO 开启时） |
| 设备密码 | 请求头 `x-device-password` |
| CORS | `credentials: true, origin: true` |

### 全局中间件

1. `cors` — 允许跨域，携带凭据
2. `express.json({ limit: '50mb' })` — JSON 解析
3. `ssoAuthMiddleware`（可选）— SSO 认证
4. 错误处理 — `sendApiError(res, statusCode, message)`

### API 前缀分类

| 前缀 | 模块 |
|------|------|
| `/api/devices` | 设备管理与操作 |
| `/api/agent` | Agent 聊天与配置 |
| `/api/rdkclaw` | RDKClaw 业务配置 |
| `/api/channels` | 外部通道 Webhook |
| `/api/sso` | 认证 |
| `/api/skills` | 本地技能 |
| `/api/apps` | One-shot 应用生成 |
| `/api/token-usage` | Token 监控 |

> **说明**：历史版本中的 `/api/ecosystem` 前缀已不再挂载；板型与「生态」类能力见 [第 9 节](#9-板卡探测与设备扩展-api)。

---

## 2. 设备管理 API

### GET /api/devices

获取已保存的设备列表。

**响应**: `Device[]`（密码字段已脱敏）

```json
[
  {
    "id": "abc123",
    "name": "RDK-X5",
    "ip": "192.168.127.10",
    "port": 22,
    "status": "connected",
    "description": "工位1 X5开发板"
  }
]
```

### POST /api/devices/connect

连接设备（SSH 验证 + 保存）。

**请求体**:

```json
{
  "host": "192.168.127.10",
  "port": 22,
  "username": "sunrise",
  "password": "sunrise",
  "name": "RDK-X5"
}
```

**响应**: 连接成功的 `Device` 对象

### POST /api/devices/verify

验证已保存设备的 SSH 连接。

**请求体**: `{ "deviceId": "abc123" }`

### GET /api/devices/:id/ping

探活设备（SSH 快速连接测试）。

### DELETE /api/devices/:id

删除设备。

### POST /api/devices/scan

局域网扫描 RDK 设备。

**响应**: 发现的设备候选列表

---

## 3. 设备操作 API

所有设备操作 API 路径格式为 `/api/devices/:id/...`，需在请求头中携带 `x-device-password`。

### 远程命令

#### POST /api/devices/:id/exec

在设备上执行 shell 命令。

**请求体**: `{ "command": "ls -la /opt/" }`

**响应**: `{ "stdout": "...", "stderr": "...", "exitCode": 0 }`

#### POST /api/devices/:id/batch-exec

批量执行多条命令。

**请求体**: `{ "commands": ["cmd1", "cmd2"] }`

### 文件操作

#### GET /api/devices/:id/files/list

列出设备目录内容。

**查询参数**: `?path=/home/sunrise/`

#### GET /api/devices/:id/files/read

读取设备文件内容。

**查询参数**: `?path=/home/sunrise/test.py`

#### POST /api/devices/:id/files/write

写入设备文件。

**请求体**: `{ "path": "/home/sunrise/test.py", "content": "..." }`

#### POST /api/devices/:id/files/upload

上传文件到设备。

**请求体**: FormData（multipart/form-data）

#### GET /api/devices/:id/files/download

从设备下载文件。

**查询参数**: `?path=/home/sunrise/output.jpg`

### 诊断

#### GET /api/devices/:id/diagnostics

获取设备硬件诊断信息（CPU 温度、内存、磁盘等）。

#### GET /api/devices/:id/workspace/health

获取工作区健康状态（IDE/VNC/ROS 等模块是否可用）。

### ROS

#### GET /api/devices/:id/ros/topics

列出 ROS2 话题。

#### GET /api/devices/:id/ros/nodes

列出 ROS2 节点。

#### POST /api/devices/:id/ros/record/start

开始录制 ROS 话题数据。

#### POST /api/devices/:id/ros/record/stop

停止录制。

### 服务管理

#### POST /api/devices/:id/services/vnc/start|stop

启动/停止 VNC 服务。

#### POST /api/devices/:id/services/node-red/start|stop

启动/停止 Node-RED 服务。

### 烧录

#### POST /api/devices/:id/flash/execute

执行系统镜像烧录。

#### GET /api/devices/:id/flash/backup/*

备份相关操作。

---

## 4. OpenClaw 管理 API

所有端点路径格式: `/api/devices/:id/openclaw/...`

### 生命周期

| 端点 | 方法 | 功能 |
|------|------|------|
| `/check` | GET | 检查 OpenClaw 是否已安装 |
| `/prepare` | POST | 安装前准备（依赖检查等） |
| `/install` | POST | 安装 OpenClaw |
| `/install-stream` | POST | 流式安装（SSE 返回进度） |
| `/deploy/start` | POST | 启动部署（网关） |
| `/deploy/status` | GET | 部署状态查询 |
| `/upgrade` | POST | 升级 OpenClaw |
| `/uninstall` | POST | 卸载 OpenClaw |
| `/restart-gateway` | POST | 重启 OpenClaw Gateway |

### 状态与诊断

| 端点 | 方法 | 功能 |
|------|------|------|
| `/status` | GET | 综合状态查询 |
| `/health` | GET | 健康检查（JSON 结构化） |
| `/doctor` | POST | 自动诊断与修复 |
| `/version` | GET | 版本信息 |
| `/logs` | GET | 运行日志 |
| `/model-test` | POST | 模型连通性测试 |

### 配置

| 端点 | 方法 | 功能 |
|------|------|------|
| `/config` | GET | 获取网关配置 |
| `/config` | POST | 更新网关配置 |
| `/onboard` | POST | 初始配置（首次部署后） |
| `/wifi` | POST | WiFi 配置 |

### 技能

| 端点 | 方法 | 功能 |
|------|------|------|
| `/skills` | GET | 已安装技能列表 |
| `/skill-content` | GET | 获取指定技能内容 |
| `/pairing` | POST | OpenClaw 配对 |

### 脚本与一键安装

| 端点 | 方法 | 功能 |
|------|------|------|
| `/script-install` | POST | 通过脚本安装 OpenClaw |

---

## 5. Agent 聊天 API

### POST /api/agent/chat

主聊天端点（SSE 流式响应）。

**请求体**:

```json
{
  "message": "帮我查一下设备温度",
  "deviceId": "abc123",
  "mode": "auto",
  "attachments": [
    {
      "type": "image",
      "name": "screenshot.png",
      "data": "base64...",
      "mimeType": "image/png"
    }
  ],
  "channel": "studio"
}
```

**SSE 事件流**:

| 事件类型 | 数据 | 说明 |
|---------|------|------|
| `text` | `{ delta: "..." }` | 文本增量 |
| `thinking` | `{ delta: "..." }` | 思考过程增量 |
| `tool_start` | `{ tool: "device_exec", args: {...} }` | 工具开始执行 |
| `tool_end` | `{ tool: "device_exec", result: "..." }` | 工具执行完成 |
| `approval` | `{ approvalId, tool, args, risk }` | 需要审批 |
| `recommendation` | `{ recommendationId, question, options }` | 方案推荐 |
| `soul_update` | `{ proposalId, section, action, content, reason }` | 人格更新提议 |
| `progress` | `{ steps: [...] }` | 进度更新 |
| `queue_status` | `{ position, total }` | 队列状态 |
| `meta` | `{ runId, sessionKey, delegate, ... }` | 元信息 |
| `done` | `{ tokens, duration, ... }` | 完成信息 |
| `error` | `{ message }` | 错误 |

### POST /api/agent/plan

规划类请求（带超时配置）。

### GET /api/agent/config

获取 LLM Provider 配置。

### POST /api/agent/config

更新 LLM Provider 配置。

### GET /api/agent/config/export

导出完整配置（用于备份/迁移）。

### POST /api/agent/config/import

导入配置。

### POST /api/chat

旧版直通聊天（直接调上游 `chat/completions`）。

---

## 6. RDKClaw 配置 API

### 人格

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/rdkclaw/persona` | GET | 获取当前人格配置 |
| `/api/rdkclaw/persona` | POST | 更新人格配置 |

**PersonaProfile 结构**:
```json
{
  "name": "小地瓜",
  "personality": "聪明、可靠、轻松有梗",
  "style": "中文为主，首句给结论",
  "rules": ["先动手再解释", "有证据说话"]
}
```

### 策略

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/rdkclaw/policy` | GET | 获取策略配置 |
| `/api/rdkclaw/policy` | POST | 更新策略配置 |

**RDKClawPolicy 结构**:
```json
{
  "approvalMode": "auto",
  "memoryEnabled": true,
  "networkEnabled": true,
  "contextMaxTokens": 128000,
  "pruningStrategy": "balanced"
}
```

### 审批决策

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/rdkclaw/approvals/:approvalId/decision` | POST | 对审批做出决策 |

**请求体**: `{ "approved": true }`

### Soul 更新决策

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/rdkclaw/soul-updates/:proposalId/decision` | POST | 对人格更新提议做出决策 |

**请求体**: `{ "accepted": true }`

### 任务取消

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/rdkclaw/runs/:runId/cancel` | POST | 取消正在执行的 Agent 任务 |

### 会话与设备同步

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/rdkclaw/session/active` | POST | 设置飞书侧最新 UI 会话 |
| `/api/rdkclaw/device/active` | POST | 设置飞书侧最新活动设备 |

### 安全审计

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/rdkclaw/security-audit` | GET | 查询审计日志 |
| `/api/rdkclaw/security-audit/clear` | POST | 清空审计日志 |

### 论坛认证

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/rdkclaw/forum/auth` | GET | 获取论坛认证信息（脱敏） |
| `/api/rdkclaw/forum/auth` | POST | 设置论坛认证凭据 |
| `/api/rdkclaw/forum/auth/clear` | POST | 清除论坛认证 |

### 用户管理

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/rdkclaw/users/:userId` | GET | 获取用户画像 |
| `/api/rdkclaw/users/:userId` | POST | 更新用户画像 |

### 内部技能

| 端点 | 方法 | 功能 | 备注 |
|------|------|------|------|
| `/api/rdkclaw/skills` | GET | 获取已加载技能列表 | `x-rdk-internal-api` |
| `/api/rdkclaw/skills` | POST | 更新技能配置 | 内部 API |
| `/api/rdkclaw/skills/reload` | POST | 重新加载技能 | 内部 API |

---

## 7. 飞书集成 API

### 认证与配对

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/rdkclaw/feishu/auth/bind` | POST | 绑定配对码 |
| `/api/rdkclaw/feishu/auth/bound` | GET | 查询绑定状态 |
| `/api/rdkclaw/feishu/pairing/requests` | GET | 待审批配对请求 |
| `/api/rdkclaw/feishu/pairing/approve` | POST | 审批通过配对 |
| `/api/rdkclaw/feishu/pairing/reject` | POST | 拒绝配对 |

### 配置与运行时

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/rdkclaw/feishu/config` | GET | 获取飞书配置 |
| `/api/rdkclaw/feishu/config` | POST | 更新飞书配置 |
| `/api/rdkclaw/feishu/status` | GET | 连接状态 |
| `/api/rdkclaw/feishu/runtime` | GET | 运行时信息 |
| `/api/rdkclaw/feishu/runtime/start` | POST | 启动飞书通道 |
| `/api/rdkclaw/feishu/runtime/stop` | POST | 停止飞书通道 |
| `/api/rdkclaw/feishu/runtime/restart` | POST | 重启飞书通道 |

### Webhook 入口

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/channels/feishu/webhook` | POST | 飞书事件回调入口 |

---

## 8. 微信集成 API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/rdkclaw/weixin/config` | GET | 获取微信配置 |
| `/api/rdkclaw/weixin/config` | POST | 更新微信配置 |
| `/api/rdkclaw/weixin/status` | GET | 连接状态 |
| `/api/rdkclaw/weixin/accounts` | GET | 账号列表 |
| `/api/rdkclaw/weixin/accounts` | POST | 添加账号 |
| `/api/rdkclaw/weixin/accounts/:id` | DELETE | 删除账号 |
| `/api/rdkclaw/weixin/restart` | POST | 重启微信通道 |
| `/api/rdkclaw/weixin/login` | GET | 扫码登录（SSE 推送二维码） |
| `/api/rdkclaw/weixin/bind-start` | POST | 开始绑定流程 |

---

## 9. 板卡探测与设备扩展 API

> **与旧版差异**：集中式「生态注册表」REST（`/api/ecosystem/*`）、`server/ecosystem/*` Provider 与 `initEcosystem` 已从当前实现移除。平台能力以 **设备记录中的板卡字段**、**SSH 探测**、**RDKClaw 的 web_search / web_fetch** 以及 **板端 OpenClaw（assess / delegate）** 为准。技能说明见仓库 `skills/`（含 `rdk-ecosystem` 等）。

### 板型探测（设备域）

经 SSH 在板端执行 `server/board/device-profiles.ts` 中的 `buildBoardDetectionCommand()`，输出由 `parseBoardDetection()` 解析为 `RdkPlatform`（若可识别）。

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/devices/:id/board/detect` | POST | 返回 `platform`、`model`、`osVersion`、`researchSeeds`、原始 `output`。查询参数 **`persist=1`**（或 `true`）时合并写回 `data/devices.json`：`boardPlatform`、`boardModel`、`boardOsVersion`、`boardDetectedAt`、`researchSeeds` |

**查询参数**: `persist` — `1` / `true` 表示写回设备记录。

**响应**（节选）:

```json
{
  "ok": true,
  "platform": "rdk-x5",
  "model": "RDK X5 ...",
  "osVersion": "...",
  "researchSeeds": ["https://developer.d-robotics.cc/rdk_doc/", "https://github.com/D-Robotics"],
  "output": "...",
  "device": { "id": "...", "boardPlatform": "rdk-x5" },
  "persisted": true
}
```

### 示例应用与模型（设备域，仍提供）

与历史「生态安装」解耦；由设备 API 直接在板端执行命令或扫描路径。

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/devices/:id/examples/run` | POST | Body: `{ command }`，在设备上执行示例启动命令 |
| `/api/devices/:id/models/list` | GET | 扫描板端模型相关路径，返回列表线索 |
| `/api/devices/:id/models/deploy` | POST | Body: `{ command }`，执行模型部署类 shell |

### RDKClaw 侧（非本文件 REST 枚举）

- **联网**：`web_search`、`web_fetch`（见 `server/agent/...` 工具注册与 RDKClaw 工具层）。
- **板端编排**：`board_openclaw_chat`、`board_openclaw_assess`、`board_openclaw_delegate` 等（见 `server/rdkclaw/tools/`）。

---

## 10. 自治调度 API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/rdkclaw/tasks` | GET | 获取任务列表 |
| `/api/rdkclaw/tasks` | POST | 创建新任务 |
| `/api/rdkclaw/tasks/:id/approve` | POST | 审批待执行任务 |
| `/api/rdkclaw/tasks/:id/pause` | POST | 暂停任务 |
| `/api/rdkclaw/tasks/:id/stop` | POST | 停止任务 |
| `/api/rdkclaw/tasks/:id/resume` | POST | 恢复任务 |

**创建任务请求体**:

```json
{
  "name": "每日设备体检",
  "description": "每天早上9点检查设备健康状态",
  "mode": "cron",
  "cron": "0 9 * * *",
  "message": "请执行设备全面诊断，检查温度、磁盘、内存和 OpenClaw 状态",
  "requiresApproval": false
}
```

---

## 11. 认证与运维 API

### SSO 认证

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/sso/login` | GET | 获取 SSO 登录信息（是否启用、登录 URL） |
| `/api/sso/callback` | GET | OAuth2 回调处理 |
| `/api/sso/me` | GET | 获取当前登录用户信息 |
| `/api/sso/logout` | POST | 登出（清除会话，返回 logoutUrl） |

### 健康检查

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/health` | GET | 服务健康检查 |

### Token 用量

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/token-usage/report` | GET | 获取 token 用量报告 |
| `/api/token-usage/reset` | POST | 重置用量统计 |

### 设备调度统计

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/devices/scheduler/stats` | GET | 设备命令队列统计 |

### 本地技能

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/skills` | GET | 获取仓库技能列表 |
| `/api/skills/:name` | GET | 获取单个技能信息 |
| `/api/skills/:name/md` | GET | 获取技能 Markdown 原文 |
| `/api/skills/reload` | POST | 重新扫描技能目录 |

### One-shot 应用生成

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/apps/one-shot-generate` | POST | LLM 生成应用代码 |
| `/api/apps/one-shot-validate` | POST | 验证生成的代码 |
| `/api/apps/one-shot-run` | POST | 在设备上运行 |
| `/api/apps/one-shot-deploy` | POST | 部署到设备 |

### 本地文件服务

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/local-files/:filename` | GET | 获取本地下载/附件文件 |

### 静态资源

| 端点 | 方法 | 功能 |
|------|------|------|
| `/vnc/*` | GET | noVNC 静态文件 |
| `/quick-connect` | GET | 快速连接页面 |

---

## 12. WebSocket / Socket.IO 协议

### Socket.IO（共享 HTTP 端口 :8787）

#### 终端 (SSH PTY)

| 事件 | 方向 | 数据 | 说明 |
|------|------|------|------|
| `init` | Client→Server | `{ deviceId, password }` | 建立 SSH shell |
| `data` | 双向 | `string` | 终端数据传输 |
| `resize` | Client→Server | `{ cols, rows }` | 终端尺寸调整 |
| `disconnect` | Client→Server | — | 断开连接，清理 SSH |

#### OpenClaw 交互

| 事件 | 方向 | 数据 | 说明 |
|------|------|------|------|
| `openclaw:start` | Client→Server | `{ deviceId, ... }` | 启动 OpenClaw 交互会话 |
| `openclaw:send` | Client→Server | `{ message }` | 发送消息给板端 |
| `openclaw:stop` | Client→Server | — | 停止交互会话 |
| `openclaw:chunk` | Server→Client | `{ delta }` | 流式响应增量 |
| `openclaw:done` | Server→Client | `{ ... }` | 交互完成 |
| `openclaw:error` | Server→Client | `{ message }` | 错误 |

#### 通知广播

| 事件 | 方向 | 数据 | 说明 |
|------|------|------|------|
| `rdkclaw:notify` | Server→Client | `NotificationPayload` | RDKClaw 通知（自治任务、通道消息等） |

### 原生 WebSocket（VNC 代理）

| 路径 | 功能 |
|------|------|
| `/websockify?target=<ip>:<port>` | 浏览器 WS → 内网 VNC TCP 桥接 |

安全约束:
- 目标 IP 必须为私网地址
- 端口范围限制
- 防止 SSRF 攻击

---

## 13. 数据持久化模型

### 存储位置总览

| 数据 | 路径 | 格式 | 容量 |
|------|------|------|------|
| 设备列表 | `data/devices.json` | JSON Array | 无硬限制；含可选板卡字段见下 |
| （遗留文件） | `data/ecosystem-registry.json` | JSON | 若仓库中仍存在则为历史数据，**当前服务端不再读取或刷新** |
| Token 用量 | `data/llm-token-usage.json` | JSON Object (`{ entries }`) | ~4000 条 |
| Agent 会话 | `~/.rdkstudio/rdkclaw-workspaces/<id>/sessions/*.jsonl` | JSONL | 按会话文件 |
| Agent 记忆 | `~/.rdkstudio/rdkclaw-workspaces/<id>/memory/*.md` | Markdown | 按天 |
| 人格配置 | `~/.rdkstudio/rdkclaw-persona.json` | JSON | 单文件 |
| 用户画像 | `~/.rdkstudio/rdkclaw-users.json` | JSON | 多用户 |
| 策略配置 | `~/.rdkstudio/rdkclaw-policy.json` | JSON | 单文件 |
| 飞书认证 | `~/.rdkstudio/feishu-auth.json` | JSON | 单文件 |
| 飞书配置 | `~/.rdkstudio/feishu-config.json` | JSON | 单文件 |
| 微信账号 | `~/.rdkstudio/weixin-accounts.json` | JSON | 多账号 |
| 微信配置 | `~/.rdkstudio/weixin-config.json` | JSON | 单文件 |
| 论坛认证 | `~/.rdkstudio/forum-auth.json` | JSON | 单文件 |
| 安全审计 | `~/.rdkstudio/rdkclaw-security-audit.json` | JSON Array | 500 条上限 |
| 自治任务 | `~/.rdkstudio/rdkclaw-autonomy-tasks.json` | JSON | 任务列表 |
| 自治审计 | `~/.rdkstudio/rdkclaw-autonomy-audit.jsonl` | JSONL | 追加写入 |
| Provider 配置 | `~/.rdkstudio/agent-config.json` | JSON | LLM 厂商配置 |
| 运行时任务 | `data/runtime-jobs.json` | JSON | 烧录/部署任务状态 |

### 设备数据模型 (devices.json)

```json
{
  "id": "uuid",
  "name": "RDK-X5",
  "host": "192.168.127.10",
  "port": 22,
  "username": "sunrise",
  "password": "***",
  "status": "connected",
  "description": "工位1",
  "addedAt": "2026-03-20T10:00:00Z",
  "lastSeenAt": "2026-03-25T08:30:00Z",
  "boardPlatform": "rdk-x5",
  "boardModel": "RDK X5",
  "boardOsVersion": "Ubuntu 22.04 ...",
  "boardDetectedAt": "2026-03-27T12:00:00.000Z",
  "researchSeeds": ["https://developer.d-robotics.cc/rdk_doc/"]
}
```

字段 `boardPlatform` / `boardModel` / `boardOsVersion` / `boardDetectedAt` / `researchSeeds` 均为可选；可由 `POST /api/devices/:id/board/detect?persist=1` 写入。

### 会话 JSONL 格式 (sessions/*.jsonl)

每行一个 JSON 对象，类型由 `type` 字段区分：

```jsonl
{"type":"header","version":3,"sessionKey":"rdkclaw:user1","createdAt":"..."}
{"type":"message","role":"user","content":[{"type":"text","text":"查设备温度"}]}
{"type":"message","role":"assistant","content":[{"type":"text","text":"好的..."},{"type":"tool_use","id":"t1","name":"device_exec","input":{"command":"..."}}]}
{"type":"message","role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"..."}]}
{"type":"compaction","summary":"用户要求检查设备温度，Agent 执行了 device_exec...","messageCount":12,"compactedAt":"..."}
```

### ~~生态技能数据模型 (EcoSkill)~~（已废弃）

历史实现中 `EcoSkill` 与 `data/ecosystem-registry.json` 由 `server/ecosystem` 维护；该模块已移除。新流程下「有什么可装、怎么装」由 **官方文档/仓库（web）** + **板端实际环境（SSH / OpenClaw）** 决定，不再在 Studio 侧维护统一 JSON 注册表。若需归档旧字段定义，请参考移除前的 Git 历史。

---

## 14. 前端类型定义

### Tab 类型 (src/app-types.ts)

```typescript
type Tab =
  | 'dashboard'   // 工作台
  | 'flasher'     // 烧录工具
  | 'terminal'    // 终端
  | 'files'       // 文件管理
  | 'vnc'         // 远程桌面
  | 'ide'         // 在线 IDE
  | 'openclaw'    // OpenClaw 管理
  | 'hardware'    // 硬件监控
  | 'skills';     // 技能工坊
```

### ChatMessage 类型

```typescript
interface ChatMessage {
  id: number;
  role: 'user' | 'ai';
  text: string;
  source?: 'studio' | 'feishu';
  channelMeta?: {
    channel: 'feishu';
    direction?: 'inbound' | 'ack' | 'outbound' | 'error';
    openIdMasked?: string;
    chatId?: string;
    messageId?: string;
  };
  action?: { label: string; tab: Tab };
  blocks?: ChatBlock[];
  attachments?: ChatAttachment[];
}
```

### ChatBlock 联合类型

```typescript
type ChatBlock =
  | { type: 'code'; lang: string; content: string }
  | { type: 'image'; src: string; caption?: string }
  | { type: 'video'; src: string; caption?: string }
  | { type: 'file'; src: string; fileName: string; caption?: string }
  | { type: 'terminal'; lines: string[]; label?: string;
      collapsible?: boolean; previewLines?: number }
  | { type: 'status'; items: Array<{ label: string; value: string; ok: boolean }>;
      collapsible?: boolean; defaultCollapsed?: boolean; summary?: string }
  | { type: 'confirm'; text: string; confirmId: string }
  | { type: 'approval'; text: string; approvalId: string;
      runId?: string; risk?: 'low' | 'medium' | 'high'; executor?: string }
  | { type: 'progress';
      steps: Array<{ label: string; status: 'done' | 'running' | 'pending' }>;
      taskId?: string }
  | { type: 'task-result'; success: boolean; title: string; detail: string }
  | { type: 'recommendation'; recommendationId: string; runId?: string;
      question: string;
      options: Array<{ id: string; label: string; description: string;
                       recommended?: boolean }>;
      allowAutoExecute?: boolean; chosen?: string }
  | { type: 'soul-update'; proposalId: string; section: string;
      action: 'add' | 'modify' | 'remove'; content: string;
      reason: string; currentSnippet?: string; accepted?: boolean | null };
```

### ChatAttachment 类型

```typescript
interface ChatAttachment {
  id: string;
  type: 'image' | 'file' | 'audio' | 'video';
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
  duration?: number;
  thumbnailUrl?: string;
  transcript?: string;
  textContent?: string;
}
```

### Device 类型

```typescript
interface Device {
  id: string;
  name: string;
  status: string;
  ip: string;
  port?: number;
  description?: string;
}
```

---

*本文档为 PRD 系列第 4 部分，详见：*
- *[prd-01-product-overview.md](prd-01-product-overview.md) — 产品概述与功能模块*
- *[prd-02-agent-system.md](prd-02-agent-system.md) — Agent 系统深度解析*
- *[prd-03-integration-operations.md](prd-03-integration-operations.md) — 集成、安全与运维*
