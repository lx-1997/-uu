---
name: RDK OpenClaw Lifecycle Ops
description: 管理 OpenClaw 生命周期（安装、升级、卸载、状态检查、重启、配对与配置变更），并提供可回滚的操作路径。
version: 1.0.0
trigger: openclaw安装,openclaw卸载,openclaw升级,gateway重启,openclaw状态,配对,feishu配置,model切换
risk: high
permissions: device_exec,network
delegate_preference: hybrid
requires_board: false
approval_level: strict
cooldown_seconds: 3
scheduler_template: openclaw_lifecycle_maintenance
category: Lifecycle
---

# RDK OpenClaw Lifecycle Ops

## 适用场景
- 用户要安装、升级、卸载、重启或排障 OpenClaw。
- 用户要修改 OpenClaw 运行配置（模型切换、飞书配置、配对操作）。
- 用户要验证 OpenClaw 是否可用（gateway/token/健康状态）。

## 工具映射

| 工具 | 用途 |
|------|------|
| `board_openclaw_status`、`board_openclaw_logs`、`board_openclaw_read_config` | 诊断/状态 |
| `board_openclaw_install`、`board_openclaw_upgrade`、`board_openclaw_uninstall`、`board_openclaw_restart_gateway` | 生命周期 |
| `board_openclaw_model_switch`、`board_openclaw_feishu_config`、`board_openclaw_pairing_list`、`board_openclaw_pairing_approve`、`board_openclaw_pairing_reject` | 配置与接入 |
| `board_openclaw_assess`、`board_openclaw_delegate` | 复杂修复 |

## 执行流程（必须按序）
1. **先体检后变更**：先读取状态/日志/配置，再进入安装或改配置动作。
2. **最小副作用原则**：优先单点修复（重启、改模型）再做重操作（升级、卸载重装）。
3. **变更后复核**：每次变更后必须再次检查状态并报告是否恢复。
4. **失败可回退**：给出可执行回退方案（例如恢复旧模型、回滚配置、重启 gateway）。

## 输出要求
- 必须分四段：`当前状态`、`执行动作`、`验证结果`、`下一步建议`。
- 输出中要标明：哪些动作已经执行、哪些仅为建议。
- 高风险动作（卸载、覆盖配置）执行前要再次请求用户确认。

## 禁止事项
- 未做状态检查就直接卸载或覆盖配置。
- 不解释风险直接执行持久性改动（例如开启外网暴露服务）。
- 遇到权限/网关错误时无限重试同一动作。
