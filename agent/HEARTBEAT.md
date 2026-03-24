# HEARTBEAT.md — 设备定期巡检清单

每次心跳触发时，按以下清单执行检查：

## 设备基础状态
- 检查 CPU 温度是否 > 80°C（`device_diagnose`）
- 检查磁盘使用率是否 > 90%
- 检查内存使用率是否 > 85%

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
