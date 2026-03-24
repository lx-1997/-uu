---
name: RDK Problem Analysis
description: 结构化问题分析流程：信息收集→假设排列→验证→结论。适用于设备异常、环境故障等需要系统化排查的场景。
version: 1.0.0
trigger: 排查问题,设备异常,为什么不工作,diagnose,troubleshoot,分析原因
risk: low
permissions: device_exec,device_file_read
delegate_preference: local
requires_board: false
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Meta
---

# RDK Problem Analysis

## 适用场景
用户报告设备/服务/功能异常，需要系统化排查而非盲目尝试。

## 执行流程

### 1. 信息收集（不超过 3 步）
- 用 `device_diagnose` 获取硬件基线（温度/内存/磁盘）
- 用 `board_openclaw_health` 获取服务状态
- 从用户描述提取关键词：错误码、时间点、操作上下文

### 2. 假设排列（最多 3 个）
按概率排序，每个假设给出对应验证命令：
- 假设 A（最可能）→ 验证命令
- 假设 B → 验证命令
- 假设 C → 验证命令

### 3. 逐一验证
- 从最可能的假设开始验证
- 每次验证后检查输出，确认/排除假设
- 若 3 个假设全部排除，扩大信息收集范围（日志、配置文件）

## 工具映射

| 工具 | 用途 |
|------|------|
| device_exec | 信息收集 |
| device_diagnose | 设备状态 |
| device_file_read | 读日志/配置 |
| board_openclaw_health | OpenClaw状态 |
| board_openclaw_delegate | 板端深度诊断 |
| web_search | 查资料 |

## 输出要求

必须包含：
- 根因（一句话）
- 修复动作（具体命令/步骤）
- 验证方法（如何确认已修复）

## 禁止事项
- 不跳过信息收集直接猜测
- 不同时尝试多个修复（先验证根因再修）
- 不输出超过 3 个假设（强制收敛）
