import { useState, useEffect, useRef } from 'react';
import { useAppState } from '../hooks/useAppState';

type InstallState = 'checking' | 'not-installed' | 'installing' | 'installed' | 'running';
type ConfigTab = 'model' | 'feishu' | 'skills' | 'interact';

const SKILLS = [
  { id: 'device_control', icon: '🕹️', name: '设备控制', desc: '控制 GPIO、LED、舵机电机等硬件外设', enabled: true },
  { id: 'ros_topic', icon: '📡', name: 'ROS 话题', desc: '查看和发布 ROS2 话题数据', enabled: true },
  { id: 'model_inference', icon: '🧠', name: '模型推理', desc: '调用 BPU 加速的 AI 模型进行推理', enabled: true },
  { id: 'file_transfer', icon: '📦', name: '文件传输', desc: '在本地和设备之间传输文件', enabled: false },
  { id: 'system_info', icon: '🖥️', name: '系统信息', desc: '查看 CPU / Memory / BPU 使用率', enabled: true },
  { id: 'camera_stream', icon: '📷', name: '摄像头', desc: '管理 MIPI/USB 摄像头流与截图', enabled: false },
];

const MODEL_PROVIDERS = [
  { id: 'openai', name: 'OpenAI / DeepSeek', icon: '🔮', desc: '兼容接口', defaultUrl: 'https://api.openai.com/v1' },
  { id: 'qwen', name: '通义千问', icon: '☁️', desc: 'Qwen-Max', defaultUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'ollama', name: '本地 Ollama', icon: '🏠', desc: '本地推理', defaultUrl: 'http://localhost:11434/v1' },
];

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export default function OpenClaw() {
  const { addToast, setActiveTab } = useAppState();

  const [installState, setInstallState] = useState<InstallState>('checking');
  const [installProgress, setInstallProgress] = useState(0);
  const [configTab, setConfigTab] = useState<ConfigTab>('model');
  const [skillStates, setSkillStates] = useState<Record<string, boolean>>(
    Object.fromEntries(SKILLS.map(s => [s.id, s.enabled]))
  );
  const [selectedProvider, setSelectedProvider] = useState('openai');
  const [apiUrl, setApiUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('gpt-4o');
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'system', content: '👋 欢迎使用 OpenClaw AI 网关！输入自然语言指令来操控你的 RDK 设备。', timestamp: new Date().toLocaleTimeString() }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setInstallState('not-installed'), 1800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleInstall = () => {
    setInstallState('installing');
    setInstallProgress(0);
    addToast('正在安装 OpenClaw...', 'info');
    const interval = setInterval(() => {
      setInstallProgress(p => {
        if (p >= 100) {
          clearInterval(interval);
          setInstallState('installed');
          addToast('OpenClaw 安装完成！', 'success');
          return 100;
        }
        return p + Math.random() * 15 + 5;
      });
    }, 400);
  };

  const handleStart = () => {
    addToast('正在启动 OpenClaw 网关服务...', 'info');
    setTimeout(() => {
      setInstallState('running');
      addToast('OpenClaw 网关已启动 (port 8000)', 'success');
    }, 2000);
  };

  const toggleSkill = (id: string) => {
    setSkillStates(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSendChat = () => {
    if (!chatInput.trim() || isChatLoading) return;
    const userMsg: ChatMessage = { role: 'user', content: chatInput, timestamp: new Date().toLocaleTimeString() };
    const userInput = chatInput.trim();
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    setTimeout(() => {
      const responses: Record<string, string> = {
        '你好': '你好！我是 OpenClaw AI 助手，可以帮你控制 RDK 设备、查看话题、管理模型。试试说 "查看系统状态" 或 "列出 ROS 话题"。',
        '查看系统状态': '📊 系统状态报告:\n• CPU: 45% (4 cores @ 1.5GHz)\n• 内存: 1.2GB / 4GB (30%)\n• BPU: 使用率 12%\n• 温度: CPU 52°C, BPU 48°C\n• 运行时间: 2h 35m',
        '列出 ROS 话题': '📡 当前活跃 ROS2 话题:\n• /hobot_dnn/bbox (30Hz)\n• /camera/color/image_raw (30Hz)\n• /tf (100Hz)\n• /cmd_vel (10Hz)',
        '打开摄像头': '📷 正在启动 MIPI 摄像头...\n✅ 摄像头已启动\n• 分辨率: 1920x1080\n• 帧率: 30fps\n• 流地址: rtsp://192.168.1.100:8554/live',
      };
      const defaultResp = '🤖 已收到指令，正在解析并执行...\n执行结果: 命令已发送到设备。你可以继续用自然语言描述下一步操作。';
      const reply = responses[userInput] || defaultResp;
      setChatMessages(prev => [...prev, { role: 'assistant', content: reply, timestamp: new Date().toLocaleTimeString() }]);
      setIsChatLoading(false);
    }, 1200);
  };

  const enabledSkillCount = Object.values(skillStates).filter(Boolean).length;

  // ─── Checking State ───
  if (installState === 'checking') {
    return (
      <div className="oc2-page">
        <div className="oc2-check-screen">
          <div className="oc2-check-spinner" />
          <div className="oc2-check-title">正在检测 OpenClaw 环境...</div>
          <div className="oc2-check-sub">检查设备上是否已安装 OpenClaw AI 网关</div>
        </div>
      </div>
    );
  }

  // ─── Not Installed / Installing ───
  if (installState === 'not-installed' || installState === 'installing') {
    return (
      <div className="oc2-page">
        <div className="oc2-install-screen">
          <div className="oc2-install-hero">
            <div className="oc2-install-emoji">🦀</div>
            <h2 className="oc2-install-title">安装 OpenClaw AI 网关</h2>
            <p className="oc2-install-desc">
              OpenClaw 是地瓜机器人官方的 AI Agent 网关，支持大模型接入、飞书机器人、
              技能编排与设备控制。安装后即可通过自然语言操控 RDK 设备。
            </p>
          </div>

          <div className="oc2-feature-grid">
            {[
              { icon: '🤖', name: '大模型接入', desc: 'OpenAI / 通义千问 / 本地 Ollama' },
              { icon: '🐦', name: 'IM 集成', desc: '飞书 / Telegram 机器人推送' },
              { icon: '🧩', name: '技能编排', desc: '自定义 AI 可调用的设备能力' },
              { icon: '💬', name: '自然语言交互', desc: '用中文对话控制 RDK 设备' },
            ].map((f, i) => (
              <div key={i} className="oc2-feature-item">
                <span className="oc2-feature-icon">{f.icon}</span>
                <div className="oc2-feature-name">{f.name}</div>
                <div className="oc2-feature-desc">{f.desc}</div>
              </div>
            ))}
          </div>

          <div className="oc2-install-cmd">
            <code>$ curl -sSL https://openclaw.ai/install.sh | bash</code>
          </div>

          {installState === 'installing' && (
            <div className="oc2-progress-wrap">
              <div className="oc2-progress-bar">
                <div className="oc2-progress-fill" style={{ width: `${Math.min(installProgress, 100)}%` }} />
              </div>
              <span className="oc2-progress-text">{Math.min(Math.round(installProgress), 100)}%</span>
            </div>
          )}

          <div className="oc2-install-actions">
            <button className="oc2-btn primary" onClick={handleInstall}
              disabled={installState === 'installing'}>
              {installState === 'installing' ? '安装中...' : '📥 一键安装'}
            </button>
            <button className="oc2-btn ghost"
              onClick={() => addToast('文档: docs.openclaw.ai/zh-CN', 'info')}>
              📖 查看文档
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Installed / Running ───
  return (
    <div className="oc2-page">
      {/* Status Bar */}
      <div className="oc2-status-bar">
        <div className="oc2-status-left">
          <span className="oc2-status-logo">🦀</span>
          <span className="oc2-status-name">OpenClaw</span>
          <span className={`oc2-badge ${installState === 'running' ? 'running' : 'stopped'}`}>
            <span className="oc2-badge-dot" />
            {installState === 'running' ? 'Running · Port 8000' : '已安装 · 未启动'}
          </span>
        </div>
        <div className="oc2-status-right">
          {installState === 'installed' && (
            <button className="oc2-btn primary sm" onClick={handleStart}>▶ 启动服务</button>
          )}
          {installState === 'running' && (
            <div className="oc2-mini-stats">
              <div className="oc2-mini-stat"><span className="val">1,247</span><span className="lbl">调用</span></div>
              <div className="oc2-mini-stat"><span className="val">212ms</span><span className="lbl">延迟</span></div>
              <div className="oc2-mini-stat"><span className="val">99.8%</span><span className="lbl">成功</span></div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="oc2-tabs">
        {([
          { id: 'model' as ConfigTab, icon: '🤖', label: '模型配置' },
          { id: 'feishu' as ConfigTab, icon: '🐦', label: '飞书集成' },
          { id: 'skills' as ConfigTab, icon: '🧩', label: `技能 (${enabledSkillCount}/${SKILLS.length})` },
          { id: 'interact' as ConfigTab, icon: '💬', label: 'AI 交互' },
        ]).map(tab => (
          <button key={tab.id}
            className={`oc2-tab ${configTab === tab.id ? 'active' : ''}`}
            onClick={() => setConfigTab(tab.id)}>
            <span className="oc2-tab-icon">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="oc2-content" key={configTab} style={{ animation: 'fadeIn 0.25s ease' }}>

        {/* Model Config */}
        {configTab === 'model' && (
          <div className="oc2-card">
            <div className="oc2-card-hd">
              <h3>大语言模型 (LLM) 配置</h3>
              <p>选择提供商并配置 API 密钥，OpenClaw 将通过该模型处理自然语言指令</p>
            </div>
            <div className="oc2-tip">
              <span>💡</span>
              <div><strong>AI 检测:</strong> 当前设备 RAM 4GB，支持本地 Ollama (Qwen2-1.5B)，也可接入云端 API</div>
            </div>
            <div className="oc2-provider-grid">
              {MODEL_PROVIDERS.map(p => (
                <button key={p.id}
                  className={`oc2-provider ${selectedProvider === p.id ? 'active' : ''}`}
                  onClick={() => { setSelectedProvider(p.id); setApiUrl(p.defaultUrl); }}>
                  <span className="oc2-provider-ico">{p.icon}</span>
                  <div className="oc2-provider-name">{p.name}</div>
                  <div className="oc2-provider-desc">{p.desc}</div>
                </button>
              ))}
            </div>
            <div className="oc2-form">
              <div className="oc2-field">
                <label>API 访问地址</label>
                <input value={apiUrl} onChange={e => setApiUrl(e.target.value)} />
              </div>
              <div className="oc2-field">
                <label>API 密钥</label>
                <input type="password" placeholder="sk-..." value={apiKey} onChange={e => setApiKey(e.target.value)} />
              </div>
              <div className="oc2-field">
                <label>默认模型</label>
                <input value={modelName} onChange={e => setModelName(e.target.value)} />
              </div>
            </div>
            <div className="oc2-actions">
              <button className="oc2-btn primary" onClick={() => addToast('模型配置已保存', 'success')}>💾 保存配置</button>
              <button className="oc2-btn ghost" onClick={() => addToast('测试请求已发送... 响应正常 (212ms)', 'success')}>🧪 连通测试</button>
            </div>
          </div>
        )}

        {/* Feishu */}
        {configTab === 'feishu' && (
          <div className="oc2-card">
            <div className="oc2-card-hd">
              <h3>飞书 / Telegram 机器人集成</h3>
              <p>配置后设备告警、推理结果可自动推送到飞书群，也支持在飞书中直接对话控制设备</p>
            </div>
            <div className="oc2-step">
              <div className="oc2-step-num">1</div>
              <div className="oc2-step-body">
                <div className="oc2-step-title">配置事件订阅地址</div>
                <div className="oc2-step-desc">复制地址到飞书开放平台 → 事件订阅中验证</div>
                <div className="oc2-webhook">
                  <code>http://192.168.1.100:8000/api/wechat/lark</code>
                  <button onClick={() => addToast('已复制到剪贴板', 'success')}>复制</button>
                </div>
              </div>
            </div>
            <div className="oc2-step">
              <div className="oc2-step-num">2</div>
              <div className="oc2-step-body">
                <div className="oc2-step-title">绑定 App 凭证</div>
                <div className="oc2-step-desc">在飞书开放平台创建应用后获取凭证</div>
                <div className="oc2-form-row">
                  <div className="oc2-field"><label>App ID</label><input placeholder="cli_..." value={feishuAppId} onChange={e => setFeishuAppId(e.target.value)} /></div>
                  <div className="oc2-field"><label>App Secret</label><input type="password" placeholder="..." value={feishuAppSecret} onChange={e => setFeishuAppSecret(e.target.value)} /></div>
                </div>
                <div className="oc2-field" style={{ marginTop: 12 }}>
                  <label>Encrypt Key (可选)</label>
                  <input type="password" placeholder="加密密钥" />
                </div>
              </div>
            </div>
            <div className="oc2-actions">
              <button className="oc2-btn primary" onClick={() => addToast('飞书配置已保存', 'success')}>💾 保存配置</button>
              <button className="oc2-btn ghost" onClick={() => addToast('模拟消息已发送到飞书群', 'success')}>📬 发送测试卡片</button>
            </div>
          </div>
        )}

        {/* Skills */}
        {configTab === 'skills' && (
          <div className="oc2-card">
            <div className="oc2-card-hd">
              <h3>技能配置 (Skills)</h3>
              <p>每个技能定义了 AI 可调用的设备能力，启用后 AI 可在对话中自动调用对应功能</p>
            </div>
            <div className="oc2-skills-grid">
              {SKILLS.map(skill => (
                <div key={skill.id} className={`oc2-skill ${skillStates[skill.id] ? 'enabled' : ''}`}>
                  <div className="oc2-skill-top">
                    <span className="oc2-skill-ico">{skill.icon}</span>
                    <button className={`oc2-toggle ${skillStates[skill.id] ? 'on' : ''}`}
                      onClick={() => toggleSkill(skill.id)} />
                  </div>
                  <div className="oc2-skill-name">{skill.name}</div>
                  <div className="oc2-skill-desc">{skill.desc}</div>
                  <div className="oc2-skill-id">{skill.id}</div>
                </div>
              ))}
            </div>
            <button className="oc2-btn ghost" style={{ marginTop: 16 }}
              onClick={() => addToast('自定义技能可通过 YAML 配置添加', 'info')}>
              + 添加自定义技能
            </button>
          </div>
        )}

        {/* AI Interact */}
        {configTab === 'interact' && (
          <>
            {installState !== 'running' ? (
              <div className="oc2-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>🔌</div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>请先启动 OpenClaw 服务</h3>
                <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 auto 24px', maxWidth: 360 }}>
                  AI 交互需要 OpenClaw 网关运行中
                </p>
                <button className="oc2-btn primary" onClick={handleStart}>▶ 启动服务</button>
              </div>
            ) : (
              <div className="oc2-chat">
                <div className="oc2-chat-hd">
                  <span>🦀</span>
                  <div>
                    <div className="oc2-chat-hd-title">OpenClaw AI 对话</div>
                    <div className="oc2-chat-hd-sub">用自然语言控制 RDK 设备</div>
                  </div>
                </div>
                <div className="oc2-chat-msgs">
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`oc2-msg ${msg.role}`}>
                      {msg.role === 'system' && <div className="oc2-msg-sys">{msg.content}</div>}
                      {msg.role === 'user' && (
                        <div className="oc2-msg-user">
                          <div className="oc2-msg-text">{msg.content}</div>
                          <div className="oc2-msg-time">{msg.timestamp}</div>
                        </div>
                      )}
                      {msg.role === 'assistant' && (
                        <div className="oc2-msg-bot">
                          <div className="oc2-msg-avatar">🦀</div>
                          <div>
                            <div className="oc2-msg-text">{msg.content}</div>
                            <div className="oc2-msg-time">{msg.timestamp}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {isChatLoading && (
                    <div className="oc2-msg assistant">
                      <div className="oc2-msg-bot">
                        <div className="oc2-msg-avatar">🦀</div>
                        <div className="oc2-typing"><span /><span /><span /></div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
                <div className="oc2-chat-prompts">
                  {['你好', '查看系统状态', '列出 ROS 话题', '打开摄像头'].map(cmd => (
                    <button key={cmd} className="oc2-prompt-chip" onClick={() => setChatInput(cmd)}>{cmd}</button>
                  ))}
                </div>
                <div className="oc2-chat-input">
                  <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                    placeholder="输入自然语言指令..."
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSendChat(); } }} />
                  <button className="oc2-send" onClick={handleSendChat}
                    disabled={!chatInput.trim() || isChatLoading}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  </button>
                </div>
                <div className="oc2-chat-footer">
                  <button className="oc2-btn ghost sm" onClick={() => setActiveTab('terminal')}>
                    💻 在终端中使用 OpenClaw
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Quick Links */}
      <div className="oc2-links">
        <button className="oc2-link" onClick={() => setActiveTab('terminal')}>💻 终端</button>
        <button className="oc2-link" onClick={() => setActiveTab('models')}>🤖 模型</button>
        <button className="oc2-link" onClick={() => setActiveTab('lowcode')}>✏️ 代码</button>
        <button className="oc2-link" onClick={() => addToast('文档: docs.openclaw.ai/zh-CN', 'info')}>📖 文档</button>
      </div>
    </div>
  );
}
