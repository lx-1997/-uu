ip=$1
network=$(echo $ip | cut -d '.' -f 1-3)

# 使用ping检查IP是否响应
if ping -c 1 $ip > /dev/null 2>&1; then
    echo "$ip is taken"
else
    # 如果ping不通，则使用arping检查ARP表
    if arping -c 1 $ip > /dev/null 2>&1; then
        echo "$ip is taken"
    else
        echo "$ip is free"
    fi
fi