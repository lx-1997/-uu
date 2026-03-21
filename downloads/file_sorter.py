#!/usr/bin/env python3
"""
文件排序脚本 - 按文件大小或名称排序 /userdata 目录中的文件
"""

import os
from pathlib import Path

def sort_files_by_size(directory="/userdata"):
    """按文件大小排序（从大到小）"""
    files = []
    for item in os.listdir(directory):
        item_path = os.path.join(directory, item)
        if os.path.isfile(item_path):
            size = os.path.getsize(item_path)
            files.append((item, size))
    
    # 按大小降序排序
    files.sort(key=lambda x: x[1], reverse=True)
    return files

def sort_files_by_name(directory="/userdata"):
    """按文件名称排序（字母顺序）"""
    files = []
    for item in os.listdir(directory):
        item_path = os.path.join(directory, item)
        if os.path.isfile(item_path):
            size = os.path.getsize(item_path)
            files.append((item, size))
    
    # 按名称升序排序
    files.sort(key=lambda x: x[0])
    return files

def format_size(size_bytes):
    """格式化文件大小显示"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.2f} TB"

def main():
    print("=" * 60)
    print("📁 /userdata 目录文件排序结果")
    print("=" * 60)
    
    # 按大小排序
    print("\n📊 按文件大小排序（从大到小）:")
    print("-" * 60)
    sorted_by_size = sort_files_by_size()
    for i, (name, size) in enumerate(sorted_by_size, 1):
        print(f"{i}. {name:<25} {format_size(size):>10}")
    
    # 按名称排序
    print("\n🔤 按文件名称排序（字母顺序）:")
    print("-" * 60)
    sorted_by_name = sort_files_by_name()
    for i, (name, size) in enumerate(sorted_by_name, 1):
        print(f"{i}. {name:<25} {format_size(size):>10}")
    
    # 统计信息
    print("\n📈 统计信息:")
    print("-" * 60)
    total_files = len(sorted_by_size)
    total_size = sum(size for _, size in sorted_by_size)
    print(f"文件总数：{total_files}")
    print(f"总大小：{format_size(total_size)}")
    if sorted_by_size:
        print(f"最大文件：{sorted_by_size[0][0]} ({format_size(sorted_by_size[0][1])})")
        print(f"最小文件：{sorted_by_size[-1][0]} ({format_size(sorted_by_size[-1][1])})")
    
    print("\n" + "=" * 60)

if __name__ == "__main__":
    main()
