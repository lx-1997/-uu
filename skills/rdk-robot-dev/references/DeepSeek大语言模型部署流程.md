# DeepSeek大语言模型部署流程：终端交互体验

1. 下载模型文件
wget -c ftp://oeftp@sdk.d-robotics.cc/oe_llm/model/DeepSeek_R1_Distill_Qwen_1.5B_1024.hbm --ftp-password=Oeftp~123$%

2. 设置 ION 内存空间最大, 满足大模型推理需求
/usr/hobot/bin/hb_switch_ion.sh bpu_first
reboot

3. 设置性能模式 注意：仅RDK S100P 支持性能模式
devmem 0x2b047000 32 0x99
devmem 0x2b047004 32 0x99

4. 配置tros.b环境
source /opt/tros/humble/setup.bash

5. 运行模型
lib=/opt/tros/humble/lib/hobot_xlm/lib
export LD_LIBRARY_PATH=${lib}:${LD_LIBRARY_PATH}
cp -r /opt/tros/humble/lib/hobot_xlm/config/ .
ros2 run hobot_xlm hobot_xlm --ros-args -p feed_type:=0 -p model_name:="DeepSeek_R1_Distill_Qwen_1.5B"


# DeepSeek大语言模型部署流程：订阅发布体验

1. 下载模型文件
wget -c ftp://oeftp@sdk.d-robotics.cc/oe_llm/model/DeepSeek_R1_Distill_Qwen_1.5B_1024.hbm --ftp-password=Oeftp~123$%

2. 设置 ION 内存空间最大, 满足大模型推理需求
/usr/hobot/bin/hb_switch_ion.sh bpu_first
reboot

3. 设置性能模式 注意：仅RDK S100P 支持性能模式
devmem 0x2b047000 32 0x99
devmem 0x2b047004 32 0x99

4. 启动 hobot_llm
配置tros.b环境
source /opt/tros/humble/setup.bash
lib=/opt/tros/humble/lib/hobot_xlm/lib
export LD_LIBRARY_PATH=${lib}:${LD_LIBRARY_PATH}
cp -r /opt/tros/humble/lib/hobot_xlm/config/ .
ros2 run hobot_xlm hobot_xlm --ros-args -p feed_type:=1 -p ros_string_sub_topic_name:="/prompt_text" -p model_name:="DeepSeek_R1_Distill_Qwen_1.5B"

5. 新开一个终端订阅输出结果topic
配置tros.b环境
source /opt/tros/humble/setup.bash
ros2 topic echo /tts_text

6. 新开一个终端发布消息
配置tros.b环境
source /opt/tros/humble/setup.bash
ros2 topic pub --once /prompt_text std_msgs/msg/String "{data: ""简单描述人工智能的发展""}"
