# Sensevoice智能语音算法部署流程：

1. 安装智能语音算法包 
sudo apt update
sudo apt install tros-humble-sensevoice-ros2

2. 配置tros.b环境
source /opt/tros/humble/setup.bash

3. 启动launch文件
ros2 launch sensevoice_ros2 sensevoice_ros2.launch.py micphone_name:="plughw:0,0"