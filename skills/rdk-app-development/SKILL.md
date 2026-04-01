---
name: RDK App Development
description: 双 Agent 协作「一句话开发机器人应用」完整工作流。RDKClaw 负责知识准备与方案编排，OpenClaw 负责板端实施，端到端完成从需求到运行的全链路。
version: 1.1.0
trigger: 做应用,开发应用,生成应用,创建应用,写应用,一句话开发,搭建项目,写一个,做一个,创建一个,开发一个,机器人应用,帮我做,帮我写,帮我开发,帮我创建,最小可运行
risk: medium
permissions: workspace_read,device_exec,network
delegate_preference: collaborative
requires_board: false
approval_level: confirm
cooldown_seconds: 0
scheduler_template: app_development
category: Development
---

# RDK 应用开发 — 双 Agent 协作工作流

## 适用场景
- 用户用自然语言描述想要的机器人应用（如"帮我做一个人脸检测应用""写一个巡线小车程序"）
- 需要 RDKClaw（Studio 端）做知识准备和方案编排，OpenClaw（板端）做代码生成、依赖安装和运行
- 涵盖从需求理解到板端运行验证的完整链路

## 前置条件
- 设备已连接（需要板端 OpenClaw 参与执行）
- 如设备未连接，先引导用户连接设备，再继续本流程

## 执行流程

### 第 0 步：板型识别（所有任务的前置步骤）

**在执行任何操作前，ALWAYS 先确认板型**。板型信息通常已在 system prompt 的设备快照中，若缺失则执行：
```bash
cat /proc/device-tree/model 2>/dev/null && cat /etc/version 2>/dev/null
```

根据板型选择对应的技术栈和模型：

| 板型 | BPU 架构 | 算力 | 系统 | ROS | 模型路径 | 推荐模型 |
|------|----------|------|------|-----|----------|----------|
| X3 | Bernoulli2 | 5T | Ubuntu 20.04 | Foxy | /opt/hobot/model/rdkx3/ | YOLOv5s, MobileNet, FCOS |
| X5 | Bayes-e | 10T | Ubuntu 22.04 | Humble | /opt/hobot/model/rdkx5/ | YOLOv5/v8, 分割, 姿态, ≤2B LLM |
| S100 | Nash-e | 80-128T | Ubuntu 22.04 | Humble | /opt/hobot/model/rdks100/ | YOLOv8x, DOSOD, LLM/VLM |

**IMPORTANT**: X3 和 X5/S100 的模型文件 `.bin` 不通用（BPU 架构不同），NEVER 混用。

### 第 1 步：需求理解 + 并行信息收集（关键！）

**目标**：在一个 turn 中同时完成知识准备和板端评估，大幅缩短准备时间。

1. 解析用户意图，提取关键词（应用类型、传感器需求、AI 能力需求）
2. **在同一轮同时发起以下工具调用**（框架会自动并行执行）：
   - `web_search`：搜索官方文档和参考实现
   - `web_fetch`：拉取关键文档/GitHub 页面正文（有 URL 时）
   - `board_openclaw_assess`：评估板端环境和能力
   - `device_diagnose`（如需）：获取设备当前资源状态

```
# 并行调用示例（在同一个 turn 中同时发起）
web_search(query="RDK X5 人脸检测 BPU 摄像头 教程")
web_fetch(url="https://...")  # 有明确文档链接时
board_openclaw_assess(task="创建并运行一个 Python 人脸检测应用")
```

3. 等所有结果回来后，综合分析：
   - web_search / web_fetch → 官方文档和代码参考
   - board_openclaw_assess → 板端能力和环境就绪度
   - 如 assess 返回 canHandle: false，根据 reason 判断：缺依赖则调整方案，能力不足则降级

> **原则**：SOUL.md 要求「先查后委」—— 不跳过知识准备直接委派。
> **并行优势**：传统串行（搜索→评估→查询）需要 3 个 turn，并行只需 1 个 turn。

> **降级路径**：若 OpenClaw 不可达，降级为 `device_exec` 直接执行简单命令，并告知用户。

### 第 2 步：方案组装（RDKClaw 本地）

**目标**：将知识准备成果整理为结构化 guidance，确保 OpenClaw 拿到充分信息。

组装 guidance 应包含以下结构：

```
## 技术方案
- 应用类型: {用户需求概要}
- 目标板型: {X3/X5/S100}（基于第 0 步识别结果）
- 推荐技术栈: {基于板型能力的推荐，如 Python + hobot_dnn}
- BPU 架构: {Bernoulli2/Bayes-e/Nash-e}（决定模型格式）
- 推荐模型: {基于板型算力的推荐}
- TROS 版本: {Foxy(X3) / Humble(X5/S100)}

## 参考资料
- 文档链接: {web_search/web_fetch 获取的关键信息}
- 代码参考: {GitHub 仓库或示例路径}

## 验收标准
- {明确的成功判定条件}
```

### 验收闭环（可演示 · 强制，针对 A/D）

委派前后都须满足，避免「做完了但用户无感」或板型错误：

1. **demo_success（用户可感知）**：用**一句白话**写清成功时长什么样（例如：窗口里能看到检测框 / 喇叭能播报 / 终端打印某一行 / 浏览器能打开某地址）。**禁止**只写「跑通 pipeline」而无现象。
2. **verify_command**：写**一条**可复制执行的验证命令（或等价 UI 操作路径），供 RDKClaw 在 `board_openclaw_delegate` 返回后**独立执行**并核对输出；不得只信板端自述。
3. **板型锁死**：guidance 中再次写明目标板型与模型路径；若 assess 与板型冲突，先纠正再委派。
4. **失败可续**：若未达 demo_success，回复须含：现象、最可能原因、**下一步一条动作**（改依赖 / 换模型 / 降级为纯 SSH），避免无意义多轮。

**板型适配要点**：
- X3：优先轻量模型，注意 2GB 内存限制，TROS 用 Foxy
- X5：可用中等模型，source `/opt/tros/humble/setup.bash`
- S100：可用大模型，多路推理，注意 Nash-e 专用模型格式

### 第 3 步：带建议委派（跨 Agent）

**目标**：将任务和完整方案交给 OpenClaw 在板端实施。

1. 调用 `board_openclaw_delegate`：
   - task: 用一句话描述核心任务
   - intent: 用户原始需求
   - context: 平台型号、环境信息
   - guidance: 第 3 步组装的完整结构化方案
2. 等待 OpenClaw 返回执行结果
3. 如果 OpenClaw 报错或部分完成，分析原因并决定：
   - 可修复 → 调整 guidance 重新委派（最多重试 1 次）
   - 不可修复 → 告知用户并给出手动操作建议

> **注意**：委派时可在 guidance 中写明建议使用的板端技能名称与路径（来自 assess/chat）。

### 第 4 步：验证回收（RDKClaw + 板端）

**目标**：不依赖 OpenClaw 自报，独立验证应用确实在运行。

1. 调用 `device_exec` 执行验证命令：
   - 检查进程: `ps aux | grep {关键进程名}`
   - 检查端口（如适用）: `ss -tlnp | grep {端口号}`
   - 检查日志（如适用）: `tail -5 {日志路径}`
2. 对比第 3 步的验收标准，判断是否达标
3. 如未达标，尝试查看错误日志定位问题

### 第 5 步：结果报告与经验沉淀

**目标**：给用户清晰的结果报告，并沉淀可复用的知识。

1. 向用户报告：
   - 应用状态（运行中/失败）
   - 部署位置（板端路径）
   - 访问方式（如有 Web 界面则给出 URL）
   - 关键技术栈和依赖
2. 如果执行成功，建议用户：
   - 如何停止/重启应用
   - 如何修改和迭代
   - 是否需要设为开机自启

## 工具映射

| 工具 | 用途 | 必需 |
|------|------|------|
| `web_search` / `web_fetch` | 搜索并拉取官方文档与仓库信息 | 是 |
| `board_openclaw_assess` | 评估板端环境和能力 | 是 |
| `board_openclaw_delegate` | 将任务和方案委派给板端 OpenClaw | 是 |
| `device_exec` | 独立验证应用运行状态 | 是 |
| `read` / `write` | 本地文件读写（如需在 Studio 端准备代码） | 否 |

## 输出要求
- 每一步完成后简要汇报进展，让用户了解当前状态
- 委派前必须说明为何需要板端执行（而非仅在 Studio 端完成）
- 验证结果必须包含可复现的命令
- 失败时给出明确的错误摘要和建议操作

## 并行执行模式

### 并行安全工具列表
以下工具可以在同一 turn 中并行调用，框架会自动识别并并行执行：
- `web_search`, `web_fetch`, `web_extract`
- `board_openclaw_assess`, `board_openclaw_chat`
- `board_openclaw_status`, `board_openclaw_logs`；`board_openclaw_health` 仅排障/验收；`board_openclaw_check` 深度体检
- `device_file_read`, `device_file_list`, `device_diagnose`
- `attachment_describe_image`, `attachment_list`, `attachment_read`
- `read`, `list`, `grep`, `memory_search`

### 推荐并行模式

**模式 A：信息收集并行（第 1 步）**
同一 turn 中同时发起 web_search + web_fetch（有 URL 时）+ board_openclaw_assess，一次性获取所有决策依据。

**模式 B：委派 + 监控并行（第 3 步后）**
委派 OpenClaw 执行后，在等待结果的同时可以：
- 用 `web_search` 预查后续可能用到的资料
- 用 `device_diagnose` 检查设备资源

**模式 C：多维验证并行（第 4 步）**
同一 turn 中同时发起多个 `device_exec` 检查进程、端口、日志。

## 禁止事项
- **不跳过知识准备直接委派**：必须先 web_search / web_fetch 了解文档与方案，并结合 assess 判断板端能力
- **不跳过评估直接委派**：必须先 board_openclaw_assess 确认板端就绪
- **不省略 guidance 中的技术方案**：guidance 不能是一句话，必须包含结构化方案
- **不跳过独立验证**：委派完成后必须用 device_exec 独立确认运行状态
- **不静默吞掉错误**：任何步骤失败都必须如实报告给用户
- **不串行执行可并行的工具调用**：信息收集阶段的工具必须并行发起
