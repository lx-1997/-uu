import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';
import { renderMarkdown } from './MarkdownRenderer';
import { resolveSocketUrl, socketIoClientOptions } from '../utils/socket';
import { resolveApiUrl } from '../utils/apiBase';
import {
  subscribeOpenClawDeployJob,
  startOpenClawDeployPoll,
  stopOpenClawDeployPoll,
  deployJobStorageKey as ocDeployJobLsKey,
  fetchOpenClawDeployJob,
} from '../utils/openclawDeployPoll';
import io from 'socket.io-client';

/* ═══════════════════════════════════════════
   Types
   ═══════════════════════════════════════════ */

interface GatewayStatus {
  running: boolean;
  version: string;
  feishuConnected: boolean;
  weixinConnected?: boolean;
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
    connectionMode?: 'websocket' | 'webhook';
    domain?: 'feishu' | 'lark';
    dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
    verificationToken?: string;
    encryptKey?: string;
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

type DeployStepState = 'pending' | 'running' | 'done' | 'error';
type DeployStepName = 'check' | 'prepare' | 'install' | 'config';
interface DeployJob {
  id: string;
  status: 'running' | 'done' | 'error';
  steps: Record<DeployStepName, DeployStepState>;
  output?: string;
  error?: string;
}

type ConfigTab = 'model' | 'feishu' | 'skills';

type SetupStep = 'gateway' | 'model' | 'feishu';
interface SetupStatus {
  gateway: 'ok' | 'warn' | 'error';
  model: 'ok' | 'warn' | 'unconfigured';
  feishu: 'ok' | 'warn' | 'unconfigured';
}

/* ═══════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════ */

interface ProviderPreset {
  label: string;
  group: 'international' | 'china';
  baseUrl: string;
  api: string;
  models: string[];
  keyHint?: string;
  docUrl?: string;
}

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  // International
  anthropic: { label: 'Anthropic', group: 'international', baseUrl: 'https://api.anthropic.com/v1', api: 'anthropic-messages', models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022'], keyHint: 'sk-ant-...' },
  openai: { label: 'OpenAI', group: 'international', baseUrl: 'https://api.openai.com/v1', api: 'openai-completions', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'], keyHint: 'sk-...' },
  google: { label: 'Google Gemini', group: 'international', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', api: 'openai-completions', models: ['gemini-2.5-pro', 'gemini-2.5-flash'], keyHint: 'AIza...' },
  openrouter: { label: 'OpenRouter', group: 'international', baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions', models: ['anthropic/claude-sonnet-4', 'openai/gpt-4o', 'google/gemini-2.5-pro'], keyHint: 'sk-or-...' },
  // China
  bailian: { label: '阿里百炼', group: 'china', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai-completions', models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen3-235b-a22b'], keyHint: 'sk-...', docUrl: 'https://bailian.console.aliyun.com' },
  deepseek: { label: 'DeepSeek', group: 'china', baseUrl: 'https://api.deepseek.com/v1', api: 'openai-completions', models: ['deepseek-chat', 'deepseek-reasoner'], keyHint: 'sk-...' },
  siliconflow: { label: '硅基流动', group: 'china', baseUrl: 'https://api.siliconflow.cn/v1', api: 'openai-completions', models: ['Qwen/Qwen3-235B-A22B', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1'], keyHint: 'sk-...' },
  zhipu: { label: '智谱 AI', group: 'china', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions', models: ['glm-4-plus', 'glm-4-flash', 'glm-4-long'], keyHint: '...' },
  moonshot: { label: 'Moonshot', group: 'china', baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-completions', models: ['moonshot-v1-128k', 'moonshot-v1-32k'], keyHint: 'sk-...' },
  volcengine: { label: '火山引擎', group: 'china', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', api: 'openai-completions', models: ['doubao-1.5-pro-256k', 'doubao-1.5-lite-32k'], keyHint: '...' },
  baichuan: { label: '百川', group: 'china', baseUrl: 'https://api.baichuan-ai.com/v1', api: 'openai-completions', models: ['Baichuan4-Turbo', 'Baichuan4-Air'], keyHint: 'sk-...' },
  minimax: { label: 'MiniMax', group: 'china', baseUrl: 'https://api.minimax.chat/v1', api: 'openai-completions', models: ['MiniMax-Text-01', 'abab6.5s-chat'], keyHint: '...' },
  stepfun: { label: '阶跃星辰', group: 'china', baseUrl: 'https://api.stepfun.com/v1', api: 'openai-completions', models: ['step-2-16k', 'step-1-128k'], keyHint: '...' },
};

const API_TYPE_OPTIONS = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
];

const QUICK_PROMPTS = [
  { label: '网关健康检查', prompt: '请先检查当前网关状态并给出一条结论' },
  { label: '能力总览', prompt: '帮我总结当前设备可用的 OpenClaw 能力' },
  { label: '设备巡检', prompt: '我现在要做一个设备健康巡检，给我步骤' },
  { label: '诊断修复', prompt: '帮我诊断为什么会连接失败，并给修复命令' },
];

type EcoCatalogSkill = {
  id: string;
  name: string;
  description: string;
  category?: string;
  tags?: string[];
};

const PLUGIN_CATALOG = [
  { id: 'feishu', name: '飞书', emoji: '💬' },
  { id: 'weixin', name: '微信', emoji: '📱' },
  { id: 'skillhub', name: 'SkillHub', emoji: '🏪' },
  { id: 'memory', name: '对话记忆', emoji: '🧠' },
  { id: 'web_search', name: '网络搜索', emoji: '🔍' },
];

function skillEmojiByCategory(category?: string) {
  const c = (category || '').toLowerCase();
  if (c.includes('ai')) return '🧠';
  if (c.includes('系统')) return '🖥️';
  if (c.includes('硬件')) return '⚡';
  if (c.includes('机器人')) return '🤖';
  if (c.includes('示例')) return '📦';
  return '🧩';
}

function normalizeSkillIdForMatch(id: string): string {
  return id.startsWith('openclaw.') ? id.split('.').slice(1).join('.') : id;
}

/* ═══════════════════════════════════════════
   Component
   ═══════════════════════════════════════════ */

export default function OpenClaw() {
  const { currentDevice, addToast, registerOpenclawSend, activeTab } = useAppState();

  // ─── Data State ───
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);

  // ─── Chat State (persisted per device) ───
  const chatStorageKey = currentDevice ? `oc-chat-${currentDevice.id}` : '';
  const [chatMessages, setChatMessagesRaw] = useState<ChatMessage[]>(() => {
    if (!chatStorageKey) return [];
    try {
      const saved = sessionStorage.getItem(chatStorageKey);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const setChatMessages: typeof setChatMessagesRaw = (update) => {
    setChatMessagesRaw((prev) => {
      const next = typeof update === 'function' ? update(prev) : update;
      if (chatStorageKey) {
        try { sessionStorage.setItem(chatStorageKey, JSON.stringify(next.slice(-200))); } catch { /* quota */ }
      }
      return next;
    });
  };
  const [chatConnected, setChatConnected] = useState(false);
  const [chatStreaming, setChatStreaming] = useState(false);

  // ─── Model Config State ───
  const [modelConfig, setModelConfig] = useState({
    baseUrl: '',
    apiKey: '',
    api: 'openai-completions',
    modelId: '',
    modelName: '',
  });
  const [selectedPreset, setSelectedPreset] = useState('');
  const [testResult, setTestResult] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  // ─── Feishu Config State ───
  const [feishuConfig, setFeishuConfig] = useState({
    appId: '',
    appSecret: '',
    connectionMode: 'websocket' as 'websocket' | 'webhook',
    domain: 'feishu' as 'feishu' | 'lark',
    dmPolicy: 'pairing' as 'pairing' | 'allowlist' | 'open' | 'disabled',
    verificationToken: '',
    encryptKey: '',
  });
  const [pairingChannel, setPairingChannel] = useState('feishu');
  const [pairingCode, setPairingCode] = useState('');

  // ─── WeChat Config State (moved to SettingsPanel) ───

  // ─── Skills/Plugins State ───
  const [skillPluginsAllowText, setSkillPluginsAllowText] = useState('');
  const [skillInstallName, setSkillInstallName] = useState('');
  const [skillInstalling, setSkillInstalling] = useState(false);
  const [boardSkills, setBoardSkills] = useState<string[]>([]);
  const [boardPlugins, setBoardPlugins] = useState<string[]>([]);
  const [ecoSkillCatalog, setEcoSkillCatalog] = useState<EcoCatalogSkill[]>([]);

  // ─── Operations State ───
  const [activeOp, setActiveOp] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: string; label: string } | null>(null);

  // ─── Deploy Wizard State ───
  const [deployProvider, setDeployProvider] = useState('');
  const [deployBaseUrl, setDeployBaseUrl] = useState('');
  const [deployApiKey, setDeployApiKey] = useState('');
  const [deployModelId, setDeployModelId] = useState('');
  const [deployApi, setDeployApi] = useState('openai-completions');
  const [deployFeishuAppId, setDeployFeishuAppId] = useState('');
  const [deployFeishuAppSecret, setDeployFeishuAppSecret] = useState('');
  const [deployRunning, setDeployRunning] = useState(false);
  const [deploySteps, setDeploySteps] = useState<DeployStepState[]>([]);
  const [deployJobId, setDeployJobId] = useState('');
  const [deployOutput, setDeployOutput] = useState('');
  const [showDeployGuideModal, setShowDeployGuideModal] = useState(false);

  // ─── Post-install Guide State ───
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [setupStep, setSetupStep] = useState<SetupStep>('gateway');

  // ─── UI State ───
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [accordion, setAccordion] = useState<ConfigTab | 'deploy' | 'ops' | 'pairing' | null>(null);
  const [configTab, setConfigTab] = useState<ConfigTab>('model');

  // ─── Refs ───
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const modelDropdownRef = useRef<HTMLDivElement | null>(null);
  const messageIdRef = useRef(0);
  const ocDeployLsKey = currentDevice ? ocDeployJobLsKey(currentDevice.id) : '';
  const ocDeployGuideModalKey = currentDevice ? `oc-deploy-guide-modal-${currentDevice.id}` : '';
  const applyDeployJobRef = useRef<(job: DeployJob) => void>(() => {});
  const nextChatMessageId = useCallback(() => {
    const now = Date.now();
    if (now <= messageIdRef.current) {
      messageIdRef.current += 1;
    } else {
      messageIdRef.current = now;
    }
    return messageIdRef.current;
  }, []);
  const applyDeployJob = (job: DeployJob) => {
    const stepOrder: DeployStepName[] = ['check', 'prepare', 'install', 'config'];
    setDeploySteps(stepOrder.map((name) => job.steps?.[name] || 'pending'));
    setDeployOutput(job.output || '');
    if (job.status === 'running') {
      setDeployRunning(true);
      return;
    }
    setDeployRunning(false);
    stopOpenClawDeployPoll();
    if (ocDeployLsKey) localStorage.removeItem(ocDeployLsKey);
    if (job.status === 'done') {
      appendSystemMessage('**部署完成！** 模型配置已写入，Gateway 正在重启...');
      setTimeout(async () => {
        await loadConfig();
        await loadStatus();
        if (deployFeishuAppId.trim() && deployFeishuAppSecret.trim()) {
          appendSystemMessage('正在写入飞书配置...');
          try {
            await fetch(resolveApiUrl(`/api/devices/${currentDevice?.id}/openclaw/config`), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                config: {
                  feishu: {
                    appId: deployFeishuAppId.trim(),
                    appSecret: deployFeishuAppSecret.trim(),
                    connectionMode: 'websocket',
                    domain: 'feishu',
                    dmPolicy: 'pairing',
                  },
                },
              }),
            });
            appendSystemMessage('**飞书配置已写入！** Gateway 已重启。');
            addToast?.('飞书配置已保存', 'success');
            setTimeout(() => { loadConfig(); loadStatus(); }, 1500);
          } catch {
            appendSystemMessage('飞书配置写入失败，请在控制面板中手动配置。');
          }
        }
        setShowSetupGuide(true);
        setSetupStep('gateway');
        setPanelOpen(true);
      }, 1200);
      return;
    }
    const err = job.error || '部署失败，请查看日志输出';
    appendSystemMessage(`**部署失败：** ${err}`);
    if (job.output?.trim()) {
      appendSystemMessage(`\`>>> deploy\`\n\n\`\`\`\n${job.output.slice(-4000)}\n\`\`\``);
    }
  };
  const stopDeployPolling = () => {
    stopOpenClawDeployPoll();
  };
  const beginDeployPolling = (jobId: string) => {
    if (!currentDevice) return;
    stopOpenClawDeployPoll();
    setDeployJobId(jobId);
    if (ocDeployLsKey) localStorage.setItem(ocDeployLsKey, jobId);
    startOpenClawDeployPoll(currentDevice.id, jobId);
  };

  /* ═══════════════════════════════════════════
     Effects
     ═══════════════════════════════════════════ */

  useEffect(() => {
    if (currentDevice) {
      try {
        const saved = sessionStorage.getItem(`oc-chat-${currentDevice.id}`);
        if (saved) setChatMessagesRaw(JSON.parse(saved));
        else setChatMessagesRaw([]);
      } catch { setChatMessagesRaw([]); }
    }
  }, [currentDevice]);

  useEffect(() => {
    if (currentDevice && activeTab === 'openclaw') {
      void Promise.all([loadStatus(), loadConfig(), loadBoardSkills(), loadEcoSkillCatalog()]);
    }
  }, [currentDevice, activeTab]);

  useEffect(() => {
    if (!currentDevice || activeTab !== 'openclaw') return;
    if (status?.running) {
      setShowDeployGuideModal(false);
      if (ocDeployGuideModalKey) {
        try { localStorage.removeItem(ocDeployGuideModalKey); } catch { /* ignore */ }
      }
      return;
    }
    let saved = '';
    if (ocDeployGuideModalKey) {
      try { saved = localStorage.getItem(ocDeployGuideModalKey) || ''; } catch { saved = ''; }
    }
    if (saved !== 'dismissed') {
      setShowDeployGuideModal(true);
    }
  }, [activeTab, currentDevice, ocDeployGuideModalKey, status?.running]);

  useEffect(() => {
    if (!ocDeployGuideModalKey) return;
    if (showDeployGuideModal) {
      try { localStorage.setItem(ocDeployGuideModalKey, 'open'); } catch { /* ignore */ }
    }
  }, [ocDeployGuideModalKey, showDeployGuideModal]);

  useEffect(() => {
    if (status !== null && config !== null && needsSetup()) {
      setShowSetupGuide(true);
      if (!status.running) {
        setSetupStep('gateway');
      } else if (!config.modelGateway?.baseUrl || !config.modelGateway?.apiKey) {
        setSetupStep('model');
      } else {
        setSetupStep('feishu');
      }
    }
  }, [status, config]);

  applyDeployJobRef.current = applyDeployJob;

  useEffect(() => {
    if (!currentDevice) return;
    const unsub = subscribeOpenClawDeployJob((job) => {
      if (job.deviceId !== currentDevice.id) return;
      applyDeployJobRef.current(job as DeployJob);
    });
    return unsub;
  }, [currentDevice?.id]);

  useEffect(() => {
    if (!currentDevice) return;
    const jid = localStorage.getItem(ocDeployJobLsKey(currentDevice.id));
    if (!jid) return;
    void fetchOpenClawDeployJob(currentDevice.id, jid).then((j) => {
      if (j) applyDeployJobRef.current(j as DeployJob);
    });
  }, [currentDevice?.id]);

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

    const socket = io(resolveSocketUrl(), socketIoClientOptions);
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
        id: nextChatMessageId(),
        role: 'assistant',
        text: `**错误：** ${data.error}`,
      }]);
      addToast?.(data.error || 'OpenClaw 对话异常', 'error');
    });
    socket.on('openclaw:disconnected', () => { setChatConnected(false); setChatStreaming(false); });
    socket.on('disconnect', () => { setChatConnected(false); setChatStreaming(false); });
    socket.on('connect_error', () => { setChatConnected(false); setChatStreaming(false); });

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

  

  /* ═══════════════════════════════════════════
     API Functions
     ═══════════════════════════════════════════ */

  const loadStatus = async (): Promise<GatewayStatus | null> => {
    if (!currentDevice) return null;
    setStatusLoading(true);
    try {
      const res = await fetch(resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw/status`));
      if (!res.ok) {
        addToast?.(`获取状态失败: HTTP ${res.status}`, 'error');
        return null;
      }
      const data = await res.json();
      setStatus(data);
      return data;
    } catch (e: any) {
      addToast?.(`获取状态失败: ${e?.message || '网络错误'}`, 'error');
      return null;
    } finally {
      setStatusLoading(false);
    }
  };

  const loadStatusWithRetry = async (times = 5, intervalMs = 2000) => {
    if (!currentDevice) return;
    for (let i = 0; i < times; i += 1) {
      await loadStatus();
      if (i < times - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  };

  const loadConfig = async (): Promise<ConfigData | null> => {
    if (!currentDevice) return null;
    try {
      const res = await fetch(resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw/config`));
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        addToast?.(`加载配置失败: ${errBody.error || `HTTP ${res.status}`}`, 'error');
        return null;
      }
      const data = await res.json();
      setConfig(data);
      if (data.modelGateway) setModelConfig(data.modelGateway);
      if (data.feishu) {
        setFeishuConfig((prev) => ({
          ...prev,
          ...data.feishu,
          connectionMode: data.feishu.connectionMode || prev.connectionMode,
          domain: data.feishu.domain || prev.domain,
          dmPolicy: data.feishu.dmPolicy || prev.dmPolicy,
          verificationToken: data.feishu.verificationToken || '',
          encryptKey: data.feishu.encryptKey || '',
        }));
      }
      if (Array.isArray(data.pluginsAllow)) setSkillPluginsAllowText(data.pluginsAllow.join('\n'));
      return data;
    } catch (e: any) {
      addToast?.(`加载配置失败: ${e?.message || '网络错误'}`, 'error');
      return null;
    }
  };

  /* WeChat functions moved to SettingsPanel */

  const appendSystemMessage = (text: string) => {
    setChatMessages((prev) => [...prev, { id: nextChatMessageId(), role: 'assistant', text }]);
  };

  const SLOW_ACTIONS = new Set(['install', 'upgrade', 'uninstall', 'prepare', 'check', 'doctor']);

  const updateLastAssistant = (text: string) => {
    setChatMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant') return [...prev.slice(0, -1), { ...last, text }];
      return prev;
    });
  };

  const runAction = async (action: string, body?: any) => {
    if (!currentDevice) return;
    setLoading(true);
    setActiveOp(action);

    const isSlow = SLOW_ACTIONS.has(action);
    const startTime = Date.now();
    appendSystemMessage(`\`>>> ${action}\`\n\n执行中...`);

    let progressTimer: ReturnType<typeof setInterval> | null = null;
    if (isSlow) {
      progressTimer = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        updateLastAssistant(`\`>>> ${action}\`\n\n执行中... (${elapsed}s)\n\n_${action === 'install' || action === 'upgrade' ? '安装/升级可能需要几分钟，请耐心等待' : '正在通过 SSH 执行命令'}_`);
      }, 5000);
    }

    const controller = new AbortController();
    const fetchTimeout = isSlow ? 600000 : 120000;
    const fetchTimer = setTimeout(() => controller.abort(), fetchTimeout);

    try {
      const res = await fetch(resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw/${action}`), {
        method: action === 'status' || action === 'version' ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(fetchTimer);
      if (progressTimer) clearInterval(progressTimer);
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      const rawText = await res.text();
      let data: any;
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        updateLastAssistant(`\`>>> ${action}\` _(${elapsed}s)_\n\n\`\`\`\n${rawText || '(空响应)'}\n\`\`\``);
        addToast?.('操作完成，但响应格式异常', 'warning');
        return;
      }

      if (!res.ok) {
        const errMsg = data.error || data.message || `HTTP ${res.status}`;
        updateLastAssistant(`\`>>> ${action}\` _(${elapsed}s)_\n\n**错误：** ${errMsg}`);
        addToast?.(errMsg, 'error');
      } else {
        const output = data.output?.trim() || JSON.stringify(data, null, 2);
        updateLastAssistant(`\`>>> ${action}\` _(${elapsed}s)_\n\n\`\`\`\n${output}\n\`\`\``);
        if (action === 'install' || action === 'uninstall' || action === 'restart-gateway' || action === 'upgrade') {
          setTimeout(() => { void loadStatusWithRetry(action === 'restart-gateway' ? 7 : 4, 2000); }, 1000);
        }
        if (data.ok) addToast?.('操作成功', 'success');
      }
    } catch (err: any) {
      clearTimeout(fetchTimer);
      if (progressTimer) clearInterval(progressTimer);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const msg = err.name === 'AbortError'
        ? `操作超时 (${Math.round(fetchTimeout / 1000)}s)，命令可能仍在板端运行`
        : err.message;
      updateLastAssistant(`\`>>> ${action}\` _(${elapsed}s)_\n\n**错误：** ${msg}`);
      addToast?.(msg, 'error');
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
    setChatMessages((prev) => [
      ...prev,
      { id: nextChatMessageId(), role: 'user', text: userText },
      { id: nextChatMessageId(), role: 'assistant', text: '' },
    ]);
    setChatStreaming(true);
    socketRef.current.emit('openclaw:send', { deviceId: currentDevice.id, message: userText });
  }, [currentDevice, chatConnected, chatStreaming, nextChatMessageId]);

  useEffect(() => {
    if (chatConnected && !chatStreaming) {
      registerOpenclawSend((text: string) => dispatchOpenClawMessage(text));
    } else {
      registerOpenclawSend(null);
    }
    return () => registerOpenclawSend(null);
  }, [chatConnected, chatStreaming, registerOpenclawSend, dispatchOpenClawMessage]);

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

  const saveConfig = async (tab?: ConfigTab) => {
    if (!currentDevice) return;
    const activeTab = tab || configTab;

    const pluginAllowList = skillPluginsAllowText
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (activeTab === 'model') {
      if (!modelConfig.baseUrl.trim() || !modelConfig.apiKey.trim()) {
        addToast?.('需要填写 Base URL 和 API Key', 'warning');
        return;
      }
    }
    if (activeTab === 'feishu') {
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
      if (feishuConfig.connectionMode === 'webhook') {
        if (!feishuConfig.verificationToken.trim() || !feishuConfig.encryptKey.trim()) {
          addToast?.('webhook 模式必须同时填写 Verification Token 和 Encrypt Key', 'warning');
          return;
        }
      }
    }
    if (activeTab === 'skills') {
      const invalid = pluginAllowList.find((id) => !/^[a-zA-Z0-9@/_.-]+$/.test(id));
      if (invalid) {
        addToast?.(`无效插件 ID: ${invalid}`, 'warning');
        return;
      }
    }

    const payload: any = {};
    if (activeTab === 'model') payload.modelGateway = modelConfig;
    else if (activeTab === 'feishu') payload.feishu = feishuConfig;
    else if (activeTab === 'skills') payload.pluginsAllow = pluginAllowList;

    setLoading(true);
    try {
      const res = await fetch(resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw/config`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: payload }),
      });
      const result = await res.json();
      if (!res.ok || result.ok === false) {
        addToast?.(`保存失败: ${result.output || result.error || '未知错误'}`, 'error');
      } else {
        addToast?.('配置已保存，Gateway 已重启', 'success');
      }
      setTimeout(() => { loadConfig(); loadStatus(); }, 2000);
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
      const res = await fetch(resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw/model-test`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      const passed = !!data?.ok;
      setTestResult(passed ? 'ok' : 'fail');
      if (passed) {
        addToast?.('模型调用测试通过', 'success');
      } else {
        const output = String(data?.output || '');
        if (Boolean(data?.pairingRequired) || /pairing required/i.test(output)) {
          setAccordion('pairing');
          addToast?.('模型测试失败：需要先通过配对审批（已展开配对面板）', 'warning');
        } else {
          addToast?.(output || '模型调用测试失败', 'warning');
        }
      }
    } catch {
      setTestResult('fail');
      addToast?.('模型调用测试失败', 'error');
    }
    setTimeout(() => setTestResult('idle'), 5000);
  };

  const switchModel = async (provider: string, modelId: string) => {
    if (!currentDevice) return;
    setShowModelSelector(false);
    setLoading(true);
    try {
      const res = await fetch(resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw/config`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { modelGateway: { ...modelConfig, modelId } } }),
      });
      const result = await res.json();
      if (!res.ok || result.ok === false) {
        addToast?.(`切换失败: ${result.output || result.error || '未知错误'}`, 'error');
      } else {
        addToast?.(`已切换到 ${modelId}`, 'success');
      }
      setTimeout(() => { loadConfig(); loadStatus(); }, 2000);
    } catch (err: any) {
      addToast?.(`切换失败: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  /* ─── Deploy Functions ─── */

  const handleOneClickInstall = async () => {
    if (!currentDevice || deployRunning) return;
    if (!deployApiKey || !deployModelId) {
      addToast?.('请填写模型 ID 和 API Key', 'warning');
      return;
    }
    try {
      const preset = PROVIDER_PRESETS[deployProvider];
      const baseUrl = deployBaseUrl || preset?.baseUrl || '';
      const api = deployApi || preset?.api || 'openai-completions';
      setDeployRunning(true);
      setDeploySteps(['running', 'pending', 'pending', 'pending']);
      setDeployOutput('');
      setShowDeployGuideModal(true);
      const res = await fetch(resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw/deploy/start`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: deployProvider || 'custom',
          baseUrl,
          apiKey: deployApiKey,
          modelId: deployModelId,
          api,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.jobId) {
        throw new Error(data?.error || `部署启动失败 (HTTP ${res.status})`);
      }
      beginDeployPolling(data.jobId);
      addToast?.(data.alreadyRunning ? '检测到已有部署任务，已继续跟踪' : '部署已启动，可切换页面后回来查看进度', 'info');
    } catch (err: any) {
      addToast?.(`配置失败: ${err.message}`, 'error');
      setDeployRunning(false);
      stopDeployPolling();
    }
  };

  /* ─── Skill Functions ─── */

  const handleInstallSkill = async (nameOverride?: string) => {
    const name = nameOverride || skillInstallName.trim();
    if (!currentDevice || !name) return;
    setSkillInstalling(true);
    try {
      const res = await fetch(resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw`), {
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
      if (data.output) {
        appendSystemMessage(`\`>>> skill install ${name}\`\n\n\`\`\`\n${data.output}\n\`\`\``);
      }
    } catch (err: any) {
      addToast?.(`安装失败: ${err.message}`, 'error');
    } finally {
      setSkillInstalling(false);
    }
  };

  const loadEcoSkillCatalog = async () => {
    try {
      const res = await fetch(resolveApiUrl('/api/ecosystem/search?source=openclaw_skill&limit=100'));
      if (!res.ok) return;
      const data = await res.json() as { skills?: Array<{ id: string; name: string; description: string; category?: string; tags?: string[] }> };
      const list = (data.skills || []).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        category: s.category,
        tags: s.tags,
      }));
      setEcoSkillCatalog(list);
    } catch {
      setEcoSkillCatalog([]);
    }
  };

  const checkBoardHasSkill = async (skillId: string): Promise<boolean> => {
    if (!currentDevice) return false;
    try {
      const res = await fetch(resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw/skills`));
      if (!res.ok) return false;
      const data = await res.json() as { ok?: boolean; skills?: string[] };
      const skillNames = (data.skills || []).map((s) => s.split('|')[0]);
      const normalized = normalizeSkillIdForMatch(skillId);
      return skillNames.includes(skillId) || skillNames.includes(normalized);
    } catch {
      return false;
    }
  };

  const handleProvisionEcoSkill = async (skillId: string, displayName: string) => {
    if (!currentDevice) {
      addToast?.('请先连接设备', 'warning');
      return;
    }
    setSkillInstalling(true);
    try {
      const res = await fetch(resolveApiUrl(`/api/ecosystem/skills/${encodeURIComponent(skillId)}/provision`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: currentDevice.id }),
      });
      const data = await res.json() as { ok?: boolean; output?: string; message?: string; error?: string };
      const text = (data.output || data.message || data.error || '').trim();
      if (text) {
        appendSystemMessage(`\`>>> provision ${skillId}\`\n\n\`\`\`\n${text}\n\`\`\``);
      }
      if (!res.ok || data.ok === false) {
        addToast?.(`注册失败: ${data.error || data.message || `HTTP ${res.status}`}`, 'warning');
        return;
      }

      let installed = false;
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        installed = await checkBoardHasSkill(skillId);
        if (installed) break;
      }
      await loadBoardSkills();
      if (installed) {
        addToast?.(`技能 ${displayName} 已注册并验证可见`, 'success');
      } else {
        addToast?.(`技能 ${displayName} 已注册，正在等待板端刷新`, 'info');
      }
    } catch (err: any) {
      addToast?.(`注册失败: ${err?.message || '网络错误'}`, 'error');
    } finally {
      setSkillInstalling(false);
    }
  };

  const loadBoardSkills = async () => {
    if (!currentDevice) return;
    try {
      const res = await fetch(resolveApiUrl(`/api/devices/${currentDevice.id}/openclaw/skills`));
      if (!res.ok) {
        addToast?.(`获取技能列表失败: HTTP ${res.status}`, 'error');
        return;
      }
      const data = await res.json();
      if (data.ok) {
        setBoardSkills(data.skills || []);
        setBoardPlugins(data.plugins || []);
      } else {
        addToast?.(`获取技能列表失败: ${data.error || '未知错误'}`, 'error');
      }
    } catch (e: any) {
      addToast?.(`获取技能列表失败: ${e?.message || '网络错误'}`, 'error');
    }
  };

  const togglePluginAllow = (pluginId: string) => {
    setSkillPluginsAllowText((prev) => {
      const list = prev.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (list.includes(pluginId)) return list.filter((id) => id !== pluginId).join('\n');
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

  const getSetupStatus = (): SetupStatus => {
    const gwOk = !!status?.running;
    const modelOk = !!(config?.modelGateway?.baseUrl && config?.modelGateway?.apiKey);
    const feishuOk = !!(config?.feishu?.appId && config?.feishu?.appSecret);
    return {
      gateway: gwOk ? 'ok' : (status === null ? 'warn' : 'error'),
      model: modelOk ? 'ok' : 'unconfigured',
      feishu: feishuOk ? 'ok' : 'unconfigured',
    };
  };

  const getSetupCompletionCount = () => {
    const s = getSetupStatus();
    let done = 0;
    if (s.gateway === 'ok') done++;
    if (s.model === 'ok') done++;
    if (s.feishu === 'ok') done++;
    return done;
  };

  const needsSetup = () => {
    const s = getSetupStatus();
    return s.gateway !== 'ok' || s.model !== 'ok';
  };

  const MI = (name: string, cls?: string) => (
    <span className={`material-symbols-outlined ${cls || ''}`}>{name}</span>
  );

  const toggleAccordion = (key: typeof accordion) => {
    setAccordion((prev) => prev === key ? null : key);
    if (key === 'model' || key === 'feishu' || key === 'skills') {
      setConfigTab(key as ConfigTab);
    }
  };

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
     Render - Accordion Trigger
     ═══════════════════════════════════════════ */

  const AccTrigger = ({ id, icon, label, hint }: { id: typeof accordion; icon: string; label: string; hint?: string }) => (
    <button className={`oc-accordion-trigger ${accordion === id ? 'open' : ''}`} onClick={() => toggleAccordion(id)}>
      <span className="oc-accordion-trigger-left" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {MI(icon)}
        {label}
      </span>
      {accordion !== id && hint && <span className="oc-accordion-summary">{hint}</span>}
      {MI('expand_more')}
    </button>
  );

  /* ═══════════════════════════════════════════
     Render - Right Panel Content
     ═══════════════════════════════════════════ */

  const setupStatus = getSetupStatus();
  const setupDone = getSetupCompletionCount();

  const renderSetupChecklist = () => {
    const items: { key: SetupStep; icon: string; label: string; status: string; statusClass: string; action: () => void; actionLabel: string }[] = [
      {
        key: 'gateway',
        icon: 'dns',
        label: '网关',
        status: setupStatus.gateway === 'ok' ? '运行中' : setupStatus.gateway === 'warn' ? '检测中...' : '未运行',
        statusClass: setupStatus.gateway === 'ok' ? 'badge-ok' : setupStatus.gateway === 'warn' ? 'badge-accent' : 'badge-danger',
        action: () => { toggleAccordion('ops'); },
        actionLabel: setupStatus.gateway === 'ok' ? '查看' : '启动',
      },
      {
        key: 'model',
        icon: 'psychology',
        label: '模型',
        status: setupStatus.model === 'ok' ? getCurrentModel() : '未配置',
        statusClass: setupStatus.model === 'ok' ? 'badge-ok' : 'badge-muted',
        action: () => { toggleAccordion('model'); },
        actionLabel: setupStatus.model === 'ok' ? '修改' : '配置',
      },
      {
        key: 'feishu',
        icon: 'forum',
        label: '飞书',
        status: setupStatus.feishu === 'ok' ? '已配置' : '未配置',
        statusClass: setupStatus.feishu === 'ok' ? 'badge-ok' : 'badge-muted',
        action: () => { toggleAccordion('feishu'); },
        actionLabel: setupStatus.feishu === 'ok' ? '修改' : '配置',
      },
    ];

    return (
      <div className="oc-setup-checklist">
        <div className="oc-setup-checklist-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {MI('checklist', 'oc-setup-icon')}
            <strong style={{ fontSize: '0.75rem' }}>配置状态</strong>
          </span>
          <span className="oc-setup-progress">{setupDone}/3</span>
        </div>
        <div className="oc-setup-checklist-body">
          {items.map((item) => (
            <div key={item.key} className={`oc-setup-item ${setupStep === item.key && showSetupGuide ? 'highlight' : ''}`}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                {MI(item.icon)}
                <span className="oc-setup-item-label">{item.label}</span>
                <span className={`badge ${item.statusClass}`} style={{ fontSize: '0.5625rem' }}>{item.status}</span>
              </span>
              <button className="btn btn-ghost btn-sm" onClick={item.action} style={{ fontSize: '0.625rem', padding: '2px 6px', flexShrink: 0 }}>
                {item.actionLabel}
              </button>
            </div>
          ))}
        </div>
        {showSetupGuide && needsSetup() && (
          <div className="oc-setup-guide-hint">
            {setupStatus.gateway !== 'ok'
              ? '请先启动网关，点击上方「启动」或展开 Gateway 网关面板'
              : setupStatus.model !== 'ok'
              ? '网关已运行，请配置模型以启用 AI 能力'
              : '基础配置已完成！可选配置飞书以接入消息渠道'}
            <button className="btn btn-ghost btn-sm" onClick={() => setShowSetupGuide(false)} style={{ fontSize: '0.5625rem', marginLeft: 'auto' }}>关闭引导</button>
          </div>
        )}
      </div>
    );
  };

  const renderPanel = () => (
    <>
      <div className="oc-panel-header">
        <strong>控制面板</strong>
        <button className="oc-panel-toggle" onClick={() => { setPanelOpen(false); setMobilePanel(false); }} title="收起面板">
          {MI('close')}
        </button>
      </div>

      <div className="oc-panel-body">
        {renderSetupChecklist()}

        {/* ── Operations ── */}
        <div className="oc-accordion">
          <div className="oc-accordion-item">
            <AccTrigger id="ops" icon="terminal" label="Gateway 网关" hint={status?.running ? '运行中' : '停止'} />
            {accordion === 'ops' && (
              <div className="oc-accordion-content">
                <div className="oc-actions-grid">
                  <button className={`chip ${activeOp === 'check' ? 'active' : ''}`} onClick={() => runAction('check')} disabled={loading}>诊断检查</button>
                  <button className={`chip ${activeOp === 'doctor' ? 'active' : ''}`} onClick={() => runAction('doctor')} disabled={loading}>Doctor</button>
                  <button className={`chip ${activeOp === 'restart-gateway' ? 'active' : ''}`} onClick={() => runAction('restart-gateway')} disabled={loading}>重启网关</button>
                  <button className={`chip ${activeOp === 'logs' ? 'active' : ''}`} onClick={() => runAction('logs', { limit: 300 })} disabled={loading}>查看日志</button>
                </div>
                <div className="divider" style={{ margin: '8px 0' }} />
                <div className="oc-actions-grid">
                  <button className={`chip ${activeOp === 'prepare' ? 'active' : ''}`} onClick={() => runAction('prepare')} disabled={loading}>环境准备</button>
                  <button className={`chip ${activeOp === 'install' ? 'active' : ''}`} onClick={() => runAction('install')} disabled={loading}>安装</button>
                  <button className={`chip ${activeOp === 'upgrade' ? 'active' : ''}`} onClick={() => runAction('upgrade')} disabled={loading}>升级</button>
                  <button className="chip" onClick={() => setConfirmAction({ action: 'uninstall', label: '卸载 OpenClaw' })} disabled={loading} style={{ color: 'var(--danger)' }}>卸载</button>
                </div>
              </div>
            )}
          </div>

          {/* ── Deploy ── */}
          <div className="oc-accordion-item">
            <AccTrigger id="deploy" icon="rocket_launch" label="一键部署" hint={deployRunning ? (deployJobId ? `部署中 #${deployJobId.slice(0, 8)}` : '部署中...') : undefined} />
            {accordion === 'deploy' && (
              <div className="oc-accordion-content">
                <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: 4 }}>快速选择（自动填充，填充后可手动修改）</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 8 }}>
                  {Object.entries(PROVIDER_PRESETS).filter(([, p]) => p.group === 'china').map(([k, p]) => (
                    <button key={k} className={`chip ${deployProvider === k ? 'active' : ''}`} onClick={() => { setDeployProvider(k); setDeployBaseUrl(p.baseUrl); setDeployModelId(p.models[0]); setDeployApi(p.api); }} style={{ fontSize: '0.625rem', padding: '2px 7px' }}>{p.label}</button>
                  ))}
                  {Object.entries(PROVIDER_PRESETS).filter(([, p]) => p.group === 'international').map(([k, p]) => (
                    <button key={k} className={`chip ${deployProvider === k ? 'active' : ''}`} onClick={() => { setDeployProvider(k); setDeployBaseUrl(p.baseUrl); setDeployModelId(p.models[0]); setDeployApi(p.api); }} style={{ fontSize: '0.625rem', padding: '2px 7px' }}>{p.label}</button>
                  ))}
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">Base URL</span>
                  <input className="input" type="text" value={deployBaseUrl} onChange={(e) => { setDeployBaseUrl(e.target.value); setDeployProvider(''); }} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">模型 ID</span>
                  <input className="input" type="text" value={deployModelId} onChange={(e) => setDeployModelId(e.target.value)} placeholder="qwen-plus / deepseek-chat / gpt-4o" />
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">API Key</span>
                  <input className="input" type="password" value={deployApiKey} onChange={(e) => setDeployApiKey(e.target.value)} placeholder={deployProvider && PROVIDER_PRESETS[deployProvider]?.keyHint || 'sk-...'} />
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">协议</span>
                  <select className="select" value={deployApi} onChange={(e) => setDeployApi(e.target.value)} aria-label="API 协议">
                    {API_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="divider" style={{ margin: '8px 0' }} />
                <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: 4 }}>飞书配置（可选，部署后自动写入）</div>
                <div className="oc-form-row">
                  <span className="oc-form-label">App ID</span>
                  <input className="input" type="text" value={deployFeishuAppId} onChange={(e) => setDeployFeishuAppId(e.target.value)} placeholder="cli_... (可跳过)" />
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">Secret</span>
                  <input className="input" type="password" value={deployFeishuAppSecret} onChange={(e) => setDeployFeishuAppSecret(e.target.value)} placeholder="飞书 App Secret (可跳过)" />
                </div>
                <button className="btn btn-primary btn-sm" onClick={handleOneClickInstall} disabled={deployRunning || !deployApiKey || !deployModelId} style={{ width: '100%', marginTop: 8 }}>
                  {deployRunning ? '部署中...' : '开始部署'}
                </button>
                {deploySteps.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: '0.625rem' }}>
                    {['诊断', '依赖', '安装', '配置'].map((label, idx) => (
                      <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        {idx > 0 && <span style={{ width: 10, height: 1, background: 'var(--border)', display: 'inline-block' }} />}
                        <span className={`badge ${deploySteps[idx] === 'done' ? 'badge-ok' : deploySteps[idx] === 'running' ? 'badge-accent' : deploySteps[idx] === 'error' ? 'badge-danger' : 'badge-muted'}`}>{label}</span>
                      </span>
                    ))}
                  </div>
                )}
                {(deployRunning || deployOutput) && (
                  <pre className="oc-log" style={{ marginTop: 8, maxHeight: 220, overflow: 'auto' }}>
                    {deployOutput || '部署任务已启动，等待日志输出...'}
                  </pre>
                )}
              </div>
            )}
          </div>

          {/* ── Model Config ── */}
          <div className="oc-accordion-item">
            <AccTrigger id="model" icon="psychology" label="模型" hint={summary.model} />
            {accordion === 'model' && (
              <div className="oc-accordion-content">
                <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: 4 }}>快速选择（自动填充下方字段，填充后仍可手动修改）</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 8 }}>
                  {Object.entries(PROVIDER_PRESETS).filter(([, p]) => p.group === 'china').map(([key, preset]) => (
                    <button key={key} className={`chip ${selectedPreset === key ? 'active' : ''}`} onClick={() => handleProviderPresetChange(key)} style={{ fontSize: '0.625rem', padding: '2px 7px' }}>{preset.label}</button>
                  ))}
                  {Object.entries(PROVIDER_PRESETS).filter(([, p]) => p.group === 'international').map(([key, preset]) => (
                    <button key={key} className={`chip ${selectedPreset === key ? 'active' : ''}`} onClick={() => handleProviderPresetChange(key)} style={{ fontSize: '0.625rem', padding: '2px 7px' }}>{preset.label}</button>
                  ))}
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">Base URL</span>
                  <input className="input" type="text" value={modelConfig.baseUrl} onChange={(e) => { setModelConfig({ ...modelConfig, baseUrl: e.target.value }); setSelectedPreset(''); }} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">模型 ID</span>
                  <input className="input" type="text" value={modelConfig.modelId} onChange={(e) => setModelConfig({ ...modelConfig, modelId: e.target.value })} placeholder="qwen-plus / deepseek-chat / gpt-4o" />
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">API Key</span>
                  <input className="input" type="password" value={modelConfig.apiKey} onChange={(e) => setModelConfig({ ...modelConfig, apiKey: e.target.value })} placeholder={selectedPreset && PROVIDER_PRESETS[selectedPreset]?.keyHint || 'sk-...'} />
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">协议</span>
                  <select className="select" value={modelConfig.api} onChange={(e) => setModelConfig({ ...modelConfig, api: e.target.value })} aria-label="API 协议">
                    {API_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="oc-form-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => saveConfig('model')} disabled={loading}>{loading ? '...' : '保存'}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { loadConfig(); addToast?.('已加载', 'info'); }}>重载</button>
                  <button className="btn btn-ghost btn-sm" onClick={testConnection} disabled={testResult === 'testing'}>
                    {testResult === 'testing' ? '...' : testResult === 'ok' ? '正常' : '测试'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Channels (Feishu + Pairing) ── */}
          <div className="oc-accordion-item">
            <AccTrigger id="feishu" icon="forum" label="消息渠道" hint={summary.feishu} />
            {accordion === 'feishu' && (
              <div className="oc-accordion-content">
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: 6 }}>飞书机器人配置</div>
                <div className="oc-form-row">
                  <span className="oc-form-label">App ID</span>
                  <input className="input" type="text" value={feishuConfig.appId} onChange={(e) => setFeishuConfig({ ...feishuConfig, appId: e.target.value })} placeholder="cli_..." />
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">Secret</span>
                  <input className="input" type="password" value={feishuConfig.appSecret} onChange={(e) => setFeishuConfig({ ...feishuConfig, appSecret: e.target.value })} placeholder="..." />
                </div>
                <div className="oc-form-grid-3">
                  <div className="oc-deploy-field">
                    <label>连接</label>
                    <select className="select" value={feishuConfig.connectionMode} onChange={(e) => setFeishuConfig({ ...feishuConfig, connectionMode: e.target.value as any })} aria-label="连接模式">
                      <option value="websocket">websocket</option>
                      <option value="webhook">webhook</option>
                    </select>
                  </div>
                  <div className="oc-deploy-field">
                    <label>域名</label>
                    <select className="select" value={feishuConfig.domain} onChange={(e) => setFeishuConfig({ ...feishuConfig, domain: e.target.value as any })} aria-label="域名">
                      <option value="feishu">feishu</option>
                      <option value="lark">lark</option>
                    </select>
                  </div>
                  <div className="oc-deploy-field">
                    <label>DM 策略</label>
                    <select className="select" value={feishuConfig.dmPolicy} onChange={(e) => setFeishuConfig({ ...feishuConfig, dmPolicy: e.target.value as any })} aria-label="DM 策略">
                      <option value="pairing">pairing</option>
                      <option value="allowlist">allowlist</option>
                      <option value="open">open</option>
                      <option value="disabled">disabled</option>
                    </select>
                  </div>
                </div>
                {feishuConfig.connectionMode === 'webhook' && (
                  <>
                    <div className="oc-form-row">
                      <span className="oc-form-label">Token</span>
                      <input className="input" type="password" value={feishuConfig.verificationToken} onChange={(e) => setFeishuConfig({ ...feishuConfig, verificationToken: e.target.value })} placeholder="Verification Token" />
                    </div>
                    <div className="oc-form-row">
                      <span className="oc-form-label">Key</span>
                      <input className="input" type="password" value={feishuConfig.encryptKey} onChange={(e) => setFeishuConfig({ ...feishuConfig, encryptKey: e.target.value })} placeholder="Encrypt Key" />
                    </div>
                  </>
                )}
                <div className="oc-form-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => saveConfig('feishu')} disabled={loading}>{loading ? '...' : '保存'}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { loadConfig(); addToast?.('已加载', 'info'); }}>重载</button>
                </div>
                <div className="divider" style={{ margin: '10px 0' }} />
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: 6 }}>配对审批</div>
                <div className="oc-pairing-row">
                  <select className="select" value={pairingChannel} onChange={(e) => setPairingChannel(e.target.value)} aria-label="配对渠道">
                    <option value="feishu">feishu</option>
                    <option value="telegram">telegram</option>
                    <option value="whatsapp">whatsapp</option>
                    <option value="discord">discord</option>
                    <option value="slack">slack</option>
                  </select>
                  <input className="input" type="text" value={pairingCode} onChange={(e) => setPairingCode(e.target.value.toUpperCase())} placeholder="配对码" />
                  <button className="btn btn-primary btn-sm" onClick={() => runAction('pairing/approve', { channel: pairingChannel, code: pairingCode.trim() })} disabled={loading || !pairingCode.trim()}>批准</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => runAction('pairing/reject', { channel: pairingChannel, code: pairingCode.trim() })} disabled={loading || !pairingCode.trim()}>拒绝</button>
                </div>
                <button className={`chip ${activeOp === 'pairing/list' ? 'active' : ''}`} onClick={() => runAction('pairing/list', { channel: pairingChannel })} disabled={loading} style={{ marginTop: 6, fontSize: '0.6875rem' }}>查看待审批列表</button>
              </div>
            )}
          </div>

          {/* ── Skills Config ── */}
          <div className="oc-accordion-item">
            <AccTrigger id="skills" icon="extension" label="技能 / 插件" hint={boardSkills.length > 0 ? `${boardSkills.length} 个技能` : `${skillPluginsAllowText.split('\n').filter(Boolean).length} 个插件`} />
            {accordion === 'skills' && (
              <div className="oc-accordion-content">
                {boardSkills.length > 0 && (
                  <>
                    <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>板端已安装技能</span>
                      <button className="btn btn-ghost btn-sm" onClick={loadBoardSkills} style={{ fontSize: '0.5625rem', padding: '1px 4px' }}>刷新</button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {boardSkills.map((s) => {
                        const parts = s.split('|');
                        const name = parts[0] || s;
                        const desc = (parts[2] || '').replace(/^"|"$/g, '').trim();
                        return (
                          <span key={s} className="chip active" title={desc || s} style={{ fontSize: '0.625rem', padding: '2px 6px', cursor: 'default', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                        );
                      })}
                    </div>
                    <div className="divider" style={{ margin: '6px 0' }} />
                  </>
                )}
                {boardPlugins.length > 0 && (
                  <>
                    <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: 4 }}>板端已启用插件</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
                      {boardPlugins.map((p) => {
                        const name = p.split('|')[0] || p;
                        return (
                          <span key={p} className="chip active" title={p} style={{ fontSize: '0.625rem', padding: '2px 6px', cursor: 'default', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                        );
                      })}
                    </div>
                    <div className="divider" style={{ margin: '6px 0' }} />
                  </>
                )}
                <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: 4 }}>安装技能</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input className="input" value={skillInstallName} onChange={(e) => setSkillInstallName(e.target.value)} placeholder="技能名称" onKeyDown={(e) => e.key === 'Enter' && handleInstallSkill()} style={{ flex: 1, fontSize: '0.75rem', padding: '5px 8px' }} />
                  <button className="btn btn-primary btn-sm" onClick={() => { handleInstallSkill(); setTimeout(loadBoardSkills, 3000); }} disabled={skillInstalling || !skillInstallName.trim()} style={{ fontSize: '0.6875rem' }}>{skillInstalling ? '...' : '安装'}</button>
                </div>
                <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  手动安装会直接执行 `clawhub install`。如需稳定可验证安装，建议使用下方“生态技能（已校验）”。
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
                  {ecoSkillCatalog.length === 0 && (
                    <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)' }}>暂无可用生态技能，请点击刷新。</span>
                  )}
                  {(() => { const boardSkillNames = boardSkills.map((b) => b.split('|')[0]); return ecoSkillCatalog.map((s) => {
                    const normalized = normalizeSkillIdForMatch(s.id);
                    const installed = boardSkillNames.includes(s.id) || boardSkillNames.includes(normalized);
                    return (
                      <button
                        key={s.id}
                        className={`chip ${installed ? 'active' : ''}`}
                        onClick={() => { handleProvisionEcoSkill(s.id, s.name); }}
                        disabled={skillInstalling}
                        title={`${s.id}\n${s.description || ''}`}
                        style={{ fontSize: '0.625rem', padding: '2px 6px' }}
                      >
                        {skillEmojiByCategory(s.category)} {s.name} {installed && '✓'}
                      </button>
                    );
                  }); })()}
                </div>
                <div className="divider" style={{ margin: '8px 0' }} />
                <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: 4 }}>插件开关</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  {PLUGIN_CATALOG.map((p) => (
                    <button key={p.id} className={`chip ${isPluginEnabled(p.id) ? 'active' : ''}`} onClick={() => togglePluginAllow(p.id)} style={{ fontSize: '0.625rem', padding: '2px 6px' }}>
                      {p.emoji} {p.name} {isPluginEnabled(p.id) && '✓'}
                    </button>
                  ))}
                </div>
                <div className="oc-form-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => saveConfig('skills')} disabled={loading}>{loading ? '...' : '保存插件'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      
    </>
  );

  /* ═══════════════════════════════════════════
     Render - Main
     ═══════════════════════════════════════════ */

  return (
    <div className={`oc-layout ${!panelOpen ? 'panel-collapsed' : ''} ${mobilePanel ? 'panel-open-mobile' : ''}`}>
      {showDeployGuideModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <div className="card" style={{ width: 'min(720px, 96vw)', maxHeight: '90vh', overflow: 'auto', padding: 12 }}>
            <div className="config-header">
              <strong>OpenClaw 一键部署引导</strong>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowDeployGuideModal(false);
                  if (ocDeployGuideModalKey) {
                    try { localStorage.setItem(ocDeployGuideModalKey, 'dismissed'); } catch { /* ignore */ }
                  }
                }}
                disabled={deployRunning}
              >
                {deployRunning ? '部署中...' : '稍后配置'}
              </button>
            </div>
            <p className="config-card-desc" style={{ marginTop: 4, marginBottom: 8 }}>
              完成部署后，OpenClaw 会更稳定更智能。安装完成以网关可用为准；若模型测试失败可稍后再修复。
            </p>
            <div className="oc-form-row">
              <span className="oc-form-label">Base URL</span>
              <input className="input" type="text" value={deployBaseUrl} onChange={(e) => { setDeployBaseUrl(e.target.value); setDeployProvider(''); }} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
            </div>
            <div className="oc-form-row">
              <span className="oc-form-label">模型 ID</span>
              <input className="input" type="text" value={deployModelId} onChange={(e) => setDeployModelId(e.target.value)} placeholder="qwen-plus / deepseek-chat / gpt-4o" />
            </div>
            <div className="oc-form-row">
              <span className="oc-form-label">API Key</span>
              <input className="input" type="password" value={deployApiKey} onChange={(e) => setDeployApiKey(e.target.value)} placeholder={deployProvider && PROVIDER_PRESETS[deployProvider]?.keyHint || 'sk-...'} />
            </div>
            <div className="oc-form-row">
              <span className="oc-form-label">协议</span>
              <select className="select" value={deployApi} onChange={(e) => setDeployApi(e.target.value)} aria-label="API 协议">
                {API_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleOneClickInstall} disabled={deployRunning || !deployApiKey || !deployModelId} style={{ width: '100%', marginTop: 8 }}>
              {deployRunning ? '部署中...' : '开始部署'}
            </button>
            {deploySteps.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: '0.625rem' }}>
                {['诊断', '依赖', '安装', '配置'].map((label, idx) => (
                  <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {idx > 0 && <span style={{ width: 10, height: 1, background: 'var(--border)', display: 'inline-block' }} />}
                    <span className={`badge ${deploySteps[idx] === 'done' ? 'badge-ok' : deploySteps[idx] === 'running' ? 'badge-accent' : deploySteps[idx] === 'error' ? 'badge-danger' : 'badge-muted'}`}>{label}</span>
                  </span>
                ))}
              </div>
            )}
            {(deployRunning || deployOutput) && (
              <pre className="oc-log" style={{ marginTop: 8, maxHeight: 260, overflow: 'auto' }}>
                {deployOutput || '部署任务已启动，等待日志输出...'}
              </pre>
            )}
            {!deployRunning && status?.running && (
              <div className="badge badge-ok" style={{ marginTop: 8 }}>网关已可用，安装完成</div>
            )}
          </div>
        </div>
      )}

      {/* ════════════ Left: Chat ════════════ */}
      <div className="oc-main">
        {/* Status bar */}
        <div className="oc-status-bar">
          <div className="oc-status-item">
            <span className={`status-dot ${status?.running ? 'online' : ''}`} />
            <span className="oc-status-label">网关</span>
            <span className="oc-status-value">{statusLoading ? '...' : status?.running ? '运行中' : '停止'}</span>
          </div>
          {status?.version && (
            <div className="oc-status-item">
              <span className="oc-status-label">v</span>
              <span className="oc-status-value">{status.version}</span>
            </div>
          )}
          <div className="oc-status-item" ref={modelDropdownRef} style={{ position: 'relative' }}>
            <span className="oc-status-label">模型</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowModelSelector(!showModelSelector)} style={{ fontSize: '0.75rem', padding: '2px 6px' }}>
              {getCurrentModel()} {MI('expand_more')}
            </button>
            {showModelSelector && (
              <div className="card" style={{ position: 'absolute', left: 0, top: '100%', zIndex: 50, minWidth: 200, marginTop: 4 }}>
                <div className="section-label">可用模型</div>
                {getAvailableModels().length > 0 ? getAvailableModels().map((m) => (
                  <button key={m.modelId} className={`config-sidebar-item ${config?.primaryModel === `${m.provider}/${m.modelId}` ? 'active' : ''}`} onClick={() => switchModel(m.provider, m.modelId)}>
                    {m.label || m.modelId}
                    {m.hasKey && <span className="badge badge-ok" style={{ marginLeft: 'auto' }}>Key</span>}
                  </button>
                )) : <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '8px 12px' }}>暂无模型</p>}
                <div className="divider" />
                <button className="config-sidebar-item" onClick={() => { toggleAccordion('model'); setShowModelSelector(false); setPanelOpen(true); }}>配置模型</button>
              </div>
            )}
          </div>
          <div className="oc-status-item">
            <span className={`status-dot ${status?.feishuConnected ? 'online' : ''}`} />
            <span className="oc-status-label">飞书</span>
            <span className="oc-status-value">{status?.feishuConnected ? '已连接' : '未连接'}</span>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            {!status?.running && (
              <button className="btn btn-primary btn-sm" onClick={() => { runAction('restart-gateway'); setShowSetupGuide(true); }} disabled={loading} style={{ fontSize: '0.6875rem' }}>启动网关</button>
            )}
            <button className="btn-icon" onClick={loadStatus} title="刷新状态">{MI('refresh')}</button>
            {!panelOpen && (
              <button className="btn-icon" onClick={() => setPanelOpen(true)} title="打开面板">{MI('dock_to_left')}</button>
            )}
            <button className="btn-icon oc-mobile-panel-btn" onClick={() => setMobilePanel(true)} title="控制面板" style={{ display: 'none' }}>{MI('tune')}</button>
          </div>
        </div>

        {/* Chat header */}
        <div className="oc-chat-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className={`status-dot ${chatConnected ? 'online' : ''}`} />
            {chatConnected ? 'OpenClaw Agent 已连接' : '连接中...'}
          </span>
          <span style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-ghost btn-sm" onClick={handleReconnect} disabled={chatStreaming} style={{ fontSize: '0.6875rem' }}>重连</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setChatMessages([]); setChatStreaming(false); }} disabled={chatMessages.length === 0} style={{ fontSize: '0.6875rem' }}>清空</button>
          </span>
        </div>

        {/* Chat messages */}
        <div className="oc-chat-body">
          {chatMessages.length === 0 ? (
            <div className="oc-chat-empty">
              <div className="oc-chat-empty-icon">{MI('hub')}</div>
              {needsSetup() ? (
                <>
                  <strong>OpenClaw 需要配置</strong>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '4px 0 8px', textAlign: 'center', maxWidth: 320 }}>
                    {!status?.running
                      ? '网关未运行。请在右侧面板中启动网关，或使用「一键部署」完成安装和配置。'
                      : '网关已运行，但模型尚未配置。请在右侧面板中配置模型以启用 AI 对话能力。'}
                  </p>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {!status?.running && (
                      <button className="btn btn-primary btn-sm" onClick={() => { runAction('restart-gateway'); setShowSetupGuide(true); }} disabled={loading}>启动网关</button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => { setPanelOpen(true); toggleAccordion(status?.running ? 'model' : 'deploy'); }}>
                      {status?.running ? '配置模型' : '一键部署'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <strong>OpenClaw Agent 就绪</strong>
                  <div className="oc-quick-prompts">
                    {QUICK_PROMPTS.map((item) => (
                      <button key={item.label} className="chip" onClick={() => dispatchOpenClawMessage(item.prompt)} disabled={!chatConnected || chatStreaming}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
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

        {/* Quick prompts strip */}
        <div className="oc-chat-suggestions">
          {QUICK_PROMPTS.map((item) => (
            <button key={item.label} className="chip" onClick={() => dispatchOpenClawMessage(item.prompt)} disabled={!chatConnected || chatStreaming} style={{ flexShrink: 0, fontSize: '0.6875rem' }}>
              {item.label}
            </button>
          ))}
          {chatStreaming && (
            <button className="btn btn-danger btn-sm" onClick={handleStopStream} style={{ flexShrink: 0, fontSize: '0.6875rem' }}>停止生成</button>
          )}
        </div>
      </div>

      {/* ════════════ Right: Panel ════════════ */}
      {panelOpen && (
        <div className="oc-panel">
          {renderPanel()}
        </div>
      )}

      {/* ════════════ Mobile drawer overlay ════════════ */}
      {mobilePanel && <div className="oc-drawer-overlay" onClick={() => setMobilePanel(false)} />}
      {mobilePanel && (
        <div className="oc-panel" style={{ position: 'fixed', inset: 0, top: 'auto', height: '70vh', zIndex: 'var(--z-modal)' as any, borderRadius: '20px 20px 0 0', boxShadow: 'var(--shadow-xl)' }}>
          {renderPanel()}
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
