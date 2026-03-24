---
name: RDK Token Usage Tracker
description: 跟踪并分析底层大模型 token 消耗，覆盖 RDKClaw 与板端 OpenClaw，两侧统一统计与对比。
version: 1.0.0
trigger: token,token消耗,用量统计,费用估算,llm usage,openclaw token,rdkclaw token,模型消耗
risk: low
permissions: workspace_read
delegate_preference: local
requires_board: false
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Monitoring
---

# RDK Token Usage Tracker

## 适用场景
- 用户要看 RDKClaw / OpenClaw 的 token 用量。
- 用户要按设备、按时间窗口统计消耗。
- 用户要排查"为什么这次对话成本高"。

## 执行流程
1. 调用 `rdkclaw_token_usage_report` 获取 token 汇总与最近记录。
2. 若用户指定设备，附带 `deviceId` 过滤。
3. **异常分支 — 无数据**：若返回空记录或 `totalTokens === 0`，告知用户当前窗口内无消耗记录，建议扩大时间范围或确认服务是否运行。
4. **异常分支 — 工具报错**：若 `rdkclaw_token_usage_report` 调用失败，记录错误摘要（可选调用 `rdkclaw_memory_append_daily` 留存异常），向用户说明原因并建议稍后重试。
5. 对比 `rdkclaw` 与 `openclaw` 两侧占比，标出高消耗来源。
6. 给出可执行优化建议（缩短上下文、减少冗余工具调用、拆分任务）。

## 工具映射

| 工具 | 用途 | 必需 |
|------|------|------|
| `rdkclaw_token_usage_report` | 查询指定时间窗口的 token 用量汇总与明细 | 是 |
| `rdkclaw_memory_append_daily` | 记录异常事件到日记（如查询失败、异常高消耗） | 否 |

## 输出要求
- 明确统计窗口（hours）。
- 输出 `totalTokens`、`runs`、`successRuns`。
- 按模型分布列出各模型的 token 占比（如 `gpt-4o: 62%`, `deepseek-r1: 38%`）。
- 给出最近高消耗记录（至少 3 条，如果存在）。
- 若数据足够，标注趋势提示（如「近 24h 用量较前日上升 40%」）。
- 给出 2~3 条节流建议。

## 禁止事项
- **不伪造数据**：查询无结果时如实告知，不编造 token 数值。
- **不自作主张删除历史记录**：任何清理操作需用户明确授权。
- **不暴露 API Key**：输出中不得包含任何密钥、endpoint 或鉴权信息。
