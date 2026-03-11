import { useState, useEffect } from 'react';
import { useAppState } from '../hooks/useAppState';

type InstallState = 'checking' | 'not-installed' | 'installing' | 'installed' | 'running';
type ModelConfig = { id: string; provider: string; providerName: string; model: string; key: string; url: string };

/* ── Builtin skills (always installed) ── */
const BUILTIN_SKILLS = [
  { id: 'device_control', name: '设备控制', icon: '🎛', desc: 'RDK 硬件指令' },
  { id: 'ros_topic', name: 'ROS 话题', icon: '📡', desc: 'ROS pub/sub' },
  { id: 'camera_stream', name: '摄像头', icon: '📷', desc: '视频流控制' },
  { id: 'model_inference', name: '模型推理', icon: '🧠', desc: '端侧推理' },
];

/* ── Pre-installed community skills ── */
const DEFAULT_COMMUNITY = [
  { id: 'exec', name: '命令执行', icon: '⌘', desc: 'Shell 命令' },
  { id: 'web_search', name: '网页搜索', icon: '🔍', desc: 'Exa / SerpAPI' },
  { id: 'file_ops', name: '文件管理', icon: '📁', desc: 'Fast.io 存储' },
];

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

/* ── Supported channels ── */
const CHANNELS = [
  { id: 'web', name: 'Web', icon: '💬' },
  { id: 'feishu', name: '飞书', icon: '🐦' },
  { id: 'telegram', name: 'Telegram', icon: '✈️' },
  { id: 'wechat', name: '微信', icon: '💚' },
  { id: 'slack', name: 'Slack', icon: '💜' },
  { id: 'discord', name: 'Discord', icon: '🎮' },
  { id: 'whatsapp', name: 'WhatsApp', icon: '📱' },
  { id: 'teams', name: 'Teams', icon: '🟦' },
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

let _modelId = 0;
const nextId = () => `m${++_modelId}`;

export default function OpenClaw() {
  const { addToast, setActiveTab } = useAppState();

  /* ── install ── */
  const [installState, setInstallState] = useState<InstallState>('checking');
  const [installProgress, setInstallProgress] = useState(0);

  /* ── models (multi-model library) ── */
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [addingModel, setAddingModel] = useState(false);
  const [newProv, setNewProv] = useState('qwen');
  const [newModel, setNewModel] = useState('qwen3.5-plus');
  const [newKey, setNewKey] = useState('');

  /* ── skills (installed = active, no toggle) ── */
  const [communitySkills, setCommunitySkills] = useState([...DEFAULT_COMMUNITY]);
  const [skillInput, setSkillInput] = useState('');

  /* ── channels ── */
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');
  const [feishuBotName, setFeishuBotName] = useState('OpenClaw');
  const [feishuPairCode, setFeishuPairCode] = useState('');
  const [feishuConfigured, setFeishuConfigured] = useState(false);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);

  /* ── install setup form ── */
  const [setupProvider, setSetupProvider] = useState('qwen');
  const [setupModel, setSetupModel] = useState('qwen3.5-plus');
  const [setupKey, setSetupKey] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setInstallState('not-installed'), 1800);
    return () => clearTimeout(t);
  }, []);

  const setupProvObj = PROVIDERS.find(p => p.id === setupProvider);
  const newProvObj = PROVIDERS.find(p => p.id === newProv);
  const activeModel = models.find(m => m.id === activeModelId);
  const allSkills = [...BUILTIN_SKILLS, ...communitySkills];

  const maskKey = (key: string) => {
    if (key.length <= 6) return key ? '••••••' : '';
    return key.slice(0, 3) + '•'.repeat(Math.min(key.length - 6, 20)) + key.slice(-3);
  };

  /* ── Install handler ── */
  const handleInstall = () => {
    if (!setupKey.trim()) { addToast('请填写 API Key', 'info'); return; }
    setInstallState('installing'); setInstallProgress(0);
    const p = PROVIDERS.find(x => x.id === setupProvider) || PROVIDERS[2];
    const id = nextId();
    const mc: ModelConfig = { id, provider: p.id, providerName: p.name, model: setupModel || p.models[0], key: setupKey, url: p.url };
    setModels([mc]); setActiveModelId(id);
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

  /* ── Add model to library ── */
  const handleAddModel = () => {
    if (!newKey.trim()) { addToast('请填写 API Key', 'info'); return; }
    const p = newProvObj || PROVIDERS[2];
    const id = nextId();
    const mc: ModelConfig = { id, provider: p.id, providerName: p.name, model: newModel || p.models[0], key: newKey, url: p.url };
    setModels(prev => [...prev, mc]);
    if (!activeModelId) setActiveModelId(id);
    setNewKey(''); setAddingModel(false);
    addToast(`已添加 ${p.name} / ${mc.model}`, 'success');
  };

  const handleRemoveModel = (id: string) => {
    setModels(prev => prev.filter(m => m.id !== id));
    if (activeModelId === id) {
      setActiveModelId(prev => { const rest = models.filter(m => m.id !== id); return rest.length ? rest[0].id : null; });
    }
  };

  /* ── Skills: install = add to list ── */
  const handleAddSkill = () => {
    const name = skillInput.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (allSkills.some(s => s.id === id)) { addToast(`技能 "${name}" 已存在`, 'info'); return; }
    setCommunitySkills(prev => [...prev, { id, name, icon: '🧩', desc: `clawhub install ${name}` }]);
    setSkillInput(''); addToast(`已安装 ${name}`, 'success');
  };

  const handleRemoveSkill = (id: string) => {
    setCommunitySkills(prev => prev.filter(s => s.id !== id));
    addToast('已卸载', 'info');
  };

  /* ─── Checking ─── */
  if (installState === 'checking') {
    return (
      <div className="center-stage">
        <div className="oc-center">
          <div className="oc-spinner" />
          <div className="oc-center-t">正在检测 OpenClaw...</div>
        </div>
      </div>
    );
  }

  /* ─── Install (首次部署) ─── */
  if (installState === 'not-installed' || installState === 'installing') {
    return (
      <div className="center-stage">
        <div className="oc-install-hero">
          <Crayfish size={100} className="oc-crayfish-idle" />
          <div>
            <h1 className="oc-hero-title">OpenClaw</h1>
            <p className="oc-hero-sub">本地 AI Agent 网关 — 让聊天框成为你操控一切的入口</p>
          </div>
        </div>

        <div className="isolated-widget" style={{ maxWidth: 580 }}>
          <div className="oc-setup-head">
            <span className="oc-setup-badge">首次部署</span>
            <span className="oc-setup-desc">环境诊断 + 依赖安装 + 程序部署 + 初始化</span>
          </div>
          <div className="oc-setup-form">
            <div className="oc-setup-field">
              <label>供应商</label>
              <select value={setupProvider} onChange={e => {
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
              <input type="password" placeholder="sk-..." value={setupKey} onChange={e => setSetupKey(e.target.value)} />
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

  /* ─── Dashboard (installed / running) ─── */
  const isRunning = installState === 'running';

  return (
    <div className="center-stage wide-stage">
      {/* ── Status header ── */}
      <div className={`oc-bar ${isRunning ? 'live' : ''}`}>
        <div className="oc-bar-left">
          <Crayfish size={30} />
          <span className="oc-bar-name">OpenClaw</span>
          <span className="oc-bar-ver">v2026.3.8</span>
          <span className={`oc-bar-badge ${isRunning ? 'on' : ''}`}>
            <span className="oc-live-dot" />
            {isRunning ? 'Running :18789' : 'Stopped'}
          </span>
        </div>
        <div className="oc-bar-right">
          {isRunning && <span className="oc-bar-stat"><b>{allSkills.length}</b> 技能 · <b>212ms</b></span>}
          {!isRunning
            ? <button className="oc-bar-btn primary" onClick={handleStart}>启动</button>
            : <button className="oc-bar-btn" onClick={() => { setInstallState('installed'); addToast('网关已停止', 'info'); }}>停止</button>
          }
          {isRunning && <button className="oc-bar-btn chat" onClick={() => setActiveTab('terminal')}>对话 →</button>}
        </div>
      </div>

      {/* ── Main content widget ── */}
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">Gateway 配置</div>

        {/* Config summary strip */}
        <div className="oc-config-bar">
          <div className="oc-cfg-item"><span className="oc-cfg-label">当前模型</span><span className="oc-cfg-val mono">{activeModel ? `${activeModel.providerName} / ${activeModel.model}` : '未配置'}</span></div>
          <div className="oc-cfg-sep" />
          <div className="oc-cfg-item"><span className="oc-cfg-label">已配置</span><span className="oc-cfg-val">{models.length} 个模型</span></div>
          <div className="oc-cfg-sep" />
          <div className="oc-cfg-item"><span className="oc-cfg-label">技能</span><span className="oc-cfg-val">{allSkills.length} 已安装</span></div>
          <div className="oc-cfg-sep" />
          <div className="oc-cfg-item"><span className="oc-cfg-label">飞书</span><span className={`oc-cfg-val ${feishuConfigured ? 'ok' : 'dim'}`}>{feishuConfigured ? '已配置' : '未配置'}</span></div>
        </div>

        {/* Two-column: Models + Skills */}
        <div className="workspace-grid two-column" style={{ marginTop: 20 }}>
          {/* ── Model library panel ── */}
          <div className="panel-card">
            <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              模型配置 <span className="oc-sec-count">{models.length} 个</span>
            </div>

            {/* Model list */}
            <div className="oc-model-list">
              {models.map(m => (
                <div key={m.id} className={`oc-model-row ${m.id === activeModelId ? 'active' : ''}`}>
                  <button className="oc-model-info" onClick={() => { setActiveModelId(m.id); addToast(`已切换到 ${m.providerName} / ${m.model}`, 'success'); }}>
                    <span className="oc-model-prov">{m.providerName}</span>
                    <span className="oc-model-name">{m.model}</span>
                    <span className="oc-model-key">{maskKey(m.key)}</span>
                  </button>
                  <div className="oc-model-actions">
                    {m.id === activeModelId && <span className="oc-model-active-tag">应用中</span>}
                    <button className="oc-model-test" onClick={() => addToast(`${m.providerName} 连通成功 · 212ms`, 'success')}>测试</button>
                    {models.length > 1 && (
                      <button className="oc-model-rm" onClick={() => handleRemoveModel(m.id)}>✕</button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add model form */}
            {addingModel ? (
              <div className="oc-add-model-form">
                <div className="oc-model-selects">
                  <div className="oc-input-group">
                    <label>供应商</label>
                    <select value={newProv} onChange={e => { setNewProv(e.target.value); const p = PROVIDERS.find(x => x.id === e.target.value); if (p) setNewModel(p.models[0]); }}>
                      {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="oc-input-group">
                    <label>模型</label>
                    <select value={newModel} onChange={e => setNewModel(e.target.value)}>
                      {(newProvObj?.models || []).map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <div className="oc-input-group">
                  <label>API Key</label>
                  <input type="password" placeholder="sk-..." value={newKey} onChange={e => setNewKey(e.target.value)} />
                </div>
                <div className="oc-form-row">
                  <button className="oc-save-btn" onClick={handleAddModel}>添加</button>
                  <button className="oc-test-btn" onClick={() => setAddingModel(false)}>取消</button>
                </div>
              </div>
            ) : (
              <button className="oc-add-model-btn" onClick={() => setAddingModel(true)}>+ 添加模型</button>
            )}
          </div>

          {/* ── Skills panel ── */}
          <div className="panel-card">
            <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              技能 <span className="oc-sec-count">{allSkills.length} 已安装</span>
              <span className="oc-clawhub-link">ClawHub 500+</span>
            </div>
            <div className="oc-skill-add">
              <input className="oc-skill-add-input" placeholder="输入技能名安装 (如 elevenlabs-agents)"
                value={skillInput} onChange={e => setSkillInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddSkill()} />
              <button className="oc-skill-add-btn" onClick={handleAddSkill}>安装</button>
            </div>
            <div className="oc-skill-list">
              {allSkills.map(s => {
                const isBuiltin = BUILTIN_SKILLS.some(b => b.id === s.id);
                return (
                  <div key={s.id} className="oc-skill-row on">
                    <span className="oc-skill-icon">{s.icon}</span>
                    <span className="oc-skill-info">
                      <span className="oc-skill-name">{s.name}</span>
                      <span className="oc-skill-desc">{s.desc}</span>
                    </span>
                    {isBuiltin
                      ? <span className="oc-skill-tag">内置</span>
                      : <button className="oc-skill-rm" onClick={() => handleRemoveSkill(s.id)}>卸载</button>
                    }
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Two-column: Channels + Tools */}
        <div className="workspace-grid two-column lower-grid">
          {/* ── Channels panel ── */}
          <div className="panel-card">
            <div className="panel-title">渠道</div>
            <div className="oc-ch-grid">
              {CHANNELS.map(ch => {
                const isActive = ch.id === 'web' || (ch.id === 'feishu' && feishuConfigured) || (ch.id === 'telegram' && telegramConfigured);
                const configurable = ch.id === 'feishu' || ch.id === 'telegram';
                return (
                  <button key={ch.id}
                    className={`oc-ch-card ${isActive ? 'active' : ''} ${configurable ? 'clickable' : ''}`}
                    onClick={() => configurable ? setExpandedChannel(expandedChannel === ch.id ? null : ch.id) : undefined}>
                    <span className="oc-ch-icon">{ch.icon}</span>
                    <span className="oc-ch-name">{ch.name}</span>
                    {isActive && <span className="oc-ch-dot on" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Toolbox panel ── */}
          <div className="panel-card">
            <div className="panel-title">工具箱</div>
            <div className="oc-tools-grid">
              <button className="oc-tl" onClick={() => addToast('网关诊断: 正常 · 12ms', 'success')}>🔍 诊断</button>
              <button className="oc-tl" onClick={() => { addToast('重启中...', 'info'); setInstallState('installed'); setTimeout(() => { setInstallState('running'); addToast('已重启', 'success'); }, 2000); }}>🔄 重启</button>
              <button className="oc-tl" onClick={() => addToast('已是最新 v2026.3.8', 'success')}>⬆️ 更新</button>
              <button className="oc-tl" onClick={() => addToast('配置已导出', 'success')}>💾 导出</button>
              <button className="oc-tl" onClick={() => addToast('24h 无异常 · 1,247 调用', 'info')}>📋 日志</button>
              <button className="oc-tl" onClick={() => setActiveTab('terminal')}>💻 终端</button>
            </div>
          </div>
        </div>

        {/* Hint */}
        <div className="oc-hint">
          💡 试试在聊天框中输入
          <button className="oc-hint-cmd" onClick={() => setActiveTab('terminal')}>"帮我切换到 DeepSeek 模型"</button>
        </div>
      </div>

      {/* ── Channel modal overlay ── */}
      {expandedChannel && <div className="oc-modal-mask" onClick={() => setExpandedChannel(null)} />}
      {expandedChannel === 'feishu' && (
        <div className="oc-modal">
          <div className="oc-modal-head">
            <h3 className="oc-modal-title">飞书配置说明</h3>
            <button className="oc-modal-close" onClick={() => setExpandedChannel(null)}>✕</button>
          </div>
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
        <div className="oc-modal">
          <div className="oc-modal-head">
            <h3 className="oc-modal-title">Telegram 配置</h3>
            <button className="oc-modal-close" onClick={() => setExpandedChannel(null)}>✕</button>
          </div>
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
    </div>
  );
}
