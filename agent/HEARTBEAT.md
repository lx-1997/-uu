# HEARTBEAT.md — 设备定期巡检清单

> 本清单仅用于**定时/自治心跳任务**，与用户在 AI Dock 里的**普通对话**无关。对话中不要因「例行体检」重复调用 `board_openclaw_health`（见 SOUL.md）。

每次心跳触发时，按以下清单执行检查：

## 设备基础状态
- 检查 CPU 温度（`device_diagnose`）：≥75°C 警告，≥85°C 严重
- 检查磁盘使用率：≥85% 警告，≥95% 严重
- 检查内存使用率：≥85% 警告

## OpenClaw 服务状态
- 检查 gateway 是否在运行（`board_openclaw_health`）
- 若 gateway 未运行，执行 `board_openclaw_restart_gateway` 自动恢复
- 恢复后再次 `board_openclaw_health` 验证

## 异常处理
- 温度过高：提醒用户检查散热
- 磁盘满：清理 /tmp 和日志文件
- gateway 反复崩溃：执行 `board_openclaw_doctor` 深度修复

## 输出要求
- 仅在发现异常时通知用户
- 正常状态静默，不制造噪音
- 异常通知包含：问题、影响、已采取的措施
