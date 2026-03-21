#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
排序功能演示程序
演示 Python 列表的各种排序方法
"""

def main():
    print("=" * 50)
    print("Python 排序功能演示")
    print("=" * 50)
    
    # 原始列表
    numbers = [64, 34, 25, 12, 22, 11, 90, 88, 45, 50, 23]
    print(f"\n原始列表：{numbers}")
    
    # 方法 1: sorted() - 返回新列表
    sorted_asc = sorted(numbers)
    print(f"\n1. 升序排序 (sorted): {sorted_asc}")
    
    # 方法 2: sorted() 降序
    sorted_desc = sorted(numbers, reverse=True)
    print(f"2. 降序排序 (sorted): {sorted_desc}")
    
    # 方法 3: list.sort() - 原地排序
    numbers_copy = numbers.copy()
    numbers_copy.sort()
    print(f"3. 原地升序排序 (sort): {numbers_copy}")
    
    # 方法 4: 自定义排序 - 按绝对值
    mixed = [-5, 3, -1, 10, -8, 2]
    print(f"\n混合列表：{mixed}")
    sorted_by_abs = sorted(mixed, key=abs)
    print(f"按绝对值排序：{sorted_by_abs}")
    
    # 方法 5: 字符串排序
    strings = ['banana', 'Apple', 'cherry', 'date', 'apple']
    print(f"\n字符串列表：{strings}")
    print(f"默认排序：{sorted(strings)}")
    print(f"忽略大小写：{sorted(strings, key=str.lower)}")
    
    print("\n" + "=" * 50)
    print("排序演示完成!")
    print("=" * 50)

if __name__ == "__main__":
    main()
