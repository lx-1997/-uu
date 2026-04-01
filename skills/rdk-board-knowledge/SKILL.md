---
name: RDK Board Knowledge
description: RDK 硬件与板端协作框架；含 TROS（TogetheROS.Bot，ROS2 兼容，勿与 Tuya IoT 混淆）与环境探测要点。适用于设备操作、AI 推理、摄像头、GPIO、模型部署、ROS2/节点/话题、板端能力。
version: 1.1.0
trigger: 设备,能力,推理,摄像头,GPIO,模型,BPU,检测,分割,跟踪,语音,TTS,SLAM,导航,板端,硬件,X3,X5,S100,ROS,ROS2,TROS,ros2,节点,话题,导航节点
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

连接设备后，ALWAYS 先确认平台型号（通常已在 system prompt 的设备快照中）。若缺失则执行：
```bash
cat /proc/device-tree/model 2>/dev/null && cat /etc/version 2>/dev/null
```

- **RDK X3**: 入门级，5TOPS BPU (Bernoulli2)，2GB RAM，Ubuntu 20.04 + Foxy。用轻量模型 (YOLOv5s/MobileNet/FCOS)
- **RDK X5**: 主力级，10TOPS BPU (Bayes-e)，4-8GB RAM，Ubuntu 22.04 + Humble。跑 YOLO/分割/姿态/DOSOD(12fps)/小LLM(≤2B)
- **RDK S100**: 旗舰级，80-128TOPS BPU (Nash-e)，8-16GB RAM，Ubuntu 22.04 + Humble。跑大模型(LLM/VLM)、DOSOD(45fps)、具身智能

**IMPORTANT**: 不同板型的模型 `.bin` 文件不通用（BPU 架构不同），NEVER 混用。在委派 OpenClaw 或执行命令前，ALWAYS 确认板型并选择对应的模型和命令。

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
available_skills: {从 board_openclaw_chat/assess 或设备侧技能列表整理的相关技能}
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

## 常见问题速查

### 网络/WiFi
```bash
# 查看网络接口
ip addr show
# 连接 WiFi
nmcli dev wifi list
nmcli dev wifi connect "SSID" password "密码"
# 查看当前连接
nmcli connection show --active
# 设置静态 IP
nmcli con mod "连接名" ipv4.addresses 192.168.1.100/24 ipv4.method manual
```

### 摄像头
```bash
# USB 摄像头检测
ls /dev/video*
v4l2-ctl --list-devices
# MIPI 摄像头（禁止热插拔！）
ls /dev/video* | grep -v "video[0-3]$"
# 查看摄像头参数
v4l2-ctl -d /dev/video0 --all
# 快速拍照测试
v4l2-ctl -d /dev/video0 --set-fmt-video=width=1920,height=1080,pixelformat=MJPG --stream-mmap --stream-count=1 --stream-to=test.jpg
```

### 系统信息
```bash
# 系统版本
rdkos_info           # 新系统
cat /etc/version     # 通用
# 已安装 hobot 包
apt list --installed | grep hobot
# 磁盘空间
df -h
# 内核版本
uname -a
```

### TROS 与「ROS 环境」（易误判）

- 板上中间件是 **TROS = TogetheROS.Bot**（ROS2 接口兼容），**不是**涂鸦智能/Tuya IoT 生态里的「TuyaROS2」等含义；也不是仅在官网装过「独立 ROS 发行版」才算有环境。
- 用户问「有没有 ROS」时，**勿**仅凭非交互 SSH 里 `which ros2` 为空就断言未安装；应先用 `ls /opt/tros`、`ls /opt/ros` 或 `ls /opt/tros/*/setup.bash` 看是否存在栈，再 `source` 对应 `setup.bash` 后测 `ros2`。
- 先查：`test -f /opt/tros/humble/setup.bash`（或任一 `ls /opt/tros/*/setup.bash`）；再查登录 shell 是否已 source：`grep -E 'tros|setup.bash' ~/.bashrc ~/.profile`。
- 已装 TROS 但未写入 bashrc：可临时 `source /opt/tros/humble/setup.bash`；持久化需在用户同意下往 `~/.bashrc` 追加 source 行（路径以板上为准）。详情见技能 **RDK ROS**（`rdk-ros`）。

### 供电/启动故障
- 必须 5V/5A USB-C 适配器，禁止电脑 USB 供电
- 绿色指示灯亮 = 上电正常；不亮 = 供电问题
- 反复重启 = 大概率供电不足或 SD 卡损坏
- 超过 2 分钟无显示 = 需串口调试

### 进程管理
```bash
# 查找占用端口的进程
ss -tlnp | grep :8080
# 按 CPU 排序进程
top -bn1 | head -15
# 停止指定名称的进程
pkill -f "进程关键字"
# 强制停止 PID
kill -9 <PID>
```

## 板型专章：RDK X3（原独立 `rdk-x3-guide` 已并入本技能）

本段仅在 **boardPlatform 为 rdk-x3** 或探测结果为 X3 时使用。

- **SoC / 用户**：Bernoulli2 BPU；默认用户常为 `sunrise`（非 root）
- **系统**：Ubuntu 20.04，ROS **Foxy**，TROS 常见 `source /opt/tros/setup.bash` 或 `/opt/tros/foxy/`
- **内存**：约 2GB，大模型易 OOM；启动推理前可 `free -h`，建议保留约 500MB 以上可用内存
- **模型与工具链**：`.bin` 与 X5/S100 **不通用**；转换链为 `hb_mapper`（非 `hb_mapper_x5`）
- **BPU / 温度 / 摄像头**（与通用速查一致，路径以板为准）：
```bash
cat /sys/devices/system/bpu/bpu0/ratio
cat /sys/class/thermal/thermal_zone0/temp
ls /dev/video* && v4l2-ctl --list-devices
source /opt/tros/setup.bash   # Foxy
```
- **推理示例**：`/app/ai_inference/`；预置模型目录常含 `/opt/hobot/model/rdkx3/`
- **文档**：X3 硬件与快速开始见 developer.d-robotics.cc → Quick_start → rdk_x3

## 板型专章：RDK S100 / S100P（原独立 `rdk-s100-guide` 已并入本技能）

本段仅在 **boardPlatform 为 rdk-s100 / rdk-ultra** 或探测为 S100 系时使用。

- **算力**：约 80T（S100）/ 128T（S100P），BPU **Nash-e**；默认用户常为 **root**
- **系统**：Ubuntu 22.04 + **Humble**，TROS：`source /opt/tros/humble/setup.bash`
- **接口**：多 USB3、双 MIPI CSI、千兆网、PCIe 等（以硬件文档为准）
- **BPU / 温度**（多 zone / 多核）：
```bash
cat /sys/devices/system/bpu/bpu*/ratio
cat /sys/class/thermal/thermal_zone*/temp
free -h
source /opt/tros/humble/setup.bash
```
- **相对 X5 的性能量级（示意）**：

| 场景 | X5 (10T) | S100 (80T 级) |
|------|----------|----------------|
| YOLOv5s 等 | ~30 fps 量级 | ~120 fps 量级 |
| DOSOD | ~12 fps | ~45 fps |

- **文档**：S100 硬件与算法应用见 developer.d-robotics.cc → rdk_s；Model Zoo 可参考 `rdk_model_zoo_s`

## 文档入口
- X3/X5: https://developer.d-robotics.cc/rdk_doc/
- S100: https://developer.d-robotics.cc/rdk_doc/rdk_s/
- Model Zoo: https://github.com/D-Robotics/rdk_model_zoo
- S100 Model Zoo: https://github.com/D-Robotics/rdk_model_zoo_s

## 工具映射

| 工具 | 用途 |
|------|------|
| web_search / web_fetch | 查文档与仓库；平台能力以设备与 OpenClaw 为准 |
| board_openclaw_assess | 评估可行性 |
| board_openclaw_delegate | 委派执行 |
| device_exec | SSH直接执行 |
| device_diagnose | 设备诊断 |

## 禁止事项

- 不在不了解平台能力的情况下盲目委派
- 不用 X5 的方案直接套用到 X3（算力差距大）
- 不忽略 S100 的 MCU 特殊能力
- 不在委派消息中省略平台上下文
