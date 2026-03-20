import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';
import { renderMarkdown } from './MarkdownRenderer';
import io from 'socket.io-client';
import '../styles/openclaw.css';

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
      <div className="oc-container">
        <div className="oc-empty-state">
          <div className="oc-empty-graphic">
            {MI('hub', 'oc-empty-icon')}
          </div>
          <h3>请先连接设备</h3>
          <p>选择一个 RDK 设备后即可管理 OpenClaw AI 网关</p>
        </div>
      </div>
    );
  }

  const summary = getConfigSummary();

  /* ═══════════════════════════════════════════
     Render - Main
     ═══════════════════════════════════════════ */

  return (
    <div className="oc-container">
      {/* ─── Header ─── */}
      <header className="oc-header">
        <div className="oc-header-left">
          <div className="oc-logo">
            <div className="oc-logo-mark">{MI('hub')}</div>
            <span className="oc-logo-text">OpenClaw</span>
          </div>
          <div className={`oc-status-pill ${status?.running ? 'running' : 'stopped'}`}>
            <span className="oc-status-dot" />
            <span>{statusLoading ? '检测中...' : status?.running ? '运行中' : '已停止'}</span>
            {status?.version && <span className="oc-version-tag">v{status.version}</span>}
          </div>
        </div>

        <div className="oc-header-right">
          <div className="oc-model-selector" ref={modelDropdownRef}>
            <button className="oc-model-btn" onClick={() => setShowModelSelector(!showModelSelector)}>
              {MI('smart_toy', 'oc-model-ico')}
              <span className="oc-model-name">{getCurrentModel()}</span>
              {MI('expand_more', `oc-expand-ico ${showModelSelector ? 'rotated' : ''}`)}
            </button>
            {showModelSelector && (
              <div className="oc-model-dropdown">
                <div className="oc-dd-header">可用模型</div>
                {getAvailableModels().length > 0 ? (
                  getAvailableModels().map((m) => (
                    <button
                      key={m.modelId}
                      className={`oc-dd-item ${config?.primaryModel === `${m.provider}/${m.modelId}` ? 'active' : ''}`}
                      onClick={() => switchModel(m.provider, m.modelId)}
                    >
                      <span className="oc-dd-label">{m.label || m.modelId}</span>
                      <span className="oc-dd-meta">
                        {m.hasKey && <span className="oc-tag success">已配置</span>}
                        {config?.primaryModel === `${m.provider}/${m.modelId}` && MI('check_circle', 'oc-check-ico')}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="oc-dd-empty">暂无已配置模型，请先在设置中配置</div>
                )}
                <div className="oc-dd-divider" />
                <button className="oc-dd-item action" onClick={() => { setMainTab('config'); setConfigTab('model'); setShowModelSelector(false); }}>
                  {MI('settings', 'oc-dd-action-ico')}
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

      {/* ─── Tab Navigation ─── */}
      <nav className="oc-tabs">
        {([
          { id: 'chat' as MainTab, icon: 'forum', label: '对话' },
          { id: 'config' as MainTab, icon: 'tune', label: '配置' },
          { id: 'ops' as MainTab, icon: 'terminal', label: '运维' },
        ]).map((tab) => (
          <button
            key={tab.id}
            className={`oc-tab ${mainTab === tab.id ? 'active' : ''}`}
            onClick={() => setMainTab(tab.id)}
          >
            {MI(tab.icon, 'oc-tab-ico')}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* ─── Content ─── */}
      <div className="oc-content">

        {/* ═══════════ Chat Tab ═══════════ */}
        {mainTab === 'chat' && (
          <div className="oc-chat-tab">
            {/* Status Cards */}
            <div className="oc-status-row">
              <div className={`oc-scard ${status?.running ? 'ok' : 'warn'}`}>
                {MI(status?.running ? 'check_circle' : 'error', 'oc-scard-ico')}
                <div className="oc-scard-body">
                  <span className="oc-scard-label">网关状态</span>
                  <span className="oc-scard-value">{status?.running ? '正常运行' : '未运行'}</span>
                </div>
                {!status?.running && (
                  <button className="oc-scard-action" onClick={() => runAction('restart-gateway')} disabled={loading}>
                    启动
                  </button>
                )}
              </div>
              <div className="oc-scard">
                {MI('tag', 'oc-scard-ico')}
                <div className="oc-scard-body">
                  <span className="oc-scard-label">版本</span>
                  <span className="oc-scard-value">{status?.version ? `OpenClaw ${status.version}` : '--'}</span>
                </div>
              </div>
              <div className="oc-scard">
                {MI('smart_toy', 'oc-scard-ico')}
                <div className="oc-scard-body">
                  <span className="oc-scard-label">当前模型</span>
                  <span className="oc-scard-value">{getCurrentModel()}</span>
                </div>
              </div>
              <div className={`oc-scard ${status?.feishuConnected ? 'ok' : ''}`}>
                {MI('chat', 'oc-scard-ico')}
                <div className="oc-scard-body">
                  <span className="oc-scard-label">飞书</span>
                  <span className="oc-scard-value">{status?.feishuConnected ? '已连接' : '未连接'}</span>
                </div>
              </div>
            </div>

            {/* Chat Area */}
            <div className="oc-chat">
              <div className="oc-chat-bar">
                <div className="oc-chat-conn">
                  <span className={`oc-conn-dot ${chatConnected ? 'on' : ''}`} />
                  <span>{chatConnected ? 'Agent 会话已建立' : '等待连接...'}</span>
                </div>
                <div className="oc-chat-actions">
                  <button className="oc-link-btn" onClick={handleReconnect} disabled={!currentDevice || chatStreaming}>
                    {MI('sync', 'oc-link-ico')} 重连
                  </button>
                  <button className="oc-link-btn" onClick={() => { setChatMessages([]); setChatStreaming(false); }} disabled={chatMessages.length === 0 || chatStreaming}>
                    {MI('delete_sweep', 'oc-link-ico')} 清空
                  </button>
                </div>
              </div>

              <div className="oc-chat-messages">
                {chatMessages.length === 0 ? (
                  <div className="oc-welcome">
                    <div className="oc-welcome-icon-wrap">
                      {MI('hub', 'oc-welcome-icon')}
                    </div>
                    <h3>OpenClaw Agent 就绪</h3>
                    <p>通过自然语言与板端 AI Agent 交互，管理设备、执行任务</p>
                    <div className="oc-quick-grid">
                      {QUICK_PROMPTS.map((item) => (
                        <button
                          key={item.label}
                          className={`oc-quick-card ${item.color}`}
                          onClick={() => dispatchOpenClawMessage(item.prompt)}
                          disabled={!chatConnected || chatStreaming}
                        >
                          <div className="oc-quick-ico-wrap">{MI(item.icon, 'oc-quick-ico')}</div>
                          <span className="oc-quick-label">{item.label}</span>
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
                        <div className="oc-msg-meta">
                          <span className="oc-msg-role">{msg.role === 'user' ? '你' : 'OpenClaw'}</span>
                          <span className="oc-msg-time">
                            {new Date(msg.id).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="oc-msg-bubble">
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
                <div className="oc-prompt-bar">
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

              <form className="oc-chat-input" onSubmit={sendMessage}>
                <div className="oc-input-box">
                  {MI('edit', 'oc-input-ico')}
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={chatConnected ? '向 OpenClaw Agent 发送消息...' : '等待连接 OpenClaw...'}
                    disabled={!chatConnected}
                  />
                </div>
                {chatStreaming ? (
                  <button type="button" className="oc-stop-btn" onClick={handleStopStream} title="停止生成">
                    {MI('stop_circle')}
                  </button>
                ) : (
                  <button type="submit" className="oc-send-btn" disabled={!chatConnected || !chatInput.trim()}>
                    {MI('send')}
                  </button>
                )}
              </form>
            </div>
          </div>
        )}

        {/* ═══════════ Config Tab ═══════════ */}
        {mainTab === 'config' && (
          <div className="oc-config-tab">
            <aside className="oc-config-nav">
              {([
                { id: 'model' as ConfigTab, icon: 'smart_toy', label: '模型配置' },
                { id: 'feishu' as ConfigTab, icon: 'chat', label: '飞书配置' },
                { id: 'skills' as ConfigTab, icon: 'extension', label: '技能插件' },
              ]).map((item) => (
                <button
                  key={item.id}
                  className={`oc-cnav-item ${configTab === item.id ? 'active' : ''}`}
                  onClick={() => setConfigTab(item.id)}
                >
                  {MI(item.icon, 'oc-cnav-ico')}
                  <span>{item.label}</span>
                </button>
              ))}
            </aside>

            <div className="oc-config-body">
              {/* ─── Model Config ─── */}
              {configTab === 'model' && (
                <div className="oc-config-panel">
                  {/* Config Summary */}
                  <div className="oc-summary-card">
                    <div className="oc-summary-title">{MI('dashboard', 'oc-summary-ico')} 当前运行配置</div>
                    <div className="oc-summary-grid">
                      <div className="oc-summary-item">
                        <span className="oc-summary-label">模型厂商</span>
                        <span className={`oc-summary-value ${summary.provider === '未配置' ? 'unconfigured' : ''}`}>{summary.provider}</span>
                      </div>
                      <div className="oc-summary-item">
                        <span className="oc-summary-label">当前模型</span>
                        <span className={`oc-summary-value ${summary.model === '未配置' ? 'unconfigured' : ''}`}>{summary.model}</span>
                      </div>
                      <div className="oc-summary-item">
                        <span className="oc-summary-label">API 类型</span>
                        <span className="oc-summary-value">{summary.api}</span>
                      </div>
                      <div className="oc-summary-item">
                        <span className="oc-summary-label">API Key</span>
                        <span className={`oc-summary-value ${summary.apiKey === '未配置' ? 'unconfigured' : ''}`}>{summary.apiKey}</span>
                      </div>
                      <div className="oc-summary-item">
                        <span className="oc-summary-label">飞书</span>
                        <span className={`oc-summary-value ${summary.feishu === '未配置' ? 'unconfigured' : ''}`}>{summary.feishu}</span>
                      </div>
                      <div className="oc-summary-item oc-summary-action">
                        <span className="oc-summary-label">连接测试</span>
                        <button
                          className={`oc-test-btn ${testResult}`}
                          onClick={testConnection}
                          disabled={testResult === 'testing'}
                        >
                          {testResult === 'testing' ? MI('hourglass_top', 'oc-test-ico') :
                           testResult === 'ok' ? MI('check_circle', 'oc-test-ico') :
                           testResult === 'fail' ? MI('error', 'oc-test-ico') :
                           MI('bolt', 'oc-test-ico')}
                          <span>{testResult === 'testing' ? '测试中...' : testResult === 'ok' ? '连接正常' : testResult === 'fail' ? '连接失败' : '测试连接'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <section className="oc-section">
                    <div className="oc-section-hdr">
                      <h3>模型网关配置</h3>
                      <p>配置 AI 模型网关参数，保存后自动重启 Gateway 服务。</p>
                    </div>

                    <div className="oc-form">
                      {/* Provider Preset */}
                      <div className="oc-field">
                        <label>模型厂商 (快速选择)</label>
                        <div className="oc-preset-grid">
                          {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => (
                            <button
                              key={key}
                              className={`oc-preset-btn ${selectedPreset === key ? 'active' : ''}`}
                              onClick={() => handleProviderPresetChange(key)}
                            >
                              {preset.label}
                            </button>
                          ))}
                          <button
                            className={`oc-preset-btn ${selectedPreset === '__custom__' ? 'active' : ''}`}
                            onClick={() => { setSelectedPreset('__custom__'); }}
                          >
                            自定义
                          </button>
                        </div>
                      </div>

                      <div className="oc-field">
                        <label>BASE URL</label>
                        <div className="oc-input-group">
                          {MI('link', 'oc-field-ico')}
                          <input
                            type="text"
                            value={modelConfig.baseUrl}
                            onChange={(e) => setModelConfig({ ...modelConfig, baseUrl: e.target.value })}
                            placeholder="https://api.example.com/v1"
                          />
                        </div>
                      </div>

                      <div className="oc-field">
                        <label>API KEY</label>
                        <div className="oc-input-group">
                          {MI('key', 'oc-field-ico')}
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
                            {API_TYPE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="oc-field">
                          <label>模型 ID</label>
                          <div className="oc-input-group">
                            {MI('model_training', 'oc-field-ico')}
                            <input
                              type="text"
                              value={modelConfig.modelId}
                              onChange={(e) => setModelConfig({ ...modelConfig, modelId: e.target.value })}
                              placeholder="gpt-4o"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="oc-field">
                        <label>模型名称 (显示用)</label>
                        <div className="oc-input-group">
                          {MI('label', 'oc-field-ico')}
                          <input
                            type="text"
                            value={modelConfig.modelName}
                            onChange={(e) => setModelConfig({ ...modelConfig, modelName: e.target.value })}
                            placeholder="My Custom Model"
                          />
                        </div>
                      </div>
                    </div>
                  </section>

                  <div className="oc-form-footer">
                    <button className="oc-btn primary" onClick={saveConfig} disabled={loading}>
                      {loading ? MI('hourglass_top', 'oc-btn-ico') : MI('save', 'oc-btn-ico')}
                      {loading ? '保存中...' : '保存配置'}
                    </button>
                    <button className="oc-btn ghost" onClick={() => { loadConfig(); addToast?.('已重新加载', 'info'); }}>
                      {MI('refresh', 'oc-btn-ico')} 重新加载
                    </button>
                  </div>
                </div>
              )}

              {/* ─── Feishu Config ─── */}
              {configTab === 'feishu' && (
                <div className="oc-config-panel">
                  <section className="oc-section">
                    <div className="oc-section-hdr">
                      <h3>飞书机器人配置</h3>
                      <p>配置飞书应用凭证，用于飞书机器人与 OpenClaw 的消息互通。</p>
                    </div>

                    <div className="oc-guide-card">
                      {MI('info', 'oc-guide-ico')}
                      <div>
                        <strong>配置指南</strong>
                        <p>在飞书开放平台创建应用，获取 App ID 和 App Secret，然后在此处配置。配置后 OpenClaw 可通过飞书接收和发送消息。</p>
                      </div>
                    </div>

                    <div className="oc-form">
                      <div className="oc-field">
                        <label>APP ID</label>
                        <div className="oc-input-group">
                          {MI('badge', 'oc-field-ico')}
                          <input
                            type="text"
                            value={feishuConfig.appId}
                            onChange={(e) => setFeishuConfig({ ...feishuConfig, appId: e.target.value })}
                            placeholder="cli_..."
                          />
                        </div>
                      </div>
                      <div className="oc-field">
                        <label>APP SECRET</label>
                        <div className="oc-input-group">
                          {MI('lock', 'oc-field-ico')}
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

                  <div className="oc-form-footer">
                    <button className="oc-btn primary" onClick={saveConfig} disabled={loading}>
                      {loading ? MI('hourglass_top', 'oc-btn-ico') : MI('save', 'oc-btn-ico')}
                      {loading ? '保存中...' : '保存配置'}
                    </button>
                    <button className="oc-btn ghost" onClick={() => { loadConfig(); addToast?.('已重新加载', 'info'); }}>
                      {MI('refresh', 'oc-btn-ico')} 重新加载
                    </button>
                  </div>
                </div>
              )}

              {/* ─── Skills & Plugins ─── */}
              {configTab === 'skills' && (
                <div className="oc-config-panel">
                  <section className="oc-section">
                    <div className="oc-section-hdr">
                      <h3>技能 / 插件管理</h3>
                      <p>管理 OpenClaw 的 Skills 和 Plugins，控制 AI Agent 可使用的能力。</p>
                    </div>

                    {/* Quick Install */}
                    <div className="oc-skill-install">
                      <div className="oc-skill-install-header">
                        <span>从 ClawHub 安装技能</span>
                        <a href="https://skillhub.tencent.com" target="_blank" rel="noopener noreferrer" className="oc-skill-link">
                          技能市场 →
                        </a>
                      </div>
                      <div className="oc-skill-install-row">
                        <div className="oc-input-group">
                          {MI('download', 'oc-field-ico')}
                          <input
                            type="text"
                            value={skillInstallName}
                            onChange={(e) => setSkillInstallName(e.target.value)}
                            placeholder="输入技能名称，如 rdk-x5-ai-detect"
                            onKeyDown={(e) => e.key === 'Enter' && handleInstallSkill()}
                          />
                        </div>
                        <button className="oc-btn primary compact" onClick={() => handleInstallSkill()} disabled={skillInstalling || !skillInstallName.trim()}>
                          {skillInstalling ? '安装中...' : '安装'}
                        </button>
                      </div>
                    </div>

                    {/* Skill Catalog */}
                    <div className="oc-catalog">
                      <div className="oc-catalog-title">内置 Skills 目录</div>
                      <div className="oc-catalog-grid">
                        {SKILL_CATALOG.map((skill) => (
                          <div key={skill.id} className="oc-catalog-card">
                            <div className="oc-catalog-header">
                              <span className="oc-catalog-emoji">{skill.emoji}</span>
                              <div className="oc-catalog-info">
                                <span className="oc-catalog-name">{skill.name}</span>
                                <span className="oc-catalog-id">{skill.id}</span>
                              </div>
                              <span className="oc-tag green">Skill</span>
                            </div>
                            <p className="oc-catalog-desc">{skill.desc}</p>
                            <button
                              className="oc-btn ghost compact"
                              onClick={() => handleInstallSkill(skill.id)}
                              disabled={skillInstalling}
                            >
                              {skillInstalling ? '...' : '安装'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Plugin Catalog */}
                    <div className="oc-catalog">
                      <div className="oc-catalog-title">插件目录</div>
                      <div className="oc-catalog-grid">
                        {PLUGIN_CATALOG.map((plugin) => (
                          <div key={plugin.id} className={`oc-catalog-card ${isPluginEnabled(plugin.id) ? 'enabled' : ''}`}>
                            <div className="oc-catalog-header">
                              <span className="oc-catalog-emoji">{plugin.emoji}</span>
                              <div className="oc-catalog-info">
                                <span className="oc-catalog-name">{plugin.name}</span>
                                <span className="oc-catalog-id">{plugin.id}</span>
                              </div>
                              {isPluginEnabled(plugin.id) && <span className="oc-tag success">已启用</span>}
                            </div>
                            <p className="oc-catalog-desc">{plugin.desc}</p>
                            <button
                              className={`oc-btn ${isPluginEnabled(plugin.id) ? 'ghost' : 'primary'} compact`}
                              onClick={() => togglePluginAllow(plugin.id)}
                            >
                              {isPluginEnabled(plugin.id) ? '停用' : '启用'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Raw plugins.allow */}
                    <div className="oc-field oc-field-mt">
                      <label>plugins.allow (高级编辑)</label>
                      <textarea
                        className="oc-textarea"
                        value={skillPluginsAllowText}
                        onChange={(e) => setSkillPluginsAllowText(e.target.value)}
                        placeholder={'skillhub\nfeishu\nmemory'}
                        rows={5}
                      />
                    </div>
                  </section>

                  <div className="oc-form-footer">
                    <button className="oc-btn primary" onClick={saveConfig} disabled={loading}>
                      {loading ? MI('hourglass_top', 'oc-btn-ico') : MI('save', 'oc-btn-ico')}
                      {loading ? '保存中...' : '保存配置'}
                    </button>
                    <button className="oc-btn ghost" onClick={() => { loadConfig(); addToast?.('已重新加载', 'info'); }}>
                      {MI('refresh', 'oc-btn-ico')} 重新加载
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════ Operations Tab ═══════════ */}
        {mainTab === 'ops' && (
          <div className="oc-ops-tab">
            <div className="oc-ops-scroll">
              {/* One-Click Deploy */}
              <div className="oc-deploy-wizard">
                <div className="oc-deploy-header">
                  <div>
                    <div className="oc-deploy-badge">一键安装向导</div>
                    <p className="oc-deploy-desc">选择模型厂商、填写 API Key，自动完成环境检测 → 安装依赖 → 安装 OpenClaw → 初始化配置。</p>
                  </div>
                </div>
                <div className="oc-deploy-form">
                  <div className="oc-deploy-field">
                    <label>模型厂商</label>
                    <select value={deployProvider} aria-label="模型厂商" onChange={(e) => {
                      setDeployProvider(e.target.value);
                      if (PROVIDER_PRESETS[e.target.value]) {
                        setDeployModelId(PROVIDER_PRESETS[e.target.value].models[0]);
                      }
                    }}>
                      <option value="">选择厂商...</option>
                      {Object.entries(PROVIDER_PRESETS).map(([key, p]) => (
                        <option key={key} value={key}>{p.label}</option>
                      ))}
                      <option value="__custom__">自定义</option>
                    </select>
                  </div>
                  {deployProvider === '__custom__' && (
                    <>
                      <div className="oc-deploy-field">
                        <label>Base URL</label>
                        <input type="text" value={deployCustomBaseUrl} onChange={(e) => setDeployCustomBaseUrl(e.target.value)} placeholder="https://..." />
                      </div>
                      <div className="oc-deploy-field">
                        <label>API 类型</label>
                        <select value={deployCustomApi} aria-label="API 类型" onChange={(e) => setDeployCustomApi(e.target.value)}>
                          {API_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                    </>
                  )}
                  <div className="oc-deploy-field">
                    <label>模型 ID</label>
                    <input type="text" value={deployModelId} onChange={(e) => setDeployModelId(e.target.value)} placeholder="gpt-4o" />
                  </div>
                  <div className="oc-deploy-field">
                    <label>API Key</label>
                    <input type="password" value={deployApiKey} onChange={(e) => setDeployApiKey(e.target.value)} placeholder="sk-..." />
                  </div>
                  <button
                    className="oc-btn primary"
                    onClick={handleOneClickInstall}
                    disabled={deployRunning || !deployProvider || !deployApiKey}
                  >
                    {deployRunning ? MI('hourglass_top', 'oc-btn-ico') : MI('rocket_launch', 'oc-btn-ico')}
                    {deployRunning ? '部署中...' : '开始部署'}
                  </button>
                </div>

                {/* Deploy Progress */}
                {deploySteps.length > 0 && (
                  <div className="oc-deploy-progress">
                    {['系统诊断', '安装依赖', '安装 OpenClaw', '初始化配置'].map((label, idx) => (
                      <div key={label} className="oc-deploy-step-wrap">
                        {idx > 0 && <div className={`oc-deploy-connector ${deploySteps[idx - 1] === 'done' ? 'done' : deploySteps[idx - 1] === 'error' ? 'error' : ''}`} />}
                        <div className={`oc-deploy-step step-${deploySteps[idx] || 'pending'}`}>
                          <div className="oc-deploy-circle">
                            {deploySteps[idx] === 'running' && MI('hourglass_top', 'oc-deploy-step-ico spinning')}
                            {deploySteps[idx] === 'done' && MI('check', 'oc-deploy-step-ico')}
                            {deploySteps[idx] === 'error' && MI('close', 'oc-deploy-step-ico')}
                            {deploySteps[idx] === 'pending' && <span className="oc-deploy-pending-dot" />}
                          </div>
                          <span className="oc-deploy-step-label">{label}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Service Management */}
              <div className="oc-ops-section">
                <h4>部署管理</h4>
                <div className="oc-ops-grid">
                  {([
                    { action: 'check', icon: 'search', label: '系统诊断', desc: '检测 OpenClaw 运行环境', color: 'blue' },
                    { action: 'prepare', icon: 'inventory_2', label: '安装依赖', desc: '准备运行所需环境', color: 'blue' },
                    { action: 'install', icon: 'download', label: '安装 OpenClaw', desc: '全新安装到设备', color: 'green' },
                    { action: 'upgrade', icon: 'upgrade', label: '升级版本', desc: '升级到最新版本', color: 'blue' },
                  ] as const).map((op) => (
                    <button
                      key={op.action}
                      className={`oc-op-card ${op.color} ${activeOp === op.action ? 'active' : ''}`}
                      onClick={() => runAction(op.action)}
                      disabled={loading}
                    >
                      {MI(op.icon, 'oc-op-ico')}
                      <div className="oc-op-info">
                        <span className="oc-op-label">{op.label}</span>
                        <span className="oc-op-desc">{op.desc}</span>
                      </div>
                      {activeOp === op.action && <span className="oc-op-spinner" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="oc-ops-section">
                <h4>服务管理</h4>
                <div className="oc-ops-grid">
                  <button className="oc-op-card orange" onClick={() => runAction('restart-gateway')} disabled={loading}>
                    {MI('restart_alt', 'oc-op-ico')}
                    <div className="oc-op-info">
                      <span className="oc-op-label">重启网关</span>
                      <span className="oc-op-desc">重启 Gateway 服务</span>
                    </div>
                    {activeOp === 'restart-gateway' && <span className="oc-op-spinner" />}
                  </button>
                  <button className="oc-op-card red" onClick={() => setConfirmAction({ action: 'uninstall', label: '卸载 OpenClaw' })} disabled={loading}>
                    {MI('delete_forever', 'oc-op-ico')}
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

              {/* Terminal Output */}
              {(output || loading) && (
                <div className="oc-terminal">
                  <div className="oc-term-header">
                    <div className="oc-term-dots"><span /><span /><span /></div>
                    <span className="oc-term-title">{loading ? '执行中...' : '执行输出'}</span>
                    <button className="oc-term-close" onClick={() => setOutput('')}>{MI('close')}</button>
                  </div>
                  <pre className="oc-term-body">
                    {output}
                    {loading && <span className="oc-term-cursor">|</span>}
                    <div ref={outputEndRef} />
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── Confirm Dialog ─── */}
      {confirmAction && (
        <div className="oc-overlay" onClick={() => setConfirmAction(null)}>
          <div className="oc-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="oc-dialog-icon warn">{MI('warning')}</div>
            <h3>确认{confirmAction.label}</h3>
            <p>此操作将完全移除 OpenClaw 及其所有配置数据，且无法撤销。确定要继续吗？</p>
            <div className="oc-dialog-btns">
              <button className="oc-btn ghost" onClick={() => setConfirmAction(null)}>取消</button>
              <button className="oc-btn danger" onClick={() => runAction(confirmAction.action)} disabled={loading}>
                {loading ? '执行中...' : `确认${confirmAction.label}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
