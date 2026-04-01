---
name: RDK Board Delegate
description: 当任务需要板端真实能力（硬件操作、模型推理、TROS pipeline 等软件端无法模拟的动作）时，将任务委派给板端 OpenClaw Agent；对于简单命令执行，可直接使用 device_exec 而无需委派。
version: 1.1.0
trigger: 板端,openclaw,委派,复杂任务,插件,部署,诊断修复
risk: high
permissions: device_exec,network
delegate_preference: board
requires_board: true
approval_level: confirm
cooldown_seconds: 0
scheduler_template: board_maintenance
category: Delegation
---

# RDK Board Delegate

## 适用场景
- 任务要求板端 OpenClaw 或板端插件完成（模型部署、TROS pipeline 操作、硬件诊断修复等）。
- 任务跨多个板端步骤，软件端工具不够稳定或不够完整。
- 用户明确要求"调用板端 OpenClaw"。
- **何时直接用 `device_exec`**：目标是单条 shell 命令且不涉及 OpenClaw 技能编排（如 `ls`、`cat`、`systemctl status`），此时无需走委派链路。

## 执行流程
1. **知识准备**（推荐）：调用 `web_search` / `web_fetch` 查官方文档与仓库；结合设备信息与 `board_openclaw_assess` 核对插件、模型、pipeline 是否就绪。此步骤与 SOUL.md「先查后委」原则对齐。
2. **评估可行性**：调用 `board_openclaw_assess` 确认板端 OpenClaw 在线、目标技能/插件已就绪。
3. **结构化任务描述**：组装委派输入，guidance 应包含以下结构：
   - `intent`：`diagnose` / `deploy` / `repair` / `automation` / `development`
   - `task`：明确目标与验收条件
   - `context`：设备现状、限制条件、日志摘要
   - `guidance` 结构化内容：
     ```
     ## 技术方案
     - 推荐技术栈: {基于文档检索与 assess 结论}
     - 推荐模型/插件: {具体名称和版本}
     ## 参考资料
     - 官方文档: {web_search 查到的链接}
     - 相关板端技能 / ClawHub: {名称及安装方式}
     ## 验收标准
     - {可观测的成功标志}
     ## 可演示验收（强制，针对 A/C/D）
     - demo_success: {用户不加设备也能听懂的一句「成功长什么样」}
     - verify_command: {一条可复制命令或明确 UI 路径，用于 RDKClaw 独立核对}
     - board_target: {X3/X5/S100 等与模型格式一致}
     ```
4. **提交委派**：调用 `board_openclaw_delegate` 将结构化任务提交给板端 OpenClaw。
5. **等待与监控**：等待板端返回结果；若超时主动轮询，若报错提炼可操作原因。
6. **独立验证**：板端完成后，用 `device_exec` 执行上文的 **verify_command**（或等价检查），**未通过则不得宣称成功**；同一错因重复失败 ≤2 次即换方案或降级。
7. **汇总报告**：汇报执行结果；如有异常，给出原因分析与修复建议。输出中标注"软件端执行"和"板端执行"各自的结果。

> **降级路径**：若步骤 2 判定 OpenClaw 不可达，降级为 `device_exec` 执行简单操作并告知用户。

## 工具映射

| 工具 | 用途 | 必需 |
|------|------|------|
| `web_search` / `web_fetch` | 搜索并拉取官方文档与仓库；结合 assess 核对版本与依赖 | 推荐 |
| `board_openclaw_assess` | 评估板端 OpenClaw 可达性与技能就绪状态 | 是 |
| `board_openclaw_delegate` | 将结构化任务委派给板端 OpenClaw 执行 | 是 |
| `device_exec` | 独立验证 / 降级路径 / 简单命令直接执行 | 是 |

## 输出要求
- 委派后必须汇报：任务是否完成（成功 / 部分完成 / 失败）。
- 给出关键输出摘要（板端返回的核心信息，去除冗余日志）。
- 如有异常，说明原因并给出下一步建议（重试、修复、降级）。
- 输出中标注哪些步骤由板端执行、哪些由软件端执行。

## 禁止事项
- **不绕过 assess 直接 delegate**：除非用户明确要求，否则必须先评估板端状态。
- **不重复造轮子**：板端 OpenClaw 已有的能力（技能/插件）不要在本地重写或模拟。
- **不在设备断连时尝试委派**：设备离线或 SSH 不可达时，不得调用 `board_openclaw_delegate`，应直接告知用户设备状态。
