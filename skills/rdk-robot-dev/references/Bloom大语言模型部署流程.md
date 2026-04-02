# Bloom大语言模型部署流程：终端交互体验

1. 安装transformers
pip3 install transformers -i https://pypi.tuna.tsinghua.edu.cn/simple

2. 配置tros.b环境
foxy版本:source /opt/tros/setup.bash
humble版本:source /opt/tros/humble/setup.bash

3. 下载模型文件
wget http://archive.d-robotics.cc/llm-model/llm_model.tar.gz

4. 解压
sudo tar -xf llm_model.tar.gz -C /opt/tros/${TROS_DISTRO}/lib/hobot_llm/

5. 系统配置
手动使用命令srpi-config修改ION memory大小为1.9GB，设置方法参考RDK用户手册配置工具srpi-config使用指南[Performance Options](https://developer.d-robotics.cc/rdk_doc/System_configuration/srpi-config#performance-options)章节。
重启后设置CPU最高频率为1.5GHz，以及调度模式为performance，命令如下：
sudo bash -c 'echo 1 > /sys/devices/system/cpu/cpufreq/boost'
sudo bash -c 'echo performance > /sys/devices/system/cpu/cpufreq/policy0/scaling_governor'

6. 配置tros.b环境
foxy版本:source /opt/tros/setup.bash
humble版本:source /opt/tros/humble/setup.bash

7. 启动launch文件
ros2 run hobot_llm hobot_llm_chat

# Bloom大语言模型部署流程：订阅发布体验

1. 安装transformers
pip3 install transformers -i https://pypi.tuna.tsinghua.edu.cn/simple

2. 配置tros.b环境 若为humble则用source /opt/tros/humble/setup.bash
source /opt/tros/setup.bash

3. 下载模型文件
wget http://archive.d-robotics.cc/llm-model/llm_model.tar.gz

4. 解压
sudo tar -xf llm_model.tar.gz -C /opt/tros/${TROS_DISTRO}/lib/hobot_llm/

5. 系统配置
手动使用命令srpi-config修改ION memory大小为1.9GB，设置方法参考RDK用户手册配置工具srpi-config使用指南[Performance Options](https://developer.d-robotics.cc/rdk_doc/System_configuration/srpi-config#performance-options)章节。
重启后设置CPU最高频率为1.5GHz，以及调度模式为performance，命令如下：
sudo bash -c 'echo 1 > /sys/devices/system/cpu/cpufreq/boost'
sudo bash -c 'echo performance > /sys/devices/system/cpu/cpufreq/policy0/scaling_governor'

6. 启动 hobot_llm
配置tros.b环境
foxy版本:source /opt/tros/setup.bash
humble版本:source /opt/tros/humble/setup.bash

ros2 run hobot_llm hobot_llm

7. 新开一个终端订阅输出结果topic
重新配置tros.b环境
foxy版本:source /opt/tros/setup.bash
humble版本:source /opt/tros/humble/setup.bash

ros2 topic echo /text_result

8. 新开一个终端发布消息
重新配置tros.b环境
foxy版本:source /opt/tros/setup.bash
humble版本:source /opt/tros/humble/setup.bash

ros2 topic pub --once /text_query std_msgs/msg/String "{data: ""中国的首都是哪里""}"
