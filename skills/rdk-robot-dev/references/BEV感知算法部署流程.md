# BEV感知算法部署流程：使用本地数据集回灌（humble版本）

1. 板端下载回灌的点云文件
wget http://archive.d-robotics.cc/TogetheROS/data/hobot_bev_data.tar.gz

2. 解压缩
mkdir -p hobot_bev_data
tar -zxvf hobot_bev_data.tar.gz -C hobot_bev_data

3. 配置tros.b humble环境
source /opt/tros/humble/setup.bash

4. 启动websocket服务
ros2 launch websocket websocket_service.launch.py

5. 启动运行脚本，并指定数据集路径
ros2 launch hobot_bev hobot_bev.launch.py image_pre_path:=hobot_bev_data/data

6. 测试效果 
运行成功后在pc端游览器输入：[http://IP:8000](http://ip:8000/)，即可查看图像和算法渲染效果（IP为RDK的IP地址）


# BEV感知算法部署流程：使用本地数据集回灌（foxy版本）


1. 板端下载回灌的点云文件
cd ~
wget http://archive.d-robotics.cc/TogetheROS/data/nuscenes_bev_val/nuscenes_bev_val.tar.gz

2. 解压缩
mkdir -p ~/hobot_bev_data
tar -zxvf ~/nuscenes_bev_val.tar.gz -C ~/hobot_bev_data

3. 配置tros.b
source /opt/tros/setup.bash
if [ -L qat ]; then rm qat; fi
ln -s `ros2 pkg prefix hobot_bev`/lib/hobot_bev/qat/ qat
ln -s ~/hobot_bev_data/nuscenes_bev_val nuscenes_bev_val

4. 启动launch文件
ros2 launch hobot_bev hobot_bev.launch.py

5. 测试效果 
运行成功后在pc端游览器输入：[http://IP:8000](http://ip:8000/)，即可查看图像和算法渲染效果（IP为RDK的IP地址）

