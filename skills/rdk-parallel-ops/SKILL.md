---
name: RDK Parallel Operations
description: 指导 Agent 在多步骤任务中识别可并行的操作，减少总耗时。适用于信息收集、批量操作、环境搭建等场景。
version: 1.0.0
trigger: 批量操作,并行,加速,同时执行,parallel
risk: low
permissions: device_exec,device_file_read
delegate_preference: local
requires_board: false
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Meta
---

# RDK Parallel Operations

## 适用场景
需要收集多项独立信息或执行多个无依赖步骤时，识别并行机会以减少总耗时。

## 可并行的常见场景

### 信息收集并行
以下操作互不依赖，应同时发起：
- `device_diagnose` + `board_openclaw_health`（设备状态 + 服务状态）
- `device_file_read`（多个独立配置文件）
- `board_openclaw_logs` + `device_exec`（journalctl）

### 验证并行
修复后的验证步骤可并行：
- `board_openclaw_health` + `device_exec`（端口检查）
- 多设备同时查询状态

## 必须串行的场景
- 安装 → 重启 → 验证（有依赖关系）
- 文件写入 → 读取确认
- doctor 修复 → 重启 → health 检查
- 任何涉及状态变更的操作链

## 决策规则
1. 只读操作之间 → 优先并行
2. 写操作与后续读操作 → 必须串行
3. 不确定是否有依赖 → 串行（安全优先）

## 禁止事项
- 不并行执行有写冲突的操作
- 不在单个 device_exec 中塞入过多命令（单条命令可读性优先）
