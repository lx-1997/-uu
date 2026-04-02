# 单目3D室内检测算法部署流程：使用本地图片回灌

1. 配置tros.b humble环境
source /opt/tros/humble/setup.bash

2. 启动ZED-2i相机和占用网络推理程序
ros2 launch dstereo_occnet zed2i_occ_node.launch.py

3. 启动launch文件
ros2 launch mono3d_indoor_detection mono3d_indoor_detection.launch.py 

4. 程序启动后可以通过网页查看ZED-2i发布的双目图像，在PC端浏览器输入[http://ip:8000](http://ip:8000/) 即可查看双目图像，ip为RDK板端的ip，并且要保证PC和RDK能通过网络通讯

5. 通过rviz2可查看占用网格
sudo apt install ros-humble-rviz2
source /opt/tros/humble/setup.bash
rviz2