import { useAppState } from '../hooks/useAppState';

export default function OpenClaw() {
  const { openclawMode, setOpenclawMode, addToast, setActiveTab } = useAppState();

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">⚙️ AI 网关</div>
        <div className="desc-text">管理大模型接入、飞书机器人和 API 调用监控。</div>

        <div className="ai-file-bar">
          <div className="ai-file-input-wrap">
            <span className="ai-file-icon">💬</span>
            <input className="clean-input ai-file-input" placeholder='快速测试: 输入一段话让 AI 回复，验证网关连通性' />
          </div>
          <button className="clean-btn" onClick={() => addToast('网关测试请求已发送... 模型响应正常 (212ms)', 'success')}>测试</button>
        </div>

        {/* AI 网关状态总览 - 新增 */}
        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">🧠 AI 状态</span>
          <span className="ai-recommend-text">
            网关 <strong style={{ color: '#22c55e' }}>Running</strong> ·
            今日调用 <strong>1,247</strong> 次 ·
            平均延迟 <strong>212ms</strong> ·
            成功率 <strong>99.8%</strong> ·
            已接入 2 个渠道 (OpenAI + 飞书)
          </span>
        </div>

        <div className="workspace-grid" style={{ gridTemplateColumns: '1fr 2fr' }}>
          <div className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <div className="panel-title">网关基础与渠道配置</div>
              <div className="usage-list">
                <div onClick={() => setOpenclawMode('model')} className={`usage-item selectable ${openclawMode === 'model' ? 'active' : ''}`} style={openclawMode === 'model' ? {borderColor: '#ff7a00', background: '#fff9f5'} : {}}>
                  <strong>🤖 模型配置 (Model Config)</strong>
                  <span>OpenAI, Qwen 等 API 接口密钥录入</span>
                </div>
                <div onClick={() => setOpenclawMode('feishu')} className={`usage-item selectable ${openclawMode === 'feishu' ? 'active' : ''}`} style={openclawMode === 'feishu' ? {borderColor: '#ff7a00', background: '#fff9f5'} : {}}>
                  <strong>🐦 飞书机器人 (Feishu Bot)</strong>
                  <span>获取回调地址并绑定自定义机器人</span>
                </div>
                <div onClick={() => setOpenclawMode('gateway')} className={`usage-item selectable ${openclawMode === 'gateway' ? 'active' : ''}`} style={openclawMode === 'gateway' ? {borderColor: '#ff7a00', background: '#fff9f5'} : {}}>
                  <strong>🌐 网关信息 (Gateway Info)</strong>
                  <span>本地运行状态与限流调用详情</span>
                </div>
                <div onClick={() => setOpenclawMode('install')} className={`usage-item selectable ${openclawMode === 'install' ? 'active' : ''}`} style={openclawMode === 'install' ? {borderColor: '#ff7a00', background: '#fff9f5'} : {}}>
                  <strong>📥 快速部署 (Installation)</strong>
                  <span>Node.js 网关代码拉取与 Docker 宏配置</span>
                </div>
              </div>
            </div>
            <button className="clean-btn" style={{ marginTop: 'auto', background: '#f1f5f9', color: '#334155' }}>检查容器运行状态 (Health Check)</button>

            {/* AI 联动入口 - 新增 */}
            <div style={{ padding: '10px 12px', background: '#f0f9ff', borderRadius: 10, border: '1px dashed #93c5fd' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 6 }}>🔗 AI 联动</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="chip-btn" onClick={() => setActiveTab('ide')}>📝 代码编辑</button>
                <button className="chip-btn" onClick={() => setActiveTab('models')}>🤖 管理推理模型</button>
              </div>
            </div>
          </div>

          <div className="panel-card" style={{ background: '#f8fafc', animation: 'fadeIn 0.3s ease-in-out' }}>
            {openclawMode === 'model' && (
              <div style={{ padding: '16px' }}>
                <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.2rem', color: '#1e293b' }}>大语言模型 (LLM) 密钥配置</h3>

                {/* AI 智能检测 - 新增 */}
                <div style={{ padding: '10px 14px', background: '#f0fdf4', borderRadius: 8, marginBottom: 16, fontSize: '0.82rem', color: '#16a34a' }}>
                  🧠 AI 检测: 当前设备支持本地 Ollama 部署 (4GB 可运行 Qwen2-1.5B)，也可接入云端 API 获得更强模型能力
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#64748b' }}>选择模型提供商</label>
                    <select className="clean-input" style={{ width: '100%', background: 'white' }}>
                      <option>OpenAI (或兼容接口如 DeepSeek)</option>
                      <option>阿里云 Qwen (通义千问)</option>
                      <option>本地 Ollama 服务</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#64748b' }}>API 访问地址 (Endpoint)</label>
                    <input type="text" className="clean-input" defaultValue="https://api.openai.com/v1" style={{ width: '100%', background: 'white' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#64748b' }}>API 密钥 (API Key)</label>
                    <input type="password" className="clean-input" placeholder="sk-..." style={{ width: '100%', background: 'white' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#64748b' }}>默认调用模型 (Model Name)</label>
                    <input type="text" className="clean-input" defaultValue="gpt-4" style={{ width: '100%', background: 'white' }} />
                  </div>
                  <button className="clean-btn" style={{ background: '#ff7a00', color: 'white', marginTop: '12px' }} onClick={() => { setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100); }}>
                    保存配置并前往底端对话框测试
                  </button>
                </div>
              </div>
            )}

            {openclawMode === 'feishu' && (
              <div style={{ padding: '16px' }}>
                <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.2rem', color: '#1e293b' }}>应用集成：企业飞书机器人</h3>

                {/* AI 配置向导 - 新增 */}
                <div style={{ padding: '10px 14px', background: '#fffbeb', borderRadius: 8, marginBottom: 16, fontSize: '0.82rem', color: '#92400e' }}>
                  💡 AI 向导: 完成下方 2 步配置后，设备告警、推理结果均可自动推送到飞书群。配合流程编排可实现零代码告警链路。
                </div>

                <div style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
                  <span style={{ color: '#ff6b00', fontWeight: 'bold', fontSize: '0.9rem' }}>步骤 1: 配置请求地址 (Webhook URL)</span>
                  <div style={{ marginTop: '8px', padding: '8px', background: '#f1f5f9', borderRadius: '4px', fontFamily: 'monospace', color: '#334155' }}>
                    http://192.168.1.100:8000/api/wechat/lark
                  </div>
                  <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '8px', marginBottom: 0 }}>请复制上游地址，前往 飞书开放平台 → 事件订阅中按判验证。</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <span style={{ color: '#ff6b00', fontWeight: 'bold', fontSize: '0.9rem' }}>步骤 2: 绑定 App 凭证</span>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#64748b' }}>应用凭证配置</label>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <input type="text" className="clean-input" placeholder="App ID (cli_...)" style={{ flex: 1, minWidth: '150px', background: 'white' }} />
                      <input type="password" className="clean-input" placeholder="App Secret" style={{ flex: 1, minWidth: '150px', background: 'white' }} />
                    </div>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#64748b' }}>Encrypt Key (事件加解密，可选)</label>
                    <input type="password" className="clean-input" placeholder="输入密钥" style={{ width: '100%', background: 'white' }} />
                  </div>
                  <button className="clean-btn" style={{ background: '#ff7a00', color: 'white', marginTop: '12px' }}>模拟发送消息测试卡片</button>
                </div>
              </div>
            )}

            {openclawMode === 'gateway' && (
              <div style={{ padding: '16px' }}>
                <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.2rem', color: '#1e293b' }}>本地服务信息监控</h3>
                <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  <div className="metric-box" style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <span style={{ color: '#64748b', fontSize: '0.85rem' }}>网关代理状态</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600, marginTop: '4px', color: '#22c55e' }}>● Running</div>
                  </div>
                  <div className="metric-box" style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <span style={{ color: '#64748b', fontSize: '0.85rem' }}>API 限流配置</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600, marginTop: '4px' }}>120 QPS</div>
                  </div>
                  {/* AI 调用成功率 - 新增 */}
                  <div className="metric-box" style={{ background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <span style={{ color: '#64748b', fontSize: '0.85rem' }}>今日成功率</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600, marginTop: '4px', color: '#22c55e' }}>99.8%</div>
                  </div>
                </div>

                {/* AI 调用趋势 - 新增 */}
                <div style={{ marginTop: '16px', padding: '12px 16px', background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <strong style={{ display: 'block', marginBottom: '8px', fontSize: '0.88rem' }}>📊 AI 调用趋势 (最近 6 小时)</strong>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 60 }}>
                    {[42, 65, 88, 120, 95, 78].map((val, i) => (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <div style={{ width: '100%', height: `${(val / 120) * 50}px`, background: 'linear-gradient(to top, #ff6b00, #ff9a44)', borderRadius: '4px 4px 0 0' }}></div>
                        <span style={{ fontSize: '0.62rem', color: '#94a3b8' }}>{`${i * 1 + 5}:00`}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: '16px' }}>
                  <strong style={{ display: 'block', marginBottom: '12px' }}>实时请求调用日志</strong>
                  <div className="terminal-screen" style={{ minHeight: '140px', padding: '12px', background: '#0f172a', borderRadius: '8px', fontSize: '0.85rem' }}>
                    <div className="terminal-line" style={{ color: '#94a3b8', marginBottom: '4px' }}>[10:45:01] OpenClaws Gateway initialized on port 8000</div>
                    <div className="terminal-line" style={{ color: '#3b82f6', marginBottom: '4px' }}>[10:45:12] Model Endpoint linked & verified</div>
                    <div className="terminal-line" style={{ color: '#22c55e', marginBottom: '4px' }}>[10:46:05] POST /v1/chat/completions - 200 OK (212ms) - 1.2k tokens</div>
                    <div className="terminal-line" style={{ color: '#22c55e', marginBottom: '4px' }}>[10:46:06] POST /api/wechat/lark - 200 OK (89ms)</div>
                  </div>
                </div>
              </div>
            )}

            {openclawMode === 'install' && (
              <div style={{ padding: '16px' }}>
                <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.2rem', color: '#1e293b' }}>快速安装与容器托管指南</h3>

                {/* AI 环境检测 - 新增 */}
                <div style={{ padding: '10px 14px', background: '#f0fdf4', borderRadius: 8, marginBottom: 16, fontSize: '0.82rem' }}>
                  <div style={{ fontWeight: 600, color: '#16a34a', marginBottom: 4 }}>🧠 AI 环境预检</div>
                  <div style={{ color: '#475569', lineHeight: 1.5 }}>
                    ✅ Node.js v18+ 已安装 · ✅ Docker 可用 · ✅ 端口 8000 空闲 · 环境就绪，可直接部署
                  </div>
                </div>

                <div style={{ background: '#0f172a', padding: '16px', borderRadius: '8px', color: 'white', fontFamily: 'monospace', marginBottom: '20px', fontSize: '0.85rem' }}>
                  <div style={{ color: '#64748b', marginBottom: '8px' }}># 1. 下载构建源码并安装 Node.js 依赖</div>
                  <div style={{ marginBottom: '16px' }}>git clone https://github.com/openclaws/openclaws.git<br/>cd openclaws && npm install</div>
                  <div style={{ color: '#64748b', marginBottom: '8px' }}># 2. 启动代理和回调网关</div>
                  <div style={{ marginBottom: '16px' }}>npm run start:gateway</div>
                </div>
                <div className="usage-item" style={{ background: 'white', border: '1px solid #e2e8f0' }}>
                  想要利用 Docker 进行脱机部署？点击下方生成您的专属 Compose 文件可以关联自带 Redis 和 PostgreSQL 保存消息上下文。
                </div>
                <button className="clean-btn" style={{ background: '#ff7a00', color: 'white', marginTop: '16px' }}>获取 Docker-compose.yaml 初始化文件</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
