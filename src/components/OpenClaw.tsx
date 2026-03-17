import { useState, useEffect } from 'react';
import { useAppState } from '../hooks/useAppState';
import { executeDeviceCommand, runOpenClawAgentAction, getRememberedDevicePassword } from '../api';

/* ── OpenClaw 大模型网关（真实接入版）── */

interface ModelConfig {
  id: string;
  provider: string;
  name: string;
  key: string;
  baseUrl: string;
  active: boolean;
}

interface Skill {
  id: string;
  icon: string;
  name: string;
  desc: string;
  enabled: boolean;
  builtin?: boolean;
}

interface Channel {
  id: string;
  icon: string;
  name: string;
  active: boolean;
  config: Record<string, string>;
}

const DEFAULT_MODELS: ModelConfig[] = [
  { id: 'qwen', provider: 'Dashscope', name: 'qwen3.5-plus', key: '', baseUrl: 'https://coding.dashscope.aliyuncs.com/v1', active: true },
  { id: 'gpt4', provider: 'OpenAI', name: 'gpt-4o', key: '', baseUrl: 'https://api.openai.com/v1', active: false },
];

const DEFAULT_SKILLS: Skill[] = [
  { id: 'vision', icon: '👁️', name: '视觉感知', desc: '摄像头画面分析与目标检测', enabled: true, builtin: true },
  { id: 'motion', icon: '🦾', name: '运动控制', desc: '电机驱动与路径规划', enabled: true, builtin: true },
  { id: 'speech', icon: '🎙️', name: '语音交互', desc: '语音识别与 TTS 合成', enabled: false, builtin: true },
  { id: 'nav', icon: '🗺️', name: '自主导航', desc: 'SLAM 建图与路径规划', enabled: false, builtin: true },
  { id: 'grasp', icon: '🤏', name: '抓取操作', desc: '机械臂抓取与放置', enabled: false, builtin: true },
];

const DEFAULT_CHANNELS: Channel[] = [
  { id: 'terminal', icon: '💻', name: '终端对话', active: true, config: {} },
  { id: 'feishu', icon: '🐦', name: '飞书机器人', active: false, config: { webhook: '', secret: '' } },
  { id: 'wechat', icon: '💬', name: '微信接入', active: false, config: { appId: '', appSecret: '' } },
  { id: 'api', icon: '🔌', name: 'REST API', active: false, config: { port: '8080' } },
];

export default function OpenClaw() {
  const { currentDevice, addToast, setActiveTab, setCmd } = useAppState();

  const [models, setModels] = useState<ModelConfig[]>(DEFAULT_MODELS);
  const [skills, setSkills] = useState<Skill[]>(DEFAULT_SKILLS);
  const [channels, setChannels] = useState<Channel[]>(DEFAULT_CHANNELS);
  const [serviceRunning, setServiceRunning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editChannel, setEditChannel] = useState<Channel | null>(null);
  const [newSkillName, setNewSkillName] = useState('');
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [newModel, setNewModel] = useState({ provider: 'OpenAI', name: '', key: '', baseUrl: '' });

  const activeModel = models.find(m => m.active);
  const enabledSkills = skills.filter(s => s.enabled).length;
  const activeChannels = channels.filter(c => c.active).length;

  // 组件挂载时自动检查状态
  useEffect(() => {
    if (currentDevice) {
      handleCheckStatus();
    }
  }, [currentDevice?.id]);

  // 真实检查 OpenClaw 服务状态
  const handleCheckStatus = async () => {
    if (!currentDevice) { addToast('请先连接设备', 'warning'); return; }
    setChecking(true);
    try {
      const result = await runOpenClawAgentAction('status', {
        host: currentDevice.ip,
        username: 'root',
      });
      const output = (result as { output?: string }).output ?? '';
      setStatusLog(prev => [...prev.slice(-50), `[状态检查] ${new Date().toLocaleTimeString()}`, output, '']);
      // 判断是否运行中
      const running = /active|running|openclaw.*start|clawctl.*start|port.*18789/i.test(output);
      setServiceRunning(running);
      addToast(running ? 'OpenClaw 服务运行中' : 'OpenClaw 服务未启动', running ? 'success' : 'info');
    } catch {
      addToast('状态检查失败，请确认设备连接', 'error');
    } finally {
      setChecking(false);
    }
  };

  // 真实安装 OpenClaw
  const handleInstall = async () => {
    if (!currentDevice) { addToast('请先连接设备', 'warning'); return; }
    setInstalling(true);
    addToast('正在安装 OpenClaw，请稍候...', 'info');
    try {
      const result = await runOpenClawAgentAction('install', {
        host: currentDevice.ip,
        username: 'root',
      });
      const output = (result as { output?: string }).output ?? '';
      setStatusLog(prev => [...prev.slice(-50), `[安装] ${new Date().toLocaleTimeString()}`, output, '']);
      setShowLog(true);
      addToast('OpenClaw 安装完成', 'success');
    } catch {
      addToast('安装失败，请检查网络连接', 'error');
    } finally {
      setInstalling(false);
    }
  };

  // 真实启动/停止服务
  const toggleService = async () => {
    if (!currentDevice) { addToast('请先连接设备', 'warning'); return; }
    if (serviceRunning) {
      // 停止服务
      setChecking(true);
      try {
        const pwd = getRememberedDevicePassword(currentDevice.id);
        const result = await executeDeviceCommand(
          currentDevice.id,
          'bash -lc "(openclaw stop || clawctl stop || pkill -f openclaw || true)"',
          pwd,
        );
        setStatusLog(prev => [...prev.slice(-50), `[停止] ${new Date().toLocaleTimeString()}`, result.output, '']);
        setServiceRunning(false);
        addToast('OpenClaw 服务已停止', 'info');
      } catch {
        addToast('停止失败', 'error');
      } finally {
        setChecking(false);
      }
    } else {
      // 启动服务
      setChecking(true);
      try {
        const result = await runOpenClawAgentAction('start', {
          host: currentDevice.ip,
          username: 'root',
        });
        const output = (result as { output?: string }).output ?? '';
        setStatusLog(prev => [...prev.slice(-50), `[启动] ${new Date().toLocaleTimeString()}`, output, '']);
        setShowLog(true);
        const running = /active|running|start|port.*18789/i.test(output);
        setServiceRunning(running);
        addToast(running ? 'OpenClaw 服务已启动' : '启动命令已发送，请检查日志', running ? 'success' : 'warning');
      } catch {
        addToast('启动失败，请先安装 OpenClaw', 'error');
      } finally {
        setChecking(false);
      }
    }
  };

  // 真实切换模型（同步到设备）
  const switchModel = async (id: string) => {
    const target = models.find(m => m.id === id);
    if (!target) return;
    setModels(prev => prev.map(m => ({ ...m, active: m.id === id })));
    if (currentDevice && serviceRunning) {
      try {
        await runOpenClawAgentAction('switch', {
          modelName: target.name,
          host: currentDevice.ip,
          username: 'root',
        });
        addToast(`已切换到 ${target.name}`, 'success');
      } catch {
        addToast(`已在本地切换到 ${target.name}（设备同步失败）`, 'warning');
      }
    } else {
      addToast(`已切换到 ${target.name}`, 'success');
    }
  };

  // 卸载 OpenClaw
  const handleUninstall = async () => {
    if (!currentDevice) { addToast('请先连接设备', 'warning'); return; }
    if (!confirm('确定要卸载 OpenClaw 吗？')) return;
    setUninstalling(true);
    addToast('正在卸载 OpenClaw...', 'info');
    try {
      const pwd = getRememberedDevicePassword(currentDevice.id);
      // 先停止服务再卸载
      await executeDeviceCommand(currentDevice.id, 'bash -lc "(openclaw stop || clawctl stop || pkill -f openclaw || true) 2>&1"', pwd);
      const result = await executeDeviceCommand(
        currentDevice.id,
        'bash -lc "(pip3 uninstall -y openclaw 2>&1 || apt remove -y openclaw 2>&1 || rm -rf /opt/openclaw 2>&1) && echo UNINSTALL_OK"',
        pwd,
      );
      setStatusLog(prev => [...prev.slice(-50), `[卸载] ${new Date().toLocaleTimeString()}`, result.output, '']);
      setShowLog(true);
      setServiceRunning(false);
      addToast('OpenClaw 已卸载', 'success');
    } catch {
      addToast('卸载失败', 'error');
    } finally {
      setUninstalling(false);
    }
  };

  // 查看设备日志
  const handleViewLogs = async () => {
    if (!currentDevice) { addToast('请先连接设备', 'warning'); return; }
    setChecking(true);
    try {
      const result = await runOpenClawAgentAction('logs', {
        host: currentDevice.ip,
        username: 'root',
      });
      const output = (result as { output?: string }).output ?? '';
      setStatusLog(prev => [...prev.slice(-50), `[日志] ${new Date().toLocaleTimeString()}`, output, '']);
      setShowLog(true);
    } catch {
      addToast('获取日志失败', 'error');
    } finally {
      setChecking(false);
    }
  };

  const handleAddModel = () => {
    if (!newModel.name || !newModel.key) { addToast('请填写模型名称和 API Key', 'warning'); return; }
    const id = `custom-${Date.now()}`;
    setModels(prev => [...prev, { id, ...newModel, active: false }]);
    setNewModel({ provider: 'OpenAI', name: '', key: '', baseUrl: '' });
    setShowAddModel(false);
    addToast(`模型 ${newModel.name} 已添加`, 'success');
  };

  const removeModel = (id: string) => {
    setModels(prev => prev.filter(m => m.id !== id));
    addToast('模型已移除', 'info');
  };

  const toggleSkill = (id: string) => setSkills(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));

  const addCustomSkill = () => {
    if (!newSkillName.trim()) return;
    setSkills(prev => [...prev, { id: `skill-${Date.now()}`, icon: '🔧', name: newSkillName.trim(), desc: '自定义技能', enabled: true }]);
    setNewSkillName('');
    addToast('技能已添加', 'success');
  };

  const removeSkill = (id: string) => setSkills(prev => prev.filter(s => s.id !== id));
  const toggleChannel = (id: string) => setChannels(prev => prev.map(c => c.id === id ? { ...c, active: !c.active } : c));

  // 未连接设备时的空状态
  if (!currentDevice) {
    return (
      <div className="center-stage">
        <div className="oc-install-hero">
          <span style={{ fontSize: '4rem' }} className="oc-crayfish-idle">🦞</span>
          <div>
            <h1 className="oc-hero-title">OpenClaw</h1>
            <p className="oc-hero-sub">大模型网关与 AI Agent 编排平台<br/>连接设备后即可开始配置</p>
          </div>
        </div>
        <div className="isolated-widget" style={{ marginTop: 24 }}>
          <div className="widget-header">快速开始</div>
          <p className="desc-text">OpenClaw 是地瓜机器人的 AI 网关，支持接入 OpenAI / Qwen 等大模型，通过技能编排实现机器人智能控制。</p>
          <div className="oc-steps">
            <div className="oc-step"><span className="oc-step-n">1</span>在左侧添加并连接 RDK 开发板</div>
            <div className="oc-step"><span className="oc-step-n">2</span>配置大模型 API Key（支持 <b>Qwen / GPT</b>）</div>
            <div className="oc-step"><span className="oc-step-n">3</span>选择技能组合，启动 OpenClaw 服务</div>
            <div className="oc-step"><span className="oc-step-n">4</span>通过终端、飞书或 API 与机器人对话</div>
          </div>
          <div style={{ marginTop: 16 }}>
            <a href="https://openclaws.io/zh" target="_blank" rel="noopener noreferrer" className="oc-ext-link">
              🔗 访问 OpenClaw 官网
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="center-stage wide-stage">
      {/* 状态栏 */}
      <div className={`oc-bar ${serviceRunning ? 'live' : ''}`}>
        <div className="oc-bar-left">
          <span style={{ fontSize: '1.4rem' }}>🦞</span>
          <span className="oc-bar-name">OpenClaw</span>
          <span className="oc-bar-ver">v2.1</span>
          <span className={`oc-bar-badge ${serviceRunning ? 'on' : ''}`}>
            <span className="oc-live-dot" />
            {serviceRunning ? '运行中' : '未启动'}
          </span>
          <a href="https://openclaws.io/zh" target="_blank" rel="noopener noreferrer" className="oc-ext-link" style={{ marginLeft: 8, fontSize: '0.75rem' }}>
            官网 ↗
          </a>
        </div>
        <div className="oc-bar-right">
          <span className="oc-bar-stat"><b>{enabledSkills}</b> 技能</span>
          <span className="oc-bar-stat"><b>{activeChannels}</b> 渠道</span>
          <button className="oc-bar-btn" onClick={handleInstall} disabled={installing}>
            {installing ? '安装中...' : '安装/更新'}
          </button>
          <button className="oc-bar-btn" onClick={handleCheckStatus} disabled={checking}>
            {checking ? '检测中...' : '刷新状态'}
          </button>
          <button className={`oc-bar-btn ${serviceRunning ? '' : 'primary'}`} onClick={toggleService} disabled={checking}>
            {serviceRunning ? '停止服务' : '启动服务'}
          </button>
          <button className="oc-bar-btn" style={{ color: '#ef4444', borderColor: '#fca5a5' }}
            onClick={handleUninstall} disabled={uninstalling}>
            {uninstalling ? '卸载中...' : '卸载'}
          </button>
        </div>
      </div>

      {/* 配置概览 */}
      <div className="isolated-widget" style={{ marginTop: 16 }}>
        <div className="oc-config-bar">
          <div className="oc-cfg-item">
            <span className="oc-cfg-label">当前模型</span>
            <span className="oc-cfg-val mono">{activeModel?.name || '未配置'}</span>
          </div>
          <span className="oc-cfg-sep" />
          <div className="oc-cfg-item">
            <span className="oc-cfg-label">API 端点</span>
            <span className="oc-cfg-val mono">{activeModel?.baseUrl || '--'}</span>
          </div>
          <span className="oc-cfg-sep" />
          <div className="oc-cfg-item">
            <span className="oc-cfg-label">设备</span>
            <span className="oc-cfg-val ok">{currentDevice.ip}</span>
          </div>
          <span className="oc-cfg-sep" />
          <div className="oc-cfg-item">
            <span className="oc-cfg-label">服务状态</span>
            <span className={`oc-cfg-val ${serviceRunning ? 'ok' : 'dim'}`}>
              {serviceRunning ? 'Active' : 'Stopped'}
            </span>
          </div>
        </div>
      </div>

      {/* 三栏布局 */}
      <div className="workspace-grid three-column" style={{ marginTop: 16 }}>
        {/* 模型配置 */}
        <div className="panel-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span className="panel-title" style={{ margin: 0 }}>🤖 模型配置</span>
            <span className="oc-sec-count">{models.length} 个</span>
          </div>
          <div className="oc-model-list">
            {models.map(m => (
              <div key={m.id} className={`oc-model-row ${m.active ? 'active' : ''}`}>
                <button className="oc-model-info" onClick={() => switchModel(m.id)}>
                  <span className="oc-model-prov">{m.provider}</span>
                  <span className="oc-model-name">{m.name}</span>
                  <span className="oc-model-key">{m.key ? '••••' + m.key.slice(-4) : '未配置 Key'}</span>
                </button>
                <div className="oc-model-actions">
                  {m.active && <span className="oc-model-active-tag">当前</span>}
                  <button className="oc-model-rm" onClick={() => removeModel(m.id)}>✕</button>
                </div>
              </div>
            ))}
          </div>
          {showAddModel ? (
            <div className="oc-add-model-form">
              <div className="oc-input-group">
                <label>提供商</label>
                <select value={newModel.provider} onChange={e => setNewModel(p => ({ ...p, provider: e.target.value }))}>
                  <option>OpenAI</option>
                  <option>Dashscope</option>
                  <option>Anthropic</option>
                  <option>自定义</option>
                </select>
              </div>
              <div className="oc-input-group">
                <label>模型名称</label>
                <input placeholder="gpt-4o / qwen-plus" value={newModel.name}
                  onChange={e => setNewModel(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="oc-input-group">
                <label>A‌PI Key</label>
                <input type="password" placeholder="sk-..." value={newModel.key}
                  onChange={e => setNewModel(p => ({ ...p, key: e.target.value }))} />
              </div>
              {showAdvanced && (
                <div className="oc-input-group">
                  <label>Base URL</label>
                  <input placeholder="https://api.openai.com/v1" value={newModel.baseUrl}
                    onChange={e => setNewModel(p => ({ ...p, baseUrl: e.target.value }))} />
                </div>
              )}
              <button className="oc-adv-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
                {showAdvanced ? '收起高级选项 ▲' : '高级选项 ▼'}
              </button>
              <div className="oc-form-row">
                <button className="oc-save-btn" onClick={handleAddModel}>添加模型</button>
                <button className="oc-test-btn" onClick={() => setShowAddModel(false)}>取消</button>
              </div>
            </div>
          ) : (
            <button className="oc-add-model-btn" onClick={() => setShowAddModel(true)}>+ 添加模型</button>
          )}
        </div>

        {/* 技能编排 */}
        <div className="panel-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span className="panel-title" style={{ margin: 0 }}>🧩 技能编排</span>
            <span className="oc-sec-count">{enabledSkills}/{skills.length} 启用</span>
          </div>
          <div className="oc-skill-add">
            <input className="oc-skill-add-input" placeholder="添加自定义技能..."
              value={newSkillName} onChange={e => setNewSkillName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCustomSkill()} />
            <button className="oc-skill-add-btn" onClick={addCustomSkill}>添加</button>
          </div>
          <div className="oc-skill-list">
            {skills.map(s => (
              <div key={s.id} className={`oc-skill-row ${s.enabled ? 'on' : ''}`} onClick={() => toggleSkill(s.id)}>
                <span className="oc-skill-icon">{s.icon}</span>
                <div className="oc-skill-info">
                  <span className="oc-skill-name">{s.name}</span>
                  <span className="oc-skill-desc">{s.desc}</span>
                </div>
                {s.builtin && <span className="oc-skill-tag">内置</span>}
                {!s.builtin && (
                  <button className="oc-skill-rm" onClick={e => { e.stopPropagation(); removeSkill(s.id); }}>移除</button>
                )}
                <span className={`oc-skill-toggle ${s.enabled ? 'on' : ''}`} />
              </div>
            ))}
          </div>
        </div>

        {/* 接入渠道 */}
        <div className="panel-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span className="panel-title" style={{ margin: 0 }}>📡 接入渠道</span>
            <span className="oc-sec-count">{activeChannels} 活跃</span>
          </div>
          <div className="oc-ch-grid">
            {channels.map(ch => (
              <div key={ch.id} className={`oc-ch-card clickable ${ch.active ? 'active' : ''}`}
                onClick={() => ch.id === 'terminal' ? toggleChannel(ch.id) : setEditChannel(ch)}>
                <span className={`oc-ch-dot ${ch.active ? 'on' : ''}`} />
                <span className="oc-ch-icon">{ch.icon}</span>
                <span className="oc-ch-name">{ch.name}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <div className="panel-title" style={{ fontSize: '0.85rem' }}>🔧 快捷工具</div>
            <div className="oc-tools-grid">
              <button className="oc-tl" onClick={() => setActiveTab('terminal')}>终端对话</button>
              <button className="oc-tl" onClick={handleViewLogs}>查看日志</button>
              <button className="oc-tl" onClick={handleCheckStatus}>状态诊断</button>
              <button className="oc-tl" onClick={() => addToast('Prompt 编辑器开发中', 'info')}>Prompt 编辑</button>
              <button className="oc-tl" onClick={() => addToast('知识库管理开发中', 'info')}>知识库</button>
              <button className="oc-tl" onClick={() => { setCmd('openclaw status'); }}>运行诊断</button>
            </div>
          </div>
        </div>
      </div>

      {/* 日志面板 */}
      {showLog && statusLog.length > 0 && (
        <div className="isolated-widget" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="widget-header" style={{ margin: 0 }}>📋 设备日志</span>
            <button className="oc-bar-btn" onClick={() => setShowLog(false)}>收起</button>
          </div>
          <pre className="ros-output-content" style={{ maxHeight: 200, overflow: 'auto' }}>
            {statusLog.join('\n')}
          </pre>
        </div>
      )}

      {/* 底部提示 */}
      <div className="oc-hint">
        💡 试试在 AI 助手中输入
        <button className="oc-hint-cmd" onClick={() => setCmd('启动 OpenClaw 服务')}>"启动 OpenClaw 服务"</button>
        或
        <button className="oc-hint-cmd" onClick={() => setCmd('切换模型到 qwen3.5-plus')}>"切换模型到 qwen3.5-plus"</button>
      </div>

      {/* 渠道配置弹窗 */}
      {editChannel && (
        <>
          <div className="oc-modal-mask" onClick={() => setEditChannel(null)} />
          <div className="oc-modal">
            <div className="oc-modal-head">
              <h3 className="oc-modal-title">{editChannel.icon} {editChannel.name} 配置</h3>
              <button className="oc-modal-close" onClick={() => setEditChannel(null)}>✕</button>
            </div>
            {editChannel.id === 'feishu' && (
              <>
                <p className="desc-text">将 OpenClaw 接入飞书群聊机器人，实现远程对话控制。</p>
                <div className="oc-steps">
                  <div className="oc-step"><span className="oc-step-n">1</span>在飞书开放平台创建自定义机器人</div>
                  <div className="oc-step"><span className="oc-step-n">2</span>获取 Webhook URL 和签名密钥</div>
                  <div className="oc-step"><span className="oc-step-n">3</span>填入下方配置并启用</div>
                </div>
                <div className="oc-input-group">
                  <label>Webhook URL</label>
                  <input placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
                </div>
                <div className="oc-input-group">
                  <label>签名密钥 (可选)</label>
                  <input type="password" placeholder="SEC..." />
                </div>
              </>
            )}
            {editChannel.id === 'wechat' && (
              <>
                <p className="desc-text">通过微信公众号或企业微信接入 OpenClaw。</p>
                <div className="oc-input-group">
                  <label>App ID</label>
                  <input placeholder="wx..." />
                </div>
                <div className="oc-input-group">
                  <label>App Secret</label>
                  <input type="password" placeholder="..." />
                </div>
              </>
            )}
            {editChannel.id === 'api' && (
              <>
                <p className="desc-text">启用 REST API 端点，支持第三方系统集成。</p>
                <div className="oc-input-group">
                  <label>监听端口</label>
                  <input placeholder="8080" defaultValue="8080" />
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="oc-save-btn wide" onClick={() => {
                toggleChannel(editChannel.id);
                setEditChannel(null);
                addToast(`${editChannel.name} 已${editChannel.active ? '关闭' : '启用'}`, 'success');
              }}>
                {editChannel.active ? '关闭渠道' : '启用渠道'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
