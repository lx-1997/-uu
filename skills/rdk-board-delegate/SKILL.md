---
name: RDK Board Delegate
description: 需要板端真实能力时，将任务委派给板端 OpenClaw Agent。
version: 1.0.0
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
- 任务要求板端 OpenClaw 或板端插件完成
- 任务跨多个板端步骤，软件端工具不够稳定或不够完整
- 用户明确要求“调用板端 OpenClaw”

## 执行策略
1. 优先使用 `board_openclaw_delegate`，把任务描述结构化后再提交。
2. 委派前补充 `intent` 与 `context`，避免板端理解偏差。
3. 板端返回错误时，先提炼可操作原因，再给出修复建议。
4. 如任务可拆分，先让板端做高复杂步骤，再由软件端完成收尾验证。

## 委派输入建议
- `intent`: `diagnose` / `deploy` / `repair` / `automation`
- `task`: 给出明确目标与验收条件
- `context`: 设备现状、限制条件、日志摘要
