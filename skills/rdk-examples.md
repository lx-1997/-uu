---
name: rdk-examples
description: "示例应用管理：NodeHub应用安装与运行，如YOLO检测、人体骨骼、SLAM、手势识别。Use when user mentions example, demo, 示例, 跟随, 手势, yolo demo."
version: 1.0.0
metadata: {"rdkstudio":{"category":"ai","icon":"play","requires":{"device":true},"tab":"examples"}}
---

# 示例应用

## When to Use
- 用户说：运行示例、demo、例子
- 用户提到特定应用：YOLO 检测、人体骨骼、SLAM、手势识别、TTS
- 用户想看 AI 推理效果

## APIs

### 运行示例应用
```
POST /api/devices/{deviceId}/examples/run
Body: { command: string }
Response: { ok: boolean, output: string }
```
CAUTION: 会在设备上执行启动命令，需确认。

### 安装/卸载示例（通过生态系统）
```
POST /api/ecosystem/skills/{skillId}/install
Body: { deviceId: string }

POST /api/ecosystem/skills/{skillId}/run
Body: { deviceId: string }

POST /api/ecosystem/skills/{skillId}/stop
Body: { deviceId: string }
```

## Client Actions
- 打开示例页面: `navigate:examples`

## Safety
- 运行示例前确认命令内容
- 部分示例需要摄像头（MIPI/USB）
- 部分示例会占用大量 BPU 资源
