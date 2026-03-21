#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
冒泡排序算法演示
"""

def bubble_sort(arr):
    """冒泡排序"""
    n = len(arr)
    print(f"初始数组: {arr}")
    print("-" * 50)
    
    for i in range(n - 1):
        swapped = False
        for j in range(n - 1 - i):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
                print(f"第 {i + 1} 轮，交换 {arr[j + 1]} 和 {arr[j]}: {arr}")
        
        if not swapped:
            print("已有序，提前结束")
            break
        print(f"第 {i + 1} 轮结束：{arr}")
        print("-" * 50)
    
    return arr

if __name__ == "__main__":
    # 测试数据
    test_data = [64, 34, 25, 12, 22, 11, 90]
    
    print("=" * 50)
    print("冒泡排序算法演示")
    print("=" * 50)
    
    sorted_data = bubble_sort(test_data.copy())
    
    print("=" * 50)
    print(f"排序结果：{sorted_data}")
    print("=" * 50)
