# mobilenetv2图片分类算法部署流程：用MIPI摄像头发布为照片

1. 配置tros.b环境
foxy版本:source /opt/tros/setup.bash
humble版本:source /opt/tros/humble/setup.bash

2. 配置MIPI摄像头
export CAM_TYPE=mipi

3. 启动launch文件
ros2 launch dnn_node_example dnn_node_example.launch.py dnn_example_config_file:=config/mobilenetv2workconfig.json dnn_example_image_width:=480 dnn_example_image_height:=272

4. 测试效果 
运行成功后在pc端游览器输入：[http://IP:8000](http://ip:8000/)，即可查看图像和算法渲染效果（IP为RDK的IP地址）

# mobilenetv2图片分类算法部署流程：用usb摄像头发布为照片


1. 配置tros.b环境
foxy版本:source /opt/tros/setup.bash
humble版本:source /opt/tros/humble/setup.bash

2. 配置usb摄像头
export CAM_TYPE=usb

3. 启动launch文件
ros2 launch dnn_node_example dnn_node_example.launch.py dnn_example_config_file:=config/mobilenetv2workconfig.json dnn_example_image_width:=480 dnn_example_image_height:=272

4. 测试效果 
运行成功后在pc端游览器输入：[http://IP:8000](http://ip:8000/)，即可查看图像和算法渲染效果（IP为RDK的IP地址）

# mobilenetv2图片分类算法部署流程：使用本地照片回灌

1. 配置tros.b环境
foxy版本:source /opt/tros/setup.bash
humble版本:source /opt/tros/humble/setup.bash

2. 启动launch文件
ros2 launch dnn_node_example dnn_node_example_feedback.launch.py dnn_example_config_file:=config/mobilenetv2workconfig.json dnn_example_image:=config/target_class.jpg
