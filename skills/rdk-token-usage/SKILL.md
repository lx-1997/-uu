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
- 用户要排查“为什么这次对话成本高”。

## 执行流程
1. 调用 `rdkclaw_token_usage_report` 获取 token 汇总与最近记录。
2. 若用户指定设备，附带 `deviceId` 过滤。
3. 对比 `rdkclaw` 与 `openclaw` 两侧占比，标出高消耗来源。
4. 给出可执行优化建议（缩短上下文、减少冗余工具调用、拆分任务）。

## 输出要求
- 明确统计窗口（hours）。
- 输出 `totalTokens`、`runs`、`successRuns`。
- 给出最近高消耗记录（至少 3 条，如果存在）。
- 给出 2~3 条节流建议。

