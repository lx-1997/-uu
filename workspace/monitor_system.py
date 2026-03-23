#!/usr/bin/env python3
"""
系统监控脚本
每 2 秒采集一次系统状态，连续采集 10 次
"""

import subprocess
import time
import os
from datetime import datetime
from statistics import mean

LOG_FILE = "workspace/monitor_log.txt"
INTERVAL = 2  # 秒
COUNT = 10    # 采集次数

def get_cpu_usage():
    """获取 CPU 使用率"""
    try:
        # 使用 top 命令
        result = subprocess.run(['top', '-bn1'], capture_output=True, text=True, timeout=5)
        for line in result.stdout.split('\n'):
            if 'Cpu(s)' in line:
                parts = line.split(',')
                for part in parts:
                    if 'id' in part:
                        idle = float(part.split()[0])
                        return round(100 - idle, 2)
        
        # 备用方法：使用 /proc/stat
        with open('/proc/stat', 'r') as f:
            line = f.readline()
            parts = line.split()
            user = int(parts[1])
            nice = int(parts[2])
            system = int(parts[3])
            idle = int(parts[4])
            total = user + nice + system + idle
            usage = (user + nice + system) / total * 100
            return round(usage, 2)
    except Exception as e:
        return None

def get_memory_usage():
    """获取内存使用率"""
    try:
        with open('/proc/meminfo', 'r') as f:
            lines = f.readlines()
            mem_total = 0
            mem_available = 0
            for line in lines:
                if line.startswith('MemTotal:'):
                    mem_total = int(line.split()[1])
                elif line.startswith('MemAvailable:'):
                    mem_available = int(line.split()[1])
            
            if mem_total > 0:
                usage = (mem_total - mem_available) / mem_total * 100
                return round(usage, 2)
    except Exception as e:
        pass
    
    # 备用方法：使用 free 命令
    try:
        result = subprocess.run(['free'], capture_output=True, text=True, timeout=5)
        for line in result.stdout.split('\n'):
            if line.startswith('Mem:'):
                parts = line.split()
                total = int(parts[1])
                used = int(parts[2])
                return round(used / total * 100, 2)
    except Exception as e:
        pass
    
    return None

def get_temperature():
    """获取系统温度（如果可用）"""
    temp_paths = [
        '/sys/class/thermal/thermal_zone0/temp',
        '/sys/class/hwmon/hwmon0/temp1_input',
        '/sys/class/hwmon/hwmon1/temp1_input',
    ]
    
    for path in temp_paths:
        try:
            if os.path.exists(path):
                with open(path, 'r') as f:
                    temp = int(f.read().strip())
                    return round(temp / 1000, 2)  # 转换为摄氏度
        except Exception as e:
            continue
    
    return None

def calc_stats(values, name):
    """计算统计信息"""
    valid_values = [v for v in values if v is not None]
    
    if not valid_values:
        return f"{name}: 无有效数据"
    
    avg = round(mean(valid_values), 2)
    min_val = round(min(valid_values), 2)
    max_val = round(max(valid_values), 2)
    
    return f"{name} 统计 (有效样本：{len(valid_values)}):\n  平均值：{avg}%, 最小值：{min_val}%, 最大值：{max_val}%"

def analyze_trend(values, name, unit="%"):
    """分析趋势"""
    valid_values = [v for v in values if v is not None]
    
    if len(valid_values) < 2:
        return None
    
    first = valid_values[0]
    last = valid_values[-1]
    change = round(last - first, 2)
    
    if change > 0:
        trend = "上升"
    elif change < 0:
        trend = "下降"
    else:
        trend = "平稳"
    
    return f"  {name}: {trend} (变化：{change}{unit})"

def main():
    print("开始系统监控...")
    print(f"采集间隔：{INTERVAL}秒，采集次数：{COUNT}")
    print("-" * 60)
    
    # 存储数据
    cpu_values = []
    mem_values = []
    temp_values = []
    timestamps = []
    log_lines = []
    
    # 添加日志头
    log_lines.append("=== System Monitor Log ===")
    log_lines.append(f"Start Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log_lines.append(f"Interval: {INTERVAL}s, Count: {COUNT}")
    log_lines.append("==========================")
    log_lines.append("")
    
    # 采集数据
    for i in range(COUNT):
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        timestamps.append(timestamp)
        
        cpu = get_cpu_usage()
        mem = get_memory_usage()
        temp = get_temperature()
        
        cpu_values.append(cpu)
        mem_values.append(mem)
        temp_values.append(temp)
        
        cpu_str = f"{cpu}%" if cpu is not None else "N/A"
        mem_str = f"{mem}%" if mem is not None else "N/A"
        temp_str = f"{temp}°C" if temp is not None else "N/A"
        
        output = f"[{timestamp}] 采集 #{i+1}: CPU={cpu_str}, MEM={mem_str}, TEMP={temp_str}"
        print(output)
        log_lines.append(output)
        
        # 等待间隔（最后一次不需要等待）
        if i < COUNT - 1:
            time.sleep(INTERVAL)
    
    print("-" * 60)
    print("计算统计信息...")
    print("")
    
    # 添加统计报告
    log_lines.append("")
    log_lines.append("==========================")
    log_lines.append("=== Summary Report ===")
    log_lines.append(f"End Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log_lines.append("")
    
    # CPU 统计
    cpu_stats = calc_stats(cpu_values, "CPU")
    print(cpu_stats)
    log_lines.append(cpu_stats)
    log_lines.append("")
    
    # 内存统计
    mem_stats = calc_stats(mem_values, "内存")
    print(mem_stats)
    log_lines.append(mem_stats)
    log_lines.append("")
    
    # 温度统计
    temp_stats = calc_stats(temp_values, "温度")
    print(temp_stats)
    log_lines.append(temp_stats)
    log_lines.append("")
    
    # 趋势分析
    log_lines.append("=== 趋势分析 ===")
    print("趋势分析:")
    
    cpu_trend = analyze_trend(cpu_values, "CPU")
    if cpu_trend:
        print(cpu_trend)
        log_lines.append(cpu_trend)
    
    mem_trend = analyze_trend(mem_values, "内存")
    if mem_trend:
        print(mem_trend)
        log_lines.append(mem_trend)
    
    temp_trend = analyze_trend(temp_values, "温度", "°C")
    if temp_trend:
        print(temp_trend)
        log_lines.append(temp_trend)
    
    log_lines.append("")
    
    # 完整数据
    log_lines.append("=== 完整数据 ===")
    log_lines.append("完整采集数据:")
    for i in range(len(timestamps)):
        cpu_str = f"{cpu_values[i]}%" if cpu_values[i] is not None else "N/A"
        mem_str = f"{mem_values[i]}%" if mem_values[i] is not None else "N/A"
        temp_str = f"{temp_values[i]}°C" if temp_values[i] is not None else "N/A"
        log_lines.append(f"  #{i+1} [{timestamps[i]}] CPU={cpu_str}, MEM={mem_str}, TEMP={temp_str}")
    
    log_lines.append("")
    log_lines.append(f"监控完成！日志已保存到：{LOG_FILE}")
    
    # 写入日志文件
    with open(LOG_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(log_lines))
    
    print("")
    print(f"监控完成！日志已保存到：{LOG_FILE}")

if __name__ == "__main__":
    main()
