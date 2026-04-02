# 人手关键点及手势识别(mediapipe)算法部署流程：用MIPI摄像头发布为照片

1. 配置tros.b环境
source /opt/tros/humble/setup.bash

2. 从tros.b的安装路径中拷贝出运行示例需要的配置文件。
cp -r /opt/tros/${TROS_DISTRO}/lib/palm_detection_mediapipe/config/ .
cp -r /opt/tros/${TROS_DISTRO}/lib/hand_landmarks_mediapipe/config/ .

3. 配置MIPI摄像头
export CAM_TYPE=mipi

4. 启动launch文件
ros2 launch hand_landmarks_mediapipe hand_landmarks.launch.py

5. 测试效果 
运行成功后在pc端游览器输入：[http://IP:8000](http://ip:8000/)，即可查看图像和算法渲染效果（IP为RDK的IP地址）

# 人手关键点及手势识别(mediapipe)算法部署流程：用usb摄像头发布为照片

1. 配置tros.b环境
source /opt/tros/humble/setup.bash

2. 从tros.b的安装路径中拷贝出运行示例需要的配置文件。
cp -r /opt/tros/${TROS_DISTRO}/lib/palm_detection_mediapipe/config/ .
cp -r /opt/tros/${TROS_DISTRO}/lib/hand_landmarks_mediapipe/config/ .

3. 配置usb摄像头
export CAM_TYPE=usb

4. 启动launch文件
ros2 launch hand_landmarks_mediapipe hand_landmarks.launch.py

5. 测试效果 
运行成功后在pc端游览器输入：[http://IP:8000](http://ip:8000/)，即可查看图像和算法渲染效果（IP为RDK的IP地址）

# 人手关键点及手势识别(mediapipe)算法部署流程：使用本地图片回灌

1. 配置tros.b环境
source /opt/tros/humble/setup.bash

2. 从tros.b的安装路径中拷贝出运行示例需要的配置文件。
cp -r /opt/tros/${TROS_DISTRO}/lib/palm_detection_mediapipe/config/ .
cp -r /opt/tros/${TROS_DISTRO}/lib/hand_landmarks_mediapipe/config/ .

3. 配置usb摄像头
export CAM_TYPE=fb

4. 启动launch文件
ros2 launch hand_landmarks_mediapipe hand_landmarks.launch.py publish_image_source:=config/example.jpg publish_image_format:=jpg publish_output_image_w:=640 publish_output_image_h:=480

5. 测试效果 
运行成功后在pc端游览器输入：[http://IP:8000](http://ip:8000/)，即可查看图像和算法渲染效果（IP为RDK的IP地址）
