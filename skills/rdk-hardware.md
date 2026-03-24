---
name: rdk-hardware
description: "硬件状态监控与诊断：CPU、内存、温度、BPU。Use when user asks about hardware, temperature, cpu, memory, bpu, 硬件, 温度, 散热, 诊断, 体检."
version: 1.0.0
metadata: {"rdkstudio":{"category":"monitoring","icon":"activity","requires":{"device":true},"tab":"hardware"}}
disableModelInvocation: true
---

# 硬件诊断

## When to Use
- 用户说：硬件检查、温度、散热、发烫、过热、体检、诊断
- 用户问：BPU占用、CPU使用率、内存情况
- 用户想了解设备健康状况

## APIs

### 获取完整诊断输出
```
GET /api/devices/{deviceId}/diagnostics
Response: { ok: boolean, output: string, device: Device }
```
一次性执行所有诊断命令：温度、BPU、CPU、内存、磁盘、网络、进程等。

### 执行自定义诊断命令
```
POST /api/devices/{deviceId}/exec
Body: { command: "cat /sys/class/thermal/thermal_zone0/temp" }
Response: { ok: boolean, output: string }
```

## Client Actions
- 打开硬件监控页面: `navigate:hardware`
- 开始诊断: `startDiagnostic`

## Common Commands
- 温度: `cat /sys/class/thermal/thermal_zone0/temp`
- BPU: `hrut_smi` 或 `bputop`
- 内存: `free -h`
- CPU: `top -bn1 | head -5`
- 磁盘: `df -h`
- 进程: `ps aux --sort=-%cpu | head -15`
