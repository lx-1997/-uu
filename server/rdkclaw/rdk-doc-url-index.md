# RDK 官方文档 URL 索引（developer.d-robotics.cc/rdk_doc）

本文件为 **唯一维护入口**：按站点侧栏可爬取的章节列出 **完整 URL**（由 `scripts/crawl-rdk-doc-paths.mjs` BFS 抓取生成 `_crawl-paths.txt` 后，运行 `node scripts/build-rdk-doc-url-index.mjs` 更新）。**每条列表标题**优先来自 GitHub `D-Robotics/rdk_doc` 与官网一致的 MD 首行标题（`node scripts/extract-rdk-doc-titles.mjs` 生成 `rdk-doc-titles.generated.json`），再由 `build-rdk-doc-url-index.mjs` 内 `MANUAL_NAME_OVERRIDES` 微调；`en/`、`rdk_s/` 路径在命中中文标题后追加 **（English）** / **（S100 · rdk_s）** 以区分站点区。无映射时回退为路径 slug。Agent 提示词从本文件加载，**请勿**在 TypeScript 中硬编码具体子链接。

> **根地址**：`https://developer.d-robotics.cc/rdk_doc/`  
> **S100 独立文档区根**：`https://developer.d-robotics.cc/rdk_doc/rdk_s/`  
> 已过滤侧栏中无效的 `.md` 直链；并剔除 OSS 上 **无索引页** 的目录 URL（如 `.../Robot_development/quick_start`、`.../boxs` 本体，子页面仍保留）。

### 排障速查（Agent：重复失败或 `hobot_usb`/V4L2 异常时优先 `web_fetch`）

- **USB 相机 / V4L2 / 官方示例**：见下节 **Basic Application / vision / usb camera**（及 **pydev demo / usb camera sample**）。
- **视频输入、编解码管线**：见下节 **Advanced development / multimedia / video_input**（及 `video_decode` / `video_processing`）。
- **人体检测（mono2d）**：文档标题 **人体检测和跟踪**（`.../body/mono2d_body_detection`）；**勿**使用已失效路径 `.../human_recognition/body_detection`（易 404）。
- **分割一切（MobileSAM / EdgeSAM）**：索引中标题为 **MobileSAM 分割一切**、**EdgeSAM 分割一切**（对应 `.../segmentation/mono_mobilesam`、`mono_edgesam`）；勿只靠英文 slug 检索。
- **仍无章节可对照**：`web_search` 用 `site:developer.d-robotics.cc` + 包名或节点名（如 `hobot_usb_cam`），再对命中 URL 做 `web_fetch`。

### 官网主导航与产品线（对照侧栏）

- **1 快速开始** → `Quick_start/`；**RDK X3 / X5 / Ultra** 硬件与烧录见其中 `hardware_introduction`、`install_os`；**RDK S100** 使用独立树 `rdk_s/Quick_start/`、`rdk_s/02_install_os/` 等。
- **2 系统配置** → `System_configuration/`。
- **3 基础应用开发** → `Basic_Application/`（及兼容路由 `03_Basic_Application/`）。
- **4 算法应用开发** → `Algorithm_Application/`。
- **5 机器人应用开发** → `Robot_development/`。**TROS 入门请勿使用** `.../Robot_development/quick_start`（无页面）；请用 **环境准备、安装 TROS、TROS 总览** 等子链接（见下节靠前条目）。
- **6 应用开发指南** → `Application_case/` 等。
- **7 进阶开发** → `Advanced_development/`、`03_multimedia_development`、`04_toolchain_development`。
- **8–10** → `FAQ`、`Appendix`、`Release_Note/`。

---

## 文档根与顶层入口

- **文档首页**：https://developer.d-robotics.cc/rdk_doc/

---

## Quick_start（快速开始）

- **Quick start**：https://developer.d-robotics.cc/rdk_doc/Quick_start
- **1.8 配件清单**：https://developer.d-robotics.cc/rdk_doc/Quick_start/accessory
- **1.6 算法体验（classification）**：https://developer.d-robotics.cc/rdk_doc/Quick_start/classification
- **1.3 入门配置向导（X3 / X5 / 等）**：https://developer.d-robotics.cc/rdk_doc/Quick_start/configuration_wizard
- **1.5.1 RDK X5**：https://developer.d-robotics.cc/rdk_doc/Quick_start/display_use/display_rdkx5
- **1.7 下载资源汇总**：https://developer.d-robotics.cc/rdk_doc/Quick_start/download
- **1.1.3 RDK Ultra**：https://developer.d-robotics.cc/rdk_doc/Quick_start/hardware_introduction/rdk_ultra
- **1.1.1 RDK X3**：https://developer.d-robotics.cc/rdk_doc/Quick_start/hardware_introduction/rdk_x3
- **1.1.2 RDK X5**：https://developer.d-robotics.cc/rdk_doc/Quick_start/hardware_introduction/rdk_x5
- **1.2.3 RDK Ultra**：https://developer.d-robotics.cc/rdk_doc/Quick_start/install_os/rdk_ultra
- **1.2.1 RDK X3**：https://developer.d-robotics.cc/rdk_doc/Quick_start/install_os/rdk_x3
- **1.2.2 RDK X5**：https://developer.d-robotics.cc/rdk_doc/Quick_start/install_os/rdk_x5
- **1.9.8 社区**：https://developer.d-robotics.cc/rdk_doc/Quick_start/RDK_Studio/Community
- **添加 RDK 设备**：https://developer.d-robotics.cc/rdk_doc/Quick_start/RDK_Studio/Device_management/hardware_resource
- **RDK Studio 集成工具的使用**：https://developer.d-robotics.cc/rdk_doc/Quick_start/RDK_Studio/Device_management/integration_tools
- **1.9.2 下载安装**：https://developer.d-robotics.cc/rdk_doc/Quick_start/RDK_Studio/download
- **人体关键点检测**：https://developer.d-robotics.cc/rdk_doc/Quick_start/RDK_Studio/Example_Applications/body_detect
- **手势识别**：https://developer.d-robotics.cc/rdk_doc/Quick_start/RDK_Studio/Example_Applications/gesture
- **Node-RED 打开示例**：https://developer.d-robotics.cc/rdk_doc/Quick_start/RDK_Studio/Example_Applications/node_red
- **YOLO 目标检测**：https://developer.d-robotics.cc/rdk_doc/Quick_start/RDK_Studio/Example_Applications/YOLO
- **1.9.4 烧录系统**：https://developer.d-robotics.cc/rdk_doc/Quick_start/RDK_Studio/flashing
- **1.9.3 界面说明**：https://developer.d-robotics.cc/rdk_doc/Quick_start/RDK_Studio/home
- **1.9.9 NodeHub**：https://developer.d-robotics.cc/rdk_doc/Quick_start/RDK_Studio/nodehub
- **1.9.7.2 配置飞书机器人**：https://developer.d-robotics.cc/rdk_doc/Quick_start/RDK_Studio/openclaw/config_feishu
- **1.9.7.1 安装并配置 OpenClaw**：https://developer.d-robotics.cc/rdk_doc/Quick_start/RDK_Studio/openclaw/config_openclaw
- **1.9.1 RDK Studio 简介**：https://developer.d-robotics.cc/rdk_doc/Quick_start/RDK_Studio/rdk_studio
- **1.9.10 版本更新**：https://developer.d-robotics.cc/rdk_doc/Quick_start/RDK_Studio/version
- **1.4 远程登录**：https://developer.d-robotics.cc/rdk_doc/Quick_start/remote_login

---

## System_configuration（系统配置）

- **System configuration**：https://developer.d-robotics.cc/rdk_doc/System_configuration
- **2.3 config.txt 文件配置**：https://developer.d-robotics.cc/rdk_doc/System_configuration/config_txt
- **2.4 Thermal和CPU频率管理**：https://developer.d-robotics.cc/rdk_doc/System_configuration/frequency_management
- **2.1 网络与蓝牙配置**：https://developer.d-robotics.cc/rdk_doc/System_configuration/network_blueteeth
- **2.5 开机自启动配置**：https://developer.d-robotics.cc/rdk_doc/System_configuration/self_start
- **2.2 srpi-config 工具配置**：https://developer.d-robotics.cc/rdk_doc/System_configuration/srpi-config

---

## Basic_Application（基础应用）

- **03 Basic Application / 02 audio**：https://developer.d-robotics.cc/rdk_doc/03_Basic_Application/02_audio
- **03 Basic Application / 02 cdev demo sample**：https://developer.d-robotics.cc/rdk_doc/03_Basic_Application/02_cdev_demo_sample
- **03 Basic Application / 05 audio / rdk x3 and rdk x3 module**：https://developer.d-robotics.cc/rdk_doc/03_Basic_Application/05_audio/rdk_x3_and_rdk_x3_module
- **03 Basic Application / 05 audio / rdk x5**：https://developer.d-robotics.cc/rdk_doc/03_Basic_Application/05_audio/rdk_x5
- **Basic Application**：https://developer.d-robotics.cc/rdk_doc/Basic_Application
- **3.1.1 管脚定义与应用**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/01_40pin_user_sample/40pin_define
- **3.1.2 GPIO应用**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/01_40pin_user_sample/gpio
- **3.1.5 I2C应用**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/01_40pin_user_sample/i2c
- **3.1.3 PWM 应用**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/01_40pin_user_sample/pwm
- **3.1.6 SPI应用**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/01_40pin_user_sample/spi
- **3.1.4 串口应用**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/01_40pin_user_sample/uart
- **幻尔载板**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/audio/rdk_x5/hiwonder_rasb5
- **3.2.1 bpu 示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/cdev_demo_sample/bpu
- **3.2.2 decode2display 示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/cdev_demo_sample/decode2display
- **3.2.3 rtsp2display 示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/cdev_demo_sample/rtsp2display
- **3.2.4 vio_capture 示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/cdev_demo_sample/vio_capture
- **3.2.5 vio2display 示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/cdev_demo_sample/vio2display
- **3.2.6 vio2encoder 示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/cdev_demo_sample/vio2encoder
- **3.6.1 参考示例（ C++）**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/multi_media_sp_dev_api/cdev_demo
- **BPU（算法推理模块）API**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/multi_media_sp_dev_api/multi_media_api/cdev_multimedia_api_ultra/bpu_api
- **DECODER（解码模块）API**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/multi_media_sp_dev_api/multi_media_api/cdev_multimedia_api_ultra/decoder_api
- **DISPLAY（显示模块）API**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/multi_media_sp_dev_api/multi_media_api/cdev_multimedia_api_ultra/display_api
- **ENCODER（编码模块）API**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/multi_media_sp_dev_api/multi_media_api/cdev_multimedia_api_ultra/encoder_api
- **SYS（模块绑定）API**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/multi_media_sp_dev_api/multi_media_api/cdev_multimedia_api_ultra/sys_api
- **VIO（视频输入）API**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/multi_media_sp_dev_api/multi_media_api/cdev_multimedia_api_ultra/vio_api
- **VIO（视频输入）API**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/multi_media_sp_dev_api/multi_media_api/cdev_multimedia_api_x3/vio_api
- **Basic Application / multi media sp dev api / multi media api / pydev multimedia api ultra**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/multi_media_sp_dev_api/multi_media_api/pydev_multimedia_api_ultra
- **Basic Application / multi media sp dev api / multi media api / pydev multimedia api x3**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/multi_media_sp_dev_api/multi_media_api/pydev_multimedia_api_x3
- **3.6.2 参考示例（python）**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/multi_media_sp_dev_api/pydev_vio_demo
- **3.3.1 基础图像分类示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/pydev_demo_sample/basic_sample
- **3.3.6 centernet 示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/pydev_demo_sample/centernet_sample
- **3.3.11 rtsp 推流解码示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/pydev_demo_sample/decode_rtsp_stream
- **3.3.9 mipi camera 示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/pydev_demo_sample/mipi_camera_sample
- **3.3.2 segment 模型示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/pydev_demo_sample/segment_sample
- **3.3.8 usb 摄像头示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/pydev_demo_sample/usb_camera_sample
- **3.3.10 web 显示摄像头示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/pydev_demo_sample/web_display_camera_sample
- **3.3.3 yolov3  模型示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/pydev_demo_sample/yolov3_sample
- **3.3.4 yolov5 模型示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/pydev_demo_sample/yolov5_sample
- **3.3.7 yolov5s_v6_v7 示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/pydev_demo_sample/yolov5s_v6_v7_sample
- **3.3.5 yolov5x 模型示例介绍**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/pydev_demo_sample/yolov5x_sample
- **3.4.1 MIPI摄像头使用**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/vision/mipi_camera
- **3.4.2 USB摄像头使用**：https://developer.d-robotics.cc/rdk_doc/Basic_Application/vision/usb_camera

---

## Basic_Development（基础开发）

- **Basic Development**：https://developer.d-robotics.cc/rdk_doc/Basic_Development

---

## Python_development / Cpp_development / Model_deploy（索引页）

- **Cpp development**：https://developer.d-robotics.cc/rdk_doc/Cpp_development
- **Model deploy**：https://developer.d-robotics.cc/rdk_doc/Model_deploy
- **Python development**：https://developer.d-robotics.cc/rdk_doc/Python_development

---

## Algorithm_Application（算法与 Model Zoo）

- **4.1.2 ModelZoo快速上手**：https://developer.d-robotics.cc/rdk_doc/Algorithm_Application/model_zoo/bpu_infer_lib_intro
- **4.1.3 ModelZoo推理接口**：https://developer.d-robotics.cc/rdk_doc/Algorithm_Application/model_zoo/infer_api
- **4.1.1 ModelZoo概述**：https://developer.d-robotics.cc/rdk_doc/Algorithm_Application/model_zoo/model_zoo_intro

---

## Robot_development（机器人应用 / TROS / boxs）

> **说明**：`https://.../Robot_development/quick_start`（仅目录）与 `.../boxs`、`.../boxs/detection` 在站点上 **404**；下列 **TROS / 机器人 · …** 与 **boxs/具体算法页** 为有效链接。

- **Robot development**：https://developer.d-robotics.cc/rdk_doc/Robot_development
- **5.1.1 环境准备**：https://developer.d-robotics.cc/rdk_doc/Robot_development/quick_start/preparation
- **5.1.2 apt安装与升级**：https://developer.d-robotics.cc/rdk_doc/Robot_development/quick_start/install_tros
- **5.1.4 运行“Hello World”**：https://developer.d-robotics.cc/rdk_doc/Robot_development/quick_start/hello_world
- **5.1.3 源码安装**：https://developer.d-robotics.cc/rdk_doc/Robot_development/quick_start/cross_compile
- **5.1.5 使用ROS2 package**：https://developer.d-robotics.cc/rdk_doc/Robot_development/quick_start/ros_pkg
- **5.1.6 版本发布记录**：https://developer.d-robotics.cc/rdk_doc/Robot_development/quick_start/changelog
- **TogetheROS.Bot 简介**：https://developer.d-robotics.cc/rdk_doc/Robot_development/tros
- **5.5.2 模型推理**：https://developer.d-robotics.cc/rdk_doc/Robot_development/tros_dev/ai_predict
- **5.5.3 breakpad使用**：https://developer.d-robotics.cc/rdk_doc/Robot_development/tros_dev/breakpad
- **5.5.4 性能火焰图**：https://developer.d-robotics.cc/rdk_doc/Robot_development/tros_dev/flame_graph
- **5.5.5 垃圾检测**：https://developer.d-robotics.cc/rdk_doc/Robot_development/tros_dev/mono2d_trash_detection
- **5.5.1 使用“zero-copy”**：https://developer.d-robotics.cc/rdk_doc/Robot_development/tros_dev/zero_copy
- **5.2.6 模型推理**：https://developer.d-robotics.cc/rdk_doc/Robot_development/quick_demo/ai_predict
- **5.2.5 数据通信**：https://developer.d-robotics.cc/rdk_doc/Robot_development/quick_demo/demo_communication
- **5.2.4 图像处理加速**：https://developer.d-robotics.cc/rdk_doc/Robot_development/quick_demo/demo_cv
- **5.2.2 数据展示**：https://developer.d-robotics.cc/rdk_doc/Robot_development/quick_demo/demo_render
- **5.2.1 数据采集**：https://developer.d-robotics.cc/rdk_doc/Robot_development/quick_demo/demo_sensor
- **5.2.7 工具**：https://developer.d-robotics.cc/rdk_doc/Robot_development/quick_demo/demo_tool
- **5.2.3 图像编解码**：https://developer.d-robotics.cc/rdk_doc/Robot_development/quick_demo/hobot_codec
- **5.2.8 文本转语音**：https://developer.d-robotics.cc/rdk_doc/Robot_development/quick_demo/hobot_tts
- **5.4.6 语音控制小车运动**：https://developer.d-robotics.cc/rdk_doc/Robot_development/apps/car_audio_control
- **5.4.7 语音追踪控制小车运动**：https://developer.d-robotics.cc/rdk_doc/Robot_development/apps/car_audio_tracking
- **5.4.5 小车手势控制**：https://developer.d-robotics.cc/rdk_doc/Robot_development/apps/car_gesture_control
- **5.4.4 小车人体跟随**：https://developer.d-robotics.cc/rdk_doc/Robot_development/apps/car_tracking
- **5.4.3 姿态检测**：https://developer.d-robotics.cc/rdk_doc/Robot_development/apps/fall_detection
- **5.4.10 视觉语音盒子**：https://developer.d-robotics.cc/rdk_doc/Robot_development/apps/hobot_llamacpp
- **5.4.2 Navigation2**：https://developer.d-robotics.cc/rdk_doc/Robot_development/apps/navigation2
- **5.4.8 小车车位寻找**：https://developer.d-robotics.cc/rdk_doc/Robot_development/apps/parking_search
- **5.4.1 SLAM建图**：https://developer.d-robotics.cc/rdk_doc/Robot_development/apps/slam
- **5.4.9 智能盒子**：https://developer.d-robotics.cc/rdk_doc/Robot_development/apps/video_boxs
- **智能语音**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/audio/hobot_audio
- **Sensevoice**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/audio/sensevoice_ros2
- **手势识别**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/body/hand_gesture_detection
- **人手关键点检测**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/body/hand_lmk_detection
- **人手关键点及手势识别(mediapipe)**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/body/hand_lmk_gesture_mediapipe
- **人脸年龄检测**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/body/mono_face_age_detection
- **人脸106关键点检测**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/body/mono_face_landmarks_detection
- **人体检测和跟踪**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/body/mono2d_body_detection
- **人体检测和跟踪(Ultralytics YOLO Pose)**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/body/mono2d_yolo_pose
- **人体实例跟踪**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/body/reid
- **Robot development / boxs / classification / mobilenetv2**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/classification/mobilenetv2
- **EfficientNet_Det**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/detection/efficientnet
- **Robot development / boxs / detection / fcos**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/detection/fcos
- **DOSOD**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/detection/hobot_dosod
- **YOLO-World**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/detection/hobot_yolo_world
- **MobileNet_SSD**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/detection/mobilenet
- **Robot development / boxs / detection / yolo**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/detection/yolo
- **BEV感知算法**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/driver/hobot_bev
- **文本图片特征检索**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/function/hobot_clip
- **光流估计**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/function/mono_pwcnet
- **Bloom大语言模型**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/generate/hobot_llm
- **DeepSeek大语言模型**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/generate/hobot_xlm
- **语义分割（MobileNet-UNet）**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/segmentation/mobilenet_unet
- **EdgeSAM 分割一切**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/segmentation/mono_edgesam
- **MobileSAM 分割一切**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/segmentation/mono_mobilesam
- **Ultralytics YOLOv8-Seg**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/segmentation/yolov8_seg
- **双目OCC算法**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/spatial/dstereo_occupancy
- **单目高程网络检测**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/spatial/elevation_net
- **双目深度算法**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/spatial/hobot_stereonet
- **双目IMU相机**：https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/spatial/stereo_imu_cam
- **5.6 已知问题**：https://developer.d-robotics.cc/rdk_doc/Robot_development/known_issues

---

## Application_case（应用案例）

- **Application case**：https://developer.d-robotics.cc/rdk_doc/Application_case
- **6.2 AMR开发指南**：https://developer.d-robotics.cc/rdk_doc/Application_case/amr
- **6.1 深度学习巡线小车**：https://developer.d-robotics.cc/rdk_doc/Application_case/line_follower

---

## Advanced_development（高级开发 / 工具链 / 多媒体子站）

- **03 multimedia development**：https://developer.d-robotics.cc/rdk_doc/03_multimedia_development
- **04 toolchain development**：https://developer.d-robotics.cc/rdk_doc/04_toolchain_development
- **Advanced development**：https://developer.d-robotics.cc/rdk_doc/Advanced_development
- **硬件资料**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/hardware_development/rdk_ultra/hardware
- **硬件资料**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/hardware_development/rdk_x3_module/hardware
- **配件清单**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/hardware_development/rdk_x3/accessory
- **硬件资料**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/hardware_development/rdk_x3/hardware
- **硬件资料**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/hardware_development/rdk_x5_module/hardware
- **配件清单**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/hardware_development/rdk_x5/accessory
- **硬件资料**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/hardware_development/rdk_x5/hardware
- **Advanced development / linux development / driver development**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/linux_development/driver_development
- **Advanced development / linux development / driver development x5**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/linux_development/driver_development_x5
- **7.2.1 开发环境搭建及编译说明**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/linux_development/environment_build
- **Advanced development / linux development / hardware unit test**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/linux_development/hardware_unit_test
- **7.2.5 内核头文件**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/linux_development/kernel_headers
- **7.2.6 应用实时内核**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/linux_development/realtime_kernel
- **7.3.11 查询多媒体模块调试信息**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/multimedia_development/debug_info
- **7.3.5 ISP图像系统**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/multimedia_development/isp_system
- **7.3.2 示例程序**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/multimedia_development/multimedia_samples
- **7.3.1 系统概述**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/multimedia_development/overview
- **7.3.12 多媒体性能调试**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/multimedia_development/performance_debug
- **7.3.7 区域处理**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/multimedia_development/region_processing
- **7.3.3 系统控制**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/multimedia_development/system_control
- **7.3.10 视频解码**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/multimedia_development/video_decode
- **7.3.9 视频编码**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/multimedia_development/video_encode
- **7.3.4 视频输入**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/multimedia_development/video_input
- **7.3.8 视频输出**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/multimedia_development/video_output
- **7.3.6 视频处理**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/multimedia_development/video_processing
- **Advanced development / toolchain development / expert**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/toolchain_development/expert
- **深入探索**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/toolchain_development/expert/advanced_content
- **API手册**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/toolchain_development/expert/api_reference
- **环境依赖**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/toolchain_development/expert/environment_config
- **附录**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/toolchain_development/expert/note
- **快速上手{#quick_start}**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/toolchain_development/expert/quick_start
- **开发指南**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/toolchain_development/expert/user_guide
- **Advanced development / toolchain development / intermediate**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/toolchain_development/intermediate
- **7.4.1 简介**：https://developer.d-robotics.cc/rdk_doc/Advanced_development/toolchain_development/overview

---

## FAQ

- **FAQ**：https://developer.d-robotics.cc/rdk_doc/FAQ
- **8.3 应用开发、编译与示例**：https://developer.d-robotics.cc/rdk_doc/FAQ/applications_and_examples
- **8.7 桌面应用**：https://developer.d-robotics.cc/rdk_doc/FAQ/desktop_app
- **8.1 硬件、系统与环境配置**：https://developer.d-robotics.cc/rdk_doc/FAQ/hardware_and_system
- **8.2 接口、外设与驱动**：https://developer.d-robotics.cc/rdk_doc/FAQ/interface
- **8.4 多媒体处理与应用**：https://developer.d-robotics.cc/rdk_doc/FAQ/multimedia
- **8.5 AI模型、算法与工具链**：https://developer.d-robotics.cc/rdk_doc/FAQ/toolchain
- **8.6 TROS/ROS 开发**：https://developer.d-robotics.cc/rdk_doc/FAQ/tros_ros

---

## Appendix（附录与命令手册）

- **Appendix**：https://developer.d-robotics.cc/rdk_doc/Appendix
- **apt**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_apt
- **dmesg**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_dmesg
- **dpkg**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_dpkg
- **dpkg-deb**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_dpkg-deb
- **find**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_find
- **grep**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_grep
- **ifconfig**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_ifconfig
- **ip**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_ip
- **mount**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_mount
- **netstat**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_netstat
- **nohup**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_nohup
- **ps**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_ps
- **route**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_route
- **rsync**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_rsync
- **scp**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_scp
- **ssh**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_ssh
- **tar**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_tar
- **top**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_top
- **zip**：https://developer.d-robotics.cc/rdk_doc/Appendix/linux-command-manual/cmd_zip
- **devmem**：https://developer.d-robotics.cc/rdk_doc/Appendix/rdk-command-manual/cmd_devmem
- **hrut_boardid （RDK X3）**：https://developer.d-robotics.cc/rdk_doc/Appendix/rdk-command-manual/cmd_hrut_boardid
- **hrut_boardid （RDK X5）**：https://developer.d-robotics.cc/rdk_doc/Appendix/rdk-command-manual/cmd_hrut_boardid_rdkx5
- **hrut_ps**：https://developer.d-robotics.cc/rdk_doc/Appendix/rdk-command-manual/cmd_hrut_ps
- **hrut_socuid**：https://developer.d-robotics.cc/rdk_doc/Appendix/rdk-command-manual/cmd_hrut_socuid
- **hrut_somstatus**：https://developer.d-robotics.cc/rdk_doc/Appendix/rdk-command-manual/cmd_hrut_somstatus
- **rdk-backup**：https://developer.d-robotics.cc/rdk_doc/Appendix/rdk-command-manual/cmd_rdk-backup
- **rdk-miniboot-update**：https://developer.d-robotics.cc/rdk_doc/Appendix/rdk-command-manual/cmd_rdk-miniboot-update
- **rdkos_info**：https://developer.d-robotics.cc/rdk_doc/Appendix/rdk-command-manual/cmd_rdkos_info

---

## Release_Note（发行说明）

- **RDK X系列历史发布**：https://developer.d-robotics.cc/rdk_doc/Release_Note/release_note

---

## 其他中文顶层（RDK / RDK Studio / 设备管理等）

- **Device management**：https://developer.d-robotics.cc/rdk_doc/Device_management
- **display use**：https://developer.d-robotics.cc/rdk_doc/display_use
- **Example Applications**：https://developer.d-robotics.cc/rdk_doc/Example_Applications
- **hardware development**：https://developer.d-robotics.cc/rdk_doc/hardware_development
- **hardware introduction**：https://developer.d-robotics.cc/rdk_doc/hardware_introduction
- **install os**：https://developer.d-robotics.cc/rdk_doc/install_os
- **linux development**：https://developer.d-robotics.cc/rdk_doc/linux_development
- **D-Robotics RDK套件**：https://developer.d-robotics.cc/rdk_doc/RDK
- **RDK Studio**：https://developer.d-robotics.cc/rdk_doc/RDK_Studio

---

## OpenClaw

- **07 openclaw**：https://developer.d-robotics.cc/rdk_doc/07_openclaw

---

## 英文文档（en）

- **en**：https://developer.d-robotics.cc/rdk_doc/en
- **en / 03 Basic Application / 02 audio**：https://developer.d-robotics.cc/rdk_doc/en/03_Basic_Application/02_audio
- **en / 03 Basic Application / 02 cdev demo sample**：https://developer.d-robotics.cc/rdk_doc/en/03_Basic_Application/02_cdev_demo_sample
- **en / 03 multimedia development**：https://developer.d-robotics.cc/rdk_doc/en/03_multimedia_development
- **en / 04 toolchain development**：https://developer.d-robotics.cc/rdk_doc/en/04_toolchain_development
- **en / 07 openclaw**：https://developer.d-robotics.cc/rdk_doc/en/07_openclaw
- **en / Advanced development**：https://developer.d-robotics.cc/rdk_doc/en/Advanced_development
- **附录（English）**：https://developer.d-robotics.cc/rdk_doc/en/Advanced_development/toolchain_development/expert/note
- **4.1.3 ModelZoo推理接口（English）**：https://developer.d-robotics.cc/rdk_doc/en/Algorithm_Application/model_zoo/infer_api
- **4.1.1 ModelZoo概述（English）**：https://developer.d-robotics.cc/rdk_doc/en/Algorithm_Application/model_zoo/model_zoo_intro
- **en / Appendix**：https://developer.d-robotics.cc/rdk_doc/en/Appendix
- **apt（English）**：https://developer.d-robotics.cc/rdk_doc/en/Appendix/linux-command-manual/cmd_apt
- **zip（English）**：https://developer.d-robotics.cc/rdk_doc/en/Appendix/linux-command-manual/cmd_zip
- **devmem（English）**：https://developer.d-robotics.cc/rdk_doc/en/Appendix/rdk-command-manual/cmd_devmem
- **rdk-backup（English）**：https://developer.d-robotics.cc/rdk_doc/en/Appendix/rdk-command-manual/cmd_rdk-backup
- **en / Application case**：https://developer.d-robotics.cc/rdk_doc/en/Application_case
- **6.2 AMR开发指南（English）**：https://developer.d-robotics.cc/rdk_doc/en/Application_case/amr
- **6.1 深度学习巡线小车（English）**：https://developer.d-robotics.cc/rdk_doc/en/Application_case/line_follower
- **en / Basic Application**：https://developer.d-robotics.cc/rdk_doc/en/Basic_Application
- **3.1.1 管脚定义与应用（English）**：https://developer.d-robotics.cc/rdk_doc/en/Basic_Application/01_40pin_user_sample/40pin_define
- **3.6.1 参考示例（ C++）（English）**：https://developer.d-robotics.cc/rdk_doc/en/Basic_Application/multi_media_sp_dev_api/cdev_demo
- **SYS（模块绑定）API（English）**：https://developer.d-robotics.cc/rdk_doc/en/Basic_Application/multi_media_sp_dev_api/multi_media_api/cdev_multimedia_api_ultra/sys_api
- **3.3.1 基础图像分类示例介绍（English）**：https://developer.d-robotics.cc/rdk_doc/en/Basic_Application/pydev_demo_sample/basic_sample
- **3.4.1 MIPI摄像头使用（English）**：https://developer.d-robotics.cc/rdk_doc/en/Basic_Application/vision/mipi_camera
- **en / Basic Development**：https://developer.d-robotics.cc/rdk_doc/en/Basic_Development
- **en / Device management**：https://developer.d-robotics.cc/rdk_doc/en/Device_management
- **en / display use**：https://developer.d-robotics.cc/rdk_doc/en/display_use
- **en / Example Applications**：https://developer.d-robotics.cc/rdk_doc/en/Example_Applications
- **en / FAQ**：https://developer.d-robotics.cc/rdk_doc/en/FAQ
- **8.3 应用开发、编译与示例（English）**：https://developer.d-robotics.cc/rdk_doc/en/FAQ/applications_and_examples
- **8.7 桌面应用（English）**：https://developer.d-robotics.cc/rdk_doc/en/FAQ/desktop_app
- **8.1 硬件、系统与环境配置（English）**：https://developer.d-robotics.cc/rdk_doc/en/FAQ/hardware_and_system
- **8.2 接口、外设与驱动（English）**：https://developer.d-robotics.cc/rdk_doc/en/FAQ/interface
- **8.4 多媒体处理与应用（English）**：https://developer.d-robotics.cc/rdk_doc/en/FAQ/multimedia
- **8.5 AI模型、算法与工具链（English）**：https://developer.d-robotics.cc/rdk_doc/en/FAQ/toolchain
- **8.6 TROS/ROS 开发（English）**：https://developer.d-robotics.cc/rdk_doc/en/FAQ/tros_ros
- **en / hardware development**：https://developer.d-robotics.cc/rdk_doc/en/hardware_development
- **en / hardware introduction**：https://developer.d-robotics.cc/rdk_doc/en/hardware_introduction
- **en / install os**：https://developer.d-robotics.cc/rdk_doc/en/install_os
- **en / linux development**：https://developer.d-robotics.cc/rdk_doc/en/linux_development
- **en / Quick start**：https://developer.d-robotics.cc/rdk_doc/en/Quick_start
- **1.8 配件清单（English）**：https://developer.d-robotics.cc/rdk_doc/en/Quick_start/accessory
- **1.6 算法体验（English）**：https://developer.d-robotics.cc/rdk_doc/en/Quick_start/classification
- **1.3 入门配置（English）**：https://developer.d-robotics.cc/rdk_doc/en/Quick_start/configuration_wizard
- **1.7 下载资源汇总（English）**：https://developer.d-robotics.cc/rdk_doc/en/Quick_start/download
- **1.9.8 社区（English）**：https://developer.d-robotics.cc/rdk_doc/en/Quick_start/RDK_Studio/Community
- **1.9.2 下载安装（English）**：https://developer.d-robotics.cc/rdk_doc/en/Quick_start/RDK_Studio/download
- **1.9.4 烧录系统（English）**：https://developer.d-robotics.cc/rdk_doc/en/Quick_start/RDK_Studio/flashing
- **1.9.3 界面说明（English）**：https://developer.d-robotics.cc/rdk_doc/en/Quick_start/RDK_Studio/home
- **1.9.9 NodeHub（English）**：https://developer.d-robotics.cc/rdk_doc/en/Quick_start/RDK_Studio/nodehub
- **1.9.1 RDK Studio 简介（English）**：https://developer.d-robotics.cc/rdk_doc/en/Quick_start/RDK_Studio/rdk_studio
- **1.9.10 版本更新（English）**：https://developer.d-robotics.cc/rdk_doc/en/Quick_start/RDK_Studio/version
- **1.4 远程登录（English）**：https://developer.d-robotics.cc/rdk_doc/en/Quick_start/remote_login
- **D-Robotics RDK套件（English）**：https://developer.d-robotics.cc/rdk_doc/en/RDK
- **en / rdk s / 01 hardware introduction**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/01_hardware_introduction
- **en / rdk s / 02 install os**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/02_install_os
- **en / rdk s / 03 C++ Sample**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/03_C++_Sample
- **en / rdk s / 03 configuration wizard**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/03_configuration_wizard
- **en / rdk s / 03 Python Sample**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/03_Python_Sample
- **en / rdk s / Advanced development**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Advanced_development
- **4.1.1 ModelZoo概述（English · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Algorithm_Application/model_zoo/model_zoo_intro
- **en / rdk s / Algorithm Application / python-api**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Algorithm_Application/python-api
- **en / rdk s / Appendix**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Appendix
- **en / rdk s / Application case**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Application_case
- **en / rdk s / Basic Application**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Basic_Application
- **en / rdk s / Basic Application / 03 40pin user guide / 01 40pin define**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Basic_Application/03_40pin_user_guide/01_40pin_define
- **en / rdk s / Basic Application / audio / audio board s100**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Basic_Application/audio/audio_board_s100
- **en / rdk s / Basic Application / Image / mipi camera**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Basic_Application/Image/mipi_camera
- **en / rdk s / Basic Application / multi media / multi media api / cdev / sys api**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Basic_Application/multi_media/multi_media_api/cdev/sys_api
- **en / rdk s / Basic Application / multi media / pydev vio demo**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Basic_Application/multi_media/pydev_vio_demo
- **en / rdk s / Basic Development**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Basic_Development
- **en / rdk s / FAQ**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/FAQ
- **en / rdk s / Quick start**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Quick_start
- **1.6 算法体验（English · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Quick_start/classification
- **1.7 下载资源汇总（English · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Quick_start/download
- **1.4 远程登录（English · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Quick_start/remote_login
- **D-Robotics RDK套件（English · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/RDK
- **en / rdk s / Release Note / roadmap**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Release_Note/roadmap
- **en / rdk s / Robot development**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Robot_development
- **5.4.1 SLAM建图（English · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Robot_development/apps/slam
- **en / rdk s / Robot development / boxs / detection / fcos**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Robot_development/boxs/detection/fcos
- **5.6 已知问题（English · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Robot_development/known_issues
- **5.2.1 数据采集（English · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Robot_development/quick_demo/demo_sensor
- **5.1.1 环境准备（English · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Robot_development/quick_start/preparation
- **TogetheROS.Bot 简介（English · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Robot_development/tros
- **5.5.1 使用“zero-copy”（English · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/Robot_development/tros_dev/zero_copy
- **en / rdk s / System configuration**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/System_configuration
- **2.3 config.txt 文件配置（English · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/System_configuration/config_txt
- **2.4 Thermal和CPU频率管理（English · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/System_configuration/frequency_management
- **en / rdk s / System configuration / gui network config**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/System_configuration/gui_network_config
- **en / rdk s / System configuration / network bluetooth**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/System_configuration/network_bluetooth
- **2.5 开机自启动配置（English · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/System_configuration/self_start
- **en / rdk s / System configuration / share file tool**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/System_configuration/share_file_tool
- **2.2 srpi-config 工具配置（English · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/en/rdk_s/System_configuration/srpi-config
- **en / RDK Studio**：https://developer.d-robotics.cc/rdk_doc/en/RDK_Studio
- **RDK X系列历史发布（English）**：https://developer.d-robotics.cc/rdk_doc/en/Release_Note/release_note
- **en / Robot development**：https://developer.d-robotics.cc/rdk_doc/en/Robot_development
- **5.4.1 SLAM建图（English）**：https://developer.d-robotics.cc/rdk_doc/en/Robot_development/apps/slam
- **5.4.9 智能盒子（English）**：https://developer.d-robotics.cc/rdk_doc/en/Robot_development/apps/video_boxs
- **en / Robot development / boxs / detection / fcos**：https://developer.d-robotics.cc/rdk_doc/en/Robot_development/boxs/detection/fcos
- **en / Robot development / boxs / detection / yolo**：https://developer.d-robotics.cc/rdk_doc/en/Robot_development/boxs/detection/yolo
- **文本图片特征检索（English）**：https://developer.d-robotics.cc/rdk_doc/en/Robot_development/boxs/function/hobot_clip
- **光流估计（English）**：https://developer.d-robotics.cc/rdk_doc/en/Robot_development/boxs/function/mono_pwcnet
- **Ultralytics YOLOv8-Seg（English）**：https://developer.d-robotics.cc/rdk_doc/en/Robot_development/boxs/segmentation/yolov8_seg
- **5.6 已知问题（English）**：https://developer.d-robotics.cc/rdk_doc/en/Robot_development/known_issues
- **5.2.1 数据采集（English）**：https://developer.d-robotics.cc/rdk_doc/en/Robot_development/quick_demo/demo_sensor
- **5.2.7 工具（English）**：https://developer.d-robotics.cc/rdk_doc/en/Robot_development/quick_demo/demo_tool
- **5.2.3 图像编解码（English）**：https://developer.d-robotics.cc/rdk_doc/en/Robot_development/quick_demo/hobot_codec
- **5.1.6 版本发布记录（English）**：https://developer.d-robotics.cc/rdk_doc/en/Robot_development/quick_start/changelog
- **5.1.1 环境准备（English）**：https://developer.d-robotics.cc/rdk_doc/en/Robot_development/quick_start/preparation
- **TogetheROS.Bot 简介（English）**：https://developer.d-robotics.cc/rdk_doc/en/Robot_development/tros
- **5.5.1 使用“zero-copy”（English）**：https://developer.d-robotics.cc/rdk_doc/en/Robot_development/tros_dev/zero_copy
- **en / System configuration**：https://developer.d-robotics.cc/rdk_doc/en/System_configuration
- **2.3 config.txt 文件配置（English）**：https://developer.d-robotics.cc/rdk_doc/en/System_configuration/config_txt
- **2.4 Thermal和CPU频率管理（English）**：https://developer.d-robotics.cc/rdk_doc/en/System_configuration/frequency_management
- **2.1 网络与蓝牙配置（English）**：https://developer.d-robotics.cc/rdk_doc/en/System_configuration/network_blueteeth
- **2.5 开机自启动配置（English）**：https://developer.d-robotics.cc/rdk_doc/en/System_configuration/self_start
- **2.2 srpi-config 工具配置（English）**：https://developer.d-robotics.cc/rdk_doc/en/System_configuration/srpi-config

---

## rdk_s（RDK S100 独立文档树）

- **rdk s / 01 hardware introduction**：https://developer.d-robotics.cc/rdk_doc/rdk_s/01_hardware_introduction
- **rdk s / 02 install os**：https://developer.d-robotics.cc/rdk_doc/rdk_s/02_install_os
- **rdk s / 02 install os / rdk s100**：https://developer.d-robotics.cc/rdk_doc/rdk_s/02_install_os/rdk_s100
- **rdk s / 03 C++ Sample**：https://developer.d-robotics.cc/rdk_doc/rdk_s/03_C++_Sample
- **rdk s / 03 configuration wizard**：https://developer.d-robotics.cc/rdk_doc/rdk_s/03_configuration_wizard
- **rdk s / 03 multimedia development**：https://developer.d-robotics.cc/rdk_doc/rdk_s/03_multimedia_development
- **rdk s / 03 Python Sample**：https://developer.d-robotics.cc/rdk_doc/rdk_s/03_Python_Sample
- **rdk s / 04 toolchain development**：https://developer.d-robotics.cc/rdk_doc/rdk_s/04_toolchain_development
- **rdk s / 05 MCU development**：https://developer.d-robotics.cc/rdk_doc/rdk_s/05_MCU_development
- **rdk s / Advanced development**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Advanced_development
- **rdk s / Advanced development / hardware development / accessory**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Advanced_development/hardware_development/accessory
- **7.2.5 内核头文件（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Advanced_development/linux_development/kernel_headers
- **rdk s / Advanced development / linux development / OTA / ota miniboot**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Advanced_development/linux_development/OTA/ota_miniboot
- **rdk s / Advanced development / rdk gen**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Advanced_development/rdk_gen
- **rdk s / Advanced development / vdsp development**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Advanced_development/vdsp_development
- **rdk s / Algorithm Application / C++ Sample / rtsp yolov5x display**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/C++_Sample/rtsp_yolov5x_display
- **4.1.1 ModelZoo概述（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/model_zoo/model_zoo_intro
- **rdk s / Algorithm Application / Python Sample / ASR**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/ASR
- **rdk s / Algorithm Application / Python Sample / LaneNet**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/LaneNet
- **rdk s / Algorithm Application / Python Sample / mipi camera yolov5x**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/mipi_camera_yolov5x
- **rdk s / Algorithm Application / Python Sample / MobileNetV2**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/MobileNetV2
- **rdk s / Algorithm Application / Python Sample / PaddleOCR**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/PaddleOCR
- **rdk s / Algorithm Application / Python Sample / ResNet18**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/ResNet18
- **rdk s / Algorithm Application / Python Sample / rtsp yolov5x display**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/rtsp_yolov5x_display
- **rdk s / Algorithm Application / Python Sample / Summary**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/Summary
- **rdk s / Algorithm Application / Python Sample / Ultralytics YOLO11**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/Ultralytics_YOLO11
- **rdk s / Algorithm Application / Python Sample / Ultralytics YOLO11 Pose**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/Ultralytics_YOLO11_Pose
- **rdk s / Algorithm Application / Python Sample / Ultralytics YOLO11 Seg**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/Ultralytics_YOLO11_Seg
- **rdk s / Algorithm Application / Python Sample / Ultralytics YOLOE11 Seg**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/Ultralytics_YOLOE11_Seg
- **rdk s / Algorithm Application / Python Sample / Ultralytics YOLOv5x**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/Ultralytics_YOLOv5x
- **rdk s / Algorithm Application / Python Sample / UNetMobileNet**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/UNetMobileNet
- **rdk s / Algorithm Application / Python Sample / USB Camera yolov5x**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/USB_Camera_yolov5x
- **rdk s / Algorithm Application / Python Sample / WebSocket yolov5x**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/Python_Sample/WebSocket_yolov5x
- **rdk s / Algorithm Application / python-api**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Algorithm_Application/python-api
- **rdk s / Appendix**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Appendix
- **apt（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Appendix/linux-command-manual/cmd_apt
- **zip（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Appendix/linux-command-manual/cmd_zip
- **devmem（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Appendix/rdk-command-manual/cmd_devmem
- **rdk s / Application case**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Application_case
- **rdk s / Application case / intro**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Application_case/intro
- **rdk s / Basic Application**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Basic_Application
- **rdk s / Basic Application / 03 40pin user guide / 01 40pin define**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Basic_Application/03_40pin_user_guide/01_40pin_define
- **rdk s / Basic Application / 03 40pin user guide / gpio**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Basic_Application/03_40pin_user_guide/gpio
- **rdk s / Basic Application / 03 40pin user guide / i2c**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Basic_Application/03_40pin_user_guide/i2c
- **rdk s / Basic Application / 03 40pin user guide / pwm**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Basic_Application/03_40pin_user_guide/pwm
- **rdk s / Basic Application / 03 40pin user guide / spi**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Basic_Application/03_40pin_user_guide/spi
- **rdk s / Basic Application / 03 40pin user guide / uart**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Basic_Application/03_40pin_user_guide/uart
- **rdk s / Basic Application / audio / audio board s100**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Basic_Application/audio/audio_board_s100
- **rdk s / Basic Application / Image / mipi camera**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Basic_Application/Image/mipi_camera
- **rdk s / Basic Application / Image / usb camera**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Basic_Application/Image/usb_camera
- **rdk s / Basic Application / multi media / cdev demo**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Basic_Application/multi_media/cdev_demo
- **rdk s / Basic Application / multi media / multi media api / cdev / sys api**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Basic_Application/multi_media/multi_media_api/cdev/sys_api
- **rdk s / Basic Application / multi media / multi media api / pydev / object camera**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Basic_Application/multi_media/multi_media_api/pydev/object_camera
- **rdk s / Basic Application / multi media / pydev vio demo**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Basic_Application/multi_media/pydev_vio_demo
- **rdk s / Basic Development**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Basic_Development
- **rdk s / FAQ**：https://developer.d-robotics.cc/rdk_doc/rdk_s/FAQ
- **8.3 应用开发、编译与示例（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/FAQ/applications_and_examples
- **8.7 桌面应用（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/FAQ/desktop_app
- **8.1 硬件、系统与环境配置（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/FAQ/hardware_and_system
- **8.2 接口、外设与驱动（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/FAQ/interface
- **8.4 多媒体处理与应用（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/FAQ/multimedia
- **8.5 AI模型、算法与工具链（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/FAQ/toolchain
- **8.6 TROS/ROS 开发（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/FAQ/tros_ros
- **rdk s / hardware development**：https://developer.d-robotics.cc/rdk_doc/rdk_s/hardware_development
- **rdk s / linux development**：https://developer.d-robotics.cc/rdk_doc/rdk_s/linux_development
- **rdk s / Quick start**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Quick_start
- **1.6 算法体验（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Quick_start/classification
- **S100 · 入门配置向导（rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Quick_start/configuration_wizard/configuration_wizard_s100
- **1.7 下载资源汇总（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Quick_start/download
- **rdk s / Quick start / hardware introduction / FAQ**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Quick_start/hardware_introduction/FAQ
- **S100 · 1.1 硬件简介（rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Quick_start/hardware_introduction/rdk_s100
- **rdk s / Quick start / hardware introduction / rdk s100 camera expansion board**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Quick_start/hardware_introduction/rdk_s100_camera_expansion_board
- **rdk s / Quick start / hardware introduction / rdk s100 mcu port expansion board**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Quick_start/hardware_introduction/rdk_s100_mcu_port_expansion_board
- **S100 · 系统烧录 FAQ（rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Quick_start/install_os/rdk_s100/FAQ
- **1.4 远程登录（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Quick_start/remote_login
- **D-Robotics RDK套件（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/RDK
- **rdk s / Release Note / roadmap**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Release_Note/roadmap
- **rdk s / Release Note / v4 0 2**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Release_Note/v4_0_2
- **rdk s / Release Note / v4 0 3**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Release_Note/v4_0_3
- **rdk s / Release Note / v4 0 4**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Release_Note/v4_0_4
- **rdk s / Release Note / v4 0 5**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Release_Note/v4_0_5
- **rdk s / Robot development**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development
- **5.4.6 语音控制小车运动（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/apps/car_audio_control
- **5.4.7 语音追踪控制小车运动（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/apps/car_audio_tracking
- **5.4.5 小车手势控制（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/apps/car_gesture_control
- **5.4.4 小车人体跟随（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/apps/car_tracking
- **5.4.3 姿态检测（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/apps/fall_detection
- **5.4.10 视觉语音盒子（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/apps/hobot_llamacpp
- **5.4.2 Navigation2（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/apps/navigation2
- **5.4.8 小车车位寻找（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/apps/parking_search
- **5.4.1 SLAM建图（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/apps/slam
- **5.4.9 智能盒子（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/apps/video_boxs
- **智能语音（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/boxs/audio/hobot_audio
- **人体检测和跟踪（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/boxs/body/mono2d_body_detection
- **rdk s / Robot development / boxs / classification / mobilenetv2**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/boxs/classification/mobilenetv2
- **EfficientNet_Det（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/boxs/detection/efficientnet
- **rdk s / Robot development / boxs / detection / fcos**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/boxs/detection/fcos
- **DOSOD（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/boxs/detection/hobot_dosod
- **YOLO-World（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/boxs/detection/hobot_yolo_world
- **MobileNet_SSD（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/boxs/detection/mobilenet
- **rdk s / Robot development / boxs / detection / yolo**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/boxs/detection/yolo
- **BEV感知算法（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/boxs/driver/hobot_bev
- **文本图片特征检索（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/boxs/function/hobot_clip
- **Bloom大语言模型（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/boxs/generate/hobot_llm
- **语义分割 MobileNet-UNet（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/boxs/segmentation/mobilenet_unet
- **单目高程网络检测（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/boxs/spatial/elevation_net
- **5.6 已知问题（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/known_issues
- **5.2.6 模型推理（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/quick_demo/ai_predict
- **5.2.5 数据通信（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/quick_demo/demo_communication
- **5.2.4 图像处理加速（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/quick_demo/demo_cv
- **5.2.2 数据展示（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/quick_demo/demo_render
- **5.2.1 数据采集（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/quick_demo/demo_sensor
- **5.2.7 工具（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/quick_demo/demo_tool
- **5.2.3 图像编解码（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/quick_demo/hobot_codec
- **5.2.8 文本转语音（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/quick_demo/hobot_tts
- **5.1.6 版本发布记录（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/quick_start/changelog
- **5.1.3 源码安装（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/quick_start/cross_compile
- **5.1.4 运行“Hello World”（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/quick_start/hello_world
- **5.1.2 apt安装与升级（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/quick_start/install_tros
- **5.1.1 环境准备（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/quick_start/preparation
- **5.1.5 使用ROS2 package（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/quick_start/ros_pkg
- **TogetheROS.Bot 简介（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/tros
- **5.5.2 模型推理（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/tros_dev/ai_predict
- **5.5.3 breakpad使用（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/tros_dev/breakpad
- **5.5.4 性能火焰图（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/tros_dev/flame_graph
- **5.5.5 垃圾检测（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/tros_dev/mono2d_trash_detection
- **5.5.1 使用“zero-copy”（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/Robot_development/tros_dev/zero_copy
- **rdk s / System configuration**：https://developer.d-robotics.cc/rdk_doc/rdk_s/System_configuration
- **2.3 config.txt 文件配置（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/System_configuration/config_txt
- **2.4 Thermal和CPU频率管理（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/System_configuration/frequency_management
- **rdk s / System configuration / gui network config**：https://developer.d-robotics.cc/rdk_doc/rdk_s/System_configuration/gui_network_config
- **rdk s / System configuration / network bluetooth**：https://developer.d-robotics.cc/rdk_doc/rdk_s/System_configuration/network_bluetooth
- **2.5 开机自启动配置（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/System_configuration/self_start
- **rdk s / System configuration / share file tool**：https://developer.d-robotics.cc/rdk_doc/rdk_s/System_configuration/share_file_tool
- **2.2 srpi-config 工具配置（S100 · rdk_s）**：https://developer.d-robotics.cc/rdk_doc/rdk_s/System_configuration/srpi-config

---
