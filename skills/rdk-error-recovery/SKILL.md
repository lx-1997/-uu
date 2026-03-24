---
name: RDK Error Recovery
description: 工具调用失败时的标准降级与恢复策略。覆盖 SSH 断连、命令超时、服务无响应等常见错误。
version: 1.0.0
trigger: 命令失败,SSH断开,超时,error,连接失败,恢复,recovery
risk: medium
permissions: device_exec
delegate_preference: local
requires_board: false
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Meta
---

# RDK Error Recovery

## 适用场景
工具调用返回错误、超时或异常输出时触发。

## 错误分类与处理

### SSH/连接错误
症状：`ECONNREFUSED`、`ETIMEDOUT`、`SSH connection closed`
处理：
1. 等待 3 秒后重试 1 次
2. 若仍失败，提示用户检查设备网络连接和 SSH 服务
3. 不无限重试

### 命令超时
症状：无输出或执行时间 > 30s
处理：
1. 检查是否启动了交互式命令（vim/top/less）
2. 用 `device_exec` 执行 `ps aux | grep <命令>` 确认进程状态
3. 必要时 `kill` 残留进程后重试

### OpenClaw 服务无响应
症状：`board_openclaw_health` 返回 `gatewayRunning: false` 或超时
处理：
1. `board_openclaw_restart_gateway` 重启
2. 等待 5 秒后 `board_openclaw_health` 验证
3. 若仍失败，`board_openclaw_doctor` 深度修复
4. 最后手段：`board_openclaw_install` 重新安装

### 命令输出异常
症状：输出包含 `command not found`、`Permission denied`、`No such file`
处理：
- `command not found` → 检查 PATH 或安装缺失软件
- `Permission denied` → 加 `sudo` 或修改权限
- `No such file` → 确认路径存在后重试

## 通用原则
- 每种错误最多重试 2 次
- 重试前必须判断根因，不盲目重复
- 恢复后用对应的验证工具确认成功
- 多次失败后向用户汇报完整错误链

## 工具映射

| 工具 | 用途 |
|------|------|
| `device_exec` | 重试命令、查进程、必要时 kill 后重试 |
| `board_openclaw_restart_gateway` | 重启 OpenClaw 网关 |
| `board_openclaw_health` | 健康检查与恢复后验证 |
| `board_openclaw_doctor` | 自动/深度修复 |
| `device_diagnose` | 设备侧诊断 |

## 输出要求

每次错误恢复必须报告：原始错误 → 恢复措施 → 恢复结果 → 是否需要进一步处理。

## 禁止事项
- 不静默吞掉错误
- 不在重试循环中无限等待
- 不对 `rm`/`dd` 等破坏性命令自动重试
