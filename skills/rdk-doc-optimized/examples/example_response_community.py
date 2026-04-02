#!/usr/bin/env python3
"""
优化版RDK文档助手的示例回答（使用社区手册链接）
"""

import sys
import os

# 添加工具函数路径
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from references.community_url_mapper import format_community_reference, create_detailed_reference

def generate_response_with_community_references(question, answer, references, additional_info=None):
    """
    生成带有社区手册引用的回答
    
    Args:
        question: 用户问题
        answer: 主要答案
        references: 引用列表
        additional_info: 额外信息
        
    Returns:
        格式化的回答
    """
    response = []
    
    # 1. 问题
    response.append(f"**问题**: {question}")
    response.append("")
    
    # 2. 答案
    response.append(f"**答案**: {answer}")
    response.append("")
    
    # 3. 文档引用
    if references:
        response.append("📚 **文档来源**:")
        for ref in references:
            response.append(create_detailed_reference(ref))
        response.append("")
    
    # 4. 详细说明
    if additional_info:
        response.append("🔍 **详细说明**:")
        if isinstance(additional_info, list):
            response.extend(additional_info)
        else:
            response.append(additional_info)
        response.append("")
    
    # 5. 相关提示
    response.append("💡 **相关提示**:")
    response.append("- 以上信息基于RDK官方社区手册，可直接点击链接验证")
    response.append("- 具体实现可能因版本不同有所差异")
    response.append("- 建议在实际操作前查阅相关文档")
    
    return "\n".join(response)

def example_baudrate_response():
    """波特率问题的示例回答（使用社区链接）"""
    
    # 文档路径
    x3_doc = "/tmp/rdk_doc/docs/01_Quick_start/hardware_introduction/rdk_x3.md"
    x5_doc = "/tmp/rdk_doc/docs/01_Quick_start/hardware_introduction/rdk_x5.md"
    s100_doc = "/tmp/rdk_doc/docs_s/01_Quick_start/01_hardware_introduction/01_rdk_s100.md"
    
    references = []
    
    # 为每个文档创建引用，指定搜索文本以查找锚点
    x3_ref = format_community_reference(x3_doc, search_text="调试串口")
    if x3_ref:
        references.append(x3_ref)
    
    x5_ref = format_community_reference(x5_doc, search_text="调试串口")
    if x5_ref:
        references.append(x5_ref)
    
    s100_ref = format_community_reference(s100_doc, search_text="Type-C")
    if s100_ref:
        references.append(s100_ref)
    
    question = "RDK X3、X5、S100开发板的波特率分别是多少？"
    answer = "根据RDK官方社区手册，各开发板的调试串口波特率配置如下：\n\n" \
             "- **RDK X3**: 921600\n" \
             "- **RDK X5**: 115200\n" \
             "- **RDK S100**: 921600"
    
    additional_info = [
        "**调试串口配置**:",
        "- 数据位（Data bits）: 8",
        "- 奇偶校验（Parity）: None",
        "- 停止位（Stop bits）: 1",
        "- 流控（Flow Control）: 无",
        "",
        "**各型号差异**:",
        "1. **RDK X3**: 使用921600高波特率，通过调试串口（接口3）连接",
        "2. **RDK X5**: 使用115200标准波特率，通过Micro USB调试口（接口4）连接",
        "3. **RDK S100**: 使用921600高波特率，通过Type-C接口（J16）连接",
        "",
        "**注意**:",
        "1. 这是**调试串口**的默认波特率，主要用于系统调试和登录",
        "2. **用户UART**（40PIN接口上的UART）可以配置其他波特率：9600, 19200, 38400, 57600, 115200, 921600",
        "3. 修改波特率需要编辑 `/boot/boot.cmd` 文件并重新生成 `boot.scr`"
    ]
    
    return generate_response_with_community_references(question, answer, references, additional_info)

def example_stereonet_response():
    """双目深度算法问题的示例回答"""
    
    # 文档路径
    stereonet_doc = "/tmp/rdk_doc/docs/05_Robot_development/03_boxs/spatial/hobot_stereonet.md"
    
    references = []
    
    stereonet_ref = format_community_reference(stereonet_doc)
    if stereonet_ref:
        references.append(stereonet_ref)
    
    question = "RDK支持的双目深度算法有哪些？"
    answer = "RDK支持地瓜双目深度估计算法（hobot_stereonet），该算法基于IGEV网络和GRU架构，具有较好的数据泛化性和较高的推理效率。"
    
    additional_info = [
        "**算法特点**:",
        "- 输入: 双目图像数据",
        "- 输出: 左视图对应的视差图和深度图",
        "- 架构: 借鉴IGEV网络，采用GRU架构",
        "- 优势: 良好的数据泛化性，较高的推理效率",
        "",
        "**支持平台**:",
        "- **RDK X5, RDK X5 Module**: Ubuntu 22.04 (Humble)",
        "- **RDK S100, RDK S100P**: Ubuntu 22.04 (Humble)",
        "",
        "**功能**:",
        "- 启动双目相机",
        "- 推理出深度结果",
        "- 在Web端显示结果",
        "",
        "**相关代码仓库**:",
        "- 双目算法: https://github.com/D-Robotics/hobot_stereonet",
        "- MIPI相机: https://github.com/D-Robotics/hobot_mipi_cam",
        "- ZED相机: https://github.com/D-Robotics/hobot_zed_cam",
        "",
        "**学习资源**:",
        "- [直播回放 | 基于RDK X5的AI双目算法部署实战](https://www.bilibili.com/video/BV1KdEjzREMz/)"
    ]
    
    return generate_response_with_community_references(question, answer, references, additional_info)

def example_mcu_response():
    """MCU开发问题的示例回答"""
    
    # 文档路径
    ipc_doc = "/tmp/rdk_doc/docs_s/07_Advanced_development/05_mcu_development/01_S100/08_mcu_ipc.md"
    s100_hardware_doc = "/tmp/rdk_doc/docs_s/01_Quick_start/01_hardware_introduction/01_rdk_s100.md"
    
    references = []
    
    ipc_ref = format_community_reference(ipc_doc)
    if ipc_ref:
        references.append(ipc_ref)
    
    hardware_ref = format_community_reference(s100_hardware_doc, search_text="MCU")
    if hardware_ref:
        references.append(hardware_ref)
    
    question = "如何在RDK S100上开发MCU程序？"
    answer = "RDK S100采用异构计算架构，内置4个Cortex-R52+ MCU核心，可以通过IPC（进程间通信）框架与A Core CPU进行内存映射通信。"
    
    additional_info = [
        "**MCU核心规格**:",
        "- 型号: ARM Cortex-R52+",
        "- 数量: 4核心",
        "- 模式: 支持Split-Lock模式",
        "",
        "**通信机制**:",
        "- **IPC框架**: 进程间通信，支持内存映射",
        "- **共享内存**: 位于 0xB4000000 地址区域",
        "- **中断机制**: 通过硬件中断通知对方",
        "",
        "**开发流程**:",
        "1. **环境搭建**: 安装MCU SDK开发环境",
        "2. **代码编写**: 使用C语言开发MCU固件",
        "3. **IPC配置**: 配置共享内存和通信通道",
        "4. **编译烧录**: 编译固件并烧录到MCU",
        "5. **测试验证**: 测试A Core ↔ MCU通信",
        "",
        "**IPC示例代码**:",
        "```c",
        "// 初始化IPC",
        "Ipc_MDMA_Init(&Ipc_ShmCfgInstances0, 0);",
        "Ipc_MDMA_OpenInstance(0);",
        "",
        "// 发送消息",
        "Ipc_MDMA_SendMsg(instance_id, channel_id, size, buffer, timeout);",
        "",
        "// 接收消息（中断方式）",
        "void Ipc_RxCallback(uint32 instance_id, uint32 chan_id, uint32 size, uint8* buffer) {",
        "    // 处理接收到的数据",
        "}",
        "```",
        "",
        "**应用场景**:",
        "- 实时控制: 电机控制、传感器采集",
        "- 通信接口: CAN总线、UART、SPI、I2C",
        "- 安全关键: 紧急停止、安全监控",
        "- 低延迟: 需要亚毫秒级响应的任务"
    ]
    
    return generate_response_with_community_references(question, answer, references, additional_info)

if __name__ == "__main__":
    print("=" * 70)
    print("RDK文档助手优化版 - 社区手册链接示例")
    print("=" * 70)
    
    print("\n" + "=" * 70)
    print("示例1: 波特率查询")
    print("=" * 70)
    print(example_baudrate_response())
    
    print("\n" + "=" * 70)
    print("示例2: 双目深度算法查询")
    print("=" * 70)
    print(example_stereonet_response())
    
    print("\n" + "=" * 70)
    print("示例3: MCU开发查询")
    print("=" * 70)
    print(example_mcu_response())
    
    print("\n" + "=" * 70)
    print("优化总结:")
    print("=" * 70)
    print("✅ **改进点**:")
    print("1. 使用社区手册链接代替GitHub链接")
    print("2. 用户可以直接点击链接访问在线文档")
    print("3. 支持锚点链接到具体章节")
    print("4. 保持了完整的引用信息")
    print("")
    print("🎯 **优势**:")
    print("- 可访问性: 用户无需GitHub账号即可查看文档")
    print("- 实时性: 社区手册总是最新版本")
    print("- 完整性: 包含完整的文档格式和图片")
    print("- 交互性: 支持文档内的导航和搜索")
    print("=" * 70)