import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';
import { renderMarkdown } from './MarkdownRenderer';
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

type MainTab = 'overview' | 'settings' | 'operations';
type SettingsTab = 'model' | 'feishu' | 'skill';

const QUICK_PROMPTS = [
  { icon: 'health_and_safety', label: '网关健康检查', prompt: '请先检查当前网关状态并给出一条结论' },
  { icon: 'widgets', label: '能力总览', prompt: '帮我总结当前设备可用的 OpenClaw 能力' },
  { icon: 'checklist', label: '设备巡检', prompt: '我现在要做一个设备健康巡检，给我步骤' },
  { icon: 'build', label: '诊断修复', prompt: '帮我诊断为什么会连接失败，并给修复命令' },
];

export default function OpenClaw() {
  const { currentDevice, addToast } = useAppState();
  const [mainTab, setMainTab] = useState<MainTab>('overview');
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [output, setOutput] = useState('');
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('model');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<OpenClawChatMessage[]>([]);
  const [chatConnected, setChatConnected] = useState(false);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ action: string; label: string } | null>(null);
  const [logOutput, setLogOutput] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const modelDropdownRef = useRef<HTMLDivElement | null>(null);
  const outputEndRef = useRef<HTMLDivElement | null>(null);

  const [modelConfig, setModelConfig] = useState({
    baseUrl: '',
    apiKey: '',
    api: 'anthropic-messages',
    modelId: 'qwen3.5-plus',
    modelName: 'Custom Model',
  });
  const [feishuConfig, setFeishuConfig] = useState({ appId: '', appSecret: '' });
  const [skillPluginsAllowText, setSkillPluginsAllowText] = useState('');

  useEffect(() => {
    if (currentDevice) {
      loadStatus();
      loadConfig();
    }
  }, [currentDevice]);

  // Close model dropdown on outside click
  useEffect(() => {
    if (!showModelSelector) return;
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelSelector(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showModelSelector]);

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
    socket.on('openclaw:ready', () => setChatConnected(true));
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
          return [...prev.slice(0, -1), { ...last, text: 'OpenClaw 未返回有效内容，请检查网关状态或设备密码。' }];
        }
        return prev;
      });
    });
    socket.on('openclaw:error', (data: { error: string }) => {
      setChatStreaming(false);
      setChatMessages((prev) => [...prev, {
        id: Date.now(),
        role: 'assistant',
        text: `**错误：** ${data.error}`,
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

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [output]);

  const dispatchOpenClawMessage = useCallback((text: string) => {
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
    socketRef.current.emit('openclaw:send', { deviceId: currentDevice.id, message: userText });
  }, [currentDevice, chatConnected, chatStreaming]);

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

  const loadStatus = async () => {
    if (!currentDevice) return;
    setStatusLoading(true);
    try {
      const res = await fetch(`/api/devices/${currentDevice.id}/openclaw/status`);
      const data = await res.json();
      setStatus(data);
    } catch {
      // silently fail
    } finally {
      setStatusLoading(false);
    }
  };

  const loadConfig = async () => {
    if (!currentDevice) return;
    try {
      const res = await fetch(`/api/devices/${currentDevice.id}/openclaw/config`);
      const data = await res.json();
      setConfig(data);
      if (data.modelGateway) setModelConfig(data.modelGateway);
      if (data.feishu) setFeishuConfig(data.feishu);
      if (Array.isArray(data.pluginsAllow)) setSkillPluginsAllowText(data.pluginsAllow.join('\n'));
    } catch {
      // silently fail
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
      if (data.ok) addToast?.('操作成功', 'success');
    } catch (err: any) {
      setOutput(`错误: ${err.message}`);
      addToast?.(err.message, 'error');
    } finally {
      setLoading(false);
      setConfirmAction(null);
    }
  };

  const loadLogs = async () => {
    if (!currentDevice) return;
    setLogLoading(true);
    try {
      const res = await fetch(`/api/devices/${currentDevice.id}/openclaw/version`);
      const versionData = await res.json();
      let logText = `OpenClaw 版本: ${versionData.version || '未安装'}\n\n`;

      const statusRes = await fetch(`/api/devices/${currentDevice.id}/openclaw/status`);
      const statusData = await statusRes.json();
      logText += `网关状态: ${statusData.running ? '运行中' : '已停止'}\n`;
      logText += `飞书连接: ${statusData.feishuConnected ? '已连接' : '未连接'}\n`;
      logText += `版本号: ${statusData.version || '--'}\n`;
      setLogOutput(logText);
    } catch (err: any) {
      setLogOutput(`日志获取失败: ${err.message}`);
    } finally {
      setLogLoading(false);
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
    if (settingsTab === 'model') configPayload.modelGateway = modelConfig;
    else if (settingsTab === 'feishu') {
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
        body: JSON.stringify({ config: configPayload }),
      });
      addToast?.('配置已保存并重启网关', 'success');
      setTimeout(() => { loadConfig(); loadStatus(); }, 1000);
    } catch (err: any) {
      addToast?.(`保存失败: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const switchModel = async (provider: string, modelId: string) => {
    if (!currentDevice) return;
    setShowModelSelector(false);
    setLoading(true);
    try {
      await fetch(`/api/devices/${currentDevice.id}/openclaw/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            modelGateway: {
              ...modelConfig,
              modelId,
            },
          },
        }),
      });
      addToast?.(`已切换模型到 ${modelId}`, 'success');
      setTimeout(() => { loadConfig(); loadStatus(); }, 1000);
    } catch (err: any) {
      addToast?.(`模型切换失败: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const getCurrentModel = () => {
    if (!config?.primaryModel) return '未配置';
    const parts = config.primaryModel.split('/');
    return parts.length > 1 ? parts[1] : config.primaryModel;
  };

  const getAvailableModels = () => config?.configuredProviders || [];

  const MI = (name: string, cls?: string) => (
    <span className={`material-symbols-outlined ${cls || ''}`}>{name}</span>
  );

  // ─── Empty device state ───
  if (!currentDevice) {
    return (
      <div className="oc-container">
        <div className="oc-empty-state">
          {MI('developer_board', 'oc-empty-icon')}
          <h3>请先连接设备</h3>
          <p>选择一个 RDK 设备后即可管理 OpenClaw AI 网关</p>
        </div>
      </div>
    );
  }

  return (
    <div className="oc-container">
      {/* ─── Header ─── */}
      <header className="oc-header">
        <div className="oc-header-left">
          <div className="oc-logo">
            {MI('hub', 'oc-logo-icon')}
            <span className="oc-logo-text">OpenClaw</span>
          </div>
          <div className={`oc-status-chip ${status?.running ? 'running' : 'stopped'}`}>
            <span className="oc-status-dot" />
            <span>{statusLoading ? '检测中...' : status?.running ? '运行中' : '已停止'}</span>
            {status?.version && <span className="oc-version">v{status.version}</span>}
          </div>
          {status?.feishuConnected && (
            <div className="oc-status-chip feishu">
              {MI('chat', 'oc-chip-icon')}
              <span>飞书已连接</span>
            </div>
          )}
        </div>

        <div className="oc-header-right">
          <div className="oc-model-selector" ref={modelDropdownRef}>
            <button
              className="oc-model-btn"
              onClick={() => setShowModelSelector(!showModelSelector)}
            >
              {MI('smart_toy', 'oc-model-icon')}
              <span className="oc-model-name">{getCurrentModel()}</span>
              {MI('expand_more', 'oc-expand-icon')}
            </button>
            {showModelSelector && (
              <div className="oc-model-dropdown">
                <div className="oc-dropdown-header">可用模型</div>
                {getAvailableModels().length > 0 ? (
                  getAvailableModels().map((model) => (
                    <button
                      key={model.modelId}
                      className={`oc-dropdown-item ${config?.primaryModel === `${model.provider}/${model.modelId}` ? 'active' : ''}`}
                      onClick={() => switchModel(model.provider, model.modelId)}
                    >
                      <span className="oc-dropdown-label">{model.label}</span>
                      <span className="oc-dropdown-meta">
                        {model.hasKey && <span className="oc-badge success">已配置</span>}
                        {config?.primaryModel === `${model.provider}/${model.modelId}` && MI('check_circle', 'oc-check')}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="oc-dropdown-empty">
                    {MI('info')}
                    <span>暂无已配置模型</span>
                  </div>
                )}
                <div className="oc-dropdown-divider" />
                <button
                  className="oc-dropdown-item action"
                  onClick={() => {
                    setMainTab('settings');
                    setSettingsTab('model');
                    setShowModelSelector(false);
                  }}
                >
                  {MI('settings')}
                  <span>配置模型</span>
                </button>
              </div>
            )}
          </div>

          <button className="oc-icon-btn" onClick={loadStatus} title="刷新状态">
            {MI('refresh')}
          </button>
        </div>
      </header>

      {/* ─── Tab Bar ─── */}
      <nav className="oc-tabs">
        {([
          { id: 'overview' as MainTab, icon: 'forum', label: '对话' },
          { id: 'settings' as MainTab, icon: 'tune', label: '设置' },
          { id: 'operations' as MainTab, icon: 'terminal', label: '运维' },
        ]).map((tab) => (
          <button
            key={tab.id}
            className={`oc-tab ${mainTab === tab.id ? 'active' : ''}`}
            onClick={() => {
              setMainTab(tab.id);
              if (tab.id === 'operations' && !logOutput) loadLogs();
            }}
          >
            {MI(tab.icon, 'oc-tab-icon')}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* ─── Content ─── */}
      <div className="oc-content">

        {/* ═══ Overview & Chat ═══ */}
        {mainTab === 'overview' && (
          <div className="oc-overview">
            {/* Status Cards */}
            <div className="oc-status-cards">
              <div className={`oc-card ${status?.running ? 'ok' : 'warn'}`}>
                <div className="oc-card-icon">{MI(status?.running ? 'check_circle' : 'error')}</div>
                <div className="oc-card-body">
                  <span className="oc-card-label">网关状态</span>
                  <span className="oc-card-value">{status?.running ? '正常运行' : '未运行'}</span>
                </div>
                {!status?.running && (
                  <button
                    className="oc-card-action"
                    onClick={() => runAction('restart-gateway')}
                    disabled={loading}
                  >
                    {loading ? '启动中...' : '启动'}
                  </button>
                )}
              </div>
              <div className="oc-card">
                <div className="oc-card-icon">{MI('tag')}</div>
                <div className="oc-card-body">
                  <span className="oc-card-label">版本</span>
                  <span className="oc-card-value">{status?.version || '--'}</span>
                </div>
              </div>
              <div className="oc-card">
                <div className="oc-card-icon">{MI('smart_toy')}</div>
                <div className="oc-card-body">
                  <span className="oc-card-label">当前模型</span>
                  <span className="oc-card-value">{getCurrentModel()}</span>
                </div>
              </div>
              <div className={`oc-card ${status?.feishuConnected ? 'ok' : ''}`}>
                <div className="oc-card-icon">{MI('chat')}</div>
                <div className="oc-card-body">
                  <span className="oc-card-label">飞书</span>
                  <span className="oc-card-value">{status?.feishuConnected ? '已连接' : '未连接'}</span>
                </div>
              </div>
            </div>

            {/* Chat Area */}
            <div className="oc-chat">
              <div className="oc-chat-toolbar">
                <div className="oc-chat-conn">
                  <span className={`oc-conn-dot ${chatConnected ? 'online' : ''}`} />
                  <span>{chatConnected ? 'Agent 会话已建立' : '等待连接...'}</span>
                </div>
                <div className="oc-chat-btns">
                  <button className="oc-text-btn" onClick={handleReconnectChat} disabled={!currentDevice || chatStreaming}>
                    {MI('sync', 'oc-btn-icon')}重连
                  </button>
                  <button className="oc-text-btn" onClick={() => { setChatMessages([]); setChatStreaming(false); }} disabled={chatMessages.length === 0 || chatStreaming}>
                    {MI('delete_sweep', 'oc-btn-icon')}清空
                  </button>
                </div>
              </div>

              <div className="oc-chat-messages">
                {chatMessages.length === 0 ? (
                  <div className="oc-chat-welcome">
                    {MI('hub', 'oc-welcome-icon')}
                    <h3>OpenClaw Agent 就绪</h3>
                    <p>通过自然语言与板端 AI Agent 交互，管理设备、执行任务</p>
                    <div className="oc-quick-grid">
                      {QUICK_PROMPTS.map((item) => (
                        <button
                          key={item.label}
                          className="oc-quick-card"
                          onClick={() => dispatchOpenClawMessage(item.prompt)}
                          disabled={!chatConnected || chatStreaming}
                        >
                          {MI(item.icon, 'oc-quick-icon')}
                          <span>{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <div key={msg.id} className={`oc-msg ${msg.role}`}>
                      <div className="oc-msg-avatar">
                        {msg.role === 'user' ? MI('person') : MI('smart_toy')}
                      </div>
                      <div className="oc-msg-content">
                        <div className="oc-msg-header">
                          <span className="oc-msg-role">{msg.role === 'user' ? '你' : 'OpenClaw'}</span>
                          <span className="oc-msg-time">
                            {new Date(msg.id).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="oc-msg-body">
                          {msg.text ? (
                            msg.role === 'assistant' ? renderMarkdown(msg.text) : msg.text
                          ) : (
                            msg.role === 'assistant' && chatStreaming ? (
                              <div className="oc-typing">
                                <span className="oc-typing-dot" />
                                <span className="oc-typing-dot" />
                                <span className="oc-typing-dot" />
                              </div>
                            ) : null
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>

              {chatMessages.length > 0 && (
                <div className="oc-quick-prompts">
                  {QUICK_PROMPTS.map((item) => (
                    <button
                      key={item.label}
                      className="oc-prompt-chip"
                      onClick={() => dispatchOpenClawMessage(item.prompt)}
                      disabled={!chatConnected || chatStreaming}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}

              <form className="oc-chat-input" onSubmit={sendOpenClawMessage}>
                <div className="oc-input-wrap">
                  {MI('edit', 'oc-input-icon')}
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={chatConnected ? '向 OpenClaw Agent 发送消息...' : '等待连接 OpenClaw...'}
                    disabled={!chatConnected || chatStreaming}
                  />
                </div>
                <button
                  type="submit"
                  className="oc-send-btn"
                  disabled={!chatConnected || !chatInput.trim() || chatStreaming}
                >
                  {chatStreaming ? MI('hourglass_top') : MI('send')}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ═══ Settings ═══ */}
        {mainTab === 'settings' && (
          <div className="oc-settings">
            <aside className="oc-settings-nav">
              {([
                { id: 'model' as SettingsTab, icon: 'smart_toy', label: '模型配置' },
                { id: 'feishu' as SettingsTab, icon: 'chat', label: '飞书配置' },
                { id: 'skill' as SettingsTab, icon: 'extension', label: '技能插件' },
              ]).map((item) => (
                <button
                  key={item.id}
                  className={`oc-nav-item ${settingsTab === item.id ? 'active' : ''}`}
                  onClick={() => setSettingsTab(item.id)}
                >
                  {MI(item.icon, 'oc-nav-icon')}
                  <span>{item.label}</span>
                </button>
              ))}
            </aside>

            <div className="oc-settings-body">
              {settingsTab === 'model' && (
                <section className="oc-section">
                  <div className="oc-section-header">
                    <h3>模型网关配置</h3>
                    <p>配置 AI 模型网关参数，保存后自动重启 Gateway 服务。</p>
                  </div>

                  <div className="oc-form">
                    <div className="oc-field">
                      <label>Base URL</label>
                      <div className="oc-input-group">
                        {MI('link', 'oc-field-icon')}
                        <input
                          type="text"
                          value={modelConfig.baseUrl}
                          onChange={(e) => setModelConfig({ ...modelConfig, baseUrl: e.target.value })}
                          placeholder="https://api.example.com/v1"
                        />
                      </div>
                    </div>

                    <div className="oc-field">
                      <label>API Key</label>
                      <div className="oc-input-group">
                        {MI('key', 'oc-field-icon')}
                        <input
                          type="password"
                          value={modelConfig.apiKey}
                          onChange={(e) => setModelConfig({ ...modelConfig, apiKey: e.target.value })}
                          placeholder="sk-..."
                        />
                      </div>
                    </div>

                    <div className="oc-field-row">
                      <div className="oc-field">
                        <label>API 类型</label>
                        <select
                          value={modelConfig.api}
                          onChange={(e) => setModelConfig({ ...modelConfig, api: e.target.value })}
                          aria-label="API 类型"
                        >
                          <option value="anthropic-messages">Anthropic Messages</option>
                          <option value="openai-chat">OpenAI Chat</option>
                        </select>
                      </div>
                      <div className="oc-field">
                        <label>模型 ID</label>
                        <div className="oc-input-group">
                          {MI('model_training', 'oc-field-icon')}
                          <input
                            type="text"
                            value={modelConfig.modelId}
                            onChange={(e) => setModelConfig({ ...modelConfig, modelId: e.target.value })}
                            placeholder="qwen3.5-plus"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="oc-field">
                      <label>模型名称</label>
                      <div className="oc-input-group">
                        {MI('label', 'oc-field-icon')}
                        <input
                          type="text"
                          value={modelConfig.modelName}
                          onChange={(e) => setModelConfig({ ...modelConfig, modelName: e.target.value })}
                          placeholder="Custom Model"
                        />
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {settingsTab === 'feishu' && (
                <section className="oc-section">
                  <div className="oc-section-header">
                    <h3>飞书机器人配置</h3>
                    <p>配置飞书应用凭证，用于飞书机器人与 OpenClaw 的消息互通。</p>
                  </div>

                  <div className="oc-form">
                    <div className="oc-field">
                      <label>App ID</label>
                      <div className="oc-input-group">
                        {MI('badge', 'oc-field-icon')}
                        <input
                          type="text"
                          value={feishuConfig.appId}
                          onChange={(e) => setFeishuConfig({ ...feishuConfig, appId: e.target.value })}
                          placeholder="cli_..."
                        />
                      </div>
                    </div>
                    <div className="oc-field">
                      <label>App Secret</label>
                      <div className="oc-input-group">
                        {MI('lock', 'oc-field-icon')}
                        <input
                          type="password"
                          value={feishuConfig.appSecret}
                          onChange={(e) => setFeishuConfig({ ...feishuConfig, appSecret: e.target.value })}
                          placeholder="..."
                        />
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {settingsTab === 'skill' && (
                <section className="oc-section">
                  <div className="oc-section-header">
                    <h3>技能 / 插件白名单</h3>
                    <p>每行一个插件 ID，保存后写入 openclaw.json 的 plugins.allow 并重启 Gateway。</p>
                  </div>

                  <div className="oc-form">
                    <div className="oc-field">
                      <label>plugins.allow</label>
                      <textarea
                        className="oc-textarea"
                        value={skillPluginsAllowText}
                        onChange={(e) => setSkillPluginsAllowText(e.target.value)}
                        placeholder={'skillhub\nfeishu_doc\nfeishu_chat'}
                        rows={8}
                      />
                    </div>
                  </div>
                </section>
              )}

              <div className="oc-form-actions">
                <button className="oc-btn primary" onClick={saveConfig} disabled={loading}>
                  {loading ? MI('hourglass_top', 'oc-btn-icon') : MI('save', 'oc-btn-icon')}
                  {loading ? '保存中...' : '保存配置'}
                </button>
                <button
                  className="oc-btn secondary"
                  onClick={() => { loadConfig(); addToast?.('已重新加载配置', 'info'); }}
                >
                  {MI('refresh', 'oc-btn-icon')}
                  重新加载
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Operations ═══ */}
        {mainTab === 'operations' && (
          <div className="oc-operations">
            <div className="oc-ops-grid">
              <div className="oc-ops-section">
                <h4>部署管理</h4>
                <div className="oc-ops-cards">
                  {([
                    { action: 'check', icon: 'search', label: '系统诊断', desc: '检测 OpenClaw 环境', color: 'blue' },
                    { action: 'prepare', icon: 'inventory_2', label: '安装依赖', desc: '准备运行环境', color: 'blue' },
                    { action: 'install', icon: 'download', label: '安装 OpenClaw', desc: '全新安装到设备', color: 'green' },
                    { action: 'upgrade', icon: 'upgrade', label: '升级版本', desc: '更新到最新版', color: 'blue' },
                  ] as const).map((op) => (
                    <button
                      key={op.action}
                      className={`oc-op-card ${op.color}`}
                      onClick={() => runAction(op.action)}
                      disabled={loading}
                    >
                      {MI(op.icon, 'oc-op-icon')}
                      <div className="oc-op-info">
                        <span className="oc-op-label">{op.label}</span>
                        <span className="oc-op-desc">{op.desc}</span>
                      </div>
                      {loading && <span className="oc-op-spinner" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="oc-ops-section">
                <h4>服务管理</h4>
                <div className="oc-ops-cards">
                  <button
                    className="oc-op-card blue"
                    onClick={() => runAction('restart-gateway')}
                    disabled={loading}
                  >
                    {MI('restart_alt', 'oc-op-icon')}
                    <div className="oc-op-info">
                      <span className="oc-op-label">重启网关</span>
                      <span className="oc-op-desc">重启 Gateway 服务</span>
                    </div>
                  </button>
                  <button
                    className="oc-op-card red"
                    onClick={() => setConfirmAction({ action: 'uninstall', label: '卸载 OpenClaw' })}
                    disabled={loading}
                  >
                    {MI('delete_forever', 'oc-op-icon')}
                    <div className="oc-op-info">
                      <span className="oc-op-label">卸载</span>
                      <span className="oc-op-desc">完全移除 OpenClaw</span>
                    </div>
                  </button>
                </div>
              </div>

              <div className="oc-ops-section">
                <h4>系统信息</h4>
                <div className="oc-info-grid">
                  <div className="oc-info-item">
                    <span className="oc-info-label">网关端口</span>
                    <span className="oc-info-value">18789</span>
                  </div>
                  <div className="oc-info-item">
                    <span className="oc-info-label">版本</span>
                    <span className="oc-info-value">{status?.version || '--'}</span>
                  </div>
                  <div className="oc-info-item">
                    <span className="oc-info-label">运行状态</span>
                    <span className={`oc-info-value ${status?.running ? 'ok' : 'err'}`}>
                      {status?.running ? '正常' : '停止'}
                    </span>
                  </div>
                  <div className="oc-info-item">
                    <span className="oc-info-label">飞书</span>
                    <span className={`oc-info-value ${status?.feishuConnected ? 'ok' : ''}`}>
                      {status?.feishuConnected ? '已连接' : '未连接'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Output Terminal */}
            {(output || loading) && (
              <div className="oc-terminal">
                <div className="oc-terminal-header">
                  <div className="oc-terminal-dots">
                    <span /><span /><span />
                  </div>
                  <span className="oc-terminal-title">
                    {loading ? '执行中...' : '执行输出'}
                  </span>
                  <button className="oc-terminal-clear" onClick={() => setOutput('')}>
                    {MI('close')}
                  </button>
                </div>
                <pre className="oc-terminal-body">
                  {output}
                  {loading && <span className="oc-terminal-cursor">|</span>}
                  <div ref={outputEndRef} />
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Confirm Dialog ─── */}
      {confirmAction && (
        <div className="oc-overlay" onClick={() => setConfirmAction(null)}>
          <div className="oc-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="oc-dialog-icon warn">
              {MI('warning')}
            </div>
            <h3>确认{confirmAction.label}</h3>
            <p>此操作将完全移除 OpenClaw 及其所有配置数据，且无法撤销。确定要继续吗？</p>
            <div className="oc-dialog-actions">
              <button className="oc-btn secondary" onClick={() => setConfirmAction(null)}>
                取消
              </button>
              <button
                className="oc-btn danger"
                onClick={() => runAction(confirmAction.action)}
                disabled={loading}
              >
                {loading ? '执行中...' : `确认${confirmAction.label}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
