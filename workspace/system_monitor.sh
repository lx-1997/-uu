#!/bin/bash

# 系统监控脚本
# 每 2 秒采集一次，连续 10 次

LOG_FILE="workspace/monitor_log.txt"
INTERVAL=2
COUNT=10

# 清空日志文件
echo "=== System Monitor Log ===" > "$LOG_FILE"
echo "Start Time: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
echo "Interval: ${INTERVAL}s, Count: ${COUNT}" >> "$LOG_FILE"
echo "==========================" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# 数组存储数据
declare -a cpu_values
declare -a mem_values
declare -a temp_values
declare -a timestamps

echo "开始系统监控..."

for i in $(seq 1 $COUNT); do
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    
    # 采集 CPU 使用率
    CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1 2>/dev/null || echo "N/A")
    if [ -z "$CPU" ] || [ "$CPU" = "N/A" ]; then
        # 备用方法：使用 /proc/stat
        CPU=$(grep 'cpu ' /proc/stat | awk '{usage=($2+$4)*100/($2+$4+$5)} END {print usage}' 2>/dev/null || echo "N/A")
    fi
    
    # 采集内存使用率
    MEM=$(free | grep Mem | awk '{printf "%.1f", $3/$2 * 100}' 2>/dev/null || echo "N/A")
    
    # 采集温度（如果可用）
    TEMP="N/A"
    if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
        TEMP=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null)
        if [ -n "$TEMP" ]; then
            TEMP=$(echo "scale=1; $TEMP / 1000" | bc 2>/dev/null || echo "$TEMP")
        fi
    elif [ -f /sys/class/hwmon/hwmon0/temp1_input ]; then
        TEMP=$(cat /sys/class/hwmon/hwmon0/temp1_input 2>/dev/null)
        if [ -n "$TEMP" ]; then
            TEMP=$(echo "scale=1; $TEMP / 1000" | bc 2>/dev/null || echo "$TEMP")
        fi
    fi
    
    # 存储数据
    cpu_values+=("$CPU")
    mem_values+=("$MEM")
    temp_values+=("$TEMP")
    timestamps+=("$TIMESTAMP")
    
    # 输出当前读数
    echo "[$TIMESTAMP] 采集 #$i: CPU=${CPU}%, MEM=${MEM}%, TEMP=${TEMP}°C"
    echo "[$TIMESTAMP] 采集 #$i: CPU=${CPU}%, MEM=${MEM}%, TEMP=${TEMP}°C" >> "$LOG_FILE"
    
    # 等待间隔（最后一次不需要等待）
    if [ $i -lt $COUNT ]; then
        sleep $INTERVAL
    fi
done

echo "" >> "$LOG_FILE"
echo "==========================" >> "$LOG_FILE"
echo "=== Summary Report ===" >> "$LOG_FILE"
echo "End Time: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# 计算统计信息
echo "计算统计信息..."

# 过滤有效值并计算
valid_cpu=()
valid_mem=()
valid_temp=()

for val in "${cpu_values[@]}"; do
    if [[ "$val" =~ ^[0-9.]+$ ]]; then
        valid_cpu+=("$val")
    fi
done

for val in "${mem_values[@]}"; do
    if [[ "$val" =~ ^[0-9.]+$ ]]; then
        valid_mem+=("$val")
    fi
done

for val in "${temp_values[@]}"; do
    if [[ "$val" =~ ^[0-9.]+$ ]]; then
        valid_temp+=("$val")
    fi
done

# 计算函数
calc_stats() {
    local name=$1
    shift
    local values=("$@")
    local count=${#values[@]}
    
    if [ $count -eq 0 ]; then
        echo "$name: 无有效数据"
        echo "$name: 无有效数据" >> "$LOG_FILE"
        return
    fi
    
    # 计算总和、最小值、最大值
    local sum=0
    local min=${values[0]}
    local max=${values[0]}
    
    for val in "${values[@]}"; do
        sum=$(echo "$sum + $val" | bc)
        if (( $(echo "$val < $min" | bc -l) )); then
            min=$val
        fi
        if (( $(echo "$val > $max" | bc -l) )); then
            max=$val
        fi
    done
    
    local avg=$(echo "scale=2; $sum / $count" | bc)
    
    echo "$name 统计 (有效样本: $count):"
    echo "  平均值：$avg%, 最小值：$min%, 最大值：$max%"
    echo "$name 统计 (有效样本: $count):" >> "$LOG_FILE"
    echo "  平均值：$avg%, 最小值：$min%, 最大值：$max%" >> "$LOG_FILE"
}

# CPU 统计
echo "" >> "$LOG_FILE"
calc_stats "CPU" "${valid_cpu[@]}" | tee -a "$LOG_FILE"

# 内存统计
echo "" >> "$LOG_FILE"
calc_stats "内存" "${valid_mem[@]}" | tee -a "$LOG_FILE"

# 温度统计
echo "" >> "$LOG_FILE"
calc_stats "温度" "${valid_temp[@]}" | tee -a "$LOG_FILE"

# 趋势分析
echo "" >> "$LOG_FILE"
echo "=== 趋势分析 ===" >> "$LOG_FILE"
echo "趋势分析:" | tee -a "$LOG_FILE"

if [ ${#valid_cpu[@]} -ge 2 ]; then
    first_cpu=${valid_cpu[0]}
    last_cpu=${valid_cpu[-1]}
    cpu_change=$(echo "scale=2; $last_cpu - $first_cpu" | bc)
    if (( $(echo "$cpu_change > 0" | bc -l) )); then
        trend="上升"
    elif (( $(echo "$cpu_change < 0" | bc -l) )); then
        trend="下降"
    else
        trend="平稳"
    fi
    echo "  CPU: ${trend} (变化：${cpu_change}%)" | tee -a "$LOG_FILE"
fi

if [ ${#valid_mem[@]} -ge 2 ]; then
    first_mem=${valid_mem[0]}
    last_mem=${valid_mem[-1]}
    mem_change=$(echo "scale=2; $last_mem - $first_mem" | bc)
    if (( $(echo "$mem_change > 0" | bc -l) )); then
        trend="上升"
    elif (( $(echo "$mem_change < 0" | bc -l) )); then
        trend="下降"
    else
        trend="平稳"
    fi
    echo "  内存：${trend} (变化：${mem_change}%)" | tee -a "$LOG_FILE"
fi

if [ ${#valid_temp[@]} -ge 2 ]; then
    first_temp=${valid_temp[0]}
    last_temp=${valid_temp[-1]}
    temp_change=$(echo "scale=2; $last_temp - $first_temp" | bc)
    if (( $(echo "$temp_change > 0" | bc -l) )); then
        trend="上升"
    elif (( $(echo "$temp_change < 0" | bc -l) )); then
        trend="下降"
    else
        trend="平稳"
    fi
    echo "  温度：${trend} (变化：${temp_change}°C)" | tee -a "$LOG_FILE"
fi

echo "" >> "$LOG_FILE"
echo "=== 完整数据 ===" >> "$LOG_FILE"
echo "完整采集数据:" >> "$LOG_FILE"
for i in "${!timestamps[@]}"; do
    echo "  #$(($i+1)) [${timestamps[$i]}] CPU=${cpu_values[$i]}%, MEM=${mem_values[$i]}%, TEMP=${temp_values[$i]}°C" >> "$LOG_FILE"
done

echo "" >> "$LOG_FILE"
echo "监控完成！日志已保存到：$LOG_FILE"
echo ""
echo "监控完成！日志已保存到：$LOG_FILE"
