#!/bin/bash
# OpenClaw 完整安装脚本
# 用于 RDK 开发板

set -e  # 遇到错误立即退出

LOG_FILE="/tmp/openclaw_install_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=========================================="
echo "OpenClaw 安装流程开始"
echo "时间: $(date)"
echo "=========================================="

# 步骤 1: 检查 node 和 npm 版本
echo ""
echo "=== 步骤 1: 检查 Node.js 和 NPM 版本 ==="
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "Node.js 版本: $NODE_VERSION"
else
    echo "错误: Node.js 未安装"
    echo "正在安装 Node.js..."
    # 根据系统类型安装
    if [ -f /etc/openwrt_release ]; then
        opkg update
        opkg install nodejs npm
    elif command -v apt &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
        apt-get install -y nodejs
    else
        echo "无法自动安装 Node.js，请手动安装"
        exit 1
    fi
    NODE_VERSION=$(node --version)
    echo "Node.js 版本: $NODE_VERSION"
fi

if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "NPM 版本: $NPM_VERSION"
else
    echo "错误: NPM 未安装"
    exit 1
fi

# 步骤 2: 创建 /root/.openclaw 目录
echo ""
echo "=== 步骤 2: 创建配置目录 ==="
mkdir -p /root/.openclaw
echo "已创建目录: /root/.openclaw"
ls -la /root/.openclaw

# 步骤 3: 从备份恢复配置
echo ""
echo "=== 步骤 3: 恢复配置文件 ==="
if [ -f /root/.openclaw_backup/openclaw.json.backup ]; then
    cp /root/.openclaw_backup/openclaw.json.backup /root/.openclaw/openclaw.json
    echo "配置已从备份恢复"
    echo "配置文件内容:"
    cat /root/.openclaw/openclaw.json
else
    echo "警告: 备份文件不存在，创建默认配置"
    cat > /root/.openclaw/openclaw.json << 'EOF'
{
  "gateway": {
    "port": 8080,
    "host": "0.0.0.0"
  },
  "tools": {
    "web": {
      "search": {
        "enabled": true,
        "provider": "duckduckgo",
        "maxResults": 5
      }
    }
  },
  "skills": [],
  "logging": {
    "level": "info"
  }
}
EOF
    echo "已创建默认配置（板端 web_search 默认 DuckDuckGo，免 Key；若要 Brave 见脚本末尾说明）"
fi

# 步骤 4: 安装 OpenClaw Gateway
echo ""
echo "=== 步骤 4: 安装 OpenClaw Gateway ==="
echo "正在安装 @openclaw/gateway..."
npm install -g @openclaw/gateway --registry=https://registry.npmjs.org 2>&1 || {
    echo "主镜像安装失败，尝试备用镜像..."
    npm install -g @openclaw/gateway --registry=https://registry.npmmirror.com
}
echo "OpenClaw Gateway 安装完成"
which openclaw-gateway || echo "警告: 未找到 openclaw-gateway 命令"

# 步骤 5: 配置 systemd 服务
echo ""
echo "=== 步骤 5: 配置 systemd 服务 ==="
cat > /etc/systemd/system/openclaw.service << 'EOF'
[Unit]
Description=OpenClaw Gateway Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/.openclaw
ExecStart=/usr/bin/openclaw-gateway --config /root/.openclaw/openclaw.json
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

echo "systemd 服务配置已创建"
systemctl daemon-reload
echo "已重新加载 systemd 配置"

# 步骤 6: 安装 RDK-X5 技能
echo ""
echo "=== 步骤 6: 安装 RDK-X5 技能包 ==="
RDK_SKILLS=(
    "rdk-x5-camera"
    "rdk-x5-sensor"
    "rdk-x5-bpu"
    "rdk-x5-gpio"
    "rdk-x5-ros"
    "rdk-x5-system"
)

for skill in "${RDK_SKILLS[@]}"; do
    echo "正在安装 $skill..."
    npm install -g "$skill" --registry=https://registry.npmjs.org 2>&1 || {
        echo "$skill 安装失败，尝试备用镜像..."
        npm install -g "$skill" --registry=https://registry.npmmirror.com 2>&1 || echo "$skill 安装失败"
    }
done

echo "所有技能安装完成"
echo "已安装的技能:"
npm list -g --depth=0 | grep rdk-x5 || echo "未找到已安装的 rdk-x5 技能"

# 步骤 7: 启动服务并验证
echo ""
echo "=== 步骤 7: 启动服务并验证 ==="
systemctl enable openclaw.service
echo "已启用 openclaw 服务开机自启"

systemctl start openclaw.service
echo "已启动 openclaw 服务"

sleep 3
echo ""
echo "服务状态:"
systemctl status openclaw.service --no-pager

echo ""
echo "服务日志 (最近 20 行):"
journalctl -u openclaw.service -n 20 --no-pager

# 验证服务是否正常运行
if systemctl is-active --quiet openclaw.service; then
    echo ""
    echo "✓ OpenClaw 服务运行正常"
    
    # 尝试连接网关
    sleep 2
    if command -v curl &> /dev/null; then
        echo ""
        echo "测试网关连接:"
        curl -s http://localhost:8080/health 2>&1 || echo "健康检查端点无响应"
    fi
else
    echo ""
    echo "✗ OpenClaw 服务未正常运行，请检查日志"
    echo "完整日志位置: $LOG_FILE"
fi

# 完成
echo ""
echo "=========================================="
echo "OpenClaw 安装流程完成"
echo "时间: $(date)"
echo "日志文件: $LOG_FILE"
echo "=========================================="

echo ""
echo "联网搜索（OpenClaw web_search）:"
echo "  默认: DuckDuckGo（免 Key，已在全新 openclaw.json 中写入）。"
echo "  升级 Brave: 在 ~/.openclaw/openclaw.json 设 tools.web.search.provider=brave，"
echo "    并配置 BRAVE_API_KEY（或 plugins.entries.brave.config.webSearch.apiKey，见 OpenClaw 文档）；"
echo "    中文场景可在对话中让 Agent 调用 web_search 时带 country=CN、language=zh。"
echo ""
echo "快速参考:"
echo "  启动服务: systemctl start openclaw"
echo "  停止服务: systemctl stop openclaw"
echo "  重启服务: systemctl restart openclaw"
echo "  查看状态: systemctl status openclaw"
echo "  查看日志: journalctl -u openclaw -f"
