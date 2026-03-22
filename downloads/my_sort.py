#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
小地瓜的排序算法演示 🍠
"""

import random
import time

def bubble_sort(arr):
    n = len(arr)
    result = arr.copy()
    for i in range(n):
        for j in range(0, n-i-1):
            if result[j] > result[j+1]:
                result[j], result[j+1] = result[j+1], result[j]
    return result

def quick_sort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quick_sort(left) + middle + quick_sort(right)

def main():
    print("=" * 50)
    print("🍠 小地瓜的排序算法演示 🍠")
    print("=" * 50)
    
    data = [random.randint(1, 100) for _ in range(15)]
    print(f"\n原始数据：{data}")
    
    start = time.time()
    bubble_result = bubble_sort(data)
    bubble_time = (time.time() - start) * 1000
    print(f"\n【冒泡排序】{bubble_time:.4f} ms")
    print(f"结果：{bubble_result}")
    
    start = time.time()
    quick_result = quick_sort(data)
    quick_time = (time.time() - start) * 1000
    print(f"\n【快速排序】{quick_time:.4f} ms")
    print(f"结果：{quick_result}")
    
    print(f"\n{'=' * 50}")
    if bubble_result == quick_result:
        print("✅ 结果一致，排序正确！")
    print(f"{'=' * 50}")

if __name__ == "__main__":
    main()
