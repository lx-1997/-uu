# 人体检测和跟踪(Ultralytics YOLO Pose)算法部署流程：用MIPI摄像头发布为照片

1. 配置tros.b环境
source /opt/tros/humble/setup.bash

2. 从tros.b的安装路径中拷贝出运行示例需要的配置文件。
cp -r /opt/tros/${TROS_DISTRO}/lib/mono2d_body_detection/config/ .

3. 配置MIPI摄像头
export CAM_TYPE=mipi

4. 启动launch文件
ros2 launch mono2d_body_detection mono2d_body_detection.launch.py kps_model_type:=1 kps_image_width:=1920 kps_image_height:=1080 kps_model_file_name:=config/yolo11x_pose_nashe_640x640_nv12.hbm
5. 测试效果 
运行成功后在pc端游览器输入：[http://IP:8000](http://ip:8000/)，即可查看图像和算法渲染效果（IP为RDK的IP地址）

# 人体检测和跟踪(Ultralytics YOLO Pose)算法部署流程：用usb摄像头发布为照片

1. 配置tros.b环境
source /opt/tros/humble/setup.bash

2. 从tros.b的安装路径中拷贝出运行示例需要的配置文件。
cp -r /opt/tros/${TROS_DISTRO}/lib/mono2d_body_detection/config/ .

3. 配置usb摄像头
export CAM_TYPE=usb

4. 启动launch文件
ros2 launch mono2d_body_detection mono2d_body_detection.launch.py kps_model_type:=1 kps_image_width:=1920 kps_image_height:=1080 kps_model_file_name:=config/yolo11x_pose_nashe_640x640_nv12.hbm

5. 测试效果 
在PC端的浏览器输入[http://IP:8000](http://ip:8000/) 即可查看图像和算法渲染效果（IP为RDK的IP地址）

# 人体检测和跟踪(Ultralytics YOLO Pose)算法部署流程：使用本地照片回灌

1. 配置tros.b环境
source /opt/tros/humble/setup.bash

2. 从tros.b的安装路径中拷贝出运行示例需要的配置文件。
cp -r /opt/tros/${TROS_DISTRO}/lib/mono2d_body_detection/config/ .
cp -r /opt/tros/${TROS_DISTRO}/lib/dnn_node_example/config/ .


3. 配置本地回灌图片
export CAM_TYPE=fb

4. 启动launch文件
ros2 launch mono2d_body_detection mono2d_body_detection.launch.py publish_image_source:=config/person_body.jpg publish_image_format:=jpg kps_model_type:=1 kps_image_width:=640 kps_image_height:=640 kps_model_file_name:=config/yolo11x_pose_nashe_640x640_nv12.hbm

5. 测试效果 
在PC端的浏览器输入[http://IP:8000](http://ip:8000/) 即可查看图像和算法渲染效果（IP为RDK的IP地址）