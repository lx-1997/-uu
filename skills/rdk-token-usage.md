# Token Usage Tracker（RDKClaw + OpenClaw）

该技能用于查看并分析底层大模型 token 消耗，统一覆盖：

- RDK Studio Claw（软件端 RDKClaw）
- 板端 OpenClaw（通过 Studio 网关转发的会话）

## 可调用工具

- `rdkclaw_token_usage_report`

### 参数

- `hours`：统计窗口（默认 24）
- `source`：`all | rdkclaw | openclaw`
- `deviceId`：可选，按设备过滤
- `limit`：最近记录条数（默认 50）

## 返回数据

- `totals.promptTokens`
- `totals.completionTokens`
- `totals.totalTokens`
- `totals.runs`
- `totals.successRuns`
- `bySource`
- `byDevice`
- `recent`（最近记录）

## 说明

当前为**估算口径**（基于文本长度近似 token），用于趋势观察、来源对比与优化决策；后续可接入模型供应商原生 usage 字段升级为精确计量。

