import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { useAppState } from '../hooks/useAppState';
import { fillTemplate } from '../i18n/en-extras';
import { useI18n } from '../i18n/use-i18n';
import { renderMarkdown } from './MarkdownRenderer';
import { resolveSocketUrl, socketIoClientOptions } from '../utils/socket';
import { fetchApi } from '../utils/apiBase';
import { stripAnsi } from '../utils/strip-ansi';
import { persistGatewayStatusSnapshot } from '../studio-ui-hints';
import {
  subscribeOpenClawDeployJob,
  startOpenClawDeployPoll,
  stopOpenClawDeployPoll,
  deployJobStorageKey as ocDeployJobLsKey,
  fetchOpenClawDeployJob,
} from '../utils/openclawDeployPoll';
import { fetchWifiLinkState } from '../utils/wifi-link-probe';
import { fetchAgentConfig } from '../api';
import io from 'socket.io-client';

/** sessionStorage：用户取消部署后阻止 Wi‑Fi 触发的自动安装，直至关闭并重新打开工作室（会话级） */
const openclawWifiAutoUserBlockKey = (deviceId: string) => `oc-wifi-auto-user-block-${deviceId}`;

/* ═══════════════════════════════════════════
   Types
   ═══════════════════════════════════════════ */

interface GatewayStatus {
  running: boolean;
  version: string;
  /** 与后端 GatewayStatus.installed 一致；旧响应可能缺省，用 version 兜底 */
  installed?: boolean;
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
  agentDefaults?: {
    thinkingDefault?: string;
    reasoning?: string;
  };
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

/** 与 AIDock `Icon.send` 一致 */
function OcComposerSendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

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

/** 工作室 AI 设置里的 provider id 与一键部署 chip 的 key 对齐 */
function mapStudioProviderToDeployPreset(provider: string): string {
  const p = String(provider || '').trim();
  if (p === 'qwen') return 'bailian';
  if (p === 'doubao') return 'volcengine';
  if (p === 'gemini') return 'google';
  return p;
}

/* ═══════════════════════════════════════════
   Component
   ═══════════════════════════════════════════ */

export default function OpenClaw() {
  const { currentDevice, addToast, registerOpenclawSend, activeTab } = useAppState();
  const { t, language } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const tf = (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars);

  const quickPrompts = useMemo(
    () => [
      { label: t('oc.quick.gateway', '网关健康检查'), prompt: t('oc.quick.gateway.prompt', '请先检查当前网关状态并给出一条结论') },
      { label: t('oc.quick.capabilities', '能力总览'), prompt: t('oc.quick.capabilities.prompt', '帮我总结当前设备可用的 OpenClaw 能力') },
      { label: t('oc.quick.inspect', '设备巡检'), prompt: t('oc.quick.inspect.prompt', '我现在要做一个设备健康巡检，给我步骤') },
      { label: t('oc.quick.diagnose', '诊断修复'), prompt: t('oc.quick.diagnose.prompt', '帮我诊断为什么会连接失败，并给修复命令') },
    ],
    [t, language],
  );

  const pluginCatalog = useMemo(
    () => [
      { id: 'feishu', name: t('oc.plugin.feishu', '飞书'), emoji: '💬' },
      { id: 'weixin', name: t('oc.plugin.weixin', '微信'), emoji: '📱' },
      { id: 'skillhub', name: t('oc.plugin.skillhub', 'SkillHub'), emoji: '🏪' },
      { id: 'memory', name: t('oc.plugin.memory', '对话记忆'), emoji: '🧠' },
      { id: 'web_search', name: t('oc.plugin.web_search', '网络搜索'), emoji: '🔍' },
    ],
    [t, language],
  );

  const deployStepLabels = useMemo(
    () => [
      t('oc.deploy.step.check', '诊断'),
      t('oc.deploy.step.deps', '依赖'),
      t('oc.deploy.step.install', '安装'),
      t('oc.deploy.step.config', '配置'),
    ],
    [t, language],
  );

  const providerDisplayLabel = useCallback((key: string, preset: ProviderPreset) => t(`oc.provider.${key}`, preset.label), [t]);

  // ─── Data State ───
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);

  const ocInstalled = useMemo(
    () => !!(status?.installed ?? status?.version?.trim()),
    [status],
  );

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
  /** 页面内对话输入（快捷 chip 下方） */
  const [ocComposerText, setOcComposerText] = useState('');
  /** `openclaw:ready` 仅保证 SSH 会话就绪，需结合状态接口判断 Agent 是否真可用 */
  const openclawAgentReady = useMemo(
    () => chatConnected && !statusLoading && ocInstalled && !!status?.running,
    [chatConnected, statusLoading, ocInstalled, status?.running],
  );

  // ─── Model Config State ───
  const [modelConfig, setModelConfig] = useState({
    baseUrl: '',
    apiKey: '',
    api: 'openai-completions',
    modelId: '',
    modelName: '',
  });
  /** 写入板端 `agents.defaults`（OpenClaw）；空字符串表示不覆盖该项 */
  const [agentDefaults, setAgentDefaults] = useState({
    thinkingDefault: '',
    reasoning: '',
  });
  const [selectedPreset, setSelectedPreset] = useState('');
  const [vendorApiTest, setVendorApiTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [gatewayTest, setGatewayTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

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
  /** 与 RDKClaw 设置中当前模型一致：已在服务端保存 API Key（或环境变量 OPENAI_API_KEY） */
  const [deployHasStudioKey, setDeployHasStudioKey] = useState(false);
  const [deployRunning, setDeployRunning] = useState(false);
  const [deploySteps, setDeploySteps] = useState<DeployStepState[]>([]);
  const [deployJobId, setDeployJobId] = useState('');
  const [deployOutput, setDeployOutput] = useState('');
  /** 安装阶段长时间无新日志时提示（非错误） */
  const [deployCancelLoading, setDeployCancelLoading] = useState(false);

  // ─── Post-install Guide State ───
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [setupStep, setSetupStep] = useState<SetupStep>('gateway');

  // ─── UI State ───
  const [panelOpen, setPanelOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [accordion, setAccordion] = useState<ConfigTab | 'deploy' | 'ops' | 'pairing' | null>(null);
  const [configTab, setConfigTab] = useState<ConfigTab>('model');
  const [modelGatewayApiKeyVisible, setModelGatewayApiKeyVisible] = useState(false);
  const [deployApiKeyVisible, setDeployApiKeyVisible] = useState(false);

  // ─── Refs ───
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const messageIdRef = useRef(0);
  const ocDeployLsKey = currentDevice ? ocDeployJobLsKey(currentDevice.id) : '';
  const ocDeployPanelHintKey = currentDevice ? `oc-deploy-panel-hint-${currentDevice.id}` : '';
  const applyDeployJobRef = useRef<(job: DeployJob) => void>(() => {});
  const deployRunningRef = useRef(false);
  /** 与 `>>> uninstall` 等同一条助手消息流：首轮 append，后续 updateLastAssistant */
  const deployLogBubbleInitializedRef = useRef(false);
  useEffect(() => {
    deployRunningRef.current = deployRunning;
  }, [deployRunning]);
  const nextChatMessageId = useCallback(() => {
    const now = Date.now();
    if (now <= messageIdRef.current) {
      messageIdRef.current += 1;
    } else {
      messageIdRef.current = now;
    }
    return messageIdRef.current;
  }, []);

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

  /** 一键部署表单与 RDKClaw（工作室 → AI 模型）当前启用模型对齐 */
  useEffect(() => {
    if (activeTab !== 'openclaw') return;
    let cancelled = false;
    void fetchAgentConfig()
      .then((cfg) => {
        if (cancelled) return;
        const models = cfg.models || [];
        const aid = cfg.activeModelId?.trim();
        const active = aid ? models.find((m) => m.id === aid) : models.find((m) => m.isActive);
        const resolved = active || models[0];
        const envOk = !!cfg.envApiKeyAvailable;

        const applyResolved = (r: NonNullable<typeof resolved>) => {
          const rawProv = String(r.provider || '').trim();
          const presetKey = mapStudioProviderToDeployPreset(rawProv);
          const preset = PROVIDER_PRESETS[presetKey];
          if (preset) {
            setDeployProvider(presetKey);
            setDeployBaseUrl((r.baseUrl || '').trim() || preset.baseUrl);
            setDeployModelId((r.model || '').trim());
            setDeployApi(preset.api);
          } else {
            setDeployProvider('');
            setDeployBaseUrl((r.baseUrl || '').trim());
            setDeployModelId((r.model || '').trim());
            setDeployApi(rawProv === 'anthropic' || rawProv === 'anthropic-compatible' ? 'anthropic-messages' : 'openai-completions');
          }
          setDeployApiKey('');
          setDeployHasStudioKey(!!r.hasApiKey || envOk);
        };

        if (resolved) {
          applyResolved(resolved);
          return;
        }
        if (cfg.configured && cfg.provider && cfg.model) {
          const p = String(cfg.provider || '');
          const presetKey = mapStudioProviderToDeployPreset(p);
          const preset = PROVIDER_PRESETS[presetKey];
          if (preset) {
            setDeployProvider(presetKey);
            setDeployBaseUrl((cfg.baseUrl || '').trim() || preset.baseUrl);
            setDeployModelId((cfg.model || '').trim());
            setDeployApi(preset.api);
          } else {
            setDeployProvider('');
            setDeployBaseUrl((cfg.baseUrl || '').trim());
            setDeployModelId((cfg.model || '').trim());
            setDeployApi(p === 'anthropic' || p === 'anthropic-compatible' ? 'anthropic-messages' : 'openai-completions');
          }
          setDeployApiKey('');
          setDeployHasStudioKey(!!cfg.hasApiKey || envOk);
          return;
        }
        setDeployHasStudioKey(envOk);
      })
      .catch(() => {
        if (!cancelled) setDeployHasStudioKey(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, currentDevice?.id]);

  useEffect(() => {
    if (currentDevice && activeTab === 'openclaw') {
      void Promise.all([loadStatus(), loadConfig(), loadBoardSkills()]);
    }
  }, [currentDevice, activeTab]);

  useEffect(() => {
    if (!currentDevice || activeTab !== 'openclaw') return;
    if (statusLoading) return;
    const installed = !!(status?.installed ?? status?.version?.trim());
    if (installed) {
      if (ocDeployPanelHintKey) {
        try {
          localStorage.removeItem(ocDeployPanelHintKey);
          sessionStorage.removeItem(ocDeployPanelHintKey);
        } catch { /* ignore */ }
      }
      return;
    }
    if (ocDeployPanelHintKey) {
      try {
        if (localStorage.getItem(ocDeployPanelHintKey) === 'dismissed') {
          localStorage.removeItem(ocDeployPanelHintKey);
        }
      } catch { /* ignore */ }
    }
    let saved = '';
    if (ocDeployPanelHintKey) {
      try { saved = sessionStorage.getItem(ocDeployPanelHintKey) || ''; } catch { saved = ''; }
    }
    if (deployRunning) return;
    try {
      if (currentDevice?.id && sessionStorage.getItem(`oc-wifi-auto-pending-${currentDevice.id}`)) return;
    } catch { /* ignore */ }
    if (saved !== 'dismissed') {
      setAccordion(null);
      setPanelOpen(true);
    }
  }, [activeTab, currentDevice, ocDeployPanelHintKey, status?.installed, status?.version, statusLoading, deployRunning]);

  /** 板端已连 Wi‑Fi 且未安装 OpenClaw 时，使用工作室侧已保存的模型配置自动发起部署（与 POST /deploy/start 服务端逻辑一致） */
  useEffect(() => {
    if (!currentDevice) return;
    const id = currentDevice.id;
    const pendingKey = `oc-wifi-auto-pending-${id}`;
    const skipCfgKey = `oc-wifi-auto-skip-nocfg-${id}`;
    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      if (cancelled || inFlight) return;
      try {
        if (sessionStorage.getItem(skipCfgKey) === '1') return;
      } catch { /* ignore */ }
      try {
        if (sessionStorage.getItem(openclawWifiAutoUserBlockKey(id)) === '1') return;
      } catch { /* ignore */ }

      const wifi = await fetchWifiLinkState(id);
      if (cancelled || wifi !== 'up') return;

      let installed = false;
      try {
        const res = await fetchApi(`/api/devices/${id}/openclaw/status`);
        if (!res.ok) return;
        const data = (await res.json()) as GatewayStatus;
        installed = !!(data?.installed ?? data?.version?.trim());
      } catch {
        return;
      }
      if (cancelled || installed) return;
      if (deployRunningRef.current) return;

      inFlight = true;
      try {
        try {
          sessionStorage.setItem(pendingKey, '1');
        } catch { /* ignore */ }
        const res = await fetchApi(`/api/devices/${id}/openclaw/deploy/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = (await res.json().catch(() => ({}))) as { jobId?: string; code?: string; error?: string };
        if (!res.ok || !data?.jobId) {
          try {
            sessionStorage.removeItem(pendingKey);
          } catch { /* ignore */ }
          if (res.status === 400 || data?.code === 'INVALID_DEPLOY_CONFIG') {
            try {
              sessionStorage.setItem(skipCfgKey, '1');
            } catch { /* ignore */ }
            addToast?.(
              tRef.current(
                'oc.deploy.autoNeedStudioModel',
                '板端已连接 Wi‑Fi，但工作室未配置模型凭据，无法自动安装 OpenClaw。请在设置中配置 AI 模型，或使用一键部署手动填写。',
              ),
              'info',
            );
          }
          return;
        }
        setDeployRunning(true);
        setDeploySteps(['running', 'pending', 'pending', 'pending']);
        setDeployOutput('');
        deployLogBubbleInitializedRef.current = false;
        setPanelOpen(true);
        setAccordion(null);
        beginDeployPolling(data.jobId);
        addToast?.(tRef.current('oc.deploy.autoStarted', '已检测到 Wi‑Fi，正在后台自动安装 OpenClaw…'), 'info');
      } catch {
        try {
          sessionStorage.removeItem(pendingKey);
        } catch { /* ignore */ }
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const iv = setInterval(tick, 42_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [currentDevice?.id]);

  useEffect(() => {
    if (status !== null && config !== null && needsSetup()) {
      setShowSetupGuide(true);
      const installed = !!(status?.installed ?? status?.version?.trim());
      if (!installed) {
        setSetupStep('gateway');
      } else if (!config.modelGateway?.baseUrl || !config.modelGateway?.apiKey) {
        setSetupStep('model');
      } else {
        setSetupStep('feishu');
      }
    }
  }, [status, config]);

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
    socket.on('openclaw:ready', () => {
      setChatConnected(true);
      void loadStatus();
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
          return [...prev.slice(0, -1), { ...last, text: tRef.current('oc.chat.emptyResponse', 'OpenClaw 未返回有效内容，请检查网关状态或设备密码。') }];
        }
        return prev;
      });
    });
    socket.on('openclaw:error', (data: { error: string }) => {
      setChatStreaming(false);
      setChatMessages((prev) => [...prev, {
        id: nextChatMessageId(),
        role: 'assistant',
        text: `${tRef.current('oc.chat.errorPrefix', '**错误：**')} ${data.error}`,
      }]);
      addToast?.(data.error || tRef.current('oc.toast.chatErr', 'OpenClaw 对话异常'), 'error');
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
      const res = await fetchApi(`/api/devices/${currentDevice.id}/openclaw/status`);
      if (!res.ok) {
        addToast?.(tf('oc.toast.statusFail', '获取状态失败: HTTP {{status}}', { status: res.status }), 'error');
        return null;
      }
      const data = await res.json();
      setStatus(data);
      const st = data as GatewayStatus;
      persistGatewayStatusSnapshot(currentDevice.id, {
        running: !!st.running,
        version: typeof st.version === 'string' ? st.version : '',
        installed: !!(st.installed ?? st.version?.trim()),
        feishuConnected: !!st.feishuConnected,
      });
      return data;
    } catch (e: any) {
      addToast?.(tf('oc.toast.statusNet', '获取状态失败: {{msg}}', { msg: e?.message || t('oc.err.network', '网络错误') }), 'error');
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
      const res = await fetchApi(`/api/devices/${currentDevice.id}/openclaw/config`);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        addToast?.(tf('oc.toast.configHttp', '加载配置失败: {{detail}}', { detail: String(errBody.error || `HTTP ${res.status}`) }), 'error');
        return null;
      }
      const data = await res.json();
      setConfig(data);
      if (data.modelGateway) setModelConfig(data.modelGateway);
      if (data.agentDefaults) {
        setAgentDefaults({
          thinkingDefault: (data.agentDefaults.thinkingDefault || '').trim(),
          reasoning: (data.agentDefaults.reasoning || '').trim(),
        });
      } else {
        setAgentDefaults({ thinkingDefault: '', reasoning: '' });
      }
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
      addToast?.(tf('oc.toast.configFail', '加载配置失败: {{msg}}', { msg: e?.message || t('oc.err.network', '网络错误') }), 'error');
      return null;
    }
  };

  /* WeChat functions moved to SettingsPanel */

  const appendSystemMessage = (text: string) => {
    setChatMessages((prev) => [...prev, { id: nextChatMessageId(), role: 'assistant', text }]);
  };

  const SLOW_ACTIONS = new Set(['install', 'upgrade', 'uninstall', 'prepare', 'check', 'doctor', 'gateway-pair']);

  const updateLastAssistant = (text: string) => {
    setChatMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant') return [...prev.slice(0, -1), { ...last, text }];
      return prev;
    });
  };

  /** 一键部署轮询：日志写入对话区，格式与 `>>> uninstall` 一致 */
  const applyDeployJob = (job: DeployJob) => {
    const stepOrder: DeployStepName[] = ['check', 'prepare', 'install', 'config'];
    const out = stripAnsi(job.output || '');
    setDeployOutput(out);
    const formatDeployChat = (raw: string) => {
      const body = raw.trim() || tRef.current('oc.run.running', '执行中...');
      return `\`>>> deploy\`\n\n\`\`\`\n${body}\n\`\`\``;
    };
    const syncDeployToChat = (raw: string) => {
      const text = formatDeployChat(raw);
      if (!deployLogBubbleInitializedRef.current) {
        appendSystemMessage(text);
        deployLogBubbleInitializedRef.current = true;
      } else {
        updateLastAssistant(text);
      }
    };

    if (job.status === 'running') {
      setDeploySteps(stepOrder.map((name) => job.steps?.[name] || 'pending'));
      setDeployRunning(true);
      syncDeployToChat(out);
      return;
    }

    syncDeployToChat(out);
    deployLogBubbleInitializedRef.current = false;

    setDeployRunning(false);
    stopOpenClawDeployPoll();
    if (ocDeployLsKey) localStorage.removeItem(ocDeployLsKey);
    if (currentDevice?.id) {
      try {
        sessionStorage.removeItem(`oc-wifi-auto-pending-${currentDevice.id}`);
      } catch { /* ignore */ }
    }
    if (job.status === 'done') {
      setDeploySteps([]);
      appendSystemMessage(tRef.current('oc.deploy.done', '**部署完成！** 模型配置已写入，Gateway 正在重启...'));
      setTimeout(async () => {
        await loadConfig();
        await loadStatus();
        if (deployFeishuAppId.trim() && deployFeishuAppSecret.trim()) {
          appendSystemMessage(tRef.current('oc.deploy.feishuWriting', '正在写入飞书配置...'));
          try {
            await fetchApi(`/api/devices/${currentDevice?.id}/openclaw/config`, {
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
            appendSystemMessage(tRef.current('oc.deploy.feishuDone', '**飞书配置已写入！** Gateway 已重启。'));
            addToast?.(tRef.current('oc.toast.feishuSaved', '飞书配置已保存'), 'success');
            setTimeout(() => { loadConfig(); loadStatus(); }, 1500);
          } catch {
            appendSystemMessage(tRef.current('oc.deploy.feishuFail', '飞书配置写入失败，请在控制面板中手动配置。'));
          }
        }
        setShowSetupGuide(true);
        setSetupStep('model');
        setPanelOpen(true);
      }, 1200);
      return;
    }
    setDeploySteps(stepOrder.map((name) => job.steps?.[name] || 'pending'));
    const err =
      job.error === 'oc.deployPoll.interrupted'
        ? tRef.current(
            'oc.deployPoll.interrupted',
            '长时间无法拉取部署进度（烧录或本机繁忙时常见）；板端可能仍在安装。请查看下方日志或稍后重试。',
          )
        : job.error || tRef.current('oc.deploy.fail', '部署失败，请查看日志输出');
    appendSystemMessage(fillTemplate(tRef.current('oc.deploy.failMsg', '**部署失败：** {{detail}}'), { detail: err }));
  };

  applyDeployJobRef.current = applyDeployJob;

  const runAction = async (action: string, body?: any) => {
    if (!currentDevice) return;
    setLoading(true);
    setActiveOp(action);

    const isSlow = SLOW_ACTIONS.has(action);
    const startTime = Date.now();
    appendSystemMessage(`\`>>> ${action}\`\n\n${t('oc.run.running', '执行中...')}`);

    let progressTimer: ReturnType<typeof setInterval> | null = null;
    if (isSlow) {
      progressTimer = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        updateLastAssistant(`\`>>> ${action}\`\n\n${t('oc.run.running', '执行中...')} (${elapsed}s)\n\n_${action === 'install' || action === 'upgrade' ? t('oc.run.progressSlow', '安装/升级可能需要几分钟；若日志长时间无新行，请展开下方日志是否已出现 apt/dpkg 报错（例如 libnode-dev 与 NodeSource 文件冲突），勿仅凭此提示推断仍在下载。') : t('oc.run.progressSsh', '正在通过 SSH 执行命令')}_`);
      }, 5000);
    }

    const controller = new AbortController();
    const fetchTimeout = isSlow ? 600000 : 120000;
    const fetchTimer = setTimeout(() => controller.abort(), fetchTimeout);

    try {
      const res = await fetchApi(`/api/devices/${currentDevice.id}/openclaw/${action}`, {
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
        updateLastAssistant(`\`>>> ${action}\` _(${elapsed}s)_\n\n\`\`\`\n${rawText || t('oc.run.emptyBody', '(空响应)')}\n\`\`\``);
        addToast?.(t('oc.toast.badResponse', '操作完成，但响应格式异常'), 'warning');
        return;
      }

      if (!res.ok) {
        const errMsg = data.error || data.message || `HTTP ${res.status}`;
        updateLastAssistant(`\`>>> ${action}\` _(${elapsed}s)_\n\n${t('oc.chat.errorPrefix', '**错误：**')} ${errMsg}`);
        addToast?.(errMsg, 'error');
      } else {
        const output = data.output?.trim() || JSON.stringify(data, null, 2);
        updateLastAssistant(`\`>>> ${action}\` _(${elapsed}s)_\n\n\`\`\`\n${output}\n\`\`\``);
        if (action === 'install' || action === 'uninstall' || action === 'restart-gateway' || action === 'upgrade' || action === 'gateway-pair') {
          setTimeout(() => { void loadStatusWithRetry(action === 'restart-gateway' || action === 'gateway-pair' ? 7 : 4, 2000); }, 1000);
        }
        if (data.ok) addToast?.(t('oc.toast.opOk', '操作成功'), 'success');
      }
    } catch (err: any) {
      clearTimeout(fetchTimer);
      if (progressTimer) clearInterval(progressTimer);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const msg = err.name === 'AbortError'
        ? tf('oc.run.timeout', '操作超时 ({{s}}s)，命令可能仍在板端运行', { s: Math.round(fetchTimeout / 1000) })
        : err.message;
      updateLastAssistant(`\`>>> ${action}\` _(${elapsed}s)_\n\n${t('oc.chat.errorPrefix', '**错误：**')} ${msg}`);
      addToast?.(msg, 'error');
    } finally {
      setLoading(false);
      setActiveOp(null);
      setConfirmAction(null);
    }
  };

  /* ─── Chat Functions ─── */

  const dispatchOpenClawMessage = useCallback((text: string) => {
    if (!currentDevice || !text.trim() || !socketRef.current || !openclawAgentReady || chatStreaming) return;
    const userText = text.trim();
    setChatMessages((prev) => [
      ...prev,
      { id: nextChatMessageId(), role: 'user', text: userText },
      { id: nextChatMessageId(), role: 'assistant', text: '' },
    ]);
    setChatStreaming(true);
    socketRef.current.emit('openclaw:send', { deviceId: currentDevice.id, message: userText });
  }, [currentDevice, openclawAgentReady, chatStreaming, nextChatMessageId]);

  const submitOcComposer = useCallback(() => {
    const trimmed = ocComposerText.trim();
    if (!trimmed) return;
    dispatchOpenClawMessage(trimmed);
    setOcComposerText('');
  }, [ocComposerText, dispatchOpenClawMessage]);

  useEffect(() => {
    if (openclawAgentReady && !chatStreaming) {
      registerOpenclawSend((text: string) => dispatchOpenClawMessage(text));
    } else {
      registerOpenclawSend(null);
    }
    return () => registerOpenclawSend(null);
  }, [openclawAgentReady, chatStreaming, registerOpenclawSend, dispatchOpenClawMessage]);

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
      const adPartial: Record<string, string> = {};
      if (agentDefaults.thinkingDefault.trim()) adPartial.thinkingDefault = agentDefaults.thinkingDefault.trim();
      if (agentDefaults.reasoning.trim()) adPartial.reasoning = agentDefaults.reasoning.trim();
      const hasAgentPatch = Object.keys(adPartial).length > 0;
      const hasModelGateway = !!(modelConfig.baseUrl.trim() && modelConfig.apiKey.trim());
      if (!hasModelGateway && !hasAgentPatch) {
        addToast?.(
          t('oc.save.needUrlKeyOrAgent', '请填写 Base URL 与 API Key，或至少选择一项思考档位 / 推理可见性'),
          'warning',
        );
        return;
      }
    }
    if (activeTab === 'feishu') {
      const hasId = !!feishuConfig.appId.trim();
      const hasSecret = !!feishuConfig.appSecret.trim();
      if ((hasId && !hasSecret) || (!hasId && hasSecret)) {
        addToast?.(t('oc.save.feishuBoth', '飞书配置需要同时填写 App ID 和 App Secret'), 'warning');
        return;
      }
      if (!hasId && !hasSecret) {
        addToast?.(t('oc.save.feishuEmpty', '飞书配置为空，未提交'), 'info');
        return;
      }
      if (feishuConfig.connectionMode === 'webhook') {
        if (!feishuConfig.verificationToken.trim() || !feishuConfig.encryptKey.trim()) {
          addToast?.(t('oc.save.webhookTokens', 'webhook 模式必须同时填写 Verification Token 和 Encrypt Key'), 'warning');
          return;
        }
      }
    }
    if (activeTab === 'skills') {
      const invalid = pluginAllowList.find((id) => !/^[a-zA-Z0-9@/_.-]+$/.test(id));
      if (invalid) {
        addToast?.(tf('oc.save.badPlugin', '无效插件 ID: {{id}}', { id: invalid }), 'warning');
        return;
      }
    }

    const payload: any = {};
    if (activeTab === 'model') {
      if (modelConfig.baseUrl.trim() && modelConfig.apiKey.trim()) {
        payload.modelGateway = modelConfig;
      }
      const ad: Record<string, string> = {};
      if (agentDefaults.thinkingDefault.trim()) ad.thinkingDefault = agentDefaults.thinkingDefault.trim();
      if (agentDefaults.reasoning.trim()) ad.reasoning = agentDefaults.reasoning.trim();
      if (Object.keys(ad).length > 0) payload.agentDefaults = ad;
    } else if (activeTab === 'feishu') payload.feishu = feishuConfig;
    else if (activeTab === 'skills') payload.pluginsAllow = pluginAllowList;

    setLoading(true);
    try {
      const res = await fetchApi(`/api/devices/${currentDevice.id}/openclaw/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: payload }),
      });
      const result = await res.json();
      if (!res.ok || result.ok === false) {
        addToast?.(tf('oc.save.fail', '保存失败: {{msg}}', { msg: String(result.output || result.error || t('common.unknownError', '未知错误')) }), 'error');
      } else {
        addToast?.(t('oc.save.ok', '配置已保存，Gateway 已重启'), 'success');
      }
      setTimeout(() => { loadConfig(); loadStatus(); }, 2000);
    } catch (err: any) {
      addToast?.(tf('oc.save.failNet', '保存失败: {{msg}}', { msg: err.message }), 'error');
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
        modelName: providerDisplayLabel(key, preset),
      }));
    }
  };

  /** 本机直连厂商 HTTP（与板端 Gateway 无关），使用当前表单中的 Base URL / Key / 模型 / 协议 */
  const testVendorApiConnection = async () => {
    if (!modelConfig.baseUrl.trim() || !modelConfig.apiKey.trim() || !modelConfig.modelId.trim()) {
      addToast?.(t('oc.test.vendorMissing', '请填写 Base URL、模型 ID 与 API Key'), 'warning');
      return;
    }
    setVendorApiTest('testing');
    try {
      const res = await fetchApi('/api/openclaw/vendor-model-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: modelConfig.baseUrl.trim(),
          apiKey: modelConfig.apiKey.trim(),
          modelId: modelConfig.modelId.trim(),
          api: modelConfig.api,
        }),
      });
      const data = await res.json();
      const passed = !!data?.ok;
      setVendorApiTest(passed ? 'ok' : 'fail');
      if (passed) {
        const ms = typeof data?.latencyMs === 'number' ? data.latencyMs : null;
        addToast?.(
          ms != null
            ? tf('oc.test.vendorOkMs', '厂商 API 可用（{{ms}} ms）', { ms: String(ms) })
            : t('oc.test.vendorOk', '厂商 API 可用'),
          'success',
        );
      } else {
        const detail = [data?.detail, data?.status ? `HTTP ${data.status}` : '', data?.error].filter(Boolean).join(' · ');
        addToast?.(detail || t('oc.test.vendorFail', '厂商 API 测试失败'), 'warning');
      }
    } catch {
      setVendorApiTest('fail');
      addToast?.(t('oc.test.vendorFailNet', '厂商 API 测试失败（网络或服务异常）'), 'error');
    }
    setTimeout(() => setVendorApiTest('idle'), 5000);
  };

  /** 经板端 WebSocket Gateway 的 chat.send 端到端测试 */
  const testGatewayModelConnection = async () => {
    if (!currentDevice) return;
    setGatewayTest('testing');
    try {
      const res = await fetchApi(`/api/devices/${currentDevice.id}/openclaw/model-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      const passed = !!data?.ok;
      setGatewayTest(passed ? 'ok' : 'fail');
      if (passed) {
        addToast?.(t('oc.test.ok', '模型调用测试通过'), 'success');
      } else {
        const output = String(data?.output || '');
        if (Boolean(data?.pairingRequired) || /pairing required/i.test(output)) {
          setAccordion('pairing');
          addToast?.(t('oc.test.pairing', '模型测试失败：需要先通过配对审批（已展开配对面板）'), 'warning');
        } else {
          addToast?.(output || t('oc.test.fail', '模型调用测试失败'), 'warning');
        }
      }
    } catch {
      setGatewayTest('fail');
      addToast?.(t('oc.test.failNet', '模型调用测试失败'), 'error');
    }
    setTimeout(() => setGatewayTest('idle'), 5000);
  };

  /* ─── Deploy Functions ─── */

  const handleOneClickInstall = async () => {
    if (!currentDevice || deployRunning) return;
    if (!deployModelId.trim()) {
      addToast?.(t('oc.deploy.needModelId', '请填写模型 ID，或先在 RDKClaw 设置中保存当前模型'), 'warning');
      return;
    }
    if (!deployApiKey.trim() && !deployHasStudioKey) {
      addToast?.(
        t('oc.deploy.needKeyOrStudio', '请填写 API Key，或先在 RDKClaw 设置中保存模型与密钥'),
        'warning',
      );
      return;
    }
    try {
      const preset = PROVIDER_PRESETS[deployProvider];
      const baseUrl = deployBaseUrl || preset?.baseUrl || '';
      const api = deployApi || preset?.api || 'openai-completions';
      setDeployRunning(true);
      setDeploySteps(['running', 'pending', 'pending', 'pending']);
      setDeployOutput('');
      setPanelOpen(true);
      setAccordion(null);
      const res = await fetchApi(`/api/devices/${currentDevice.id}/openclaw/deploy/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: deployProvider || 'custom',
          baseUrl,
          apiKey: deployApiKey.trim() || undefined,
          modelId: deployModelId.trim(),
          api,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.jobId) {
        throw new Error(data?.error || tf('oc.deploy.startFail', '部署启动失败 (HTTP {{status}})', { status: res.status }));
      }
      deployLogBubbleInitializedRef.current = false;
      beginDeployPolling(data.jobId);
      addToast?.(data.alreadyRunning ? t('oc.deploy.trackExisting', '检测到已有部署任务，已继续跟踪') : t('oc.deploy.started', '部署已启动，可切换页面后回来查看进度'), 'info');
    } catch (err: any) {
      addToast?.(tf('oc.deploy.configFail', '配置失败: {{msg}}', { msg: err.message }), 'error');
      setDeployRunning(false);
      setDeploySteps([]);
      stopDeployPolling();
      deployLogBubbleInitializedRef.current = false;
    }
  };

  const stopLocalDeployAndBlockWifiAuto = (deviceId: string) => {
    try {
      sessionStorage.setItem(openclawWifiAutoUserBlockKey(deviceId), '1');
    } catch { /* ignore */ }
    try {
      sessionStorage.removeItem(`oc-wifi-auto-pending-${deviceId}`);
    } catch { /* ignore */ }
    stopDeployPolling();
    try {
      localStorage.removeItem(ocDeployJobLsKey(deviceId));
    } catch { /* ignore */ }
    setDeployRunning(false);
    setDeployJobId('');
    setDeploySteps([]);
    setDeployOutput('');
    deployLogBubbleInitializedRef.current = false;
  };

  const handleCancelDeploy = async () => {
    if (!currentDevice || deployCancelLoading || !deployRunning) return;
    const devId = currentDevice.id;
    const jid = deployJobId.trim();

    if (!jid) {
      stopLocalDeployAndBlockWifiAuto(devId);
      addToast?.(
        t(
          'oc.deploy.cancelBlockedAutoUntilRestart',
          '已停止部署。已关闭 Wi‑Fi 自动安装；请重启工作室后才会再次自动发起。',
        ),
        'info',
      );
      return;
    }

    setDeployCancelLoading(true);
    try {
      const res = await fetchApi(`/api/devices/${devId}/openclaw/deploy/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: jid }),
      });
      const data = await res.json().catch(() => ({} as { message?: string; error?: string }));
      if (!res.ok) {
        addToast?.(
          tf('oc.deploy.cancelFail', '取消失败：{{msg}}', {
            msg: String(data?.message || data?.error || `HTTP ${res.status}`),
          }),
          'warning',
        );
        return;
      }
      stopLocalDeployAndBlockWifiAuto(devId);
      addToast?.(
        t(
          'oc.deploy.cancelBlockedAutoUntilRestart',
          '已取消部署。已关闭 Wi‑Fi 自动安装；请重启工作室后才会再次自动发起。',
        ),
        'success',
      );
    } catch (err: unknown) {
      addToast?.(
        tf('oc.deploy.cancelFail', '取消失败：{{msg}}', {
          msg: err instanceof Error ? err.message : String(err),
        }),
        'error',
      );
    } finally {
      setDeployCancelLoading(false);
    }
  };


  const renderDeployProgressTrack = () => {
    if (deploySteps.length === 0) return null;
    return (
      <div className="oc-install-progress">
        <div className="oc-install-steps-track">
          {deploySteps.map((st, idx) => (
            <Fragment key={idx}>
              {idx > 0 && (
                <div
                  className={
                    `oc-install-step-connector${
                      deploySteps[idx - 1] === 'done'
                        ? ' connector-done'
                        : deploySteps[idx - 1] === 'error'
                          ? ' connector-error'
                          : ''
                    }`
                  }
                />
              )}
              <div
                className={`oc-install-step-node step-${st}${idx === 2 ? ' oc-install-step-node--hint' : ''}`}
              >
                <div className="oc-install-step-circle">
                  {st === 'running' && (
                    <span className="material-symbols-outlined oc-install-step-icon-spin">progress_activity</span>
                  )}
                  {st === 'done' && <span className="material-symbols-outlined oc-install-step-icon">check</span>}
                  {st === 'error' && <span className="material-symbols-outlined oc-install-step-icon">close</span>}
                  {st === 'pending' && <span className="oc-step-pending-dot" aria-hidden />}
                </div>
                <div className="oc-install-step-label">{deployStepLabels[idx]}</div>
                {idx === 2 && (
                  <div className="oc-install-step-hint">
                    {t('oc.deploy.stepInstallHint', 'npm 全局安装为主，ARM 设备约 5–15 分钟')}
                  </div>
                )}
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    );
  };

  /** 一键部署：仅四步进度条 +（进行中时）取消部署；详细日志见对话区 / 其它入口 */
  const renderDeployMainStrip = () => {
    if (!deployRunning && deploySteps.length === 0) return null;
    return (
      <div className="oc-deploy-main-strip">
        <div className="oc-deploy-main-strip-head">
          <span className="oc-deploy-main-strip-title">
            {deployRunning ? t('oc.deploy.mainStripRunning', '一键部署进行中') : t('oc.deploy.mainStripProgress', '部署进度')}
          </span>
          {deployRunning ? (
            <div className="oc-deploy-main-strip-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void handleCancelDeploy()}
                disabled={deployCancelLoading}
              >
                {deployCancelLoading ? t('oc.test.testing', '...') : t('oc.deploy.cancelBtn', '取消部署')}
              </button>
            </div>
          ) : null}
        </div>
        {renderDeployProgressTrack()}
      </div>
    );
  };

  /* ─── Skill Functions ─── */

  const handleInstallSkill = async (nameOverride?: string) => {
    const name = nameOverride || skillInstallName.trim();
    if (!currentDevice || !name) return;
    setSkillInstalling(true);
    try {
      const res = await fetchApi(`/api/devices/${currentDevice.id}/openclaw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installCommand: `export PATH="$HOME/.npm-global/bin:$PATH" && clawhub install ${name} 2>&1 && echo "[Done]"`,
          configureCommand: '',
        }),
      });
      const data = await res.json();
      if (data.output?.includes('[Done]')) {
        addToast?.(tf('oc.skill.installOk', '技能 {{name}} 安装成功', { name }), 'success');
        if (!nameOverride) setSkillInstallName('');
      } else {
        addToast?.(t('oc.skill.installMaybe', '安装可能未成功，请查看输出'), 'warning');
      }
      if (data.output) {
        appendSystemMessage(`\`>>> skill install ${name}\`\n\n\`\`\`\n${data.output}\n\`\`\``);
      }
    } catch (err: any) {
      addToast?.(tf('oc.skill.installFail', '安装失败: {{msg}}', { msg: err.message }), 'error');
    } finally {
      setSkillInstalling(false);
    }
  };


  const loadBoardSkills = async () => {
    if (!currentDevice) return;
    try {
      const res = await fetchApi(`/api/devices/${currentDevice.id}/openclaw/skills`);
      if (!res.ok) {
        addToast?.(tf('oc.skills.listFail', '获取技能列表失败: HTTP {{status}}', { status: res.status }), 'error');
        return;
      }
      const data = await res.json();
      if (data.ok) {
        setBoardSkills(data.skills || []);
        setBoardPlugins(data.plugins || []);
      } else {
        addToast?.(tf('oc.skills.listFail2', '获取技能列表失败: {{msg}}', { msg: String(data.error || t('common.unknownError', '未知错误')) }), 'error');
      }
    } catch (e: any) {
      addToast?.(tf('oc.skills.listNet', '获取技能列表失败: {{msg}}', { msg: e?.message || t('oc.err.network', '网络错误') }), 'error');
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
    if (!config?.primaryModel) return t('oc.summary.notConfigured', '未配置');
    const parts = config.primaryModel.split('/');
    return parts.length > 1 ? parts[1] : config.primaryModel;
  };

  const isPluginEnabled = (id: string) => {
    const list = skillPluginsAllowText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return list.includes(id);
  };

  const getConfigSummary = () => {
    const na = t('oc.summary.notConfigured', '未配置');
    const ok = t('oc.summary.configured', '已配置');
    if (!config) return { provider: na, model: na, api: '--', apiKey: '--', feishu: na };
    const gw = config.modelGateway;
    return {
      provider: gw?.modelName || gw?.baseUrl?.replace(/https?:\/\//, '').split('/')[0] || na,
      model: getCurrentModel(),
      api: gw?.api || '--',
      apiKey: gw?.apiKey ? `${gw.apiKey.slice(0, 6)}...` : na,
      feishu: config.feishu?.appId ? ok : na,
    };
  };

  const getSetupStatus = (): SetupStatus => {
    const installed = !!(status?.installed ?? status?.version?.trim());
    const modelOk = !!(config?.modelGateway?.baseUrl && config?.modelGateway?.apiKey);
    const feishuOk = !!(config?.feishu?.appId && config?.feishu?.appSecret);
    return {
      gateway: installed ? 'ok' : (status === null ? 'warn' : 'error'),
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
    const installed = !!(status?.installed ?? status?.version?.trim());
    const modelOk = !!(config?.modelGateway?.baseUrl && config?.modelGateway?.apiKey);
    return !installed || !modelOk;
  };

  const MI = (name: string, cls?: string) => (
    <span className={`material-symbols-outlined ${cls || ''}`}>{name}</span>
  );

  const OcApiKeyRow = ({
    value,
    onChange,
    placeholder,
    visible,
    onToggleVisible,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    visible: boolean;
    onToggleVisible: () => void;
  }) => (
    <div className="oc-form-row">
      <span className="oc-form-label">{t('oc.form.apiKey', 'API Key')}</span>
      <div className="oc-input-with-toggle">
        <input
          className="input"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-label={t('oc.form.apiKey', 'API Key')}
        />
        <button
          type="button"
          className="oc-secret-toggle"
          onClick={onToggleVisible}
          aria-label={visible ? t('oc.aria.hideApiKey', '隐藏 API Key') : t('oc.aria.showApiKey', '显示 API Key')}
          aria-pressed={visible}
          title={visible ? t('oc.aria.hideApiKey', '隐藏 API Key') : t('oc.aria.showApiKey', '显示 API Key')}
        >
          {MI(visible ? 'visibility_off' : 'visibility', 'oc-secret-toggle-icon')}
        </button>
      </div>
    </div>
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
          <h3 className="empty-state-title">{t('oc.empty.title', '连接设备后管理 OpenClaw')}</h3>
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
        label: t('oc.setup.openclaw', 'OpenClaw'),
        status:
          setupStatus.gateway === 'ok'
            ? (status?.running ? t('oc.setup.ocWithGw', '已安装 · 网关运行中') : t('oc.setup.ocInstalledOnly', '已安装'))
            : setupStatus.gateway === 'warn'
              ? t('oc.status.checking', '检测中...')
              : t('oc.status.notInstalled', '未安装'),
        statusClass: setupStatus.gateway === 'ok' ? 'badge-ok' : setupStatus.gateway === 'warn' ? 'badge-accent' : 'badge-danger',
        action: () => {
          setPanelOpen(true);
          toggleAccordion(setupStatus.gateway === 'ok' ? 'ops' : 'deploy');
        },
        actionLabel:
          setupStatus.gateway === 'ok'
            ? t('oc.action.view', '查看')
            : t('oc.action.deploy', '一键部署 OpenClaw'),
      },
      {
        key: 'model',
        icon: 'psychology',
        label: t('oc.setup.model', '模型'),
        status: setupStatus.model === 'ok' ? getCurrentModel() : t('oc.summary.notConfigured', '未配置'),
        statusClass: setupStatus.model === 'ok' ? 'badge-ok' : 'badge-muted',
        action: () => { toggleAccordion('model'); },
        actionLabel: setupStatus.model === 'ok' ? t('oc.action.edit', '修改') : t('oc.action.configure', '配置'),
      },
      {
        key: 'feishu',
        icon: 'forum',
        label: t('oc.setup.feishu', '飞书'),
        status: setupStatus.feishu === 'ok' ? t('oc.summary.configured', '已配置') : t('oc.summary.notConfigured', '未配置'),
        statusClass: setupStatus.feishu === 'ok' ? 'badge-ok' : 'badge-muted',
        action: () => { toggleAccordion('feishu'); },
        actionLabel: setupStatus.feishu === 'ok' ? t('oc.action.edit', '修改') : t('oc.action.configure', '配置'),
      },
    ];

    return (
      <div className="oc-setup-checklist">
        <div className="oc-setup-checklist-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {MI('checklist', 'oc-setup-icon')}
            <strong style={{ fontSize: '0.75rem' }}>{t('oc.setup.header', '配置状态')}</strong>
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
              ? t('oc.setup.hint.needInstall', '请先安装 OpenClaw：使用「一键部署」或展开下方面板按步骤安装')
              : setupStatus.model !== 'ok'
              ? t('oc.setup.hint.model', 'OpenClaw 已安装，请配置模型以启用 AI 能力')
              : t('oc.setup.hint.feishu', '基础配置已完成！可选配置飞书以接入消息渠道')}
            <button className="btn btn-ghost btn-sm" onClick={() => setShowSetupGuide(false)} style={{ fontSize: '0.5625rem', marginLeft: 'auto' }}>{t('oc.setup.dismiss', '关闭引导')}</button>
          </div>
        )}
      </div>
    );
  };

  /** 一键部署前：板端需能访问外网 */
  const deployWifiPrereqNotice = (
    <div
      role="note"
      className="oc-deploy-wifi-prereq"
      style={{
        marginTop: 10,
        marginBottom: 6,
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        borderLeft: '3px solid var(--accent)',
        background: 'var(--accent-subtle)',
        fontSize: '0.8125rem',
        lineHeight: 1.55,
        color: 'var(--text-primary)',
      }}
    >
      <span style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ flexShrink: 0, color: 'var(--accent)', marginTop: 1 }} aria-hidden>{MI('wifi')}</span>
        <span>
          {t(
            'oc.deploy.wifiPrereq',
            '一键部署需要从板端下载依赖，请先为开发板连接 Wi‑Fi（或网线）并确保能访问互联网。若尚未配网，可点击界面右上角的 Wi‑Fi 图标进行配网，完成后再开始部署。',
          )}
        </span>
      </span>
    </div>
  );

  const renderPanel = () => (
    <>
      <div className="oc-panel-header">
        <strong>{t('oc.panel.title', '控制面板')}</strong>
        <button className="oc-panel-toggle" onClick={() => { setPanelOpen(false); setMobilePanel(false); }} title={t('oc.panel.collapse', '收起面板')}>
          {MI('close')}
        </button>
      </div>

      <div className="oc-panel-body">
        {renderSetupChecklist()}

        {/* ── Operations ── */}
        <div className="oc-accordion">
          <div className="oc-accordion-item">
            <AccTrigger id="ops" icon="terminal" label={t('oc.ops.gateway', 'Gateway 网关')} hint={status?.running ? t('oc.ops.hint.run', '运行中') : t('oc.ops.hint.stop', '停止')} />
            {accordion === 'ops' && (
              <div className="oc-accordion-content">
                <div className="oc-actions-grid">
                  <button type="button" className={`chip ${activeOp === 'check' ? 'active' : ''}`} onClick={() => runAction('check')} disabled={loading}>{t('oc.ops.check', '诊断检查')}</button>
                  <button type="button" className={`chip ${activeOp === 'doctor' ? 'active' : ''}`} onClick={() => runAction('doctor')} disabled={loading}>{t('oc.ops.doctor', '诊断并修复')}</button>
                  <button type="button" className={`chip ${activeOp === 'restart-gateway' ? 'active' : ''}`} onClick={() => runAction('restart-gateway')} disabled={loading}>{t('oc.ops.restartGw', '重启网关')}</button>
                  <button type="button" className={`chip ${activeOp === 'logs' ? 'active' : ''}`} onClick={() => runAction('logs', { limit: 300 })} disabled={loading}>{t('oc.ops.logs', '查看日志')}</button>
                </div>
                <div className="divider" style={{ margin: '8px 0' }} />
                <div className="oc-actions-grid">
                  <button type="button" className={`chip ${activeOp === 'prepare' ? 'active' : ''}`} onClick={() => runAction('prepare')} disabled={loading}>{t('oc.ops.prepare', '环境准备')}</button>
                  <button type="button" className={`chip ${activeOp === 'install' ? 'active' : ''}`} onClick={() => runAction('install')} disabled={loading}>{t('oc.ops.install', '安装')}</button>
                  <button type="button" className={`chip ${activeOp === 'upgrade' ? 'active' : ''}`} onClick={() => runAction('upgrade')} disabled={loading}>{t('oc.ops.upgrade', '升级')}</button>
                  <button type="button" className="chip" onClick={() => setConfirmAction({ action: 'uninstall', label: t('oc.ops.uninstall', '卸载 OpenClaw') })} disabled={loading} style={{ color: 'var(--danger)' }}>{t('oc.uninstall', '卸载')}</button>
                </div>
              </div>
            )}
          </div>

          {/* ── Deploy ── */}
          <div className="oc-accordion-item">
            <AccTrigger id="deploy" icon="rocket_launch" label={t('oc.deploy.title', '一键部署 OpenClaw')} hint={deployRunning ? (deployJobId ? tf('oc.deploy.runningId', '部署中 #{{id}}', { id: deployJobId.slice(0, 8) }) : t('oc.deploy.runningShort', '部署中...')) : undefined} />
            {accordion === 'deploy' && (
              <div className="oc-accordion-content">
                {deployWifiPrereqNotice}
                <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: 4 }}>{t('oc.deploy.quickPick', '快速选择（自动填充，填充后可手动修改）')}</div>
                {deployHasStudioKey && !deployApiKey.trim() && (
                  <div style={{ fontSize: '0.625rem', color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.45 }}>
                    {t('oc.deploy.syncedWithStudio', '模型与 Base URL 已与 RDKClaw 设置中的当前模型对齐；API Key 使用工作室已保存的凭据（无需重复填写）。')}
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 8 }}>
                  {Object.entries(PROVIDER_PRESETS).filter(([, p]) => p.group === 'china').map(([k, p]) => (
                    <button key={k} type="button" className={`chip ${deployProvider === k ? 'active' : ''}`} onClick={() => { setDeployProvider(k); setDeployBaseUrl(p.baseUrl); setDeployModelId(p.models[0]); setDeployApi(p.api); }} style={{ fontSize: '0.625rem', padding: '2px 7px' }}>{providerDisplayLabel(k, p)}</button>
                  ))}
                  {Object.entries(PROVIDER_PRESETS).filter(([, p]) => p.group === 'international').map(([k, p]) => (
                    <button key={k} type="button" className={`chip ${deployProvider === k ? 'active' : ''}`} onClick={() => { setDeployProvider(k); setDeployBaseUrl(p.baseUrl); setDeployModelId(p.models[0]); setDeployApi(p.api); }} style={{ fontSize: '0.625rem', padding: '2px 7px' }}>{providerDisplayLabel(k, p)}</button>
                  ))}
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">{t('oc.form.baseUrl', 'Base URL')}</span>
                  <input className="input" type="text" value={deployBaseUrl} onChange={(e) => { setDeployBaseUrl(e.target.value); setDeployProvider(''); }} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">{t('oc.form.modelId', '模型 ID')}</span>
                  <input className="input" type="text" value={deployModelId} onChange={(e) => setDeployModelId(e.target.value)} placeholder="qwen-plus / deepseek-chat / gpt-4o" />
                </div>
                <OcApiKeyRow
                  value={deployApiKey}
                  onChange={setDeployApiKey}
                  placeholder={deployProvider && PROVIDER_PRESETS[deployProvider]?.keyHint || 'sk-...'}
                  visible={deployApiKeyVisible}
                  onToggleVisible={() => setDeployApiKeyVisible((v) => !v)}
                />
                <div className="oc-form-row">
                  <span className="oc-form-label">{t('oc.form.protocol', '协议')}</span>
                  <select className="select" value={deployApi} onChange={(e) => setDeployApi(e.target.value)} aria-label={t('oc.aria.apiProtocol', 'API 协议')}>
                    {API_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="divider" style={{ margin: '8px 0' }} />
                <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: 4 }}>{t('oc.deploy.feishuOptional', '飞书配置（可选，部署后自动写入）')}</div>
                <div className="oc-form-row">
                  <span className="oc-form-label">{t('oc.form.appId', 'App ID')}</span>
                  <input className="input" type="text" value={deployFeishuAppId} onChange={(e) => setDeployFeishuAppId(e.target.value)} placeholder={t('oc.ph.cliSkip', 'cli_... (可跳过)')} />
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">{t('oc.form.secret', 'Secret')}</span>
                  <input className="input" type="password" value={deployFeishuAppSecret} onChange={(e) => setDeployFeishuAppSecret(e.target.value)} placeholder={t('oc.ph.feishuSecret', '飞书 App Secret (可跳过)')} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'stretch' }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void handleOneClickInstall()}
                    disabled={
                      deployRunning
                      || !deployModelId.trim()
                      || (!deployApiKey.trim() && !deployHasStudioKey)
                    }
                    style={{ flex: 1 }}
                  >
                    {deployRunning ? t('oc.deploy.runningShort', '部署中...') : t('oc.deploy.startBtn', '开始部署')}
                  </button>
                  {deployRunning && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void handleCancelDeploy()}
                      disabled={deployCancelLoading}
                    >
                      {deployCancelLoading ? t('oc.test.testing', '...') : t('oc.deploy.cancelBtn', '取消部署')}
                    </button>
                  )}
                </div>
                {(deployRunning || deployOutput.trim() || deploySteps.length > 0) && (
                  <p className="oc-deploy-panel-log-hint">
                    {t('oc.deploy.logOnMain', '实时进度见上方步骤条；完整日志在对话区或「Gateway → 查看日志」等处查看。')}
                  </p>
                )}
                {!deployRunning && !ocInstalled && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ alignSelf: 'flex-start', fontSize: '0.625rem', marginTop: 4 }}
                    onClick={() => {
                      if (ocDeployPanelHintKey) {
                        try { sessionStorage.setItem(ocDeployPanelHintKey, 'dismissed'); } catch { /* ignore */ }
                      }
                      addToast?.(t('oc.deploy.dismissAutoExpandToast', '已关闭自动展开一键部署；可随时手动展开该面板。'), 'info');
                    }}
                  >
                    {t('oc.modal.later', '稍后配置')}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Model Config ── */}
          <div className="oc-accordion-item">
            <AccTrigger id="model" icon="psychology" label={t('oc.model.title', '模型')} hint={summary.model} />
            {accordion === 'model' && (
              <div className="oc-accordion-content">
                <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: 4 }}>{t('oc.model.quickPick', '快速选择（自动填充下方字段，填充后仍可手动修改）')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 8 }}>
                  {Object.entries(PROVIDER_PRESETS).filter(([, p]) => p.group === 'china').map(([key, preset]) => (
                    <button key={key} type="button" className={`chip ${selectedPreset === key ? 'active' : ''}`} onClick={() => handleProviderPresetChange(key)} style={{ fontSize: '0.625rem', padding: '2px 7px' }}>{providerDisplayLabel(key, preset)}</button>
                  ))}
                  {Object.entries(PROVIDER_PRESETS).filter(([, p]) => p.group === 'international').map(([key, preset]) => (
                    <button key={key} type="button" className={`chip ${selectedPreset === key ? 'active' : ''}`} onClick={() => handleProviderPresetChange(key)} style={{ fontSize: '0.625rem', padding: '2px 7px' }}>{providerDisplayLabel(key, preset)}</button>
                  ))}
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">{t('oc.form.baseUrl', 'Base URL')}</span>
                  <input className="input" type="text" value={modelConfig.baseUrl} onChange={(e) => { setModelConfig({ ...modelConfig, baseUrl: e.target.value }); setSelectedPreset(''); }} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">{t('oc.form.modelId', '模型 ID')}</span>
                  <input className="input" type="text" value={modelConfig.modelId} onChange={(e) => setModelConfig({ ...modelConfig, modelId: e.target.value })} placeholder="qwen-plus / deepseek-chat / gpt-4o" />
                </div>
                <OcApiKeyRow
                  value={modelConfig.apiKey}
                  onChange={(apiKey) => setModelConfig({ ...modelConfig, apiKey })}
                  placeholder={selectedPreset && PROVIDER_PRESETS[selectedPreset]?.keyHint || 'sk-...'}
                  visible={modelGatewayApiKeyVisible}
                  onToggleVisible={() => setModelGatewayApiKeyVisible((v) => !v)}
                />
                <div className="oc-form-row">
                  <span className="oc-form-label">{t('oc.form.protocol', '协议')}</span>
                  <select className="select" value={modelConfig.api} onChange={(e) => setModelConfig({ ...modelConfig, api: e.target.value })} aria-label={t('oc.aria.apiProtocol', 'API 协议')}>
                    {API_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', margin: '8px 0 4px' }}>
                  {t(
                    'oc.model.agentDefaultsHint',
                    '板端对应 openclaw.json 的 agents.defaults：思考档位为 thinkingDefault；推理可见性由工作室按板端 openclaw 版本自动选择 reasoningDefault（新）或 reasoning（旧），避免未知键导致启动失败。留空表示本次保存不修改该项。',
                  )}
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">{t('oc.form.thinkingDefault', '思考档位')}</span>
                  <select
                    className="select"
                    value={agentDefaults.thinkingDefault}
                    onChange={(e) => setAgentDefaults({ ...agentDefaults, thinkingDefault: e.target.value })}
                    aria-label={t('oc.aria.thinkingDefault', '思考档位 thinkingDefault')}
                  >
                    <option value="">{t('oc.form.agentDefaultInherit', '不修改')}</option>
                    <option value="off">off</option>
                    <option value="minimal">minimal</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="xhigh">xhigh</option>
                    <option value="adaptive">adaptive</option>
                  </select>
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">{t('oc.form.reasoningVisibility', '推理可见性')}</span>
                  <select
                    className="select"
                    value={agentDefaults.reasoning}
                    onChange={(e) => setAgentDefaults({ ...agentDefaults, reasoning: e.target.value })}
                    aria-label={t('oc.aria.reasoningVisibility', '推理可见性 reasoning')}
                  >
                    <option value="">{t('oc.form.agentDefaultInherit', '不修改')}</option>
                    <option value="off">off</option>
                    <option value="on">on</option>
                    <option value="stream">stream</option>
                  </select>
                </div>
                <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                  {t(
                    'oc.test.vendorVsGatewayHint',
                    '「测试 API」从本机直连厂商接口（不经板端 Gateway）；「测试网关」经 WebSocket 走板端完整链路（依赖网关与配对等）。',
                  )}
                </div>
                <div className="oc-form-actions" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => saveConfig('model')} disabled={loading}>{loading ? t('oc.test.testing', '...') : t('oc.save', '保存')}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { loadConfig(); addToast?.(t('oc.toast.reloaded', '已加载'), 'info'); }}>{t('oc.reload', '重载')}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={testVendorApiConnection} disabled={vendorApiTest === 'testing'}>
                    {vendorApiTest === 'testing'
                      ? t('oc.test.testing', '...')
                      : vendorApiTest === 'ok'
                        ? t('oc.test.vendorOkLabel', 'API 正常')
                        : t('oc.test.vendorRun', '测试 API')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={testGatewayModelConnection} disabled={!currentDevice || gatewayTest === 'testing'} title={!currentDevice ? t('oc.test.gatewayNeedDevice', '需先选择设备') : undefined}>
                    {gatewayTest === 'testing'
                      ? t('oc.test.testing', '...')
                      : gatewayTest === 'ok'
                        ? t('oc.test.gatewayOkLabel', '网关正常')
                        : t('oc.test.gatewayRun', '测试网关')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Channels (Feishu + Pairing) ── */}
          <div className="oc-accordion-item">
            <AccTrigger id="feishu" icon="forum" label={t('oc.channel.title', '消息渠道')} hint={summary.feishu} />
            {accordion === 'feishu' && (
              <div className="oc-accordion-content">
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: 6 }}>{t('oc.feishu.botConfig', '飞书机器人配置')}</div>
                <div className="oc-form-row">
                  <span className="oc-form-label">{t('oc.form.appId', 'App ID')}</span>
                  <input className="input" type="text" value={feishuConfig.appId} onChange={(e) => setFeishuConfig({ ...feishuConfig, appId: e.target.value })} placeholder="cli_..." />
                </div>
                <div className="oc-form-row">
                  <span className="oc-form-label">{t('oc.form.secret', 'Secret')}</span>
                  <input className="input" type="password" value={feishuConfig.appSecret} onChange={(e) => setFeishuConfig({ ...feishuConfig, appSecret: e.target.value })} placeholder="..." />
                </div>
                <div className="oc-form-grid-3">
                  <div className="oc-deploy-field">
                    <label>{t('oc.feishu.conn', '连接')}</label>
                    <select className="select" value={feishuConfig.connectionMode} onChange={(e) => setFeishuConfig({ ...feishuConfig, connectionMode: e.target.value as any })} aria-label={t('oc.aria.connMode', '连接模式')}>
                      <option value="websocket">websocket</option>
                      <option value="webhook">webhook</option>
                    </select>
                  </div>
                  <div className="oc-deploy-field">
                    <label>{t('oc.feishu.domain', '域名')}</label>
                    <select className="select" value={feishuConfig.domain} onChange={(e) => setFeishuConfig({ ...feishuConfig, domain: e.target.value as any })} aria-label={t('oc.aria.domain', '域名')}>
                      <option value="feishu">feishu</option>
                      <option value="lark">lark</option>
                    </select>
                  </div>
                  <div className="oc-deploy-field">
                    <label>{t('oc.feishu.dm', 'DM 策略')}</label>
                    <select className="select" value={feishuConfig.dmPolicy} onChange={(e) => setFeishuConfig({ ...feishuConfig, dmPolicy: e.target.value as any })} aria-label={t('oc.aria.dm', 'DM 策略')}>
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
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => saveConfig('feishu')} disabled={loading}>{loading ? t('oc.test.testing', '...') : t('oc.save', '保存')}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { loadConfig(); addToast?.(t('oc.toast.reloaded', '已加载'), 'info'); }}>{t('oc.reload', '重载')}</button>
                </div>
                <div className="divider" style={{ margin: '10px 0' }} />
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: 4 }}>{t('oc.pairing.gatewayTrustTitle', '网关信任（CLI ↔ Gateway）')}</div>
                <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.35 }}>
                  {t('oc.pairing.gatewayTrustHint', '与下方「渠道配对码」不同：用于板端 openclaw 与本机 18789 网关建立信任，可消除 pairing required。')}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => runAction('gateway-pair', { mode: 'force' })}
                    disabled={loading}
                  >
                    {t('oc.pairing.gatewayPairForce', '一键配对（推荐）')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => runAction('gateway-pair', { mode: 'full' })}
                    disabled={loading}
                  >
                    {t('oc.pairing.gatewayPairFull', '重置并配对')}
                  </button>
                </div>
                <div className="divider" style={{ margin: '10px 0' }} />
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: 6 }}>{t('oc.pairing.title', '配对审批')}</div>
                <div className="oc-pairing-row">
                  <select className="select" value={pairingChannel} onChange={(e) => setPairingChannel(e.target.value)} aria-label={t('oc.aria.pairChannel', '配对渠道')}>
                    <option value="feishu">feishu</option>
                    <option value="telegram">telegram</option>
                    <option value="whatsapp">whatsapp</option>
                    <option value="discord">discord</option>
                    <option value="slack">slack</option>
                  </select>
                  <input className="input" type="text" value={pairingCode} onChange={(e) => setPairingCode(e.target.value.toUpperCase())} placeholder={t('oc.pairing.codePh', '配对码')} />
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => runAction('pairing/approve', { channel: pairingChannel, code: pairingCode.trim() })} disabled={loading || !pairingCode.trim()}>{t('oc.pairing.approve', '批准')}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => runAction('pairing/reject', { channel: pairingChannel, code: pairingCode.trim() })} disabled={loading || !pairingCode.trim()}>{t('oc.pairing.reject', '拒绝')}</button>
                </div>
                <button type="button" className={`chip ${activeOp === 'pairing/list' ? 'active' : ''}`} onClick={() => runAction('pairing/list', { channel: pairingChannel })} disabled={loading} style={{ marginTop: 6, fontSize: '0.6875rem' }}>{t('oc.pairing.listPending', '查看待审批列表')}</button>
              </div>
            )}
          </div>

          {/* ── Skills Config ── */}
          <div className="oc-accordion-item">
            <AccTrigger id="skills" icon="extension" label={t('oc.skills.title', '技能 / 插件')} hint={boardSkills.length > 0 ? tf('oc.skills.hintCount', '{{n}} 个技能', { n: boardSkills.length }) : tf('oc.skills.hintPlugins', '{{n}} 个插件', { n: skillPluginsAllowText.split('\n').filter(Boolean).length })} />
            {accordion === 'skills' && (
              <div className="oc-accordion-content">
                {boardSkills.length > 0 && (
                  <>
                    <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{t('oc.skills.boardInstalled', '板端已安装技能')}</span>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={loadBoardSkills} style={{ fontSize: '0.5625rem', padding: '1px 4px' }}>{t('oc.skills.refresh', '刷新')}</button>
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
                    <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: 4 }}>{t('oc.skills.boardPlugins', '板端已启用插件')}</div>
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
                <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: 4 }}>{t('oc.skills.installLabel', '安装技能')}</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input className="input" value={skillInstallName} onChange={(e) => setSkillInstallName(e.target.value)} placeholder={t('oc.skills.namePh', '技能名称')} onKeyDown={(e) => e.key === 'Enter' && handleInstallSkill()} style={{ flex: 1, fontSize: '0.75rem', padding: '5px 8px' }} />
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => { handleInstallSkill(); setTimeout(loadBoardSkills, 3000); }} disabled={skillInstalling || !skillInstallName.trim()} style={{ fontSize: '0.6875rem' }}>{skillInstalling ? t('oc.test.testing', '...') : t('oc.skills.install', '安装')}</button>
                </div>
                <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {t('oc.skills.installHint', '手动安装会直接执行 clawhub install。复杂技能请用 RDKClaw「技能工坊」或对话生成 SKILL.md 并写入板端。')}
                </div>
                <div className="divider" style={{ margin: '8px 0' }} />
                <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: 4 }}>{t('oc.skills.pluginToggle', '插件开关')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  {pluginCatalog.map((p) => (
                    <button key={p.id} className={`chip ${isPluginEnabled(p.id) ? 'active' : ''}`} onClick={() => togglePluginAllow(p.id)} style={{ fontSize: '0.625rem', padding: '2px 6px' }}>
                      {p.emoji} {p.name} {isPluginEnabled(p.id) && '✓'}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: '0.5625rem', color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 6 }}>
                  {t(
                    'oc.skills.webSearchPolicy',
                    '板端联网搜索：全新安装与在 Studio 保存本页配置时，若未指定引擎会自动写入 DuckDuckGo（免 Key）。要更高质量可在 ~/.openclaw/openclaw.json 将 tools.web.search.provider 改为 brave 并配置 BRAVE_API_KEY（及官方文档中的插件项）；中文检索可在对话中说明使用 country=CN、language=zh。',
                  )}
                </div>
                <div className="oc-form-actions">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => saveConfig('skills')} disabled={loading}>{loading ? t('oc.test.testing', '...') : t('oc.skills.savePlugins', '保存插件')}</button>
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
      {/* ════════════ Left: Chat ════════════ */}
      <div className="oc-main">
        {/* Status bar */}
        <div className="oc-status-bar">
          <div className="oc-status-item">
            <span className={`status-dot ${status?.running ? 'online' : ''}`} />
            <span className="oc-status-label">{t('oc.status.gateway', '网关')}</span>
            <span className="oc-status-value">{statusLoading ? t('oc.test.testing', '...') : status?.running ? t('oc.status.running', '运行中') : t('oc.ops.hint.stop', '停止')}</span>
          </div>
          {status?.version && (
            <div className="oc-status-item">
              <span className="oc-status-label">v</span>
              <span className="oc-status-value">{status.version}</span>
            </div>
          )}
          <div className="oc-status-item">
            <span className="oc-status-label">{t('oc.status.model', '模型')}</span>
            <span className="oc-status-value" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={getCurrentModel()}>
              {getCurrentModel()}
            </span>
          </div>
          <div className="oc-status-item">
            <span className={`status-dot ${status?.feishuConnected ? 'online' : ''}`} />
            <span className="oc-status-label">{t('oc.status.feishu', '飞书')}</span>
            <span className="oc-status-value">{status?.feishuConnected ? t('oc.feishu.connected', '已连接') : t('oc.feishu.disconnected', '未连接')}</span>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            {ocInstalled && (
              <>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => { runAction('restart-gateway'); setShowSetupGuide(true); }}
                  disabled={loading}
                  style={{ fontSize: '0.6875rem' }}
                >
                  {t('oc.ops.restartGw', '重启网关')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void loadStatus()}
                  disabled={statusLoading}
                  style={{ fontSize: '0.6875rem' }}
                >
                  {t('oc.title.refreshStatus', '刷新状态')}
                </button>
              </>
            )}
            {!panelOpen && (
              <button type="button" className="btn-icon" onClick={() => setPanelOpen(true)} title={t('oc.title.openPanel', '打开面板')}>{MI('dock_to_left')}</button>
            )}
            <button type="button" className="btn-icon oc-mobile-panel-btn" onClick={() => setMobilePanel(true)} title={t('oc.title.controlPanel', '控制面板')} style={{ display: 'none' }}>{MI('tune')}</button>
          </div>
        </div>

        {/* Chat header：仅「清空」 */}
        <div className="oc-chat-header" style={{ justifyContent: 'flex-end' }}>
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setChatMessages([]); setChatStreaming(false); }} disabled={chatMessages.length === 0} style={{ fontSize: '0.6875rem' }}>{t('oc.chat.clear', '清空')}</button>
          </span>
        </div>

        {renderDeployMainStrip()}

        {/* Chat messages；一键部署日志与 uninstall 相同，写入下方对话流（>>> deploy + 代码块） */}
        <div className="oc-chat-body">
          {chatMessages.map((msg) => (
            <div key={msg.id} className={`config-chat-msg ${msg.role === 'assistant' ? 'ai' : 'user'}`}>
              {msg.text ? (
                msg.role === 'assistant' ? renderMarkdown(msg.text, t('markdown.copy', '复制')) : msg.text
              ) : (
                msg.role === 'assistant' && chatStreaming ? (
                  <span style={{ display: 'flex', gap: 3 }}><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></span>
                ) : null
              )}
            </div>
          ))}
          {!deployRunning && chatMessages.length === 0 && (
            <div className="oc-chat-empty">
              <div className="oc-chat-empty-icon">{MI('hub')}</div>
              {needsSetup() ? (
                <>
                  <strong>{t('oc.chat.needSetupTitle', 'OpenClaw 需要配置')}</strong>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '4px 0 8px', textAlign: 'center', maxWidth: 320 }}>
                    {!ocInstalled
                      ? t('oc.chat.needInstall', '尚未检测到 OpenClaw CLI。请使用「一键部署」或在板端安装后再试。')
                      : t('oc.chat.needModel', 'OpenClaw 已安装，但模型尚未配置。请在右侧面板中配置模型以启用 AI 对话能力。')}
                  </p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {!ocInstalled && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          setPanelOpen(true);
                          toggleAccordion('deploy');
                        }}
                      >
                        {t('oc.deploy.title', '一键部署 OpenClaw')}
                      </button>
                    )}
                    {ocInstalled && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          setPanelOpen(true);
                          toggleAccordion('model');
                        }}
                      >
                        {t('oc.models.configure', '配置模型')}
                      </button>
                    )}
                  </div>
                </>
              ) : !status?.running ? (
                <>
                  <strong>{t('oc.chat.needStartGwTitle', '网关未运行')}</strong>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '4px 0 8px', textAlign: 'center', maxWidth: 320 }}>
                    {t('oc.chat.needStartGwBody', '对话前需要启动板端 Gateway。可在下方启动，或展开右侧「Gateway 网关」面板操作。')}
                  </p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        runAction('restart-gateway');
                        setShowSetupGuide(true);
                      }}
                      disabled={loading}
                    >
                      {t('oc.ops.restartGw', '重启网关')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void loadStatus()}
                      disabled={statusLoading}
                    >
                      {t('oc.title.refreshStatus', '刷新状态')}
                    </button>
                  </div>
                </>
              ) : (
                <strong>{t('oc.chat.readyTitle', 'OpenClaw Agent 就绪')}</strong>
              )}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* 快捷短语在上，输入框在下（与 Dock 占位一致） */}
        {!deployRunning && (
          <div className="oc-chat-composer">
            <div className="oc-chat-suggestions">
              {quickPrompts.map((item) => (
                <button key={item.label} className="chip" onClick={() => dispatchOpenClawMessage(item.prompt)} disabled={!openclawAgentReady || chatStreaming} style={{ flexShrink: 0, fontSize: '0.6875rem' }}>
                  {item.label}
                </button>
              ))}
              {chatStreaming && (
                <button type="button" className="btn btn-danger btn-sm" onClick={handleStopStream} style={{ flexShrink: 0, fontSize: '0.6875rem' }}>{t('oc.chat.stopGen', '停止生成')}</button>
              )}
            </div>
            <div className="oc-chat-input-row">
              <div className="oc-chat-input-shell">
                <textarea
                  className="oc-chat-textarea dock-cmd-input"
                  rows={1}
                  value={ocComposerText}
                  onChange={(e) => setOcComposerText(e.target.value)}
                  placeholder={t('dock.input.openclaw', '向 OpenClaw Agent 发送消息...')}
                  disabled={!currentDevice || !openclawAgentReady || chatStreaming}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || e.shiftKey || (e.nativeEvent as KeyboardEvent).isComposing) return;
                    e.preventDefault();
                    submitOcComposer();
                  }}
                />
              </div>
              <button
                type="button"
                className={`dock-send-btn${currentDevice && openclawAgentReady && !chatStreaming && ocComposerText.trim() ? ' ready' : ''}`}
                onClick={submitOcComposer}
                disabled={!currentDevice || !openclawAgentReady || chatStreaming || !ocComposerText.trim()}
                title={t('dock.send', '发送')}
              >
                <OcComposerSendIcon />
              </button>
            </div>
          </div>
        )}
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
            <div className="modal-header"><span className="modal-title">{tf('oc.confirm.title', '确认 {{label}}', { label: confirmAction.label })}</span></div>
            <div className="modal-body">{t('oc.confirm.body', '此操作不可撤销。确定继续？')}</div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmAction(null)}>{t('oc.confirm.cancel', '取消')}</button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  const a = confirmAction.action;
                  setConfirmAction(null);
                  void runAction(a);
                }}
                disabled={loading}
              >
                {t('oc.confirm.run', '确认')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
