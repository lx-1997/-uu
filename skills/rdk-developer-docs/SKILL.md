---
name: RDK 开发者文档知识库
description: 基于 developer.d-robotics.cc 的 RDK 官方文档索引。当用户询问 RDK 开发相关问题时，直接定位到对应文档页面并获取内容回答。覆盖 RDK X3/X5/S100 全系列。
version: 1.0.0
trigger: 文档,教程,怎么用,如何,开发,配置,安装,烧录,WiFi,摄像头,GPIO,BPU,模型部署,YOLO,检测,分割,跟踪,ROS,TROS,Node-RED,VNC,SSH,串口,I2C,SPI,PWM,HDMI,USB,MIPI,camera,sensor,inference,deploy,tutorial,guide,quickstart,快速开始,入门,示例,demo,example
risk: low
permissions: network
delegate_preference: local
requires_board: false
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Knowledge
---

# RDK 开发者文档知识库

## 核心能力

当用户询问 RDK 开发相关问题时，你应该：
1. 根据问题关键词，从下方文档索引中定位最相关的页面 URL
2. 使用 `web_fetch` 获取该页面内容
3. 从获取的内容中提取关键信息回答用户
4. 如果需要在板端操作，结合 `device_exec` 执行

## 文档站点结构

基础 URL: `https://developer.d-robotics.cc/rdk_doc`

### 1. 快速开始 (Quick_start)

| 主题 | URL 路径 | 适用场景 |
|------|----------|----------|
| RDK X3 介绍 | `/Quick_start/hardware_introduction/rdk_x3/` | 用户问 X3 规格/接口 |
| RDK X5 介绍 | `/Quick_start/hardware_introduction/rdk_x5/` | 用户问 X5 规格/接口 |
| RDK S100 介绍 | `/Quick_start/hardware_introduction/rdk_s100/` | 用户问 S100 规格/接口 |
| 系统烧录 | `/Quick_start/install_os/` | 用户问烧录/刷机/安装系统 |
| 远程登录 (SSH) | `/Quick_start/remote_login/` | 用户问 SSH 连接/远程登录 |
| 网络配置 | `/Quick_start/network/` | 用户问 WiFi/有线网络/IP |
| 下载资源汇总 | `/Quick_start/download/` | 用户找镜像/工具/资料下载 |

### 2. 系统配置 (System_configuration)

| 主题 | URL 路径 | 适用场景 |
|------|----------|----------|
| 外设接口 | `/System_configuration/peripheral/` | 用户问 GPIO/I2C/SPI/UART/PWM |
| 摄像头 | `/System_configuration/camera/` | 用户问 MIPI/USB 摄像头配置 |
| 显示输出 | `/System_configuration/display/` | 用户问 HDMI/LCD 显示 |
| 音频 | `/System_configuration/audio/` | 用户问音频录制/播放 |
| 蓝牙 | `/System_configuration/bluetooth/` | 用户问蓝牙配对/连接 |
| 系统更新 | `/System_configuration/system_update/` | 用户问 apt 更新/系统升级 |

### 3. Python 开发 (Python_development)

| 主题 | URL 路径 | 适用场景 |
|------|----------|----------|
| Python 快速开始 | `/Python_development/quick_start/` | 用户问 Python 开发入门 |
| 摄像头使用 | `/Python_development/camera/` | 用户问 Python 调用摄像头 |
| 模型推理 | `/Python_development/inference/` | 用户问 Python BPU 推理 |
| 多媒体 | `/Python_development/multimedia/` | 用户问 Python 编解码 |

### 4. C/C++ 开发 (Cpp_development)

| 主题 | URL 路径 | 适用场景 |
|------|----------|----------|
| C++ 快速开始 | `/Cpp_development/quick_start/` | 用户问 C++ 开发入门 |
| 模型推理 | `/Cpp_development/inference/` | 用户问 C++ BPU 推理 |
| 多媒体 | `/Cpp_development/multimedia/` | 用户问 C++ 编解码 |

### 5. 模型部署 (Model_deploy)

| 主题 | URL 路径 | 适用场景 |
|------|----------|----------|
| 模型转换概述 | `/Model_deploy/overview/` | 用户问模型转换流程 |
| ONNX 转 BIN | `/Model_deploy/onnx_to_bin/` | 用户问 ONNX 模型转换 |
| 模型优化 | `/Model_deploy/optimization/` | 用户问模型量化/优化 |
| 模型验证 | `/Model_deploy/verification/` | 用户问模型精度验证 |

### 6. 机器人开发 (Robot_development)

| 主题 | URL 路径 | 适用场景 |
|------|----------|----------|
| TROS 安装 | `/Robot_development/quick_start/` | 用户问 TROS/ROS2 安装 |
| 目标检测 (YOLO) | `/Robot_development/boxs/detection/yolo/` | 用户问 YOLO 检测部署 |
| FCOS 检测 | `/Robot_development/boxs/detection/fcos/` | 用户问 FCOS 检测 |
| 语义分割 | `/Robot_development/boxs/segmentation/` | 用户问语义分割 |
| 人体关键点 | `/Robot_development/boxs/body_keypoint/` | 用户问人体姿态估计 |
| 手势识别 | `/Robot_development/boxs/hand_gesture/` | 用户问手势识别 |
| 目标跟踪 | `/Robot_development/boxs/tracking/` | 用户问目标跟踪 |
| SLAM | `/Robot_development/boxs/slam/` | 用户问 SLAM/建图/定位 |
| 导航 | `/Robot_development/boxs/navigation/` | 用户问自主导航 |
| 语音交互 | `/Robot_development/boxs/voice/` | 用户问语音识别/合成 |

### 7. 高级开发 (Advanced_development)

| 主题 | URL 路径 | 适用场景 |
|------|----------|----------|
| 硬件开发 (X5) | `/Advanced_development/hardware_development/rdk_x5/hardware/` | 用户问 X5 硬件设计资料 |
| 硬件开发 (X3) | `/Advanced_development/hardware_development/rdk_x3/hardware/` | 用户问 X3 硬件设计资料 |
| 内核开发 | `/Advanced_development/linux_development/` | 用户问 Linux 内核/驱动 |
| 多媒体开发 | `/Advanced_development/multimedia_development/` | 用户问底层多媒体 API |

## GitHub 代码仓库索引

| 仓库 | URL | 用途 |
|------|-----|------|
| rdk_model_zoo | `https://github.com/D-Robotics/rdk_model_zoo` | 预训练模型库（YOLO/分类/分割/检测） |
| hobot_dnn | `https://github.com/D-Robotics/hobot_dnn` | BPU 推理 ROS2 包 |
| hobot_cv | `https://github.com/D-Robotics/hobot_cv` | 图像处理 ROS2 包 |
| hobot_codec | `https://github.com/D-Robotics/hobot_codec` | 编解码 ROS2 包 |
| hobot_websocket | `https://github.com/D-Robotics/hobot_websocket` | WebSocket 推流 ROS2 包 |
| hobot_trigger | `https://github.com/D-Robotics/hobot_trigger` | 事件触发 ROS2 包 |

## 使用流程

```
用户问题 → 匹配文档索引 → web_fetch 获取页面 → 提取关键信息 → 回答用户
                                                    ↓
                                            需要板端操作时
                                                    ↓
                                        device_exec 执行命令
```

## 关键操作速查

### 摄像头实时画面
```bash
# 启动 YOLO 检测 + Web 可视化（RDK X5）
source /opt/tros/humble/setup.bash
ros2 launch dnn_node_example dnn_node_example.launch.py \
  dnn_example_config_file:=config/yolov5workconfig.json \
  dnn_example_image_width:=640 dnn_example_image_height:=480
# 浏览器访问 http://<设备IP>:8000 查看实时画面
```

### 模型部署快速流程
```bash
# 1. 查看已有模型
ls /opt/hobot/model/rdkx5/
# 2. 运行 YOLO 推理示例
cd /app/ai_inference
python3 01_yolov5_detect.py
```

### TROS 安装
```bash
# RDK X5 (Ubuntu 22.04)
sudo apt update
sudo apt install tros-humble-*
source /opt/tros/humble/setup.bash
```

## 板型差异速查

| 特性 | RDK X3 | RDK X5 | RDK S100 |
|------|--------|--------|----------|
| AI 算力 | 5 TOPS | 10 TOPS | 80/128 TOPS |
| CPU | 4×A53 | 8×A55 | 8×A78AE |
| 内存 | 2GB | 4/8GB | 8/16GB |
| 摄像头 | 1×MIPI | 2×MIPI | 2×MIPI |
| USB | 4×USB 2.0 | 2×USB 3.0 | 4×USB 3.0 |
| 系统 | Ubuntu 20.04 | Ubuntu 22.04 | Ubuntu 22.04 |
| ROS | Foxy | Humble | Humble |
| BPU 架构 | Bernoulli2 | Bayes-e | Nash-e |
