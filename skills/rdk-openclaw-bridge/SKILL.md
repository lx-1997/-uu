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

## 目标
在一次任务中同时使用软件端工具与板端委派能力，确保执行链路统一且结果可验证。

## 执行步骤
1. 先用软件端工具做状态探测与参数收集。
2. 将复杂动作提交给 `board_openclaw_delegate` 执行。
3. 板端完成后，再用软件端工具做结果核验。
4. 输出中分层标注“软件端执行”和“板端执行”结果。

## 质量要求
- 每次桥接必须说明为何需要板端委派。
- 至少给出一个可复现的验证命令或验证步骤。
- 如果任一步骤失败，明确建议回滚或降级方案。
