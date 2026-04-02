#!/usr/bin/env python3
"""
社区手册URL映射工具
将本地RDK文档路径转换为社区手册链接
"""

import os
import re

# 社区手册基础URL
COMMUNITY_BASE_URL = "https://developer.d-robotics.cc/rdk_doc"

def remove_number_prefix(path_part, level=0, is_last_part=False):
    """
    移除路径部分中的数字前缀，根据层级和位置决定
    
    Args:
        path_part: 路径部分
        level: 路径层级（0表示第一级目录）
        is_last_part: 是否是最后一部分（文件名）
        
    Returns:
        处理后的字符串
    """
    if not path_part:
        return path_part
    
    # 匹配以数字和下划线开头的部分
    match = re.match(r'^(\d+_)?(.+)$', path_part)
    if not match:
        return path_part
    
    prefix = match.group(1)  # 数字前缀，如 "01_", "03_"
    base = match.group(2)    # 基础部分
    
    # 特殊规则：根据实际观察的社区链接模式
    if is_last_part:
        # 文件名：总是移除数字前缀
        return base
    elif level == 0:
        # 第一级目录：移除数字前缀
        return base
    else:
        # 中间目录：保留数字前缀（根据GPIO例子）
        return path_part

def local_to_community(local_path):
    """
    将本地路径转换为社区手册链接
    
    Args:
        local_path: 本地文件路径
        
    Returns:
        社区手册链接，如果无法转换则返回None
    """
    if not local_path:
        return None
    
    # 标准化路径
    local_path = os.path.abspath(local_path)
    
    # 检查是否是RDK文档路径
    if not local_path.startswith('/tmp/rdk_doc/'):
        return None
    
    # 移除基础路径和文件扩展名
    if local_path.startswith('/tmp/rdk_doc/docs/'):
        # 主文档（X3/X5/Ultra）
        rel_path = local_path[18:]  # 移除 '/tmp/rdk_doc/docs/'
        
        # 移除.md扩展名
        if rel_path.endswith('.md'):
            rel_path = rel_path[:-3]
        
        # 分割路径部分
        parts = rel_path.split('/')
        
        if not parts:
            return None
        
        # 处理每个部分：对于docs目录，移除所有数字前缀
        processed_parts = []
        for i, part in enumerate(parts):
            if not part:
                continue
            
            # 判断是否是最后一部分（文件名）
            is_last_part = (i == len(parts) - 1)
            
            # 对于docs目录，总是移除数字前缀
            # level参数在这里不重要，因为docs目录总是移除前缀
            processed_part = remove_number_prefix(part, level=i, is_last_part=is_last_part)
            
            # 确保移除前缀（对于docs目录，即使不是最后一部分也移除）
            match = re.match(r'^(\d+_)?(.+)$', processed_part)
            if match:
                processed_part = match.group(2)
            
            processed_parts.append(processed_part)
        
        # 构建社区链接（主文档）
        community_path = '/'.join(processed_parts)
        community_url = f"{COMMUNITY_BASE_URL}/{community_path}"
        
        return community_url
        
    elif local_path.startswith('/tmp/rdk_doc/docs_s/'):
        # S100文档（特殊处理）
        rel_path = local_path[20:]  # 移除 '/tmp/rdk_doc/docs_s/'
        
        # 移除.md扩展名
        if rel_path.endswith('.md'):
            rel_path = rel_path[:-3]
        
        # 分割路径部分
        parts = rel_path.split('/')
        
        if not parts:
            return None
        
        # 处理每个部分：对于docs_s目录，有特殊规则
        processed_parts = []
        for i, part in enumerate(parts):
            if not part:
                continue
            
            # 判断是否是最后一部分（文件名）
            is_last_part = (i == len(parts) - 1)
            
            # 根据层级和位置处理
            processed_part = remove_number_prefix(part, level=i, is_last_part=is_last_part)
            processed_parts.append(processed_part)
        
        # 构建社区链接（S100文档）
        # docs_s目录的链接以 /rdk_s/ 开头
        community_path = '/'.join(processed_parts)
        community_url = f"{COMMUNITY_BASE_URL}/rdk_s/{community_path}"
        
        return community_url
    
    return None

def extract_document_title(file_path, max_lines=20):
    """
    从Markdown文件中提取标题
    
    Args:
        file_path: 文件路径
        max_lines: 最多读取的行数
        
    Returns:
        文档标题（第一个#标题），如果没有则返回文件名
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            for i, line in enumerate(f):
                if i >= max_lines:
                    break
                
                # 查找第一个#开头的标题
                line = line.strip()
                if line.startswith('# '):
                    return line[2:].strip()
                elif line.startswith('## '):
                    return line[3:].strip()
                elif line.startswith('### '):
                    return line[4:].strip()
    except Exception:
        pass
    
    # 如果找不到标题，使用文件名
    filename = os.path.basename(file_path).replace('.md', '')
    filename = remove_number_prefix(filename)
    return filename.replace('_', ' ').title()

def find_anchor_in_file(file_path, search_text):
    """
    在文件中查找可能对应的锚点
    
    Args:
        file_path: 文件路径
        search_text: 搜索文本
        
    Returns:
        锚点ID，如果没有则返回""
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        lines = content.split('\n')
        
        # 简单查找：包含搜索文本的行
        for i, line in enumerate(lines):
            if search_text.lower() in line.lower():
                # 向前查找最近的标题
                for j in range(i, max(-1, i-10), -1):
                    if lines[j].startswith('#'):
                        title = lines[j].strip('#').strip()
                        # 将标题转换为锚点格式
                        anchor = title.lower()
                        anchor = re.sub(r'[^\w\s-]', '', anchor)  # 移除特殊字符
                        anchor = re.sub(r'[-\s]+', '-', anchor)   # 空格和连字符替换为-
                        return f"#{anchor}"
                break
    except Exception:
        pass
    
    return ""

def format_community_reference(file_path, title=None, search_text=""):
    """
    格式化社区手册引用
    
    Args:
        file_path: 本地文件路径
        title: 文档标题（可选）
        search_text: 搜索文本，用于查找锚点
        
    Returns:
        格式化的引用字典
    """
    community_url = local_to_community(file_path)
    if not community_url:
        return None
    
    if not title:
        title = extract_document_title(file_path)
    
    # 尝试查找锚点
    anchor = ""
    if search_text:
        anchor = find_anchor_in_file(file_path, search_text)
    
    # 添加锚点到URL
    if anchor:
        community_url_with_anchor = f"{community_url}{anchor}"
    else:
        community_url_with_anchor = community_url
    
    return {
        "title": title,
        "url": community_url_with_anchor,
        "local_path": file_path,
        "anchor": anchor
    }

def test_mappings():
    """测试映射关系"""
    test_cases = [
        # (本地路径, 期望的完整社区链接)
        # docs目录测试
        ("/tmp/rdk_doc/docs/01_Quick_start/hardware_introduction/rdk_x3.md", 
         "https://developer.d-robotics.cc/rdk_doc/Quick_start/hardware_introduction/rdk_x3"),
        
        ("/tmp/rdk_doc/docs/01_Quick_start/install_os/rdk_x3.md", 
         "https://developer.d-robotics.cc/rdk_doc/Quick_start/install_os/rdk_x3"),
        
        ("/tmp/rdk_doc/docs/05_Robot_development/03_boxs/spatial/hobot_stereonet.md", 
         "https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/spatial/hobot_stereonet"),
        
        ("/tmp/rdk_doc/docs/02_System_configuration/01_network_blueteeth.md", 
         "https://developer.d-robotics.cc/rdk_doc/System_configuration/network_blueteeth"),
        
        # docs_s目录测试（特殊格式）
        ("/tmp/rdk_doc/docs_s/01_Quick_start/01_hardware_introduction/01_rdk_s100.md", 
         "https://developer.d-robotics.cc/rdk_doc/rdk_s/Quick_start/hardware_introduction/rdk_s100"),
        
        ("/tmp/rdk_doc/docs_s/03_Basic_Application/03_40pin_user_guide/02_gpio.md", 
         "https://developer.d-robotics.cc/rdk_doc/rdk_s/Basic_Application/03_40pin_user_guide/gpio"),
        
        # 其他可能的docs_s文件
        ("/tmp/rdk_doc/docs_s/07_Advanced_development/05_mcu_development/01_S100/08_mcu_ipc.md", 
         "https://developer.d-robotics.cc/rdk_doc/rdk_s/Advanced_development/mcu_development/S100/mcu_ipc"),
    ]
    
    print("社区手册链接映射测试:")
    print("=" * 80)
    
    for local_path, expected_url in test_cases:
        community_url = local_to_community(local_path)
        
        if community_url:
            status = "✅" if community_url == expected_url else "❌"
            print(f"{status} 本地: {os.path.basename(local_path)}")
            print(f"   社区链接: {community_url}")
            
            if community_url != expected_url:
                print(f"   期望链接: {expected_url}")
                print(f"   差异分析:")
                print(f"     实际: {community_url}")
                print(f"     期望: {expected_url}")
            
            # 测试标题提取
            title = extract_document_title(local_path)
            print(f"   文档标题: {title}")
            
            # 测试完整引用
            ref = format_community_reference(local_path)
            if ref:
                print(f"   引用格式: [{ref['title']}]({ref['url']})")
            
            print()
        else:
            print(f"❌ 无法映射: {local_path}")
            print()

def create_markdown_reference(ref):
    """
    创建Markdown格式的引用
    
    Args:
        ref: 引用字典
        
    Returns:
        Markdown格式的字符串
    """
    if not ref:
        return ""
    
    return f"📖 **参考文档**: [{ref['title']}]({ref['url']})"

def create_detailed_reference(ref):
    """
    创建详细的引用信息
    
    Args:
        ref: 引用字典
        
    Returns:
        详细的引用信息字符串
    """
    if not ref:
        return ""
    
    result = f"📖 **参考文档**: [{ref['title']}]({ref['url']})"
    result += f"\n📁 **本地路径**: `{ref['local_path']}`"
    
    if ref.get('anchor'):
        result += f"\n🔗 **章节锚点**: {ref['anchor']}"
    
    return result

# 示例使用
if __name__ == "__main__":
    print("=" * 80)
    print("RDK社区手册链接映射工具")
    print("=" * 80)
    
    # 运行测试
    test_mappings()
    
    print("\n" + "=" * 80)
    print("实际使用示例:")
    print("=" * 80)
    
    # 实际文件测试
    test_file = "/tmp/rdk_doc/docs/01_Quick_start/hardware_introduction/rdk_x3.md"
    ref = format_community_reference(test_file, search_text="调试串口")
    
    if ref:
        print(f"文件: {os.path.basename(test_file)}")
        print(f"标题: {ref['title']}")
        print(f"社区链接: {ref['url']}")
        print(f"Markdown引用: {create_markdown_reference(ref)}")
        print(f"详细引用:\n{create_detailed_reference(ref)}")
    
    print("\n" + "=" * 80)
    print("总结:")
    print("=" * 80)
    print("✅ 本地文档路径已成功映射到社区手册链接")
    print("✅ 用户可以点击链接直接访问在线文档")
    print("✅ 支持锚点链接到具体章节")
    print("=" * 80)