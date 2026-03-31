---
name: RDK X3 Board Guide
description: RDK X3 开发板专用指南。5 TOPS BPU (Bernoulli2)、4×A53 CPU、2GB 内存、Ubuntu 20.04 + ROS Foxy。覆盖硬件接口、系统配置、AI 推理、TROS 使用。
version: 1.0.0
trigger: X3,RDK X3,rdk x3,x3 module,bernoulli,5tops,foxy,ubuntu 20.04,sunrise,x3开发板
risk: low
permissions: device_exec,network
delegate_preference: collaborative
requires_board: true
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Knowledge
---

# RDK X3 Board Guide

## 板型识别

检测当前板子是否为 X3：
```bash
cat /etc/version  # 含 "x3" 或 "sunrise"
cat /proc/device-tree/model  # Horizon X3
hrut_somid  # 查看 SoM ID
```

## X3 特有注意事项

### BPU 架构差异
- X3 使用 **Bernoulli2** 架构（不同于 X5 的 Bayes-e）
- 模型文件后缀 `.bin`，但与 X5 的 `.bin` **不通用**
- 转换工具链：`hb_mapper` (X3) vs `hb_mapper_x5` (X5)

### 系统差异
- 默认用户：`sunrise`（不是 root）
- 系统：Ubuntu 20.04（不是 22.04）
- ROS 版本：Foxy（不是 Humble）
- TROS 路径：`/opt/tros/` 或 `/opt/tros/foxy/`

### 内存限制
- 仅 2GB 内存，运行大模型时注意 OOM
- 建议：`free -h` 检查可用内存，大于 500MB 再启动推理

### 常用命令
```bash
# 查看 BPU 状态
cat /sys/devices/system/bpu/bpu0/ratio
cat /sys/devices/system/bpu/bpu1/ratio

# 查看温度
cat /sys/class/thermal/thermal_zone0/temp  # 除以1000

# 查看 CPU 频率
cat /sys/devices/system/cpu/cpufreq/policy0/cpuinfo_cur_freq

# 摄像头检测
ls /dev/video*
v4l2-ctl --list-devices

# TROS 环境
source /opt/tros/setup.bash  # Foxy
```

### AI 推理示例路径
```bash
/app/ai_inference/  # Python 推理示例
/opt/hobot/model/rdkx3/  # 预置模型
```

### 文档参考
- 硬件介绍: https://developer.d-robotics.cc/rdk_doc/Quick_start/hardware_introduction/rdk_x3/
- 系统烧录: https://developer.d-robotics.cc/rdk_doc/Quick_start/install_os/
- GPIO/外设: https://developer.d-robotics.cc/rdk_doc/System_configuration/peripheral/
