---
name: RDK S100 Board Guide
description: RDK S100/S100P 开发板专用指南。80/128 TOPS BPU (Nash-e)、8×A78AE CPU、8/16GB 内存、Ubuntu 22.04 + ROS Humble。覆盖高性能 AI 推理、多路摄像头、机器人开发。
version: 1.0.0
trigger: S100,RDK S100,rdk s100,s100p,nash,80tops,128tops,s100开发板,高算力
risk: low
permissions: device_exec,network
delegate_preference: collaborative
requires_board: true
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Knowledge
---

# RDK S100 Board Guide

## 板型识别

检测当前板子是否为 S100：
```bash
cat /etc/version  # 含 "s100"
cat /proc/device-tree/model  # Horizon S100
```

## S100 特有优势

### 高性能 AI
- **80 TOPS** (S100) / **128 TOPS** (S100P) — 远超 X5 的 10 TOPS
- BPU 架构：**Nash-e**（最新一代）
- 支持更大模型、更高分辨率、更多并发推理任务

### 硬件接口
- 4×USB 3.0（比 X5 多 2 个）
- 2×MIPI CSI 摄像头接口
- 千兆以太网
- PCIe 3.0 扩展

### 系统环境
- Ubuntu 22.04 + ROS Humble（与 X5 相同）
- TROS 路径：`/opt/tros/humble/`
- 默认用户：`root`

## 常用命令
```bash
# 查看 BPU 状态（S100 可能有多个 BPU 核心）
cat /sys/devices/system/bpu/bpu*/ratio

# 查看温度
cat /sys/class/thermal/thermal_zone*/temp

# 查看 CPU 频率（8 核 A78AE）
cat /sys/devices/system/cpu/cpufreq/policy*/cpuinfo_cur_freq

# 内存（8/16GB）
free -h

# TROS 环境
source /opt/tros/humble/setup.bash
```

## AI 推理性能参考

| 模型 | X5 (10T) | S100 (80T) | 输入尺寸 |
|------|----------|------------|----------|
| YOLOv5s | ~30 fps | ~120 fps | 640×640 |
| DOSOD | ~12 fps | ~45 fps | 640×640 |
| YOLO11 Pose | ~15 fps | ~60 fps | 640×640 |

## 多路推理

S100 的高算力支持同时运行多个推理任务：
```bash
# 同时运行检测 + 分割
ros2 launch hobot_dnn multi_model.launch.py
```

## 文档参考
- 硬件介绍: https://developer.d-robotics.cc/rdk_doc/Quick_start/hardware_introduction/rdk_s100/
- 算法应用: https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/
- Python 示例: https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/
