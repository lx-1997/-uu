#!/usr/bin/env python3
"""
优化版RDK文档助手的示例回答
"""

import sys
import os

# 添加工具函数路径
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from references.github_url_mapper import format_reference, create_detailed_reference

def generate_response_with_references(question, answer, references, additional_info=None):
    """
    生成带有文档引用的回答
    
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
    
    # 5. 相关命令（如果有）
    response.append("💡 **相关提示**:")
    response.append("- 以上信息基于RDK官方文档")
    response.append("- 具体实现可能因版本不同有所差异")
    response.append("- 建议在实际操作前查阅相关文档")
    
    return "\n".join(response)

def example_baudrate_response():
    """波特率问题的示例回答"""
    
    # 模拟找到的文档
    x3_doc = "/tmp/rdk_doc/docs/01_Quick_start/hardware_introduction/rdk_x3.md"
    x5_doc = "/tmp/rdk_doc/docs/01_Quick_start/hardware_introduction/rdk_x5.md"
    remote_login_doc = "/tmp/rdk_doc/docs/01_Quick_start/remote_login.md"
    
    references = []
    for doc in [x3_doc, x5_doc, remote_login_doc]:
        ref = format_reference(doc)
        if ref:
            references.append(ref)
    
    question = "RDK X3、X5、S100开发板的波特率分别是多少？"
    answer = "根据RDK官方文档，各开发板的调试串口波特率配置如下：\n\n" \
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
        "**注意**:",
        "1. 这是调试串口的默认波特率，用于系统调试和登录",
        "2. 40PIN接口上的用户UART可以配置其他波特率（9600, 19200, 38400, 57600, 115200, 921600）",
        "3. 修改波特率需要编辑 `/boot/boot.cmd` 文件并重新生成 `boot.scr`"
    ]
    
    return generate_response_with_references(question, answer, references, additional_info)

def example_mcu_response():
    """MCU开发问题的示例回答"""
    
    # 模拟找到的文档
    ipc_doc = "/tmp/rdk_doc/docs_s/07_Advanced_development/05_mcu_development/01_S100/08_mcu_ipc.md"
    hardware_doc = "/tmp/rdk_doc/docs_s/01_Quick_start/01_hardware_introduction/01_rdk_s100.md"
    
    references = []
    for doc in [ipc_doc, hardware_doc]:
        ref = format_reference(doc)
        if ref:
            references.append(ref)
    
    question = "如何在RDK S100上开发MCU程序？"
    answer = "RDK S100采用异构计算架构，内置Cortex-R52+ MCU，可以通过IPC（进程间通信）与A Core CPU进行内存映射通信。"
    
    additional_info = [
        "**MCU开发要点**:",
        "1. **硬件架构**: S100包含4个Cortex-R52+ MCU核心，支持Split-Lock模式",
        "2. **通信方式**: 通过IPC框架进行A Core ↔ MCU通信",
        "3. **内存映射**: 共享内存区域位于 0xB4000000",
        "4. **开发工具**: 使用MCU SDK进行固件开发",
        "",
        "**IPC通信实例**:",
        "```c",
        "// 初始化IPC",
        "Ipc_MDMA_Init(&Ipc_ShmCfgInstances0, 0);",
        "Ipc_MDMA_OpenInstance(0);",
        "",
        "// 发送消息",
        "Ipc_MDMA_SendMsg(instance_id, channel_id, size, buffer, timeout);",
        "```",
        "",
        "**应用场景**:",
        "- 实时控制（电机、传感器）",
        "- CAN总线通信",
        "- 低延迟响应任务"
    ]
    
    return generate_response_with_references(question, answer, references, additional_info)

def example_installation_response():
    """系统安装问题的示例回答"""
    
    install_doc = "/tmp/rdk_doc/docs/01_Quick_start/install_os/rdk_x3.md"
    download_doc = "/tmp/rdk_doc/docs/01_Quick_start/download.md"
    
    references = []
    for doc in [install_doc, download_doc]:
        ref = format_reference(doc)
        if ref:
            references.append(ref)
    
    question = "如何给RDK X3开发板烧录系统？"
    answer = "RDK X3支持通过USB Type-C接口使用官方烧录工具进行系统烧录。"
    
    additional_info = [
        "**烧录步骤**:",
        "1. **准备工具**:",
        "   - RDK X3开发板",
        "   - 5V/3A电源适配器",
        "   - USB Type-C数据线",
        "   - 电脑（Windows/Linux/macOS）",
        "",
        "2. **下载资源**:",
        "   - 系统镜像：从[下载页面](https://developer.d-robotics.cc/resource)获取",
        "   - 烧录工具：hbupdate（Horizon烧录工具）",
        "",
        "3. **进入烧录模式**:",
        "   - 断开电源",
        "   - 按住BOOT按钮（如果有）",
        "   - 连接USB Type-C线到电脑",
        "   - 释放BOOT按钮",
        "",
        "4. **执行烧录**:",
        "   ```bash",
        "   # Linux/macOS",
        "   sudo ./hbupdate -i rdk_x3_ubuntu_desktop.img",
        "",
        "   # Windows",
        "   hbupdate.exe -i rdk_x3_ubuntu_desktop.img",
        "   ```",
        "",
        "5. **完成烧录**:",
        "   - 断开USB线",
        "   - 连接电源启动",
        "   - 默认用户名：root，密码：root",
        "",
        "**注意**:",
        "- 确保使用5V/3A电源，避免供电不足",
        "- 烧录过程中不要断电",
        "- 首次启动可能需要较长时间"
    ]
    
    return generate_response_with_references(question, answer, references, additional_info)

if __name__ == "__main__":
    print("=" * 70)
    print("RDK文档助手优化版 - 示例回答")
    print("=" * 70)
    
    print("\n" + "=" * 70)
    print("示例1: 波特率查询")
    print("=" * 70)
    print(example_baudrate_response())
    
    print("\n" + "=" * 70)
    print("示例2: MCU开发查询")
    print("=" * 70)
    print(example_mcu_response())
    
    print("\n" + "=" * 70)
    print("示例3: 系统安装查询")
    print("=" * 70)
    print(example_installation_response())
    
    print("\n" + "=" * 70)
    print("总结:")
    print("=" * 70)
    print("优化后的回答格式包含:")
    print("1. 明确的问题和答案")
    print("2. GitHub文档引用（可验证）")
    print("3. 详细的说明和步骤")
    print("4. 相关提示和注意事项")
    print("=" * 70)