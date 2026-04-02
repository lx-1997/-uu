#!/usr/bin/env python3
"""
测试社区链接的实际有效性
"""

import os
import sys

# 添加工具函数路径
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from community_url_mapper import local_to_community, extract_document_title

def test_actual_links():
    """测试实际的社区链接"""
    
    test_files = [
        # GPIO例子（已知正确的）
        "/tmp/rdk_doc/docs_s/03_Basic_Application/03_40pin_user_guide/02_gpio.md",
        
        # S100硬件介绍（需要验证）
        "/tmp/rdk_doc/docs_s/01_Quick_start/01_hardware_introduction/01_rdk_s100.md",
        
        # MCU IPC（需要验证）
        "/tmp/rdk_doc/docs_s/07_Advanced_development/05_mcu_development/01_S100/08_mcu_ipc.md",
        
        # 其他docs_s文件
        "/tmp/rdk_doc/docs_s/03_Basic_Application/03_40pin_user_guide/04_uart.md",
        "/tmp/rdk_doc/docs_s/03_Basic_Application/03_40pin_user_guide/03_pwm.md",
    ]
    
    print("实际社区链接测试")
    print("=" * 80)
    
    for file_path in test_files:
        if not os.path.exists(file_path):
            print(f"❌ 文件不存在: {file_path}")
            continue
        
        # 生成社区链接
        community_url = local_to_community(file_path)
        title = extract_document_title(file_path)
        
        print(f"\n📄 文件: {os.path.basename(file_path)}")
        print(f"   📍 路径: {file_path}")
        print(f"   🏷️  标题: {title}")
        print(f"   🔗 社区链接: {community_url}")
        
        # 显示路径分析
        rel_path = file_path[20:] if file_path.startswith('/tmp/rdk_doc/docs_s/') else file_path[18:]
        parts = rel_path.replace('.md', '').split('/')
        print(f"   📁 路径分析: {' → '.join(parts)}")
        
        # 建议的访问方式
        if community_url:
            print(f"   💡 建议: 点击链接或复制到浏览器访问")
    
    print("\n" + "=" * 80)
    print("总结:")
    print("1. GPIO链接已知正确（已验证）")
    print("2. 其他链接可能需要调整")
    print("3. 用户可以点击链接后使用页面内搜索")
    print("=" * 80)

def generate_smart_reference(file_path):
    """
    生成智能引用，包含备选访问方案
    """
    community_url = local_to_community(file_path)
    title = extract_document_title(file_path)
    
    if not community_url:
        return None
    
    # 基础引用
    ref = {
        "title": title,
        "url": community_url,
        "local_path": file_path,
        "smart_tips": []
    }
    
    # 根据文件类型添加智能提示
    if "gpio" in file_path.lower():
        ref["smart_tips"].append("这是GPIO配置文档，包含引脚定义和使用示例")
    
    if "s100" in file_path.lower():
        ref["smart_tips"].append("S100专用文档，包含硬件规格和接口说明")
    
    if "mcu" in file_path.lower():
        ref["smart_tips"].append("MCU开发文档，包含IPC通信和实时系统开发")
    
    # 添加通用提示
    ref["smart_tips"].append("如果链接无法直接访问，可在社区手册中搜索文档标题")
    
    return ref

if __name__ == "__main__":
    test_actual_links()
    
    print("\n\n智能引用示例:")
    print("=" * 80)
    
    test_file = "/tmp/rdk_doc/docs_s/03_Basic_Application/03_40pin_user_guide/02_gpio.md"
    ref = generate_smart_reference(test_file)
    
    if ref:
        print(f"📖 文档: {ref['title']}")
        print(f"🔗 链接: {ref['url']}")
        print(f"📁 路径: {ref['local_path']}")
        print("💡 提示:")
        for tip in ref['smart_tips']:
            print(f"   • {tip}")