#!/usr/bin/env python3
"""
排序算法演示
包含：冒泡排序、快速排序、归并排序、插入排序
"""

import random
import time

# 冒泡排序
def bubble_sort(arr):
    n = len(arr)
    result = arr.copy()
    for i in range(n):
        for j in range(0, n - i - 1):
            if result[j] > result[j + 1]:
                result[j], result[j + 1] = result[j + 1], result[j]
    return result

# 快速排序
def quick_sort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quick_sort(left) + middle + quick_sort(right)

# 归并排序
def merge_sort(arr):
    if len(arr) <= 1:
        return arr
    mid = len(arr) // 2
    left = merge_sort(arr[:mid])
    right = merge_sort(arr[mid:])
    return merge(left, right)

def merge(left, right):
    result = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            result.append(left[i])
            i += 1
        else:
            result.append(right[j])
            j += 1
    result.extend(left[i:])
    result.extend(right[j:])
    return result

# 插入排序
def insertion_sort(arr):
    result = arr.copy()
    for i in range(1, len(result)):
        key = result[i]
        j = i - 1
        while j >= 0 and result[j] > key:
            result[j + 1] = result[j]
            j -= 1
        result[j + 1] = key
    return result

# 性能测试
def benchmark(sort_func, arr, name):
    start = time.perf_counter()
    sorted_arr = sort_func(arr)
    end = time.perf_counter()
    print(f"{name}: {(end - start) * 1000:.4f} ms")
    return sorted_arr

def main():
    print("=" * 50)
    print("Python 排序算法演示")
    print("=" * 50)
    
    # 生成随机数组
    random.seed(42)
    test_array = [random.randint(1, 100) for _ in range(15)]
    
    print(f"\n原始数组: {test_array}")
    print(f"数组长度: {len(test_array)}")
    
    # 演示各种排序
    print("\n--- 排序结果 ---")
    
    bubble_result = bubble_sort(test_array)
    print(f"冒泡排序: {bubble_result}")
    
    quick_result = quick_sort(test_array)
    print(f"快速排序: {quick_result}")
    
    merge_result = merge_sort(test_array)
    print(f"归并排序: {merge_result}")
    
    insertion_result = insertion_sort(test_array)
    print(f"插入排序: {insertion_result}")
    
    # 验证结果正确性
    expected = sorted(test_array)
    print(f"\nPython 内置: {expected}")
    
    all_correct = (
        bubble_result == expected and
        quick_result == expected and
        merge_result == expected and
        insertion_result == expected
    )
    print(f"\n所有算法结果正确: {all_correct}")
    
    # 性能对比（使用更大的数组）
    print("\n--- 性能测试 (1000 个元素) ---")
    large_array = [random.randint(1, 10000) for _ in range(1000)]
    
    benchmark(bubble_sort, large_array, "冒泡排序")
    benchmark(quick_sort, large_array, "快速排序")
    benchmark(merge_sort, large_array, "归并排序")
    benchmark(insertion_sort, large_array, "插入排序")
    
    print("\n" + "=" * 50)
    print("演示完成!")
    print("=" * 50)

if __name__ == "__main__":
    main()
