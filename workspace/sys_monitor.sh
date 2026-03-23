#!/bin/bash
echo "=== 系统监控演示 (30 秒持续输出) ==="
echo "开始时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

CPU_SUM=0
MEM_SUM=0

for i in $(seq 1 30); do
    TS=$(date "+%H:%M:%S")
    CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1 | cut -d'.' -f1)
    MEM_USED=$(free -m | grep Mem | awk '{print $3}')
    MEM_TOTAL=$(free -m | grep Mem | awk '{print $2}')
    MEM_PCT=$((MEM_USED * 100 / MEM_TOTAL))
    LOAD=$(cat /proc/loadavg | awk '{print $1}')
    
    echo "[$i/30] $TS | CPU: ${CPU}% | 内存: ${MEM_USED}/${MEM_TOTAL}MB (${MEM_PCT}%) | Load: $LOAD"
    
    CPU_SUM=$((CPU_SUM + CPU))
    MEM_SUM=$((MEM_SUM + MEM_PCT))
    
    sleep 1
done

echo ""
echo "=== 汇总结果 ==="
echo "结束时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "平均 CPU 使用率: $((CPU_SUM / 30))%"
echo "平均内存使用率: $((MEM_SUM / 30))%"
echo "采样次数：30 次"
echo "=== 演示完成 ==="
