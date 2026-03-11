import { useState, useEffect } from 'react';
import { useAppState } from '../hooks/useAppState';

type InstallState = 'checking' | 'not-installed' | 'installing' | 'installed' | 'running';

/* ── Skills from ClawHub ecosystem ── */
const SKILLS = [
  { id: 'device_control', name: '设备控制', icon: '🎛', builtin: true, desc: 'RDK 硬件指令' },
  { id: 'ros_topic', name: 'ROS 话题', icon: '📡', builtin: true, desc: 'ROS pub/sub' },
  { id: 'camera_stream', name: '摄像头', icon: '📷', builtin: true, desc: '视频流控制' },
  { id: 'model_inference', name: '模型推理', icon: '🧠', builtin: true, desc: '端侧推理' },
  { id: 'exec', name: '命令执行', icon: '⌘', builtin: false, desc: 'Shell 命令' },
  { id: 'web_search', name: '网页搜索', icon: '🔍', builtin: false, desc: 'Exa / SerpAPI' },
  { id: 'browser', name: '浏览器', icon: '🌐', builtin: false, desc: 'Playwright' },
  { id: 'file_ops', name: '文件管理', icon: '📁', builtin: false, desc: 'Fast.io 存储' },
  { id: 'home_assistant', name: '智能家居', icon: '🏠', builtin: false, desc: 'Home Assistant' },
  { id: 'workflow', name: '工作流', icon: '⚡', builtin: false, desc: 'n8n 自动化' },
  { id: 'github', name: 'GitHub', icon: '🐙', builtin: false, desc: 'Issues / PR' },
  { id: 'whisper', name: '语音识别', icon: '🎤', builtin: false, desc: 'OpenAI Whisper' },
];

const DEFAULTS: Record<string, boolean> = {
  device_control: true, ros_topic: true, camera_stream: false, model_inference: true,
  exec: true, web_search: true, browser: false, file_ops: true,
  home_assistant: false, workflow: false, github: false, whisper: false,
};

/* ── Model providers & models ── */
const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4.1', 'gpt-4o-mini', 'o4-mini', 'o3'] },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'qwen', name: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3.5-plus', 'qwen-max', 'qwen-turbo'] },
  { id: 'anthropic', name: 'Anthropic', url: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-20250514', 'claude-4-opus-20250514'] },
  { id: 'google', name: 'Google', url: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  { id: 'ollama', name: 'Ollama (本地)', url: 'http://localhost:11434/v1',
    models: ['llama3', 'mistral', 'gemma2', 'qwen2.5'] },
];

/* Crayfish mascot SVG */
const Crayfish = ({ size = 88, className = '' }: { size?: number; className?: string }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 120 120" fill="none">
    <ellipse cx="60" cy="68" rx="22" ry="28" fill="#ff6b00" />
    <ellipse cx="60" cy="98" rx="14" ry="8" fill="#e86000" />
    <path d="M48 104 Q60 118 72 104" fill="#ff6b00" stroke="#e86000" strokeWidth="1.5"/>
    <ellipse cx="60" cy="42" rx="16" ry="14" fill="#ff8533" />
    <circle cx="52" cy="36" r="5" fill="#fff" /><circle cx="68" cy="36" r="5" fill="#fff" />
    <circle cx="53" cy="35" r="2.5" fill="#1e293b" /><circle cx="69" cy="35" r="2.5" fill="#1e293b" />
    <circle cx="54" cy="34" r="1" fill="#fff" /><circle cx="70" cy="34" r="1" fill="#fff" />
    <path d="M54 44 Q60 49 66 44" stroke="#c2410c" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
    <path d="M50 30 Q42 14 32 10" stroke="#ff8533" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    <path d="M70 30 Q78 14 88 10" stroke="#ff8533" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    <circle cx="31" cy="9" r="3" fill="#ff6b00" /><circle cx="89" cy="9" r="3" fill="#ff6b00" />
    <path d="M38 58 Q22 48 14 52" stroke="#ff6b00" strokeWidth="4" fill="none" strokeLinecap="round"/>
    <path d="M14 52 Q8 44 6 48 Q4 52 14 52" fill="#ff8533" stroke="#e86000" strokeWidth="1.2"/>
    <path d="M14 52 Q8 58 10 62 Q14 58 14 52" fill="#ff8533" stroke="#e86000" strokeWidth="1.2"/>
    <path d="M82 58 Q98 48 106 52" stroke="#ff6b00" strokeWidth="4" fill="none" strokeLinecap="round"/>
    <path d="M106 52 Q112 44 114 48 Q116 52 106 52" fill="#ff8533" stroke="#e86000" strokeWidth="1.2"/>
    <path d="M106 52 Q112 58 110 62 Q106 58 106 52" fill="#ff8533" stroke="#e86000" strokeWidth="1.2"/>
    <path d="M42 72 L28 78" stroke="#ff8533" strokeWidth="2" strokeLinecap="round"/>
    <path d="M42 80 L30 88" stroke="#ff8533" strokeWidth="2" strokeLinecap="round"/>
    <path d="M78 72 L92 78" stroke="#ff8533" strokeWidth="2" strokeLinecap="round"/>
    <path d="M78 80 L90 88" stroke="#ff8533" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

export default function OpenClaw() {
  const { addToast, setActiveTab } = useAppState();

  const [installState, setInstallState] = useState<InstallState>('checking');
  const [installProgress, setInstallProgress] = useState(0);
  const [skillStates, setSkillStates] = useState<Record<string, boolean>>({ ...DEFAULTS });
  const [provider, setProvider] = useState('qwen');
  const [apiUrl, setApiUrl] = useState(PROVIDERS[2].url);
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('qwen3.5-plus');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');
  const [feishuBotName, setFeishuBotName] = useState('OpenClaw');
  const [feishuPairCode, setFeishuPairCode] = useState('');
  const [feishuConfigured, setFeishuConfigured] = useState(false);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  const [setupProvider, setSetupProvider] = useState('qwen');
  const [setupModel, setSetupModel] = useState('qwen3.5-plus');
  const [setupKey, setSetupKey] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setInstallState('not-installed'), 1800);
    return () => clearTimeout(t);
  }, []);

  const currentProvObj = PROVIDERS.find(p => p.id === provider);
  const setupProvObj = PROVIDERS.find(p => p.id === setupProvider);

  const handleInstall = () => {
    if (!setupKey.trim()) { addToast('请填写 API Key', 'info'); return; }
    setInstallState('installing');
    setInstallProgress(0);
    const p = setupProvObj || PROVIDERS[2];
    setProvider(setupProvider);
    setApiUrl(p.url);
    setModelName(setupModel || p.models[0]);
    setApiKey(setupKey);
    addToast('环境诊断 + 依赖安装 + 程序部署 + 初始化...', 'info');
    const iv = setInterval(() => {
      setInstallProgress(prev => {
        if (prev >= 100) { clearInterval(iv); setInstallState('installed'); addToast('OpenClaw 安装完成！', 'success'); return 100; }
        return prev + Math.random() * 12 + 4;
      });
    }, 400);
  };

  const handleStart = () => {
    addToast('正在启动...', 'info');
    setTimeout(() => { setInstallState('running'); addToast('OpenClaw 已启动 · port 18789', 'success'); }, 2000);
  };

  const selectProvider = (id: string) => {
    const p = PROVIDERS.find(x => x.id === id);
    if (!p) return;
    setProvider(id);
    setApiUrl(p.url);
    setModelName(p.models[0]);
  };

  const maskKey = (key: string) => {
    if (key.length <= 6) return key ? '••••••' : '未配置';
    return key.slice(0, 3) + '•'.repeat(Math.min(key.length - 6, 20)) + key.slice(-3);
  };

  const enabledCount = Object.values(skillStates).filter(Boolean).length;

  // ─── Checking ───
  if (installState === 'checking') {
    return (
      <div className="oc">
        <div className="oc-center">
          <div className="oc-spinner" />
          <div className="oc-center-t">正在检测 OpenClaw...</div>
        </div>
      </div>
    );
  }

  // ─── Install (首次部署) ───
  if (installState === 'not-installed' || installState === 'installing') {
    return (
      <div className="oc oc-install-page">
        <div className="oc-install-hero">
          <Crayfish size={96} className="oc-crayfish-idle" />
          <div className="oc-install-text">
            <h1 className="oc-hero-title">OpenClaw</h1>
            <p className="oc-hero-sub">本地 AI Agent 网关 — 让聊天框成为你操控一切的入口</p>
          </div>
        </div>

        <div className="oc-install-card">
          <div className="oc-setup-head">
            <span className="oc-setup-badge">首次部署</span>
            <span className="oc-setup-desc">环境诊断 + 依赖安装 + 程序部署 + 初始化</span>
          </div>
          <div className="oc-setup-form">
            <div className="oc-setup-field">
              <label>供应商</label>
              <select value={setupProvider}
                onChange={e => {
                  setSetupProvider(e.target.value);
                  const p = PROVIDERS.find(x => x.id === e.target.value);
                  if (p) setSetupModel(p.models[0]);
                }}>
                {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="oc-setup-field">
              <label>模型</label>
              <select value={setupModel} onChange={e => setSetupModel(e.target.value)}>
                {(setupProvObj?.models || []).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="oc-setup-field wide">
              <label>API Key</label>
              <input type="password" placeholder="sk-..."
                value={setupKey} onChange={e => setSetupKey(e.target.value)} />
            </div>
          </div>

          {installState === 'installing' && (
            <div className="oc-prog">
              <div className="oc-prog-track"><div className="oc-prog-fill" style={{ width: `${Math.min(installProgress, 100)}%` }} /></div>
              <span className="oc-prog-num">{Math.min(Math.round(installProgress), 100)}%</span>
            </div>
          )}

          <button className="oc-big-btn full" onClick={handleInstall} disabled={installState === 'installing'}>
            {installState === 'installing' ? '安装中...' : '开始安装'}
          </button>
        </div>

        <p className="oc-install-note">首次部署仅需执行一次 · Node.js 22+ · RAM ≥ 4 GB</p>
      </div>
    );
  }

  // ─── Dashboard (installed / running) ───
  const isRunning = installState === 'running';

  return (
    <div className="oc oc-dash">
      {/* ── Slim status bar ── */}
      <div className={`oc-bar ${isRunning ? 'live' : ''}`}>
        <div className="oc-bar-left">
          <Crayfish size={26} />
          <span className="oc-bar-name">OpenClaw</span>
          <span className="oc-bar-ver">v2026.3.8</span>
          <span className={`oc-bar-badge ${isRunning ? 'on' : ''}`}>
            <span className="oc-live-dot" />
            {isRunning ? 'Running :18789' : 'Stopped'}
          </span>
        </div>
        <div className="oc-bar-right">
          {isRunning && (
            <span className="oc-bar-stat"><b>{enabledCount}</b> 技能 · <b>212ms</b></span>
          )}
          {!isRunning
            ? <button className="oc-bar-btn primary" onClick={handleStart}>启动</button>
            : <button className="oc-bar-btn" onClick={() => { setInstallState('installed'); addToast('网关已停止', 'info'); }}>停止</button>
          }
          {isRunning && (
            <button className="oc-bar-btn chat" onClick={() => setActiveTab('terminal')}>对话 →</button>
          )}
        </div>
      </div>

      {/* ── Config summary ── */}
      <div className="oc-config-bar">
        <div className="oc-cfg-item">
          <span className="oc-cfg-label">供应商</span>
          <span className="oc-cfg-val">{currentProvObj?.name || provider}</span>
        </div>
        <div className="oc-cfg-sep" />
        <div className="oc-cfg-item">
          <span className="oc-cfg-label">模型</span>
          <span className="oc-cfg-val mono">{modelName}</span>
        </div>
        <div className="oc-cfg-sep" />
        <div className="oc-cfg-item">
          <span className="oc-cfg-label">API Key</span>
          <span className="oc-cfg-val mono">{maskKey(apiKey)}</span>
        </div>
        <div className="oc-cfg-sep" />
        <div className="oc-cfg-item">
          <span className="oc-cfg-label">飞书</span>
          <span className={`oc-cfg-val ${feishuConfigured ? 'ok' : 'dim'}`}>
            {feishuConfigured ? '已配置' : '未配置'}
          </span>
        </div>
      </div>

      {/* ── Two-column body ── */}
      <div className="oc-grid">
        {/* Left: model config */}
        <section className="oc-col">
          <h2 className="oc-sec-title">模型配置</h2>
          <div className="oc-model-selects">
            <div className="oc-input-group">
              <label>供应商</label>
              <select value={provider} onChange={e => selectProvider(e.target.value)}>
                {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="oc-input-group">
              <label>模型</label>
              <select value={modelName} onChange={e => setModelName(e.target.value)}>
                {(currentProvObj?.models || []).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="oc-input-group">
            <label>API Key</label>
            <input type="password" placeholder="sk-..." value={apiKey} onChange={e => setApiKey(e.target.value)} />
          </div>
          <div className="oc-form-row">
            <button className="oc-save-btn" onClick={() => addToast('模型配置已保存', 'success')}>保存</button>
            <button className="oc-test-btn" onClick={() => addToast(`${currentProvObj?.name} 连通成功 · 212ms`, 'success')}>测试</button>
            <button className="oc-adv-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
              {showAdvanced ? '收起 ↑' : '高级 ↓'}
            </button>
          </div>
          {showAdvanced && (
            <div className="oc-adv-fields">
              <div className="oc-input-group">
                <label>Base URL</label>
                <input value={apiUrl} onChange={e => setApiUrl(e.target.value)} />
              </div>
            </div>
          )}

          {/* Channels below model config */}
          <h2 className="oc-sec-title" style={{ marginTop: 8 }}>渠道</h2>
          <div className="oc-ch-row">
            <div className="oc-ch-card active">
              <span className="oc-ch-icon">💬</span><span className="oc-ch-name">Web</span>
              <span className="oc-ch-dot on" />
            </div>
            <button className={`oc-ch-card ${feishuConfigured ? 'active' : ''}`}
              onClick={() => setExpandedChannel(expandedChannel === 'feishu' ? null : 'feishu')}>
              <span className="oc-ch-icon">🐦</span><span className="oc-ch-name">飞书</span>
              <span className={`oc-ch-dot ${feishuConfigured ? 'on' : ''}`} />
            </button>
            <button className={`oc-ch-card ${telegramConfigured ? 'active' : ''}`}
              onClick={() => setExpandedChannel(expandedChannel === 'telegram' ? null : 'telegram')}>
              <span className="oc-ch-icon">✈️</span><span className="oc-ch-name">TG</span>
              <span className={`oc-ch-dot ${telegramConfigured ? 'on' : ''}`} />
            </button>
          </div>
        </section>

        {/* Right: skills */}
        <section className="oc-col">
          <h2 className="oc-sec-title">
            技能 <span className="oc-sec-count">{enabledCount}/{SKILLS.length}</span>
            <span className="oc-clawhub-link">ClawHub 500+</span>
          </h2>
          <div className="oc-skill-list">
            {SKILLS.map(s => (
              <button key={s.id}
                className={`oc-skill-row ${skillStates[s.id] ? 'on' : ''}`}
                onClick={() => setSkillStates(prev => ({ ...prev, [s.id]: !prev[s.id] }))}>
                <span className="oc-skill-icon">{s.icon}</span>
                <span className="oc-skill-info">
                  <span className="oc-skill-name">{s.name}</span>
                  <span className="oc-skill-desc">{s.desc}</span>
                </span>
                {s.builtin && <span className="oc-skill-tag">内置</span>}
                <span className={`oc-skill-toggle ${skillStates[s.id] ? 'on' : ''}`} />
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* ── Channel expanded (full-width) ── */}
      {expandedChannel === 'feishu' && (
        <div className="oc-ch-expand">
          <h3 className="oc-ch-expand-title">飞书配置说明</h3>
          <div className="oc-steps">
            <div className="oc-step"><span className="oc-step-n">1</span>访问飞书开放平台 (open.feishu.cn) 并登录</div>
            <div className="oc-step"><span className="oc-step-n">2</span>创建「企业自建应用」</div>
            <div className="oc-step"><span className="oc-step-n">3</span>在「添加应用能力」中开启「机器人」</div>
            <div className="oc-step"><span className="oc-step-n">4</span><b>复制 App ID 和 App Secret</b></div>
            <div className="oc-step"><span className="oc-step-n">5</span>在「权限管理」→「批量导入」粘贴权限 JSON</div>
            <div className="oc-step"><span className="oc-step-n">6</span>「事件订阅」选择 WebSocket 长连接</div>
            <div className="oc-step"><span className="oc-step-n">7</span>添加事件 im.message.receive_v1</div>
            <div className="oc-step"><span className="oc-step-n">8</span>创建版本并发布</div>
            <div className="oc-step"><span className="oc-step-n">9</span>向机器人发消息获取配对码</div>
          </div>
          <div className="oc-ch-fields-grid">
            <div className="oc-input-group"><label>App ID</label><input placeholder="cli_a93a..." value={feishuAppId} onChange={e => setFeishuAppId(e.target.value)} /></div>
            <div className="oc-input-group"><label>App Secret</label><input type="password" placeholder="..." value={feishuAppSecret} onChange={e => setFeishuAppSecret(e.target.value)} /></div>
            <div className="oc-input-group"><label>机器人名称</label><input placeholder="OpenClaw" value={feishuBotName} onChange={e => setFeishuBotName(e.target.value)} /></div>
            <div className="oc-input-group"><label>配对码</label>
              <div className="oc-pair-row">
                <input placeholder="ABC123" value={feishuPairCode} onChange={e => setFeishuPairCode(e.target.value)} />
                <button className="oc-test-btn" onClick={() => { if (!feishuPairCode) { addToast('请输入配对码', 'info'); return; } addToast('授权成功', 'success'); }}>授权</button>
              </div>
            </div>
          </div>
          <button className="oc-save-btn wide" onClick={() => {
            if (!feishuAppId || !feishuAppSecret) { addToast('请填写 App ID 和 App Secret', 'info'); return; }
            setFeishuConfigured(true); addToast('飞书配置已保存', 'success'); setExpandedChannel(null);
          }}>保存飞书配置</button>
        </div>
      )}
      {expandedChannel === 'telegram' && (
        <div className="oc-ch-expand">
          <h3 className="oc-ch-expand-title">Telegram 配置</h3>
          <div className="oc-steps">
            <div className="oc-step"><span className="oc-step-n">1</span>在 Telegram 中找到 @BotFather</div>
            <div className="oc-step"><span className="oc-step-n">2</span>发送 /newbot 创建机器人</div>
            <div className="oc-step"><span className="oc-step-n">3</span>复制 Bot Token 填入下方</div>
          </div>
          <div className="oc-ch-fields-grid single">
            <div className="oc-input-group"><label>Bot Token</label><input placeholder="123456:ABC-DEF..." value={telegramToken} onChange={e => setTelegramToken(e.target.value)} /></div>
          </div>
          <button className="oc-save-btn wide" onClick={() => {
            if (!telegramToken) { addToast('请填写 Bot Token', 'info'); return; }
            setTelegramConfigured(true); addToast('Telegram 已保存', 'success'); setExpandedChannel(null);
          }}>保存 Telegram 配置</button>
        </div>
      )}

      {/* ── Toolbox row ── */}
      <div className="oc-tools-row">
        <button className="oc-tl" onClick={() => addToast('网关诊断: 正常 · 12ms', 'success')}>🔍 诊断</button>
        <button className="oc-tl" onClick={() => { addToast('重启中...', 'info'); setInstallState('installed'); setTimeout(() => { setInstallState('running'); addToast('已重启', 'success'); }, 2000); }}>🔄 重启</button>
        <button className="oc-tl" onClick={() => addToast('已是最新 v2026.3.8', 'success')}>⬆️ 更新</button>
        <button className="oc-tl" onClick={() => addToast('配置已导出', 'success')}>💾 导出</button>
        <button className="oc-tl" onClick={() => addToast('24h 无异常 · 1,247 调用', 'info')}>📋 日志</button>
        <button className="oc-tl" onClick={() => setActiveTab('terminal')}>💻 终端</button>
      </div>

      {/* ── Hint ── */}
      <div className="oc-hint">
        💡 试试在聊天框中输入
        <button className="oc-hint-cmd" onClick={() => setActiveTab('terminal')}>
          "帮我切换到 DeepSeek 模型"
        </button>
      </div>
    </div>
  );
}
