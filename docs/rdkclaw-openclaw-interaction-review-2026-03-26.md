# RDKClaw × OpenClaw 交互链路审查与优化方案（2026-03-26）

## 1. 背景与目标

你的目标是：让 **RDKClaw 能持续“教会”OpenClaw**，而不只是一次性委派执行。

本文分两部分：
1. 现有链路（当前系统实际如何运行）
2. 可行优化方案（如何把“协同”升级为“教学闭环”）

---

## 2. 当前链路（As-Is）

### 2.1 主入口：Studio 聊天统一走 RDKClaw SSE

- 前端主聊天流通过 `/api/agent/chat` 建立 SSE，事件类型包含 `queue_status`、`run_progress`、`tool_*`、`run_complete` 等。
- 后端 `/api/agent/chat` 会把请求转发到 `rdkclaw.streamChat(...)`，形成统一执行与回流。

关键代码：
- `src/api.ts` 中 `streamAgentChat`（SSE 客户端）
- `server/index.ts` 中 `app.post('/api/agent/chat', ...)`
- `server/rdkclaw/app.ts` 中 `streamChat`

### 2.2 并发与排队：按设备串行

- `RDKClawApp.streamChat` 先按 `deviceLane` 查询队列状态，如已有任务会先发 `queue_status`。
- 随后通过 `DeviceQueue.acquireSlot(...)` 获取设备级独占槽位，保证同一设备严格串行。

关键代码：
- `server/rdkclaw/app.ts`（`queue_status`、`acquireSlot`）
- `server/rdkclaw/device-queue.ts`（设备级队列）

### 2.3 决策层：本地执行 / 协同 / 板端优先

- 委派策略由 `selectDelegateDecision(...)` 决定：`local_only` / `collaborative` / `board_primary`。
- 决策依据包括：用户 mode、匹配技能策略、板端技能快照。

关键代码：
- `server/rdkclaw/delegation.ts`
- `server/rdkclaw/app.ts`（system prompt 构建与决策注入）

### 2.4 OpenClaw 的角色：被调用执行体（而非主脑）

系统提示明确了定位：
- RDK Studio Claw 是主体编排 Agent
- 板端 OpenClaw 是可调用能力

关键代码：
- `server/skill-loader.ts`（`buildSkillContext`）

### 2.5 板端协同机制（已具备）

- `board_openclaw_assess`：先评估板端可用性
- `board_openclaw_delegate`：携带 `intent/task/context/guidance` 委派
- `board_openclaw_chat`：可继续会话补充信息

此外已支持“反向求助协议”：
- OpenClaw 在回复中可发 `[NEED_RDKCLAW]...[/NEED_RDKCLAW]`
- RDKClaw 接到后可再用本地工具（web_search/ecosystem）补充信息回传

关键代码：
- `server/rdkclaw/tools/board-openclaw-delegate.ts`
- `server/rdkclaw/system-prompt-builder.ts`

### 2.6 多渠道接入：Studio / 飞书 / 微信

- 飞书 webhook 入站 `/api/channels/feishu/webhook`，含鉴权/去重/绑定流程。
- 飞书、微信通道都走 `rdkclaw.streamChat`，共享核心执行链。

关键代码：
- `server/index.ts`（Feishu webhook + runtime/config API）
- `server/rdkclaw/feishu-channel-adapter.ts`
- `server/agent/channels/feishu.ts`
- `server/agent/channels/weixin.ts`

### 2.7 OpenClaw 面板与 AIDock 的关系

- AIDock 有 `dockOcMode` 切换：可直发 OpenClaw，也可走 RDKClaw 主链。
- 注释中已明确推荐：主链路统一走 RDKClaw（OpenClaw 作为服务端可调用能力）。

关键代码：
- `src/components/AIDock.tsx`
- `src/components/OpenClaw.tsx`

---

## 3. 与 OpenClaw 最新机制对照（openclaw-mini-main）

`openclaw-mini-main` 体现了“生产型 Agent”的关键机制：

1. 双层循环（outer follow-up + inner tools/steering）
   - `openclaw-mini-main/src/agent-loop.ts`
2. Gateway 控制面（WS challenge 握手、广播、背压）
   - `openclaw-mini-main/src/gateway/server.ts`
3. Skill 编排层（frontmatter、invocation policy、命令匹配）
   - `openclaw-mini-main/src/skills.ts`
4. Heartbeat 唤醒合并与调度
   - `openclaw-mini-main/src/heartbeat.ts`

你当前仓库已经吸收了不少机制（设备队列、SSE事件、多渠道、审批等），**短板不在“能不能协同”，而在“如何持续教学并固化到板端能力”**。

---

## 4. 核心缺口（Why 还没“教会”）

1. **缺少教学资产模型**
   - 目前有委派与 guidance，但没有“教学单元/课程卡”的结构化对象。

2. **缺少教学结果写回链路**
   - OpenClaw 成功执行后，经验没有自动提炼为可安装技能或可复用模板。

3. **缺少教学验证闭环**
   - 没有“教完再考”流程（回放任务验证、成功率统计、回滚）。

4. **缺少跨会话教学记忆索引**
   - 有记忆能力，但未针对“教学成果”建立专门索引与检索权重。

---

## 5. 可行优化方案（To-Be）

## 5.1 P0：教学闭环 MVP（先做这个）

目标：先打通“教一次 -> 学会一次 -> 可验证一次”。

### 新增能力

1. `teach_openclaw_skill` 工具（RDKClaw 侧）
- 输入：
  - task_pattern
  - prerequisites
  - recommended_steps
  - fallback_steps
  - verify_commands
- 输出：教学提案 ID（待确认）

2. 教学提案确认流
- 复用你现有审批机制（approval/recommendation UI）
- 用户确认后才写入板端

3. 板端落地器
- 将教学提案渲染为板端技能包（SKILL.md + 必要脚本）
- 通过已存在的 OpenClaw 管理/委派链推送安装

4. 自动回放验证
- 教学完成后自动发起 1 次验证任务
- 记录结果：成功/失败、耗时、是否需要 RDKClaw 补给

### 数据结构建议

新增 `data/openclaw-teaching-log.json`（或 server-side store）字段：
- teachId
- sourceRunId
- targetDeviceId
- skillName
- status (proposed/installed/verified/failed)
- verifyReport
- updatedAt

---

## 5.2 P1：教学增强（可复用、可推荐）

1. 教学模式触发器
- 当 `board_openclaw_delegate` 连续 N 次处理同类任务成功，触发“建议固化技能”。

2. 教学质量评分
- 维度：成功率、平均耗时、补给轮次、失败恢复率。

3. 生态映射
- 与 `ecosystem_query` 联动：自动补全依赖信息，减少“教了但环境不满足”。

---

## 5.3 P2：多渠道一致教学体验

1. Studio/飞书/微信共享教学状态
- 任务在哪个渠道发起都可查看教学进度。

2. 教学里程碑事件标准化
- `teaching_proposed` / `teaching_installed` / `teaching_verified` / `teaching_failed`

3. 对外回执统一模板
- 防止渠道间信息丢失或解释不一致。

---

## 6. 建议实施顺序（低风险高收益）

1. 先做 P0（MVP）：教学提案 + 安装 + 回放验证
2. 再做 P1：自动触发与评分
3. 最后做 P2：多渠道一致化展示

理由：
- 你现有链路已经足够支持“执行与回传”，P0 只需补“教学资产 + 验证闭环”。
- 这是最短路径把“会做事”变成“教会了”。

---

## 7. 可直接落地的第一批开发项（建议）

1. 后端
- 新增 `server/rdkclaw/tools/teach-openclaw-skill.ts`
- 在 `server/rdkclaw/app.ts` 注册该工具并接入审批事件
- 新增 teaching log 存储模块

2. 前端
- 在现有 AIDock 事件流中增加 teaching 事件渲染卡片
- 在 OpenClaw 面板增加“已教学技能”列表与验证状态

3. 板端桥接
- 在 `board_openclaw_delegate` 成功路径追加“是否固化教学”判断
- 失败路径保留降级与回滚建议

---

## 8. 风险与控制

1. 风险：误教学（把偶发方案固化）
- 控制：至少 2 次成功 + 用户确认后才能固化。

2. 风险：板端能力漂移（版本更新后失效）
- 控制：周期性回放验证，失败自动标记 stale。

3. 风险：跨渠道状态不一致
- 控制：以 runId/sessionId 为统一主键，所有渠道只读同一状态源。

---

## 9. 一句话结论

你们现在已经有“协同执行”能力；要实现“rdkclaw 教会 openclaw”，核心是补上 **教学资产化 + 写回安装 + 回放验证** 三件事。建议先做 P0 MVP，两周内就能看到“学会了并可复现”的效果。
