# EdgeSAM图像分割算法部署流程：用MIPI摄像头发布为照片

1. 配置tros.b环境
source /opt/tros/humble/setup.bash

2. 配置MIPI摄像头
export CAM_TYPE=mipi

3. 启动launch文件
ros2 launch mono_edgesam sam.launch.py 

4. 测试效果 
推理的结果会渲染到Web上, 在PC端的浏览器输入[http://IP:8000](http://ip:8000/) 即可查看图像和算法渲染效果（IP为RDK的IP地址）, 手动打开界面右上角设置, 选中”Full Image Segmentation“选项, 可以显示渲染效果。

# EdgeSAM图像分割算法部署流程：用usb摄像头发布为照片

1. 配置tros.b环境
source /opt/tros/humble/setup.bash

2. 配置usb摄像头
export CAM_TYPE=usb

3. 启动launch文件
ros2 launch mono_edgesam sam.launch.py 

4. 测试效果 
推理的结果会渲染到Web上, 在PC端的浏览器输入[http://IP:8000](http://ip:8000/) 即可查看图像和算法渲染效果（IP为RDK的IP地址）, 手动打开界面右上角设置, 选中”Full Image Segmentation“选项, 可以显示渲染效果。

# EdgeSAM图像分割算法部署流程：使用本地照片回灌

1. 配置tros.b环境
source /opt/tros/humble/setup.bash

2. 配置本地回灌图片
export CAM_TYPE=fb

3. 启动launch文件
ros2 launch mono_edgesam sam.launch.py 

4. 测试效果 
推理的结果会渲染到Web上, 在PC端的浏览器输入[http://IP:8000](http://ip:8000/) 即可查看图像和算法渲染效果（IP为RDK的IP地址）, 手动打开界面右上角设置, 选中”Full Image Segmentation“选项, 可以显示渲染效果。