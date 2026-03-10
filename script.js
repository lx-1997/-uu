const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const newRenderOpenClaw = \  const renderOpenClaw = () => (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header"> OpenClaws Agent Gateway</div>
        <div className="desc-text">OpenClaws.io 大模型网关与 AI Agent 编排。一键配置大语言模型、飞书等渠道接入。提示：你可以通过页面底部的 AI 指令框直接调试交互。</div>
        <div className="workspace-grid" style={{ gridTemplateColumns: '1fr 2fr' }}>
          
          <div className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <div className="panel-title">网关基础与渠道配置</div>
              <div className="usage-list">
                <div onClick={() => setOpenclawMode('model')} className={\\\usage-item selectable \\\\}>
                  <strong> 模型配置 (Model Config)</strong>
                  <span>OpenAI, Qwen 等 API 接口</span>
                </div>
                <div onClick={() => setOpenclawMode('feishu')} className={\\\usage-item selectable \\\\}>
                  <strong> 飞书接入 (Feishu Bot)</strong>
                  <span>获取 Webhook 并配置企业机器人</span>
                </div>
                <div onClick={() => setOpenclawMode('gateway')} className={\\\usage-item selectable \\\\}>
                  <strong> 网关信息 (Gateway Info)</strong>
                  <span>查看运行状态与本地连接代理</span>
                </div>
                <div onClick={() => setOpenclawMode('install')} className={\\\usage-item selectable \\\\}>
                  <strong> 快速安装/部署 (Installation)</strong>
                  <span>Node.js 网关代理与持久化设置</span>
                </div>
              </div>
            </div>
          </div>

          <div className="panel-card" style={{ background: '#f8fafc' }}>
            {openclawMode === 'model' && (
              <div style={{ padding: '16px', animation: 'fadeIn 0.3s ease-in-out' }}>
                <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.2rem', color: '#1e293b' }}>大语言模型密钥配置</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#64748b' }}>模型提供商</label>
                    <select className="clean-input" style={{ width: '100%', background: 'white' }}>
                      <option>OpenAI / DeepSeek (兼容接口)</option>
                      <option>阿里云 Qwen (通义千问)</option>
                      <option>Ollama (本地私有部署)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#64748b' }}>API Endpoint</label>
                    <input type="text" className="clean-input" defaultValue="https://api.openai.com/v1" style={{ width: '100%', background: 'white' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#64748b' }}>API Key</label>
                    <input type="password" className="clean-input" placeholder="sk-....." style={{ width: '100%', background: 'white' }} />
                  </div>
                  <button className="clean-btn" style={{ background: '#ff7a00', color: 'white', marginTop: '12px' }}>保存并在网关生效</button>
                </div>
              </div>
            )}

            {openclawMode === 'feishu' && (
              <div style={{ padding: '16px', animation: 'fadeIn 0.3s ease-in-out' }}>
                <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.2rem', color: '#1e293b' }}>飞书机器人接入参数</h3>
                <div style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
                  <span style={{ color: '#ff6b00', fontWeight: 'bold' }}>网关回调地址 (Webhook URL):</span>
                  <div style={{ marginTop: '8px', padding: '8px', background: '#f1f5f9', borderRadius: '4px', fontFamily: 'monospace' }}>
                    http://192.168.1.100:8000/api/wechat/lark
                  </div>
                  <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '12px' }}>将此地址填入飞书开放平台 - 事件订阅请求地址中。</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#64748b' }}>App ID & App Secret</label>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <input type="text" className="clean-input" placeholder="App ID (cli_...)" style={{ flex: 1, background: 'white' }} />
                      <input type="password" className="clean-input" placeholder="App Secret (...)" style={{ flex: 1, background: 'white' }} />
                    </div>
                  </div>
                  <button className="clean-btn" style={{ background: '#ff7a00', color: 'white', marginTop: '12px' }}>联调并测试连接</button>
                </div>
              </div>
            )}

            {openclawMode === 'gateway' && (
              <div style={{ padding: '16px', animation: 'fadeIn 0.3s ease-in-out' }}>
                <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.2rem', color: '#1e293b' }}>网关运行状态面板</h3>
                <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div className="metric-box" style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <span style={{ color: '#64748b', fontSize: '0.85rem' }}>代理状态</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600, marginTop: '4px', color: '#22c55e' }}> Running</div>
                  </div>
                  <div className="metric-box" style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <span style={{ color: '#64748b', fontSize: '0.85rem' }}>拦截规则 (Rate Limit)</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600, marginTop: '4px' }}>120 QPS</div>
                  </div>
                </div>
                <div style={{ marginTop: '20px' }}>
                  <strong style={{ display: 'block', marginBottom: '12px' }}>最近请求日志 (Mock)</strong>
                  <div className="terminal-screen" style={{ minHeight: '120px', padding: '12px', background: '#0f172a', borderRadius: '8px', fontSize: '0.85rem' }}>
                    <div className="terminal-line" style={{ color: '#3b82f6', marginBottom: '4px' }}>[INFO] OpenClaws proxy initialized on port 8000</div>
                    <div className="terminal-line" style={{ color: '#22c55e', marginBottom: '4px' }}>[INFO] POST /v1/chat/completions - 200 OK (212ms)</div>
                    <div className="terminal-line" style={{ color: '#22c55e', marginBottom: '4px' }}>[INFO] POST /api/wechat/lark - 200 OK (89ms)</div>
                  </div>
                </div>
              </div>
            )}

            {openclawMode === 'install' && (
              <div style={{ padding: '16px', animation: 'fadeIn 0.3s ease-in-out' }}>
                <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.2rem', color: '#1e293b' }}>快速安装与容器托管</h3>
                <div style={{ background: '#0f172a', padding: '16px', borderRadius: '8px', color: 'white', fontFamily: 'monospace', marginBottom: '16px' }}>
                  <div style={{ color: '#94a3b8', marginBottom: '8px' }}># 1. 克隆代码并安装依赖</div>
                  <div style={{ marginBottom: '12px' }}>git clone https://github.com/openclaws/openclaws.git<br/>cd openclaws && npm install</div>
                  <div style={{ color: '#94a3b8', marginBottom: '8px' }}># 2. 启动代理网关</div>
                  <div>npm run start:gateway</div>
                </div>
                <button className="clean-btn" style={{ background: 'white', border: '1px solid #e2e8f0', color: '#334155' }}>
                  生成 Docker-compose.yaml
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );\;

const startIndex = code.indexOf('  const renderOpenClaw = () => (');
const endIndex = code.indexOf('  const renderHardware = () => (');
if (startIndex !== -1 && endIndex !== -1) {
  const result = code.substring(0, startIndex) + newRenderOpenClaw + '\n\n' + code.substring(endIndex);
  fs.writeFileSync('src/App.tsx', result, 'utf8');
  console.log('Successfully replaced renderOpenClaw using JS');
} else {
  console.log('Failed to find start or end index.');
}
