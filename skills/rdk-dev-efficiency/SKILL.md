---
name: RDK Dev Efficiency
description: 开发者效率：结构化排障、错误恢复、安全并行、多方案/审批交互、复杂任务用 create_plan/update_plan。合并原 error-recovery / problem-analysis / parallel-ops / interactive-workflow。
version: 2.0.0
trigger: 命令失败,SSH断开,超时,恢复,recovery,排查问题,设备异常,为什么不工作,troubleshoot,并行,同时,batch,交互,确认,选择,审批,多步骤,create_plan,执行计划
risk: medium
permissions: device_exec,network
delegate_preference: local
requires_board: false
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Meta
---

# RDK 开发者效率（排障 · 并行 · 交互 · 计划）

## 1. 结构化排障（原 problem-analysis）

用户说「不工作 / 异常」时：

1. **收集**（≤3 步）：`device_diagnose`；需要 JSON 或明确排障时再 `board_openclaw_health`；日常可看 `board_openclaw_status`。
2. **假设**（≤3 个）：按概率排序，每个给一条验证命令。
3. **验证**：从最可能开始；排除后再扩大范围（日志、`device_file_read`、delegate）。

输出必须含：**根因一句**、**修复动作**、**验证方法**。

## 2. 错误恢复（原 error-recovery）

| 现象 | 处理 |
|------|------|
| SSH 断连 / `ECONNREFUSED` | 等 3s 重试 1 次；仍失败则提示查网络/SSH，不无限重试 |
| 命令超时 | 查是否交互式命令；`ps` 查残留；必要时 kill 再试 |
| OpenClaw 无响应 | `restart_gateway` → 短等待 → `health` 验收；仍失败 `doctor`；最后才考虑重装 |
| `command not found` / `Permission denied` / `No such file` | 查 PATH/sudo/路径 |

原则：每类错误最多 **2** 次盲目重试；恢复后用对应工具验证；**不对** `rm`/`dd` 等破坏性命令自动重试。

## 3. 并行（原 parallel-ops）

- 只读、无依赖的步骤可并行：`device_diagnose` + `board_openclaw_status`（推荐日常）；需 JSON 时再考虑 `health`。
- 多文件只读可并行 `device_file_read`。
- **必须串行**：安装→重启→验证；写后读；doctor→重启→health。

## 4. 交互（原 interactive-workflow）

- 多等价方案 → 列出 2～4 个选项 + 推荐理由，等用户选择或「用推荐」。
- 有风险操作 → 说明风险与范围，走审批。
- 已明确「自动执行」→ 不重复确认。

## 5. 计划工具（复杂任务）

- 3+ 步骤或多方协作：用 **`create_plan`** 落 Markdown 计划，步骤中可标注预期工具名。
- 执行中用 **`update_plan`** 更新每步状态（in_progress / done / failed）。

## 工具速查

| 用途 | 工具 |
|------|------|
| 排障基线 | `device_diagnose`、`board_openclaw_status` / `health` |
| 深度 | `board_openclaw_logs`、`device_exec`、`board_openclaw_delegate` |
| 资料 | `web_search` / `web_fetch` |
| 长任务计划 | `create_plan`、`update_plan` |

## 禁止事项

- 跳过收集直接猜根因。
- 有依赖关系的步骤强行并行。
- 低风险操作滥用审批或 health。
