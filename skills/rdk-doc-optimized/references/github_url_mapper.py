#!/usr/bin/env python3
"""
GitHub URL映射工具
将本地RDK文档路径转换为GitHub链接
"""

import os

# RDK GitHub组织
GITHUB_BASE_URL = "https://github.com/D-Robotics"

# 主仓库映射
REPO_MAPPINGS = {
    # 主文档仓库
    "/tmp/rdk_doc/docs/": "rdk-doc/blob/main/docs/",
    "/tmp/rdk_doc/docs_s/": "rdk-doc/blob/main/docs_s/",
    
    # 其他相关仓库（如果检测到）
    "/tmp/rdk_model_zoo/": "rdk_model_zoo/blob/main/",
    "/tmp/rdk_imu/": "rdk_imu/blob/main/",
}

def local_to_github(local_path):
    """
    将本地路径转换为GitHub链接
    
    Args:
        local_path: 本地文件路径
        
    Returns:
        GitHub链接，如果无法转换则返回None
    """
    if not local_path or not os.path.exists(local_path):
        return None
    
    # 转换为绝对路径
    local_path = os.path.abspath(local_path)
    
    # 查找匹配的仓库
    for local_prefix, github_path in REPO_MAPPINGS.items():
        if local_path.startswith(local_prefix):
            # 提取相对路径
            rel_path = local_path[len(local_prefix):]
            
            # 构建GitHub链接
            github_url = f"{GITHUB_BASE_URL}/{github_path}{rel_path}"
            
            # 如果是目录，使用tree视图
            if os.path.isdir(local_path):
                github_url = github_url.replace("/blob/", "/tree/")
            
            return github_url
    
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
    return os.path.basename(file_path).replace('.md', '').replace('_', ' ').title()

def find_anchor_in_content(file_path, search_text):
    """
    在文档内容中查找锚点
    
    Args:
        file_path: 文件路径
        search_text: 要查找的文本
        
    Returns:
        锚点ID（如 #debug_uart），如果没有则返回""
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # 简单的锚点查找逻辑
        lines = content.split('\n')
        for i, line in enumerate(lines):
            if search_text.lower() in line.lower():
                # 查找前一个标题作为锚点
                for j in range(i, max(-1, i-10), -1):
                    if lines[j].startswith('#'):
                        # 将标题转换为锚点ID
                        title = lines[j].strip('#').strip()
                        anchor = title.lower().replace(' ', '-').replace('.', '')
                        return f"#{anchor}"
                break
    except Exception:
        pass
    
    return ""

def format_reference(file_path, title=None, anchor=""):
    """
    格式化文档引用
    
    Args:
        file_path: 本地文件路径
        title: 文档标题（可选）
        anchor: 锚点ID（可选）
        
    Returns:
        格式化的引用字符串
    """
    github_url = local_to_github(file_path)
    if not github_url:
        return None
    
    if not title:
        title = extract_document_title(file_path)
    
    # 添加锚点
    if anchor and not anchor.startswith('#'):
        anchor = f"#{anchor}"
    
    github_url_with_anchor = f"{github_url}{anchor}"
    
    return {
        "title": title,
        "url": github_url_with_anchor,
        "local_path": file_path
    }

def get_multiple_references(file_paths):
    """
    获取多个文件的引用
    
    Args:
        file_paths: 文件路径列表
        
    Returns:
        引用列表
    """
    references = []
    for file_path in file_paths:
        ref = format_reference(file_path)
        if ref:
            references.append(ref)
    
    return references

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
    
    return f"""📖 **参考文档**: [{ref['title']}]({ref['url']})
📁 **本地路径**: `{ref['local_path']}`"""

# 示例使用
if __name__ == "__main__":
    # 测试路径转换
    test_paths = [
        "/tmp/rdk_doc/docs/01_Quick_start/hardware_introduction/rdk_x3.md",
        "/tmp/rdk_doc/docs/01_Quick_start/remote_login.md",
        "/tmp/rdk_doc/docs_s/01_Quick_start/01_hardware_introduction/01_rdk_s100.md",
    ]
    
    print("GitHub URL映射测试:")
    print("=" * 60)
    
    for path in test_paths:
        ref = format_reference(path)
        if ref:
            print(f"文件: {os.path.basename(path)}")
            print(f"标题: {ref['title']}")
            print(f"GitHub链接: {ref['url']}")
            print(f"Markdown引用: {create_markdown_reference(ref)}")
            print("-" * 60)