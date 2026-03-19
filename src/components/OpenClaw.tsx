import { useState, useEffect, useRef } from 'react';
import { useAppState } from '../hooks/useAppState';
import io from 'socket.io-client';
import '../styles/openclaw.css';

interface GatewayStatus {
  running: boolean;
  version: string;
  feishuConnected: boolean;
}

interface ConfigData {
  modelGateway?: {
    baseUrl: string;
    apiKey: string;
    api: string;
    modelId: string;
    modelName: string;
  };
  feishu?: {
    appId: string;
    appSecret: string;
  };
  runtimeModel?: {
    provider: string;
    modelId: string;
    apiKey: string;
  };
  primaryModel?: string;
  configuredProviders?: Array<{
    provider: string;
    modelId: string;
    label: string;
    hasKey: boolean;
  }>;
  pluginsAllow?: string[];
}

interface OpenClawChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

const OPENCLAW_QUICK_PROMPTS = [
  '请先检查当前网关状态并给出一条结论',
  '帮我总结当前设备可用的 OpenClaw 能力',
  '我现在要做一个设备健康巡检，给我步骤',
  '帮我诊断为什么会连接失败，并给修复命令',
];

export default function OpenClaw() {
  const { currentDevice, addToast } = useAppState();
  const [activeTab, setActiveTab] = useState<'chat' | 'settings'>('chat');
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState('');
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'model' | 'feishu' | 'skill' | 'install'>('model');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<OpenClawChatMessage[]>([]);
  const [chatConnected, setChatConnected] = useState(false);
  const [chatStreaming, setChatStreaming] = useState(false);
  const socketRef = useRef<SocketIOClient.Socket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // 表单状态
  const [modelConfig, setModelConfig] = useState({
    baseUrl: '',
    apiKey: '',
    api: 'anthropic-messages',
    modelId: 'qwen3.5-plus',
    modelName: 'Custom Model',
  });

  const [feishuConfig, setFeishuConfig] = useState({
    appId: '',
    appSecret: '',
  });
  const [skillPluginsAllowText, setSkillPluginsAllowText] = useState('');

  useEffect(() => {
    if (currentDevice) {
      loadStatus();
      loadConfig();
    }
  }, [currentDevice]);

  const resolveSocketUrl = () => {
    const apiBase = (window as any).rdkDesktop?.apiBase as string | undefined;
    if (!apiBase) return 'http://localhost:8787';
    try {
      const url = new URL(apiBase);
      return `${url.protocol}//${url.host}`;
    } catch {
      return 'http://localhost:8787';
    }
  };

  useEffect(() => {
    if (!currentDevice) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setChatConnected(false);
      setChatStreaming(false);
      return;
    }

    const socket = io(resolveSocketUrl(), {
      transports: ['polling'],
      upgrade: false,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 800,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setChatConnected(false);
      socket.emit('openclaw:start', { deviceId: currentDevice.id });
    });

    socket.on('openclaw:ready', () => {
      setChatConnected(true);
    });

    socket.on('openclaw:data', (data: { chunk: string }) => {
      setChatMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant') {
          return [...prev.slice(0, -1), { ...last, text: `${last.text}${data.chunk}` }];
        }
        return prev;
      });
    });

    socket.on('openclaw:complete', () => {
      setChatStreaming(false);
      setChatMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && !last.text.trim()) {
          return [...prev.slice(0, -1), { ...last, text: '⚠️ OpenClaw 未返回有效内容，请检查网关状态或设备密码。' }];
        }
        return prev;
      });
    });

    socket.on('openclaw:error', (data: { error: string }) => {
      setChatStreaming(false);
      setChatMessages((prev) => [...prev, {
        id: Date.now(),
        role: 'assistant',
        text: `❌ OpenClaw 错误：${data.error}`,
      }]);
      addToast?.(data.error || 'OpenClaw 对话异常', 'error');
    });

    socket.on('openclaw:disconnected', () => {
      setChatConnected(false);
      setChatStreaming(false);
    });

    socket.on('disconnect', () => {
      setChatConnected(false);
      setChatStreaming(false);
    });

    socket.on('connect_error', (err: any) => {
      setChatConnected(false);
      setChatStreaming(false);
      addToast?.(`OpenClaw 连接失败: ${err?.message || 'socket error'}`, 'warning');
    });

    return () => {
      socket.emit('openclaw:stop', { deviceId: currentDevice.id });
      socket.disconnect();
      socketRef.current = null;
      setChatConnected(false);
      setChatStreaming(false);
    };
  }, [currentDevice]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatStreaming]);

  const dispatchOpenClawMessage = (text: string) => {
    if (!currentDevice || !text.trim() || !socketRef.current || !chatConnected || chatStreaming) return;
    const userText = text.trim();
    const msgId = Date.now();
    setChatMessages((prev) => [
      ...prev,
      { id: msgId, role: 'user', text: userText },
      { id: msgId + 1, role: 'assistant', text: '' },
    ]);
    setChatInput('');
    setChatStreaming(true);

    socketRef.current.emit('openclaw:send', {
      deviceId: currentDevice.id,
      message: userText,
    });
  };

  const sendOpenClawMessage = (e: React.FormEvent) => {
    e.preventDefault();
    dispatchOpenClawMessage(chatInput);
  };

  const handleReconnectChat = () => {
    if (!currentDevice || !socketRef.current) return;
    setChatConnected(false);
    socketRef.current.emit('openclaw:stop', { deviceId: currentDevice.id });
    socketRef.current.emit('openclaw:start', { deviceId: currentDevice.id });
  };

  const clearChatMessages = () => {
    setChatMessages([]);
    setChatStreaming(false);
  };

  const loadStatus = async () => {
    if (!currentDevice) return;
    try {
      const res = await fetch(`/api/devices/${currentDevice.id}/openclaw/status`);
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error('加载状态失败:', err);
    }
  };

  const loadConfig = async () => {
    if (!currentDevice) return;
    try {
      const res = await fetch(`/api/devices/${currentDevice.id}/openclaw/config`);
      const data = await res.json();
      setConfig(data);
      if (data.modelGateway) {
        setModelConfig(data.modelGateway);
      }
      if (data.feishu) {
        setFeishuConfig(data.feishu);
      }
      if (Array.isArray(data.pluginsAllow)) {
        setSkillPluginsAllowText(data.pluginsAllow.join('\n'));
      }
    } catch (err) {
      console.error('加载配置失败:', err);
    }
  };

  const runAction = async (action: string, body?: any) => {
    if (!currentDevice) return;
    setLoading(true);
    setOutput('');
    try {
      const res = await fetch(`/api/devices/${currentDevice.id}/openclaw/${action}`, {
        method: action === 'status' || action === 'version' ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      setOutput(data.output || JSON.stringify(data, null, 2));
      if (action === 'install' || action === 'uninstall' || action === 'restart-gateway') {
        setTimeout(loadStatus, 2000);
      }
      if (data.ok) {
        addToast?.('操作成功', 'success');
      }
    } catch (err: any) {
      setOutput(`错误: ${err.message}`);
      addToast?.(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    if (!currentDevice) return;

    const pluginAllowList = skillPluginsAllowText
      .split(/\r?\n|,/) 
      .map((item) => item.trim())
      .filter(Boolean);

    if (settingsTab === 'model') {
      if (!modelConfig.baseUrl.trim() || !modelConfig.apiKey.trim()) {
        addToast?.('模型配置需要同时填写 Base URL 和 API Key', 'warning');
        return;
      }
    }

    if (settingsTab === 'feishu') {
      const hasAppId = !!feishuConfig.appId.trim();
      const hasSecret = !!feishuConfig.appSecret.trim();
      if ((hasAppId && !hasSecret) || (!hasAppId && hasSecret)) {
        addToast?.('飞书配置需要同时填写 App ID 和 App Secret', 'warning');
        return;
      }
    }

    if (settingsTab === 'skill') {
      const invalid = pluginAllowList.find((id) => !/^[a-zA-Z0-9@/_-]+$/.test(id));
      if (invalid) {
        addToast?.(`无效插件 ID: ${invalid}`, 'warning');
        return;
      }
    }

    const configPayload: any = {};
    if (settingsTab === 'model') {
      configPayload.modelGateway = modelConfig;
    } else if (settingsTab === 'feishu') {
      if (feishuConfig.appId.trim() && feishuConfig.appSecret.trim()) {
        configPayload.feishu = feishuConfig;
      } else {
        addToast?.('飞书配置为空，未提交更新', 'info');
        return;
      }
    } else if (settingsTab === 'skill') {
      configPayload.pluginsAllow = pluginAllowList;
    }

    setLoading(true);
    try {
      await fetch(`/api/devices/${currentDevice.id}/openclaw/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: configPayload,
        }),
      });
      setOutput('配置已保存并重启网关');
      addToast?.('配置已保存', 'success');
      setTimeout(() => {
        loadConfig();
        loadStatus();
      }, 1000);
    } catch (err: any) {
      setOutput(`保存失败: ${err.message}`);
      addToast?.(`保存失败: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const getCurrentModel = () => {
    if (!config?.primaryModel) return '未配置';
    const parts = config.primaryModel.split('/');
    return parts.length > 1 ? parts[1] : config.primaryModel;
  };

  const getAvailableModels = () => {
    return config?.configuredProviders || [];
  };

  if (!currentDevice) {
    return (
      <div className="openclaw-container">
        <div className="openclaw-empty">
          <p>请先选择一个设备</p>
        </div>
      </div>
    );
  }

  return (
    <div className="openclaw-container">
      <div className="openclaw-header">
        <div className="openclaw-title-section">
          <h2>OpenClaw AI 网关</h2>
          <div className="openclaw-status-bar">
            <span className={`status-dot ${status?.running ? 'running' : 'stopped'}`}></span>
            <span className="status-text">
              {status?.running ? '运行中' : '已停止'}
            </span>
            {status?.version && (
              <span className="version-text">v{status.version}</span>
            )}
          </div>
        </div>

        <div className="openclaw-controls">
          <div className="model-selector-wrapper">
            <button 
              className="model-selector-btn"
              onClick={() => setShowModelSelector(!showModelSelector)}
            >
              <span className="model-icon">🤖</span>
              <span className="model-name">{getCurrentModel()}</span>
              <span className="dropdown-arrow">▼</span>
            </button>
            {showModelSelector && (
              <div className="model-dropdown">
                {getAvailableModels().length > 0 ? (
                  getAvailableModels().map((model) => (
                    <div
                      key={model.modelId}
                      className={`model-option ${config?.primaryModel === `${model.provider}/${model.modelId}` ? 'active' : ''}`}
                      onClick={() => {
                        // TODO: 切换模型
                        setShowModelSelector(false);
                      }}
                    >
                      <span className="model-label">{model.label}</span>
                      {model.hasKey && <span className="model-badge">已配置</span>}
                    </div>
                  ))
                ) : (
                  <div className="model-option disabled">
                    <span>暂无已配置模型</span>
                  </div>
                )}
                <div className="model-divider"></div>
                <div 
                  className="model-option action"
                  onClick={() => {
                    setActiveTab('settings');
                    setShowModelSelector(false);
                  }}
                >
                  <span>⚙️ 配置模型</span>
                </div>
              </div>
            )}
          </div>

          {status?.feishuConnected && (
            <span className="feishu-badge">
              <span className="feishu-icon">📱</span>
              飞书已连接
            </span>
          )}

          <button
            className="btn-icon"
            onClick={() => setActiveTab(activeTab === 'chat' ? 'settings' : 'chat')}
            title={activeTab === 'chat' ? '设置' : '返回对话'}
          >
            {activeTab === 'chat' ? '⚙️' : '💬'}
          </button>
        </div>
      </div>

      <div className="openclaw-content">
        {activeTab === 'chat' && (
          <div className="openclaw-chat-panel">
            <div className="openclaw-chat-toolbar">
              <div className="openclaw-chat-status">
                <span className={`chat-status-dot ${chatConnected ? 'online' : 'offline'}`} />
                <span>{chatConnected ? '已连接 OpenClaw 会话' : '连接中 / 未连接'}</span>
              </div>
              <div className="openclaw-chat-actions">
                <button className="btn-secondary" onClick={handleReconnectChat} disabled={!currentDevice || chatStreaming}>重连会话</button>
                <button className="btn-secondary" onClick={clearChatMessages} disabled={chatMessages.length === 0 || chatStreaming}>清空对话</button>
              </div>
            </div>

            {!status?.running && (
              <div className="openclaw-chat-warning">
                OpenClaw 网关未运行，建议先点击“启动网关”后再对话。
                <button
                  className="btn-secondary"
                  onClick={() => runAction('restart-gateway')}
                  disabled={loading}
                >
                  {loading ? '启动中...' : '启动网关'}
                </button>
              </div>
            )}

            <div className="openclaw-chat-messages">
              {chatMessages.length === 0 ? (
                <div className="openclaw-empty">
                  <div className="empty-icon">💬</div>
                  <h3>OpenClaw 对话已就绪</h3>
                  <p>输入问题后会直接通过本地会话连接板端 Agent</p>
                  <div className="openclaw-empty-prompts">
                    {OPENCLAW_QUICK_PROMPTS.slice(0, 3).map((prompt) => (
                      <button
                        key={prompt}
                        className="openclaw-prompt-chip"
                        onClick={() => dispatchOpenClawMessage(prompt)}
                        disabled={!chatConnected || chatStreaming}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div key={msg.id} className={`openclaw-chat-msg ${msg.role}`}>
                    <div className="openclaw-chat-meta">
                      <div className="openclaw-chat-role">{msg.role === 'user' ? '你' : 'OpenClaw'}</div>
                      <span className="openclaw-chat-time">{new Date(msg.id).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="openclaw-chat-text">{msg.text || (msg.role === 'assistant' && chatStreaming ? '思考中…' : '')}</div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {chatMessages.length > 0 && (
              <div className="openclaw-chat-prompts">
                {OPENCLAW_QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    className="openclaw-prompt-chip"
                    onClick={() => dispatchOpenClawMessage(prompt)}
                    disabled={!chatConnected || chatStreaming}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            <form className="openclaw-chat-input" onSubmit={sendOpenClawMessage}>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={chatConnected ? '给 OpenClaw 发送消息…' : '等待 OpenClaw 连接…'}
                disabled={!chatConnected || chatStreaming}
              />
              <button type="submit" className="btn-primary" disabled={!chatConnected || !chatInput.trim() || chatStreaming}>
                {chatStreaming ? '发送中…' : '发送'}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="openclaw-settings-panel">
            <div className="settings-sidebar">
              <div className="settings-nav">
                <button className={`nav-item ${settingsTab === 'model' ? 'active' : ''}`} onClick={() => setSettingsTab('model')}>模型配置</button>
                <button className={`nav-item ${settingsTab === 'feishu' ? 'active' : ''}`} onClick={() => setSettingsTab('feishu')}>飞书配置</button>
                <button className={`nav-item ${settingsTab === 'skill' ? 'active' : ''}`} onClick={() => setSettingsTab('skill')}>技能配置</button>
                <button className={`nav-item ${settingsTab === 'install' ? 'active' : ''}`} onClick={() => setSettingsTab('install')}>安装管理</button>
              </div>
            </div>

            <div className="settings-content">
              {settingsTab === 'model' && (
                <div className="settings-section">
                  <h3>模型网关配置</h3>
                  <p className="section-desc">配置模型网关参数并指定默认模型，提交后会自动重启 Gateway。</p>

                  <div className="form-group">
                    <label>Base URL</label>
                    <input
                      type="text"
                      value={modelConfig.baseUrl}
                      onChange={(e) => setModelConfig({ ...modelConfig, baseUrl: e.target.value })}
                      placeholder="https://api.example.com/v1"
                    />
                  </div>

                  <div className="form-group">
                    <label>API Key</label>
                    <input
                      type="password"
                      value={modelConfig.apiKey}
                      onChange={(e) => setModelConfig({ ...modelConfig, apiKey: e.target.value })}
                      placeholder="sk-..."
                    />
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>API 类型</label>
                      <select
                        value={modelConfig.api}
                        onChange={(e) => setModelConfig({ ...modelConfig, api: e.target.value })}
                      >
                        <option value="anthropic-messages">Anthropic Messages</option>
                        <option value="openai-chat">OpenAI Chat</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label>模型 ID</label>
                      <input
                        type="text"
                        value={modelConfig.modelId}
                        onChange={(e) => setModelConfig({ ...modelConfig, modelId: e.target.value })}
                        placeholder="qwen3.5-plus"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>模型名称</label>
                    <input
                      type="text"
                      value={modelConfig.modelName}
                      onChange={(e) => setModelConfig({ ...modelConfig, modelName: e.target.value })}
                      placeholder="Custom Model"
                    />
                  </div>
                </div>
              )}

              {settingsTab === 'feishu' && (
                <div className="settings-section">
                  <h3>飞书机器人配置</h3>
                  <p className="section-desc">用于飞书机器人配对。请同时填写 App ID 与 App Secret。</p>

                  <div className="form-group">
                    <label>App ID</label>
                    <input
                      type="text"
                      value={feishuConfig.appId}
                      onChange={(e) => setFeishuConfig({ ...feishuConfig, appId: e.target.value })}
                      placeholder="cli_..."
                    />
                  </div>

                  <div className="form-group">
                    <label>App Secret</label>
                    <input
                      type="password"
                      value={feishuConfig.appSecret}
                      onChange={(e) => setFeishuConfig({ ...feishuConfig, appSecret: e.target.value })}
                      placeholder="..."
                    />
                  </div>
                </div>
              )}

              {settingsTab === 'skill' && (
                <div className="settings-section">
                  <h3>技能 / 插件白名单</h3>
                  <p className="section-desc">每行一个插件 ID，保存后会写入 openclaw.json 的 plugins.allow 并重启 Gateway。</p>

                  <div className="form-group">
                    <label>plugins.allow</label>
                    <textarea
                      className="settings-textarea"
                      value={skillPluginsAllowText}
                      onChange={(e) => setSkillPluginsAllowText(e.target.value)}
                      placeholder={'skillhub\nfeishu_doc\nfeishu_chat'}
                    />
                  </div>
                </div>
              )}

              {settingsTab !== 'install' && (
                <div className="settings-actions">
                  <button
                    className="btn-primary"
                    onClick={saveConfig}
                    disabled={loading}
                  >
                    {loading ? '保存中...' : '保存当前配置'}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      loadConfig();
                      addToast?.('已重新加载配置', 'info');
                    }}
                  >
                    重新加载
                  </button>
                </div>
              )}

              {settingsTab === 'install' && (
                <div className="settings-section">
                  <h3>安装管理</h3>
                  <p className="section-desc">安装相关操作独立到该页面，避免与配置项混淆。</p>
                  <div className="action-grid">
                    <button className="action-card" onClick={() => runAction('check')} disabled={loading}>
                      <span className="action-icon">🔍</span>
                      <span className="action-label">系统诊断</span>
                    </button>
                    <button className="action-card" onClick={() => runAction('prepare')} disabled={loading}>
                      <span className="action-icon">📦</span>
                      <span className="action-label">安装依赖</span>
                    </button>
                    <button className="action-card primary" onClick={() => runAction('install')} disabled={loading}>
                      <span className="action-icon">⬇️</span>
                      <span className="action-label">安装 OpenClaw</span>
                    </button>
                    <button className="action-card" onClick={() => runAction('upgrade')} disabled={loading}>
                      <span className="action-icon">⬆️</span>
                      <span className="action-label">升级版本</span>
                    </button>
                    <button className="action-card" onClick={() => runAction('restart-gateway')} disabled={loading}>
                      <span className="action-icon">🔄</span>
                      <span className="action-label">重启网关</span>
                    </button>
                    <button className="action-card danger" onClick={() => runAction('uninstall')} disabled={loading}>
                      <span className="action-icon">🗑️</span>
                      <span className="action-label">卸载</span>
                    </button>
                  </div>
                </div>
              )}

              {output && (
                <div className="output-box">
                  <div className="output-header">
                    <span>执行输出</span>
                    <button onClick={() => setOutput('')}>清空</button>
                  </div>
                  <pre>{output}</pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
