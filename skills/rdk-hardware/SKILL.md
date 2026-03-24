---
name: RDK Hardware
description: 硬件状态监控与诊断——CPU、内存、温度、BPU、磁盘、网络、进程。触发词：硬件检查、温度、散热、过热、体检、诊断、BPU、CPU、内存、hardware、diagnostics。
version: 1.0.0
trigger: 硬件检查,温度,散热,过热,体检,诊断,BPU,CPU,内存,hardware,diagnostics
risk: low
permissions: workspace_read,device_exec
delegate_preference: local
requires_board: true
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Procedure
disableModelInvocation: true
---

# RDK Hardware

## 适用场景
- 用户说：硬件检查、温度、散热、发烫、过热、体检、诊断。
- 用户问：BPU 占用、CPU 使用率、内存情况。
- 需要了解设备整体健康状况或定位硬件异常。

## 执行流程
1. **一键诊断**：调用 `GET /api/devices/{deviceId}/diagnostics` 获取完整诊断输出（温度、BPU、CPU、内存、磁盘、网络、进程等）。
2. **解读结果**：将诊断输出按类别（温度/CPU/内存/磁盘/BPU/网络）分段解读，标注正常或异常。
3. **精细排查**（可选）：若需单项深入，调用 `POST /api/devices/{deviceId}/exec` 执行自定义命令。
4. **导航到硬件页面**：需要时发出 `navigate:hardware` 或 `startDiagnostic` 客户端动作。

> **常用诊断命令参考**
> - 温度：`cat /sys/class/thermal/thermal_zone0/temp`
> - BPU：`hrut_smi` 或 `bputop`
> - 内存：`free -h`
> - CPU：`top -bn1 | head -5`
> - 磁盘：`df -h`
> - 进程：`ps aux --sort=-%cpu | head -15`

## 工具映射

| 工具 / API | 用途 | 必需 |
|------------|------|------|
| `GET /api/devices/{deviceId}/diagnostics` | 一次性执行全量诊断 | 是 |
| `POST /api/devices/{deviceId}/exec` | 执行单条自定义诊断命令 | 否 |
| `navigate:hardware` | 打开硬件监控页面 | 否 |
| `startDiagnostic` | 触发 UI 诊断流程 | 否 |

## 输出要求
- 诊断结果分类展示：温度、CPU、内存、磁盘、BPU、网络各一段。
- 对异常指标高亮标注并给出建议（如温度过高建议散热）。
- 输出应简洁可操作，不要原样倾倒终端输出。

## 禁止事项
- **不跳过整体诊断直接问用户查哪项**：优先执行一键诊断，再按需深入。
- **不对异常指标不做解读**：必须将原始数值转为用户可理解的描述（如 "85°C，偏高"）。
- **不在诊断失败时静默**：API 失败时必须告知用户并建议手动检查。
