import { useState, useEffect } from 'react';
import { useAppState } from '../hooks/useAppState';

type InstallState = 'checking' | 'not-installed' | 'installing' | 'installed' | 'running';

const SKILLS = [
  { id: 'exec', name: '命令执行', icon: '⌘' },
  { id: 'web_search', name: '网页搜索', icon: '🔍' },
  { id: 'browser', name: '浏览器', icon: '🌐' },
  { id: 'device_control', name: '设备控制', icon: '🎛' },
  { id: 'ros_topic', name: 'ROS 话题', icon: '📡' },
  { id: 'model_inference', name: '模型推理', icon: '🧠' },
  { id: 'camera_stream', name: '摄像头', icon: '📷' },
  { id: 'cron', name: '定时任务', icon: '⏱' },
  { id: 'file_ops', name: '文件操作', icon: '📁' },
];

const DEFAULTS: Record<string, boolean> = {
  exec: true, web_search: true, browser: false, device_control: true,
  ros_topic: true, model_inference: true, camera_stream: false, cron: false, file_ops: true,
};

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'qwen', name: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-max' },
  { id: 'ollama', name: 'Ollama', url: 'http://localhost:11434/v1', model: 'llama3' },
];

export default function OpenClaw() {
  const { addToast, setActiveTab } = useAppState();

  const [installState, setInstallState] = useState<InstallState>('checking');
  const [installProgress, setInstallProgress] = useState(0);
  const [skillStates, setSkillStates] = useState<Record<string, boolean>>({ ...DEFAULTS });
  const [provider, setProvider] = useState('openai');
  const [apiUrl, setApiUrl] = useState(PROVIDERS[0].url);
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('gpt-4o');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setInstallState('not-installed'), 1800);
    return () => clearTimeout(t);
  }, []);

  const handleInstall = () => {
    setInstallState('installing');
    setInstallProgress(0);
    addToast('正在安装 OpenClaw...', 'info');
    const iv = setInterval(() => {
      setInstallProgress(p => {
        if (p >= 100) { clearInterval(iv); setInstallState('installed'); addToast('OpenClaw 安装完成！', 'success'); return 100; }
        return p + Math.random() * 15 + 5;
      });
    }, 400);
  };

  const handleStart = () => {
    addToast('正在启动...', 'info');
    setTimeout(() => { setInstallState('running'); addToast('OpenClaw 已启动 · port 18789', 'success'); }, 2000);
  };

  const selectProvider = (p: typeof PROVIDERS[0]) => {
    setProvider(p.id);
    setApiUrl(p.url);
    setModelName(p.model);
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

  // ─── Install ───
  if (installState === 'not-installed' || installState === 'installing') {
    return (
      <div className="oc">
        <div className="oc-hero-install">
          <svg width="64" height="64" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="14" fill="#ff6b00" />
            <path d="M14 20c0-5.5 4.5-10 10-10s10 4.5 10 10v2c0 1.1-.9 2-2 2H16c-1.1 0-2-.9-2-2v-2z" fill="#fff" opacity=".9"/>
            <circle cx="20" cy="19" r="2" fill="#ff6b00"/><circle cx="28" cy="19" r="2" fill="#ff6b00"/>
            <path d="M12 26h24v2c0 5.5-4.5 10-10 10h-4c-5.5 0-10-4.5-10-10v-2z" fill="#fff" opacity=".8"/>
          </svg>
          <h1 className="oc-hero-title">OpenClaw</h1>
          <p className="oc-hero-sub">
            本地 AI Agent 网关 — 让聊天框成为你操控一切的入口
          </p>

          <div className="oc-tags">
            {['多模型 LLM', '自然语言控制', '技能编排', '渠道集成', 'RDK 设备'].map(f => (
              <span key={f} className="oc-tag">{f}</span>
            ))}
          </div>

          {installState === 'installing' && (
            <div className="oc-prog">
              <div className="oc-prog-track"><div className="oc-prog-fill" style={{ width: `${Math.min(installProgress, 100)}%` }} /></div>
              <span className="oc-prog-num">{Math.min(Math.round(installProgress), 100)}%</span>
            </div>
          )}

          <button className="oc-big-btn" onClick={handleInstall} disabled={installState === 'installing'}>
            {installState === 'installing' ? '安装中...' : '安装 OpenClaw'}
          </button>

          <p className="oc-req">需要 Node.js 22+ · RAM ≥ 4GB</p>
        </div>
      </div>
    );
  }

  // ─── Installed / Running ───
  const isRunning = installState === 'running';

  return (
    <div className="oc">
      {/* ── Hero status ── */}
      <div className={`oc-hero ${isRunning ? 'live' : ''}`}>
        <div className="oc-hero-top">
          <svg className="oc-logo" width="40" height="40" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="14" fill="#ff6b00" />
            <path d="M14 20c0-5.5 4.5-10 10-10s10 4.5 10 10v2c0 1.1-.9 2-2 2H16c-1.1 0-2-.9-2-2v-2z" fill="#fff" opacity=".9"/>
            <circle cx="20" cy="19" r="2" fill="#ff6b00"/><circle cx="28" cy="19" r="2" fill="#ff6b00"/>
          </svg>
          <div>
            <h1 className="oc-hero-name">OpenClaw</h1>
            <p className="oc-hero-tagline">
              {isRunning ? '网关运行中 — 在下方聊天框中对话即可控制设备' : 'AI Agent 网关 · 就绪'}
            </p>
          </div>
        </div>

        <div className="oc-hero-mid">
          <span className={`oc-live ${isRunning ? 'on' : ''}`}>
            <span className="oc-live-dot" />
            {isRunning ? 'Running' : 'Stopped'}
          </span>
          {isRunning && (
            <div className="oc-stats">
              <span className="oc-stat"><b>1,247</b> 调用</span>
              <span className="oc-stat"><b>212ms</b> 延迟</span>
              <span className="oc-stat"><b>{enabledCount}</b> 技能</span>
            </div>
          )}
        </div>

        <div className="oc-hero-acts">
          {!isRunning
            ? <button className="oc-big-btn" onClick={handleStart}>启动网关</button>
            : <button className="oc-big-btn outline" onClick={() => { setInstallState('installed'); addToast('网关已停止', 'info'); }}>停止</button>
          }
          {isRunning && (
            <button className="oc-go-chat" onClick={() => setActiveTab('terminal')}>
              打开终端对话 →
            </button>
          )}
        </div>
      </div>

      {/* ── Model ── */}
      <section className="oc-section">
        <h2 className="oc-sec-title">模型</h2>
        <div className="oc-prov-row">
          {PROVIDERS.map(p => (
            <button key={p.id}
              className={`oc-prov-card ${provider === p.id ? 'active' : ''}`}
              onClick={() => selectProvider(p)}>
              <span className="oc-prov-name">{p.name}</span>
              <span className="oc-prov-model">{p.model}</span>
            </button>
          ))}
        </div>
        <div className="oc-model-form">
          <div className="oc-input-group">
            <label>API Key</label>
            <input type="password" placeholder="sk-..." value={apiKey} onChange={e => setApiKey(e.target.value)} />
          </div>
          <div className="oc-form-row">
            <button className="oc-save-btn" onClick={() => addToast('配置已保存', 'success')}>保存</button>
            <button className="oc-test-btn" onClick={() => addToast('连通成功 · 212ms', 'success')}>测试连接</button>
            <button className="oc-adv-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
              {showAdvanced ? '收起' : '高级 ↓'}
            </button>
          </div>
        </div>
        {showAdvanced && (
          <div className="oc-adv-fields">
            <div className="oc-input-group">
              <label>API 地址</label>
              <input value={apiUrl} onChange={e => setApiUrl(e.target.value)} />
            </div>
            <div className="oc-input-group">
              <label>模型 ID</label>
              <input value={modelName} onChange={e => setModelName(e.target.value)} />
            </div>
          </div>
        )}
      </section>

      {/* ── Skills ── */}
      <section className="oc-section">
        <h2 className="oc-sec-title">技能 <span className="oc-sec-count">{enabledCount}/{SKILLS.length}</span></h2>
        <div className="oc-skill-grid">
          {SKILLS.map(s => (
            <button key={s.id}
              className={`oc-skill-chip ${skillStates[s.id] ? 'on' : ''}`}
              onClick={() => setSkillStates(prev => ({ ...prev, [s.id]: !prev[s.id] }))}>
              <span className="oc-skill-icon">{s.icon}</span>
              <span className="oc-skill-label">{s.name}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Channels ── */}
      <section className="oc-section">
        <h2 className="oc-sec-title">渠道</h2>
        <div className="oc-ch-row">
          <div className="oc-ch-card active">
            <span className="oc-ch-icon">💬</span>
            <span className="oc-ch-name">Web 面板</span>
            <span className="oc-ch-dot on" />
          </div>
          <button className="oc-ch-card" onClick={() => setShowAdvanced(false) || setShowAdvanced(true)}>
            <span className="oc-ch-icon">🐦</span>
            <span className="oc-ch-name">飞书</span>
            <span className="oc-ch-dot" />
          </button>
          <button className="oc-ch-card" onClick={() => addToast('Telegram 配置: 在聊天框中输入 "配置 Telegram"', 'info')}>
            <span className="oc-ch-icon">✈️</span>
            <span className="oc-ch-name">Telegram</span>
            <span className="oc-ch-dot" />
          </button>
        </div>
      </section>

      {/* ── Hint ── */}
      <div className="oc-hint">
        💡 所有配置都可以在聊天框中通过自然语言完成 — 试试输入
        <button className="oc-hint-cmd" onClick={() => { setActiveTab('terminal'); addToast('试试在聊天框中配置', 'info'); }}>
          "帮我切换到 DeepSeek 模型"
        </button>
      </div>
    </div>
  );
}
