---
name: RDK Board Knowledge
description: RDK 全系列硬件能力感知与协作决策框架。当用户提到设备操作、AI推理、摄像头、GPIO、模型部署、板端能力时激活。
version: 1.0.0
trigger: 设备,能力,推理,摄像头,GPIO,模型,BPU,检测,分割,跟踪,语音,TTS,SLAM,导航,板端,硬件,X3,X5,S100
risk: low
permissions: none
delegate_preference: collaborative
requires_board: false
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Knowledge
---

# RDK 板端知识 — 决策框架

## 你的角色
你是协作指导者。当设备已连接，你知道它的能力量级，可以精准引导 OpenClaw 完成任务。

## 平台判断
连接设备后，先确认平台型号：
- **RDK X3**: 入门级，5TOPS BPU，2GB RAM。用轻量模型 (YOLOv5s/MobileNet/FCOS)
- **RDK X5**: 主力级，10TOPS BPU，4-8GB RAM。跑 YOLO/分割/姿态/DOSOD(12fps)/小LLM(≤2B)
- **RDK S100**: 旗舰级，80-128TOPS Nash BPU，12-24GB RAM + MCU。跑大模型(LLM/VLM)、DOSOD(45fps)、具身智能

不确定时用 ecosystem_query 工具查询。

## 协作决策树
```
用户请求 → 判断任务性质
├─ 纯编排/问答 → 本地完成，但可引用设备上下文
├─ 需要硬件操作 (GPIO/摄像头/传感器) → 委派 OpenClaw
├─ 需要AI推理 (检测/分割/LLM) → 委派 OpenClaw，附带平台推荐
├─ 需要系统操作 (安装/配置/诊断) → 可用 device_exec 或委派
└─ 复合任务 → 拆分步骤，本地编排 + 板端执行
```

## 委派消息模板
委派给 OpenClaw 时，不要发裸命令。附带上下文：
```
task: {具体任务描述}
platform_context: 当前平台 {型号}，BPU {TOPS}TOPS
recommended_approach: {基于平台的推荐方案}
available_skills: {从 ecosystem_query 查到的相关技能}
doc_reference: {相关文档链接}
```

## 降级策略
- OpenClaw 未安装/网关不通 → 用 device_exec 通过 SSH 直接执行
- 技能不存在 → 建议安装，提供 installCmd
- 模型不兼容 → 推荐该平台支持的替代模型
- 板端超时 → 检查设备状态，必要时重启网关

## 常见任务速查
| 任务 | X3 推荐 | X5 推荐 | S100 推荐 |
|------|---------|---------|-----------|
| 目标检测 | YOLOv5s | YOLOv5/v8 | YOLOv8x/DOSOD |
| 语义分割 | DeepLabV3+ | YOLOv8-Seg | YOLOv8-Seg |
| 人体检测 | mono2d_body | mono2d_body | mono2d_body |
| 语音合成 | - | hobot_tts | hobot_tts |
| 大模型 | 不支持 | ≤2B量化 | LLM/VLM全系列 |
| SLAM | ORB-SLAM3 | ORB-SLAM3 | ORB-SLAM3 |
| 导航 | Nav2 | Nav2 | Nav2 |
| 关节控制 | - | - | MCU (R52+) |

## 文档入口
- X3/X5: https://developer.d-robotics.cc/rdk_doc/
- S100: https://developer.d-robotics.cc/rdk_doc/rdk_s/
- Model Zoo: https://github.com/D-Robotics/rdk_model_zoo
- S100 Model Zoo: https://github.com/D-Robotics/rdk_model_zoo_s
