import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';
import { renderMarkdown } from './MarkdownRenderer';
import { resolveSocketUrl } from '../utils/socket';
import io from 'socket.io-client';

/* ═══════════════════════════════════════════
   Types
   ═══════════════════════════════════════════ */

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
  allProviders?: Record<string, any>;
}

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

type MainTab = 'chat' | 'config' | 'ops';
type ConfigTab = 'model' | 'feishu' | 'skills';

/* ═══════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════ */

const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string; api: string; models: string[] }> = {
  anthropic: { label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', api: 'anthropic-messages', models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022'] },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', api: 'openai-chat', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'] },
  google: { label: 'Google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', api: 'google-genai', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', api: 'openai-chat', models: ['deepseek-chat', 'deepseek-reasoner'] },
  qwen: { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai-chat', models: ['qwen3-plus', 'qwen3-max'] },
  zhipu: { label: '智谱 AI', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-chat', models: ['glm-4-plus', 'glm-4-flash'] },
  moonshot: { label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-chat', models: ['moonshot-v1-8k', 'moonshot-v1-32k'] },
};

const API_TYPE_OPTIONS = [
  { value: 'openai-chat', label: 'OpenAI Chat' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-genai', label: 'Google GenAI' },
];

const QUICK_PROMPTS = [
  { icon: 'health_and_safety', label: '网关健康检查', prompt: '请先检查当前网关状态并给出一条结论', color: 'green' },
  { icon: 'widgets', label: '能力总览', prompt: '帮我总结当前设备可用的 OpenClaw 能力', color: 'blue' },
  { icon: 'checklist', label: '设备巡检', prompt: '我现在要做一个设备健康巡检，给我步骤', color: 'purple' },
  { icon: 'build', label: '诊断修复', prompt: '帮我诊断为什么会连接失败，并给修复命令', color: 'orange' },
];

const SKILL_CATALOG = [
  { id: 'rdk-x5-ai-detect', name: 'AI 推理检测', emoji: '🧠', desc: 'BPU 加速 YOLO/分类/分割/ASR/端侧 LLM' },
  { id: 'rdk-x5-system', name: '系统管理', emoji: '🖥️', desc: '备份、OTA、温度、CPU 频率、systemd' },
  { id: 'rdk-x5-monitor', name: '硬件监控', emoji: '📊', desc: 'CPU/BPU/内存/温度实时监控' },
  { id: 'rdk-x5-network', name: '网络配置', emoji: '🌐', desc: 'WiFi、以太网、DNS、防火墙管理' },
  { id: 'rdk-x5-camera', name: '摄像头', emoji: '📸', desc: '摄像头采集、预览、图片保存' },
  { id: 'rdk-x5-media', name: '多媒体', emoji: '🎬', desc: '音视频编解码与播放' },
  { id: 'rdk-x5-gpio', name: 'GPIO', emoji: '⚡', desc: 'GPIO 引脚控制与状态读取' },
  { id: 'rdk-x5-tros', name: 'TROS', emoji: '🤖', desc: 'TogetherROS 话题/节点/启动' },
  { id: 'rdk-x5-app', name: '应用管理', emoji: '📦', desc: '容器与应用部署管理' },
  { id: 'rdk-x5-quickstart', name: '快速入门', emoji: '🚀', desc: '新手引导与示例运行' },
];

const PLUGIN_CATALOG = [
  { id: 'feishu', name: '飞书', emoji: '💬', type: 'channel', desc: '飞书消息通道，接收和发送消息' },
  { id: 'skillhub', name: 'SkillHub', emoji: '🏪', type: 'skill', desc: 'Skill 市场，安装和管理技能' },
  { id: 'memory', name: '对话记忆', emoji: '🧠', type: 'memory', desc: '长期对话记忆与上下文管理' },
  { id: 'web_search', name: '网络搜索', emoji: '🔍', type: 'plugin', desc: '联网搜索实时信息' },
];

/* ═══════════════════════════════════════════
   Component
   ═══════════════════════════════════════════ */

export default function OpenClaw() {
  const { currentDevice, addToast } = useAppState();

  // ─── Tab State ───
  const [mainTab, setMainTab] = useState<MainTab>('chat');
  const [configTab, setConfigTab] = useState<ConfigTab>('model');

  // ─── Data State ───
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);

  // ─── Chat State ───
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatConnected, setChatConnected] = useState(false);
  const [chatStreaming, setChatStreaming] = useState(false);

  // ─── Model Config State ───
  const [modelConfig, setModelConfig] = useState({
    baseUrl: '',
    apiKey: '',
    api: 'openai-chat',
    modelId: '',
    modelName: '',
  });
  const [selectedPreset, setSelectedPreset] = useState('');
  const [testResult, setTestResult] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  // ─── Feishu Config State ───
  const [feishuConfig, setFeishuConfig] = useState({ appId: '', appSecret: '' });

  // ─── Skills/Plugins State ───
  const [skillPluginsAllowText, setSkillPluginsAllowText] = useState('');
  const [skillInstallName, setSkillInstallName] = useState('');
  const [skillInstalling, setSkillInstalling] = useState(false);

  // ─── Operations State ───
  const [output, setOutput] = useState('');
  const [activeOp, setActiveOp] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: string; label: string } | null>(null);

  // ─── Deploy Wizard State ───
  const [deployProvider, setDeployProvider] = useState('');
  const [deployApiKey, setDeployApiKey] = useState('');
  const [deployModelId, setDeployModelId] = useState('');
  const [deployCustomBaseUrl, setDeployCustomBaseUrl] = useState('');
  const [deployCustomApi, setDeployCustomApi] = useState('openai-chat');
  const [deployRunning, setDeployRunning] = useState(false);
  const [deploySteps, setDeploySteps] = useState<('pending' | 'running' | 'done' | 'error')[]>([]);

  // ─── UI State ───
  const [showModelSelector, setShowModelSelector] = useState(false);

  // ─── Refs ───
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const modelDropdownRef = useRef<HTMLDivElement | null>(null);
  const outputEndRef = useRef<HTMLDivElement | null>(null);

  /* ═══════════════════════════════════════════
     Effects
     ═══════════════════════════════════════════ */

  useEffect(() => {
    if (currentDevice) {
      loadStatus();
      loadConfig();
    }
  }, [currentDevice]);

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

  // Socket.IO connection for chat
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
    socket.on('connect_error', () => {
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

  /* ═══════════════════════════════════════════
     API Functions
     ═══════════════════════════════════════════ */

  const loadStatus = async () => {
    if (!currentDevice) return;
    setStatusLoading(true);
    try {
      const res = await fetch(`/api/devices/${currentDevice.id}/openclaw/status`);
      const data = await res.json();
      setStatus(data);
    } catch { /* silent */ } finally {
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
    } catch { /* silent */ }
  };

  const runAction = async (action: string, body?: any) => {
    if (!currentDevice) return;
    setLoading(true);
    setActiveOp(action);
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
      setActiveOp(null);
      setConfirmAction(null);
    }
  };

  /* ─── Chat Functions ─── */

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

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    dispatchOpenClawMessage(chatInput);
  };

  const handleReconnect = () => {
    if (!currentDevice || !socketRef.current) return;
    setChatConnected(false);
    socketRef.current.emit('openclaw:stop', { deviceId: currentDevice.id });
    socketRef.current.emit('openclaw:start', { deviceId: currentDevice.id });
  };

  const handleStopStream = () => {
    if (!currentDevice || !socketRef.current) return;
    socketRef.current.emit('openclaw:stop', { deviceId: currentDevice.id });
    setChatStreaming(false);
    setTimeout(() => {
      socketRef.current?.emit('openclaw:start', { deviceId: currentDevice.id });
    }, 500);
  };

  /* ─── Config Functions ─── */

  const saveConfig = async () => {
    if (!currentDevice) return;

    const pluginAllowList = skillPluginsAllowText
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (configTab === 'model') {
      if (!modelConfig.baseUrl.trim() || !modelConfig.apiKey.trim()) {
        addToast?.('需要填写 Base URL 和 API Key', 'warning');
        return;
      }
    }
    if (configTab === 'feishu') {
      const hasId = !!feishuConfig.appId.trim();
      const hasSecret = !!feishuConfig.appSecret.trim();
      if ((hasId && !hasSecret) || (!hasId && hasSecret)) {
        addToast?.('飞书配置需要同时填写 App ID 和 App Secret', 'warning');
        return;
      }
      if (!hasId && !hasSecret) {
        addToast?.('飞书配置为空，未提交', 'info');
        return;
      }
    }
    if (configTab === 'skills') {
      const invalid = pluginAllowList.find((id) => !/^[a-zA-Z0-9@/_.-]+$/.test(id));
      if (invalid) {
        addToast?.(`无效插件 ID: ${invalid}`, 'warning');
        return;
      }
    }

    const payload: any = {};
    if (configTab === 'model') payload.modelGateway = modelConfig;
    else if (configTab === 'feishu') payload.feishu = feishuConfig;
    else if (configTab === 'skills') payload.pluginsAllow = pluginAllowList;

    setLoading(true);
    try {
      await fetch(`/api/devices/${currentDevice.id}/openclaw/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: payload }),
      });
      addToast?.('配置已保存，Gateway 已重启', 'success');
      setTimeout(() => { loadConfig(); loadStatus(); }, 1500);
    } catch (err: any) {
      addToast?.(`保存失败: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleProviderPresetChange = (key: string) => {
    setSelectedPreset(key);
    if (key && PROVIDER_PRESETS[key]) {
      const preset = PROVIDER_PRESETS[key];
      setModelConfig((prev) => ({
        ...prev,
        baseUrl: preset.baseUrl,
        api: preset.api,
        modelId: preset.models[0] || prev.modelId,
        modelName: preset.label,
      }));
    }
  };

  const testConnection = async () => {
    if (!currentDevice) return;
    setTestResult('testing');
    try {
      const res = await fetch(`/api/devices/${currentDevice.id}/openclaw/status`);
      const data = await res.json();
      setTestResult(data.running ? 'ok' : 'fail');
      if (data.running) {
        addToast?.('网关连接正常', 'success');
      } else {
        addToast?.('网关未运行，请先启动', 'warning');
      }
    } catch {
      setTestResult('fail');
      addToast?.('连接测试失败', 'error');
    }
    setTimeout(() => setTestResult('idle'), 5000);
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
          config: { modelGateway: { ...modelConfig, modelId } },
        }),
      });
      addToast?.(`已切换到 ${modelId}`, 'success');
      setTimeout(() => { loadConfig(); loadStatus(); }, 1000);
    } catch (err: any) {
      addToast?.(`切换失败: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  /* ─── Deploy Functions ─── */

  const handleOneClickInstall = async () => {
    if (!currentDevice || deployRunning) return;
    if (!deployProvider || !deployApiKey) {
      addToast?.('请选择模型厂商并填写 API Key', 'warning');
      return;
    }

    setDeployRunning(true);
    setDeploySteps(['running', 'pending', 'pending', 'pending']);
    setOutput('');

    const stepActions = ['check', 'prepare', 'install'];
    for (let i = 0; i < stepActions.length; i++) {
      setDeploySteps((prev) => prev.map((s, idx) => idx === i ? 'running' : idx < i ? 'done' : s));
      try {
        const res = await fetch(`/api/devices/${currentDevice.id}/openclaw/${stepActions[i]}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        setOutput((prev) => prev + (data.output || '') + '\n');
        if (!data.ok && stepActions[i] !== 'check') {
          setDeploySteps((prev) => prev.map((s, idx) => idx === i ? 'error' : s));
          setDeployRunning(false);
          addToast?.(`${stepActions[i]} 步骤失败`, 'error');
          return;
        }
        setDeploySteps((prev) => prev.map((s, idx) => idx === i ? 'done' : s));
      } catch (err: any) {
        setDeploySteps((prev) => prev.map((s, idx) => idx === i ? 'error' : s));
        setDeployRunning(false);
        addToast?.(`部署错误: ${err.message}`, 'error');
        return;
      }
    }

    // Step 4: Onboard with config
    setDeploySteps((prev) => prev.map((s, idx) => idx === 3 ? 'running' : s));
    try {
      const isCustom = deployProvider === '__custom__';
      const provider = isCustom ? 'custom-gateway' : deployProvider;
      const modelId = deployModelId || (PROVIDER_PRESETS[deployProvider]?.models[0] || 'default');

      await fetch(`/api/devices/${currentDevice.id}/openclaw/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: deployApiKey, modelId }),
      });
      setDeploySteps((prev) => prev.map((s, idx) => idx === 3 ? 'done' : s));
      addToast?.('部署完成！', 'success');
      setTimeout(() => { loadConfig(); loadStatus(); }, 2000);
    } catch (err: any) {
      setDeploySteps((prev) => prev.map((s, idx) => idx === 3 ? 'error' : s));
      addToast?.(`初始化配置失败: ${err.message}`, 'error');
    } finally {
      setDeployRunning(false);
    }
  };

  /* ─── Skill Functions ─── */

  const handleInstallSkill = async (nameOverride?: string) => {
    const name = nameOverride || skillInstallName.trim();
    if (!currentDevice || !name) return;
    setSkillInstalling(true);
    try {
      const res = await fetch(`/api/devices/${currentDevice.id}/openclaw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installCommand: `export PATH="$HOME/.npm-global/bin:$PATH" && clawhub install ${name} 2>&1 && echo "[Done]"`,
          configureCommand: '',
        }),
      });
      const data = await res.json();
      if (data.output?.includes('[Done]')) {
        addToast?.(`技能 ${name} 安装成功`, 'success');
        if (!nameOverride) setSkillInstallName('');
      } else {
        addToast?.('安装可能未成功，请查看输出', 'warning');
      }
      if (mainTab === 'ops') setOutput(data.output || '');
    } catch (err: any) {
      addToast?.(`安装失败: ${err.message}`, 'error');
    } finally {
      setSkillInstalling(false);
    }
  };

  const togglePluginAllow = (pluginId: string) => {
    setSkillPluginsAllowText((prev) => {
      const list = prev.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (list.includes(pluginId)) {
        return list.filter((id) => id !== pluginId).join('\n');
      }
      return [...list, pluginId].join('\n');
    });
  };

  /* ─── Helpers ─── */

  const getCurrentModel = () => {
    if (!config?.primaryModel) return '未配置';
    const parts = config.primaryModel.split('/');
    return parts.length > 1 ? parts[1] : config.primaryModel;
  };

  const getAvailableModels = () => config?.configuredProviders || [];

  const isPluginEnabled = (id: string) => {
    const list = skillPluginsAllowText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return list.includes(id);
  };

  const getConfigSummary = () => {
    if (!config) return { provider: '未配置', model: '未配置', api: '--', apiKey: '--', feishu: '未配置' };
    const gw = config.modelGateway;
    return {
      provider: gw?.modelName || gw?.baseUrl?.replace(/https?:\/\//, '').split('/')[0] || '未配置',
      model: getCurrentModel(),
      api: gw?.api || '--',
      apiKey: gw?.apiKey ? `${gw.apiKey.slice(0, 6)}...` : '未配置',
      feishu: config.feishu?.appId ? '已配置' : '未配置',
    };
  };

  const MI = (name: string, cls?: string) => (
    <span className={`material-symbols-outlined ${cls || ''}`}>{name}</span>
  );

  /* ═══════════════════════════════════════════
     Render - Empty State
     ═══════════════════════════════════════════ */

  if (!currentDevice) {
    return (
      <div className="config-page page-center">
        <div className="empty-state">
          <div className="empty-state-icon">{MI('hub')}</div>
          <h3 className="empty-state-title">连接设备后管理 OpenClaw</h3>
        </div>
      </div>
    );
  }

  const summary = getConfigSummary();

  /* ═══════════════════════════════════════════
     Render - Main
     ═══════════════════════════════════════════ */

  return (
    <div className="config-page">
      {/* ── Header row ── */}
      <div className="config-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="config-card-icon">{MI('hub')}</span>
          <strong>OpenClaw</strong>
          <span className={`badge ${status?.running ? 'badge-ok' : 'badge-warn'}`}>
            {statusLoading ? '...' : status?.running ? '运行中' : '停止'}
          </span>
          {status?.version && <span className="badge badge-muted">v{status.version}</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div ref={modelDropdownRef} style={{ position: 'relative' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowModelSelector(!showModelSelector)}>
              {getCurrentModel()} {MI('expand_more')}
            </button>
            {showModelSelector && (
              <div className="card" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 50, minWidth: 200, marginTop: 4 }}>
                <div className="section-label">可用模型</div>
                {getAvailableModels().length > 0 ? getAvailableModels().map((m) => (
                  <button key={m.modelId} className={`config-sidebar-item ${config?.primaryModel === `${m.provider}/${m.modelId}` ? 'active' : ''}`} onClick={() => switchModel(m.provider, m.modelId)}>
                    {m.label || m.modelId}
                    {m.hasKey && <span className="badge badge-ok">Key</span>}
                  </button>
                )) : <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '8px 0' }}>暂无模型</p>}
                <div className="divider" />
                <button className="config-sidebar-item" onClick={() => { setMainTab('config'); setConfigTab('model'); setShowModelSelector(false); }}>配置模型</button>
              </div>
            )}
          </div>
          <button className="btn-icon" onClick={loadStatus} title="刷新">{MI('refresh')}</button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <nav className="config-tabs">
        {([['chat', '对话'], ['config', '配置'], ['ops', '运维']] as [MainTab, string][]).map(([id, label]) => (
          <button key={id} className={`config-tab ${mainTab === id ? 'active' : ''}`} onClick={() => setMainTab(id)}>{label}</button>
        ))}
      </nav>

      {/* ════════════ Chat Tab ════════════ */}
      {mainTab === 'chat' && (
        <>
          {/* Status strip */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {[
              { label: '网关', val: status?.running ? '运行中' : '停止', ok: !!status?.running },
              { label: '版本', val: status?.version || '--', ok: true },
              { label: '模型', val: getCurrentModel(), ok: !!config?.primaryModel },
              { label: '飞书', val: status?.feishuConnected ? '已连接' : '未连接', ok: !!status?.feishuConnected },
            ].map((s) => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}>
                <span className={`status-dot ${s.ok ? 'online' : ''}`} />
                <span style={{ color: 'var(--text-muted)' }}>{s.label}</span>
                <strong style={{ color: 'var(--text-primary)' }}>{s.val}</strong>
              </div>
            ))}
            {!status?.running && (
              <button className="btn btn-primary btn-sm" onClick={() => runAction('restart-gateway')} disabled={loading}>启动网关</button>
            )}
          </div>

          {/* Chat area */}
          <div className="config-chat" style={{ flex: 1, minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: '0.75rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className={`status-dot ${chatConnected ? 'online' : ''}`} />
                {chatConnected ? '已连接' : '连接中...'}
              </span>
              <span style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost btn-sm" onClick={handleReconnect} disabled={chatStreaming}>重连</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setChatMessages([]); setChatStreaming(false); }} disabled={chatMessages.length === 0}>清空</button>
              </span>
            </div>

            <div className="config-chat-stream" style={{ flex: 1, overflow: 'auto' }}>
              {chatMessages.length === 0 ? (
                <div className="empty-state" style={{ padding: '40px 20px' }}>
                  <div className="empty-state-icon">{MI('hub')}</div>
                  <strong>OpenClaw Agent 就绪</strong>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 12 }}>
                    {QUICK_PROMPTS.map((item) => (
                      <button key={item.label} className="chip" onClick={() => dispatchOpenClawMessage(item.prompt)} disabled={!chatConnected || chatStreaming}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div key={msg.id} className={`config-chat-msg ${msg.role === 'assistant' ? 'ai' : 'user'}`}>
                    {msg.text ? (
                      msg.role === 'assistant' ? renderMarkdown(msg.text) : msg.text
                    ) : (
                      msg.role === 'assistant' && chatStreaming ? (
                        <span style={{ display: 'flex', gap: 3 }}><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></span>
                      ) : null
                    )}
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {chatMessages.length > 0 && (
              <div style={{ display: 'flex', gap: 4, padding: '6px 12px', borderTop: '1px solid var(--border)', overflowX: 'auto' }}>
                {QUICK_PROMPTS.map((item) => (
                  <button key={item.label} className="chip" onClick={() => dispatchOpenClawMessage(item.prompt)} disabled={!chatConnected || chatStreaming} style={{ flexShrink: 0 }}>
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            <form className="config-chat-input" onSubmit={sendMessage}>
              <input className="input" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder={chatConnected ? '向 OpenClaw Agent 发送...' : '等待连接...'} disabled={!chatConnected} style={{ flex: 1 }} />
              {chatStreaming ? (
                <button type="button" className="btn btn-danger btn-sm" onClick={handleStopStream}>停止</button>
              ) : (
                <button type="submit" className="btn btn-primary btn-sm" disabled={!chatConnected || !chatInput.trim()}>发送</button>
              )}
            </form>
          </div>
        </>
      )}

      {/* ════════════ Config Tab ════════════ */}
      {mainTab === 'config' && (
        <div className="config-split">
          <aside className="config-sidebar">
            {([['model', '模型'], ['feishu', '飞书'], ['skills', '技能']] as [ConfigTab, string][]).map(([id, label]) => (
              <button key={id} className={`config-sidebar-item ${configTab === id ? 'active' : ''}`} onClick={() => setConfigTab(id)}>{label}</button>
            ))}
          </aside>

          <div className="config-detail page-scroll">
            {/* ── Model ── */}
            {configTab === 'model' && (
              <>
                <div className="section-label">当前配置</div>
                <div className="card card-compact" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 0 }}>
                  {[
                    ['厂商', summary.provider],
                    ['模型', summary.model],
                    ['API', summary.api],
                    ['Key', summary.apiKey],
                    ['飞书', summary.feishu],
                  ].map(([k, v]) => (
                    <div key={k} className="config-row">
                      <span className="config-label">{k}</span>
                      <span className="config-value" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{v}</span>
                    </div>
                  ))}
                </div>

                <div className="divider" />
                <div className="section-label">模型网关</div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                  {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => (
                    <button key={key} className={`chip ${selectedPreset === key ? 'active' : ''}`} onClick={() => handleProviderPresetChange(key)}>{preset.label}</button>
                  ))}
                  <button className={`chip ${selectedPreset === '__custom__' ? 'active' : ''}`} onClick={() => setSelectedPreset('__custom__')}>自定义</button>
                </div>

                <div className="config-row">
                  <span className="config-label">Base URL</span>
                  <input className="input" type="text" value={modelConfig.baseUrl} onChange={(e) => setModelConfig({ ...modelConfig, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
                </div>
                <div className="config-row">
                  <span className="config-label">API Key</span>
                  <input className="input" type="password" value={modelConfig.apiKey} onChange={(e) => setModelConfig({ ...modelConfig, apiKey: e.target.value })} placeholder="sk-..." />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                  <div className="config-row">
                    <span className="config-label">API 类型</span>
                    <select className="select" value={modelConfig.api} onChange={(e) => setModelConfig({ ...modelConfig, api: e.target.value })} aria-label="API 类型">
                      {API_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="config-row">
                    <span className="config-label">模型 ID</span>
                    <input className="input" type="text" value={modelConfig.modelId} onChange={(e) => setModelConfig({ ...modelConfig, modelId: e.target.value })} placeholder="gpt-4o" />
                  </div>
                </div>

                <div className="config-actions" style={{ marginTop: 12 }}>
                  <button className="btn btn-primary" onClick={saveConfig} disabled={loading}>{loading ? '保存中...' : '保存'}</button>
                  <button className="btn btn-ghost" onClick={() => { loadConfig(); addToast?.('已加载', 'info'); }}>重新加载</button>
                  <button className="btn btn-ghost" onClick={testConnection} disabled={testResult === 'testing'}>
                    {testResult === 'testing' ? '测试中...' : testResult === 'ok' ? '连接正常' : '测试连接'}
                  </button>
                </div>
              </>
            )}

            {/* ── Feishu ── */}
            {configTab === 'feishu' && (
              <>
                <div className="section-label">飞书机器人</div>
                <div className="config-row">
                  <span className="config-label">App ID</span>
                  <input className="input" type="text" value={feishuConfig.appId} onChange={(e) => setFeishuConfig({ ...feishuConfig, appId: e.target.value })} placeholder="cli_..." />
                </div>
                <div className="config-row">
                  <span className="config-label">App Secret</span>
                  <input className="input" type="password" value={feishuConfig.appSecret} onChange={(e) => setFeishuConfig({ ...feishuConfig, appSecret: e.target.value })} placeholder="..." />
                </div>
                <div className="config-actions" style={{ marginTop: 12 }}>
                  <button className="btn btn-primary" onClick={saveConfig} disabled={loading}>{loading ? '保存中...' : '保存'}</button>
                  <button className="btn btn-ghost" onClick={() => { loadConfig(); addToast?.('已加载', 'info'); }}>重新加载</button>
                </div>
              </>
            )}

            {/* ── Skills ── */}
            {configTab === 'skills' && (
              <>
                <div className="section-label">安装技能</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="input" value={skillInstallName} onChange={(e) => setSkillInstallName(e.target.value)} placeholder="技能名称" onKeyDown={(e) => e.key === 'Enter' && handleInstallSkill()} style={{ flex: 1 }} />
                  <button className="btn btn-primary btn-sm" onClick={() => handleInstallSkill()} disabled={skillInstalling || !skillInstallName.trim()}>{skillInstalling ? '...' : '安装'}</button>
                </div>

                <div className="divider" />
                <div className="section-label">Skills</div>
                <div className="config-grid">
                  {SKILL_CATALOG.map((s) => (
                    <button key={s.id} className="config-card" onClick={() => handleInstallSkill(s.id)} disabled={skillInstalling}>
                      <div className="config-card-head">
                        <span>{s.emoji}</span>
                        <span className="config-card-name">{s.name}</span>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="divider" />
                <div className="section-label">Plugins</div>
                <div className="config-grid">
                  {PLUGIN_CATALOG.map((p) => (
                    <button key={p.id} className={`config-card ${isPluginEnabled(p.id) ? 'selected' : ''}`} onClick={() => togglePluginAllow(p.id)}>
                      <div className="config-card-head">
                        <span>{p.emoji}</span>
                        <span className="config-card-name">{p.name}</span>
                        {isPluginEnabled(p.id) && <span className="badge badge-ok">ON</span>}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="divider" />
                <div className="section-label">plugins.allow</div>
                <textarea className="textarea" value={skillPluginsAllowText} onChange={(e) => setSkillPluginsAllowText(e.target.value)} placeholder={'feishu\nmemory\nweb_search'} rows={4} />
                <div className="config-actions" style={{ marginTop: 8 }}>
                  <button className="btn btn-primary" onClick={saveConfig} disabled={loading}>{loading ? '保存中...' : '保存'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ════════════ Ops Tab ════════════ */}
      {mainTab === 'ops' && (
        <div className="page-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Quick deploy */}
          <div className="card card-compact">
            <div className="section-label">一键安装</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 8 }}>
              <div>
                <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>厂商</span>
                <select className="select" value={deployProvider} onChange={(e) => { setDeployProvider(e.target.value); if (PROVIDER_PRESETS[e.target.value]) setDeployModelId(PROVIDER_PRESETS[e.target.value].models[0]); }} aria-label="厂商" style={{ width: '100%' }}>
                  <option value="">选择...</option>
                  {Object.entries(PROVIDER_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                  <option value="__custom__">自定义</option>
                </select>
              </div>
              <div>
                <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>模型 ID</span>
                <input className="input" type="text" value={deployModelId} onChange={(e) => setDeployModelId(e.target.value)} placeholder="gpt-4o" />
              </div>
              <div>
                <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>API Key</span>
                <input className="input" type="password" value={deployApiKey} onChange={(e) => setDeployApiKey(e.target.value)} placeholder="sk-..." />
              </div>
            </div>
            <button className="btn btn-primary" onClick={handleOneClickInstall} disabled={deployRunning || !deployProvider || !deployApiKey} style={{ width: '100%' }}>
              {deployRunning ? '部署中...' : '开始部署'}
            </button>
            {deploySteps.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: '0.6875rem' }}>
                {['诊断', '依赖', '安装', '配置'].map((label, idx) => (
                  <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {idx > 0 && <span style={{ width: 12, height: 1, background: 'var(--border)', display: 'inline-block' }} />}
                    <span className={`badge ${deploySteps[idx] === 'done' ? 'badge-ok' : deploySteps[idx] === 'running' ? 'badge-accent' : deploySteps[idx] === 'error' ? 'badge-danger' : 'badge-muted'}`}>{label}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Actions grid */}
          <div className="section-label">操作</div>
          <div className="config-grid">
            {([
              { action: 'check', label: '诊断' },
              { action: 'prepare', label: '安装依赖' },
              { action: 'install', label: '安装 OpenClaw' },
              { action: 'upgrade', label: '升级' },
              { action: 'restart-gateway', label: '重启网关' },
            ] as const).map((op) => (
              <button key={op.action} className={`chip ${activeOp === op.action ? 'active' : ''}`} onClick={() => runAction(op.action)} disabled={loading}>{op.label}</button>
            ))}
            <button className="chip" onClick={() => setConfirmAction({ action: 'uninstall', label: '卸载' })} disabled={loading} style={{ color: 'var(--danger)' }}>卸载</button>
          </div>

          {/* System info */}
          <div className="section-label">系统</div>
          <div className="card card-compact">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 0 }}>
              {[
                ['端口', '18789'],
                ['版本', status?.version ? `OpenClaw ${status.version}` : '--'],
                ['状态', status?.running ? '正常' : '停止'],
                ['飞书', status?.feishuConnected ? '已连接' : '未连接'],
              ].map(([k, v]) => (
                <div key={k} className="config-row">
                  <span className="config-label">{k}</span>
                  <span className="config-value mono" style={{ fontSize: '0.75rem' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Terminal output */}
          {(output || loading) && (
            <div className="config-terminal" style={{ maxHeight: 240 }}>
              <pre style={{ margin: 0 }}>{output}{loading && '|'}</pre>
              <div ref={outputEndRef} />
            </div>
          )}
        </div>
      )}

      {/* ── Confirm Dialog ── */}
      {confirmAction && (
        <div className="modal-overlay" onClick={() => setConfirmAction(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><span className="modal-title">确认{confirmAction.label}</span></div>
            <div className="modal-body">此操作不可撤销。确定继续？</div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setConfirmAction(null)}>取消</button>
              <button className="btn btn-danger" onClick={() => runAction(confirmAction.action)} disabled={loading}>{loading ? '执行中...' : '确认'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
