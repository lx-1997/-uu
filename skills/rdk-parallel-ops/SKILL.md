---
name: RDK Parallel Operations
description: 指导 Agent 在多步骤任务中识别可并行的操作，减少总耗时。适用于信息收集、批量操作、环境搭建等场景。
version: 1.0.0
trigger: 并行,同时,一起,parallel,batch,多个,同步,concurrent,一并,顺便
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

常见场景：
- "同时查一下设备状态和 OpenClaw 服务状态"
- "帮我一起检查 CPU 温度和磁盘空间"
- "顺便把日志也拉下来"
- 信息收集：`device_diagnose` +（仅当需要 JSON 或 UI 异常时）`board_openclaw_health`；日常可看 `board_openclaw_status` 或信任界面 **ON / OpenClaw**
- 多文件读取：`device_file_read` 同时读取多个独立配置文件
- 混合查询：`board_openclaw_logs` + `device_exec`（journalctl）
- 修复后验证：`board_openclaw_health`（需 JSON 验收时）+ `device_exec`（端口检查）；非修复场景不要例行 health

## 执行流程

1. **分析任务依赖关系**：列出所有待执行的子任务，标注每个任务的输入/输出
2. **判断并行/串行**：只读操作之间 → 并行；写操作与后续读操作 → 串行；不确定是否有依赖 → 串行（安全优先）
3. **并行分发独立任务**：将无依赖的任务同时发起调用，充分利用并发能力
4. **等待全部完成**：所有并行任务返回后，检查每个任务的执行状态
5. **合并结果**：将成功/失败结果统一整理，失败任务标注原因
6. **统一汇报**：以结构化格式向用户呈现合并后的结果

## 工具映射

| 并行组合 | 场景 | 说明 |
|----------|------|------|
| `device_diagnose` + `board_openclaw_status` | 全面状态收集（推荐） | 硬件与轻量服务摘要；避免无意义重复 `health` |
| `device_diagnose` + `board_openclaw_health` | 需 JSON 或明确排障 | 仅用户报障 / UI 异常 / 装升重启后验收 |
| `device_file_read` × N | 多配置文件读取 | 读取多个独立文件可同时发起 |
| `board_openclaw_logs` + `device_exec` | 日志 + 系统信息 | 日志查询与命令执行互不影响 |
| `board_openclaw_health` + `device_exec`（端口检查） | 修复/重启后验收 | 有明确验收需求时再并行 |
| `device_exec` × N | 批量只读命令 | 多条无副作用的查询命令可并行（如 df、free、uptime） |

### 必须串行的场景

- 安装 → 重启 → 验证（有依赖关系）
- 文件写入 → 读取确认
- doctor 修复 → 重启 → health 检查
- 任何涉及状态变更的操作链

## 输出要求

- 合并结果按任务分组，每组包含：任务名称、执行状态（✅ 成功 / ❌ 失败）、关键输出摘要
- 失败任务必须标注失败原因和建议的后续操作
- 汇报格式示例：
  ```
  并行执行结果（共 N 项）：
  ✅ 设备诊断：CPU 45°C，内存 62%，磁盘 78%
  ✅ OpenClaw 状态：running，版本 1.2.3
  ❌ 日志查询：连接超时 — 建议检查 SSH 连接后重试
  ```
- 全部成功时给出综合结论；部分失败时先展示成功项，再列出失败项及恢复建议

## 禁止事项

- 不并行执行有写冲突的操作
- 不在单个 device_exec 中塞入过多命令（单条命令可读性优先）
- 不对有依赖关系的步骤强行并行
- 不在不确定依赖关系时默认并行（安全优先，存疑则串行）
