# Ultralytics YOLOv8-Seg图像分割算法部署流程：用MIPI摄像头发布为照片

1. 配置tros.b环境
foxy版本:source /opt/tros/setup.bash
humble版本:source /opt/tros/humble/setup.bash

2. 配置MIPI摄像头
export CAM_TYPE=mipi

3. 启动launch文件
ros2 launch dnn_node_example dnn_node_example.launch.py dnn_example_dump_render_img:=0 dnn_example_config_file:=config/yolov8segworkconfig.json dnn_example_image_width:=1920 dnn_example_image_height:=1080

# Ultralytics YOLOv8-Seg图像分割算法部署流程：用usb摄像头发布为照片

1. 配置tros.b环境
foxy版本:source /opt/tros/setup.bash
humble版本:source /opt/tros/humble/setup.bash


2. 配置usb摄像头
export CAM_TYPE=usb

3. 启动launch文件
ros2 launch dnn_node_example dnn_node_example.launch.py dnn_example_dump_render_img:=0 dnn_example_config_file:=config/yolov8segworkconfig.json dnn_example_image_width:=1920 dnn_example_image_height:=1080

# Ultralytics YOLOv8-Seg图像分割算法部署流程：使用本地照片回灌

1. 配置tros.b环境
foxy版本:source /opt/tros/setup.bash
humble版本:source /opt/tros/humble/setup.bash

2. 启动launch文件
ros2 launch dnn_node_example dnn_node_example_feedback.launch.py dnn_example_config_file:=config/yolov8segworkconfig.json dnn_example_image:=config/test.jpg
