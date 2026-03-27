---
name: RDK OpenClaw Bridge
description: 协调 RDK Studio 软件能力与板端 OpenClaw 能力，形成统一执行链路。
version: 1.0.0
trigger: 协同,桥接,混合执行,先检查再委派,回归验证
risk: medium
permissions: workspace_read,device_exec,network
delegate_preference: hybrid
requires_board: false
approval_level: confirm
cooldown_seconds: 0
scheduler_template: bridge_validation
category: Delegation
---

# RDK OpenClaw Bridge

## 适用场景
- RDKClaw 需要通过板端 OpenClaw 执行复杂任务（模型部署、TROS pipeline、设备诊断修复等），且任务需软件端与板端协同完成。
- 单独使用软件端工具无法完成全部步骤，需桥接板端能力补齐链路。
- 任务执行后需要软件端做结果核验或回归验证。
- 用户要求"先检查再委派"的混合执行模式。

## 执行流程
1. **评估可行性**：调用 `board_openclaw_assess` 确认板端 OpenClaw 是否可达、是否具备目标能力（插件/技能已安装）。
2. **查询平台能力**：用 `web_search` / `web_fetch` 查文档与仓库；用 `board_openclaw_chat` 或已装技能列表核对插件、模型、pipeline 是否满足任务。
3. **组装上下文消息**：将软件端已收集的状态信息（设备状态、日志摘要、用户意图）结构化为 `intent` + `task` + `context`，确保板端理解无歧义。
4. **委派执行**：调用 `board_openclaw_delegate` 将任务提交到板端 OpenClaw，附带结构化上下文。
5. **监控进度**：等待板端返回，若超时则主动轮询状态；若中途报错，提炼可操作的错误原因。
6. **汇总结果**：板端完成后，用软件端工具做结果核验（如端口检查、日志比对），输出中分层标注"软件端执行"和"板端执行"结果。

> **降级路径**：若步骤 1 评估板端不可达或能力不足，降级为 `device_exec` 直接执行简单命令，并告知用户降级原因。

## 工具映射

| 工具 | 用途 | 必需 |
|------|------|------|
| `board_openclaw_assess` | 评估板端 OpenClaw 可达性与能力覆盖 | 是 |
| `board_openclaw_delegate` | 将结构化任务委派给板端 OpenClaw 执行 | 是 |
| `web_search` / `web_fetch` | 查文档与仓库；版本与就绪度以 assess 与板端为准 | 推荐 |
| `device_exec` | 降级路径：OpenClaw 不可用时直接在板端执行简单命令 | 否 |

## 输出要求
- 每次桥接必须说明为何需要板端委派（不可仅由软件端完成的理由）。
- 输出中分层标注"软件端执行"和"板端执行"各自的结果。
- 至少给出一个可复现的验证命令或验证步骤。
- 如果任一步骤失败，明确建议回滚或降级方案，并附带错误摘要。

## 禁止事项
- **不绕过 assess 直接 delegate**：除非用户明确要求跳过评估，否则必须先调用 `board_openclaw_assess`。
- **不丢弃板端返回的错误信息**：板端报错必须原样或摘要呈现给用户，不得静默吞掉。
- **不在 OpenClaw 不可用时静默失败**：必须明确告知用户 OpenClaw 不可达，并给出降级建议（如使用 `device_exec`）。
