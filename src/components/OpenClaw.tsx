import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { useAppState } from '../hooks/useAppState';
import { useAIChatStore } from '../hooks/useAIChatStore';
import { fillTemplate } from '../i18n/en-extras';
import { useI18n } from '../i18n/use-i18n';
import { renderMarkdown } from './MarkdownRenderer';
import { resolveSocketUrl, socketIoClientOptions } from '../utils/socket';
import { fetchApi, reportFetchApiFailure, reportFetchApiNetworkFailure } from '../utils/apiBase';
import { sanitizeTerminalLineForDisplay } from '../utils/strip-ansi';
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
import { DEVICE_DIAGNOSTICS_POLL_MS, DEVICE_POLL_PHASE_OPENCLAW_WIFI_TICK_MS } from '../constants';
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

interface ModelHealthSnapshot {
  signature: string;
  lastSuccessAt: number;
  lastFailureAt: number;
  consecutiveFailures: number;
  source: 'manual' | 'chat';
}

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

type OpenClawChatPhase =
  | 'connecting'
  | 'ready'
  | 'thinking'
  | 'responding'
  | 'waiting_rdkclaw'
  | 'need_rdkclaw'
  | 'executing'
  | 'completed'
  | 'error'
  | 'disconnected';

type DeployStepState = 'pending' | 'running' | 'done' | 'error';
type DeployStepName = 'check' | 'prepare' | 'install' | 'config';
interface DeployJob {
  id: string;
  status: 'running' | 'done' | 'error';
  steps: Record<DeployStepName, DeployStepState>;
  output?: string;
  error?: string;
}

type ConfigTab = 'model' | 'feishu';

type SetupStep = 'gateway' | 'model' | 'feishu';
interface SetupStatus {
  /** 一键部署进行中：优先于「已安装」，避免与主区进度条同时显示矛盾文案 */
  gateway: 'ok' | 'warn' | 'error' | 'deploying';
  model: 'ok' | 'warn' | 'unconfigured';
  feishu: 'ok' | 'warn' | 'unconfigured';
}

interface DeployPrecheck {
  network: 'checking' | 'ok' | 'fail' | 'skip';
  deps: 'checking' | 'ok' | 'fail' | 'skip';
  npm: 'checking' | 'ok' | 'fail' | 'skip';
  overall: 'idle' | 'checking' | 'ok' | 'warn' | 'fail';
  detail: string;
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

/** 根据已加载的 modelGateway 推断快速选择 chip（默认对齐火山引擎 / 豆包） */
function inferPresetFromGateway(mg: { baseUrl?: string; modelId?: string }): string {
  const u = (mg.baseUrl || '').trim().toLowerCase();
  const mid = (mg.modelId || '').trim().toLowerCase();
  if (u) {
    for (const [key, preset] of Object.entries(PROVIDER_PRESETS)) {
      const pb = preset.baseUrl.trim().toLowerCase().replace(/\/$/, '');
      const un = u.replace(/\/$/, '');
      if (pb && (un === pb || un.startsWith(pb))) return key;
    }
    if (u.includes('ark.') && u.includes('volces.com')) return 'volcengine';
    if (u.includes('dashscope.aliyuncs.com')) return 'bailian';
  }
  if (mid.startsWith('doubao')) return 'volcengine';
  if (mid.startsWith('qwen')) return 'bailian';
  if (mid.startsWith('deepseek')) return 'deepseek';
  if (mid.startsWith('glm')) return 'zhipu';
  if (!u && !mid) return 'volcengine';
  return '';
}

function getVendorProbeFingerprint(input: {
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  api?: string;
}): string {
  return JSON.stringify({
    baseUrl: String(input.baseUrl || '').trim(),
    apiKey: String(input.apiKey || '').trim(),
    modelId: String(input.modelId || '').trim(),
    api: String(input.api || '').trim(),
  });
}

function getModelHealthSignature(input: {
  baseUrl?: string;
  modelId?: string;
  api?: string;
  primaryModel?: string;
  runtimeProvider?: string;
}): string {
  return JSON.stringify({
    baseUrl: String(input.baseUrl || '').trim(),
    modelId: String(input.modelId || '').trim(),
    api: String(input.api || '').trim(),
    primaryModel: String(input.primaryModel || '').trim(),
    runtimeProvider: String(input.runtimeProvider || '').trim(),
  });
}

const MODEL_HEALTH_STORAGE_PREFIX = 'oc-model-health';
const MODEL_HEALTH_CONSECUTIVE_FAILS = 2;

const DEPLOY_LOG_MAX_LINES = 2500;
const DEPLOY_STEP_ETA_SECONDS: Record<DeployStepName, number> = {
  check: 15,
  prepare: 45,
  install: 600,
  config: 20,
};

function sanitizeDeployLogLine(line: string): string {
  return sanitizeTerminalLineForDisplay(line)
    .replace(/^\uFEFF/, '')
    .replace(/\u200B/g, '');
}

/** 后端在异常结束时可能仍保留某步为 running，需在前端收敛为 error，避免步骤条永远转圈 */
function normalizeDeployStepsFromJob(job: DeployJob): DeployStepState[] {
  const stepOrder: DeployStepName[] = ['check', 'prepare', 'install', 'config'];
  const out = stepOrder.map((name) => job.steps?.[name] || 'pending');

  if (job.status !== 'error') {
    return out;
  }

  const mapped = out.map((s) => (s === 'running' ? 'error' : s));
  if (mapped.some((s) => s === 'error')) {
    return mapped;
  }

  if (mapped.every((s) => s === 'done')) {
    const next: DeployStepState[] = [...mapped];
    next[next.length - 1] = 'error';
    return next;
  }

  const firstNonDone = mapped.findIndex((s) => s !== 'done');
  if (firstNonDone >= 0) {
    const next: DeployStepState[] = [...mapped];
    next[firstNonDone] = 'error';
    return next;
  }

  return mapped;
}

/** npm / shell 输出行语义分类，用于终端风格着色（类似 CI 日志） */
function deployLogLineClass(line: string): string {
  const s = line.trim();
  if (!s) return 'blank';
  if (/npm ERR!/i.test(s)) return 'err';
  if (/npm WARN/i.test(s)) return 'warn';
  if (/^npm http (fetch|cache)/i.test(s)) {
    if (/\(cache hit\)/i.test(s) || /cache hit/i.test(s)) return 'cache';
    return 'http';
  }
  if (/^npm (info|notice)/i.test(s)) return 'info';
  if (/^(added|removed|changed)\s+\d+\s+packages?/i.test(s) || /^audited\s+\d+/i.test(s) || /vulnerabilit/i.test(s)) return 'summary';
  if (/^\+[\s@/]|^└|^├|^│/.test(s)) return 'tree';
  if (/\b(fatal|FATAL|error:)\b/i.test(s) && !/0 error/i.test(s)) return 'err';
  return 'default';
}

function OcDeployLogPanel({
  text,
  deployRunning,
  waitingLabel,
  addToast,
  copyOk,
  copyFail,
  title,
  subtitle,
  truncatedHint,
  copyLabel,
  copyEmptyHint,
  liveLabel,
}: {
  text: string;
  deployRunning: boolean;
  waitingLabel: string;
  addToast?: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  copyOk: string;
  copyFail: string;
  title: string;
  subtitle: string;
  truncatedHint: string;
  copyLabel: string;
  /** 无日志时禁用「复制」的说明（悬停可见） */
  copyEmptyHint?: string;
  liveLabel: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { lines, truncated, lineNoStart } = useMemo(() => {
    const raw = text || '';
    const all = raw.split('\n');
    const over = all.length > DEPLOY_LOG_MAX_LINES;
    const sliced = over ? all.slice(-DEPLOY_LOG_MAX_LINES) : all;
    const start = over ? all.length - sliced.length + 1 : 1;
    return { lines: sliced, truncated: over, lineNoStart: start };
  }, [text]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [text]);

  const copyAll = () => {
    const v = (text || '').trim();
    if (!v) return;
    void navigator.clipboard.writeText(text).then(
      () => addToast?.(copyOk, 'success'),
      () => addToast?.(copyFail, 'error'),
    );
  };

  const showPlaceholder = !text.trim() && !deployRunning;

  return (
    <div className="oc-deploy-log-panel">
      <div className="oc-deploy-log-toolbar">
        <div className="oc-deploy-log-toolbar-left">
          <span className="material-symbols-outlined oc-deploy-log-toolbar-icon" aria-hidden>terminal</span>
          <div className="oc-deploy-log-toolbar-text">
            <span className="oc-deploy-log-title">{title}</span>
            <span className="oc-deploy-log-subtitle">{subtitle}</span>
          </div>
        </div>
        <div className="oc-deploy-log-toolbar-right">
          {deployRunning ? (
            <span className="oc-deploy-log-live" aria-live="polite">
              <span className="oc-deploy-log-live-dot" />
              {liveLabel}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm oc-deploy-log-copy"
            onClick={copyAll}
            disabled={!text.trim()}
            title={text.trim() ? copyLabel : copyEmptyHint}
          >
            {copyLabel}
          </button>
        </div>
      </div>
      {truncated ? (
        <div className="oc-deploy-log-truncated" role="note">
          {truncatedHint}
        </div>
      ) : null}
      <div className="oc-deploy-log-body" ref={scrollRef} role="log" aria-label={title}>
        {showPlaceholder ? (
          <div className="oc-deploy-log-placeholder">{waitingLabel}</div>
        ) : (
          lines.map((line, i) => {
            const cls = deployLogLineClass(line);
            const display = sanitizeDeployLogLine(line);
            const no = lineNoStart + i;
            return (
              <div key={`${no}-${i}`} className={`oc-deploy-log-line oc-deploy-log-line--${cls}`}>
                <span className="oc-deploy-log-gutter">{no}</span>
                <span className="oc-deploy-log-text">{display.length ? display : ' '}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Component
   ═══════════════════════════════════════════ */

export default function OpenClaw() {
  const { currentDevice, addToast, registerOpenclawSend, activeTab, setShowAddDevice, setDevices } = useAppState();
  const chatStore = useAIChatStore();
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

  const deployStepLabels = useMemo(
    () => [
      t('oc.deploy.step.check', '诊断'),
      t('oc.deploy.step.deps', '依赖'),
      t('oc.deploy.step.install', '安装'),
      t('oc.deploy.step.config', '配置'),
    ],
    [t, language],
  );

  // ─── Data State ───
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [config, setConfig] = useState<ConfigData | null>(null);
  /** 仅用于保存配置 / 测试厂商 API，避免与套件端长任务 `activeOp` 混用导致整页按钮被锁死 */
  const [configBusy, setConfigBusy] = useState(false);
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
  const [chatPhase, setChatPhase] = useState<OpenClawChatPhase>('connecting');
  /** 页面内对话输入（快捷 chip 下方） */
  const [ocComposerText, setOcComposerText] = useState('');
  /** `openclaw:ready` 仅保证 SSH 会话就绪，需结合状态接口判断 Agent 是否真可用 */
  const openclawAgentReady = useMemo(
    () => chatConnected && !statusLoading && ocInstalled && !!status?.running,
    [chatConnected, statusLoading, ocInstalled, status?.running],
  );

  // ─── Model Config State（未拉取套件端配置前与产品默认「豆包 / 火山引擎」对齐）───
  const [modelConfig, setModelConfig] = useState(() => {
    const v = PROVIDER_PRESETS.volcengine;
    return {
      baseUrl: v.baseUrl,
      apiKey: '',
      api: v.api,
      modelId: v.models[0] || '',
      modelName: v.label,
    };
  });
  /** 写入套件端 `agents.defaults`（OpenClaw）；空字符串表示不覆盖该项 */
  const [agentDefaults, setAgentDefaults] = useState({
    thinkingDefault: '',
    reasoning: '',
  });
  const [vendorApiTest, setVendorApiTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [vendorApiProbe, setVendorApiProbe] = useState<{ status: 'unknown' | 'ok' | 'fail'; fingerprint: string }>({
    status: 'unknown',
    fingerprint: '',
  });
  const [modelHealthSnapshot, setModelHealthSnapshot] = useState<ModelHealthSnapshot | null>(null);
  /** Background model API reachability status (auto-checked when gateway running + config loaded) */
  const [modelApiReachable, setModelApiReachable] = useState<'unknown' | 'checking' | 'ok' | 'fail'>('unknown');

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

  // ─── Operations State ───
  const [activeOp, setActiveOp] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: string; label: string } | null>(null);

  // ─── Deploy Wizard State ───
  const [deployProvider, setDeployProvider] = useState('volcengine');
  const [deployBaseUrl, setDeployBaseUrl] = useState(() => PROVIDER_PRESETS.volcengine.baseUrl);
  const [deployApiKey, setDeployApiKey] = useState('');
  const [deployModelId, setDeployModelId] = useState(() => PROVIDER_PRESETS.volcengine.models[0] || '');
  const [deployApi, setDeployApi] = useState('openai-completions');
  const [deployNpmRegistry, setDeployNpmRegistry] = useState('');
  const [deployFeishuAppId, setDeployFeishuAppId] = useState('');
  const [deployFeishuAppSecret, setDeployFeishuAppSecret] = useState('');
  /** 与 RDKClaw 设置中当前模型一致：已在服务端保存 API Key（或环境变量 OPENAI_API_KEY） */
  const [deployHasStudioKey, setDeployHasStudioKey] = useState(false);
  const [deployRunning, setDeployRunning] = useState(false);
  const [deploySteps, setDeploySteps] = useState<DeployStepState[]>([]);
  const [deployJobId, setDeployJobId] = useState('');
  const [deployOutput, setDeployOutput] = useState('');
  /** 最近一次失败原因（用于步骤条旁醒目提示 + 与聊天区摘要一致） */
  const [deployLastError, setDeployLastError] = useState('');
  /** 安装阶段长时间无新日志时提示（非错误） */
  const [deployCancelLoading, setDeployCancelLoading] = useState(false);
  const [deployPrecheck, setDeployPrecheck] = useState<DeployPrecheck>({
    network: 'skip',
    deps: 'skip',
    npm: 'skip',
    overall: 'idle',
    detail: '',
  });
  const [deployStepEtaSec, setDeployStepEtaSec] = useState<number | null>(null);
  const [deployStepElapsedSec, setDeployStepElapsedSec] = useState<number>(0);
  /** 一键部署或取消部署请求进行中：与套件端 SSH/安装冲突，需锁定网关类操作 */
  const boardDeployBusy = deployRunning || deployCancelLoading;

  // ─── Device network (WiFi/Ethernet) link state ───
  const [deviceNetUp, setDeviceNetUp] = useState<boolean | null>(null);
  useEffect(() => {
    if (!currentDevice) { setDeviceNetUp(null); return; }
    const id = currentDevice.id;
    let cancelled = false;
    const probe = async () => {
      const s = await fetchWifiLinkState(id);
      if (!cancelled) setDeviceNetUp(s.state === 'up');
    };
    void probe();
    const iv = setInterval(probe, DEVICE_POLL_PHASE_OPENCLAW_WIFI_TICK_MS);
    return () => { cancelled = true; clearInterval(iv); };
  }, [currentDevice?.id]);

  /** 输入框可编辑（仅发送受 `openclawAgentReady` 约束），避免「全灰无说明」 */
  const ocComposerEditable = useMemo(
    () => !!currentDevice && ocInstalled && !statusLoading && !deployRunning && !chatStreaming,
    [currentDevice, ocInstalled, statusLoading, deployRunning, chatStreaming],
  );

  const currentVendorProbeFingerprint = useMemo(
    () => getVendorProbeFingerprint(modelConfig),
    [modelConfig.baseUrl, modelConfig.apiKey, modelConfig.modelId, modelConfig.api],
  );

  const currentBoardModelHealthSignature = useMemo(
    () => getModelHealthSignature({
      baseUrl: config?.modelGateway?.baseUrl,
      modelId: config?.modelGateway?.modelId,
      api: config?.modelGateway?.api,
      primaryModel: config?.primaryModel,
      runtimeProvider: config?.runtimeModel?.provider,
    }),
    [config?.modelGateway?.baseUrl, config?.modelGateway?.modelId, config?.modelGateway?.api, config?.primaryModel, config?.runtimeModel?.provider],
  );

  const localVendorApiVerifiedForCurrentConfig = useMemo(
    () => vendorApiProbe.status === 'ok' && vendorApiProbe.fingerprint === currentVendorProbeFingerprint,
    [vendorApiProbe, currentVendorProbeFingerprint],
  );

  const modelHealthStorageKey = currentDevice ? `${MODEL_HEALTH_STORAGE_PREFIX}-${currentDevice.id}` : '';

  const writeModelHealthSnapshot = useCallback((next: ModelHealthSnapshot | null) => {
    setModelHealthSnapshot(next);
    if (!modelHealthStorageKey) return;
    try {
      if (next) localStorage.setItem(modelHealthStorageKey, JSON.stringify(next));
      else localStorage.removeItem(modelHealthStorageKey);
    } catch { /* ignore */ }
  }, [modelHealthStorageKey]);

  const markModelHealthy = useCallback((source: 'manual' | 'chat', signatureOverride?: string) => {
    const signature = signatureOverride || currentBoardModelHealthSignature;
    if (!signature) return;
    const now = Date.now();
    writeModelHealthSnapshot({
      signature,
      lastSuccessAt: now,
      lastFailureAt: 0,
      consecutiveFailures: 0,
      source,
    });
  }, [currentBoardModelHealthSignature, writeModelHealthSnapshot]);

  const markModelFailure = useCallback((source: 'manual' | 'chat', signatureOverride?: string, hard = false) => {
    const signature = signatureOverride || currentBoardModelHealthSignature;
    if (!signature) return;
    const now = Date.now();
    const prev = modelHealthSnapshot && modelHealthSnapshot.signature === signature ? modelHealthSnapshot : null;
    writeModelHealthSnapshot({
      signature,
      lastSuccessAt: prev?.lastSuccessAt || 0,
      lastFailureAt: now,
      consecutiveFailures: hard ? MODEL_HEALTH_CONSECUTIVE_FAILS : Math.max(1, (prev?.consecutiveFailures || 0) + 1),
      source,
    });
  }, [currentBoardModelHealthSignature, modelHealthSnapshot, writeModelHealthSnapshot]);

  const hasHardModelFailureForCurrentConfig = useMemo(
    () => !!(
      currentBoardModelHealthSignature
      && modelHealthSnapshot?.signature === currentBoardModelHealthSignature
      && modelHealthSnapshot.consecutiveFailures >= MODEL_HEALTH_CONSECUTIVE_FAILS
      && modelHealthSnapshot.lastFailureAt >= modelHealthSnapshot.lastSuccessAt
    ),
    [currentBoardModelHealthSignature, modelHealthSnapshot],
  );

  const getChatPhaseLabel = useCallback((phase: OpenClawChatPhase) => {
    switch (phase) {
      case 'connecting': return t('oc.chat.phase.connecting', '连接中');
      case 'ready': return t('oc.chat.phase.ready', '已就绪');
      case 'thinking': return t('oc.chat.phase.thinking', '思考中');
      case 'responding': return t('oc.chat.phase.responding', '回复中');
      case 'waiting_rdkclaw': return t('oc.chat.phase.waitingRdkclaw', '等待 RDKClaw 放行');
      case 'need_rdkclaw': return t('oc.chat.phase.needRdkclaw', '需要 RDKClaw 补充信息');
      case 'executing': return t('oc.chat.phase.executing', '执行中');
      case 'completed': return t('oc.chat.phase.completed', '已完成');
      case 'error': return t('oc.chat.phase.error', '异常');
      case 'disconnected': return t('oc.chat.phase.disconnected', '已断开');
      default: return t('oc.chat.phase.connecting', '连接中');
    }
  }, [t]);

  const getChatPhaseHint = useCallback((phase: OpenClawChatPhase) => {
    switch (phase) {
      case 'thinking': return t('oc.chat.phaseHint.thinking', '套件端 Agent 正在整理上下文与计划，请稍候。');
      case 'responding': return t('oc.chat.phaseHint.responding', '套件端 Agent 已开始回传结果。');
      case 'waiting_rdkclaw': return t('oc.chat.phaseHint.waitingRdkclaw', '套件端正在做对齐确认，等待 RDKClaw 补充或放行后再继续执行。');
      case 'need_rdkclaw': return t('oc.chat.phaseHint.needRdkclaw', '套件端缺少联网文档或上游信息，正在请求 RDKClaw 补充。');
      case 'executing': return t('oc.chat.phaseHint.executing', '套件端已进入执行阶段，正在落地命令或技能链。');
      case 'error': return t('oc.chat.phaseHint.error', '本轮对话出现异常，可查看最后一条错误信息。');
      case 'disconnected': return t('oc.chat.phaseHint.disconnected', '设备会话已断开，系统会在需要时自动重连。');
      case 'completed': return t('oc.chat.phaseHint.completed', '本轮已完成，可以继续下一轮。');
      case 'ready': return t('oc.chat.phaseHint.ready', '套件端会话已就绪，可以开始对话。');
      default: return t('oc.chat.phaseHint.connecting', '正在建立与套件端的协作会话。');
    }
  }, [t]);

  const chatPhaseToneClass = useMemo(() => {
    switch (chatPhase) {
      case 'completed':
      case 'ready':
        return 'is-ok';
      case 'error':
      case 'disconnected':
        return 'is-error';
      case 'waiting_rdkclaw':
      case 'need_rdkclaw':
      case 'thinking':
      case 'executing':
      case 'responding':
        return 'is-warn';
      default:
        return '';
    }
  }, [chatPhase]);

  const ocComposerBlockHint = useMemo(() => {
    if (!currentDevice || !ocInstalled || deployRunning) return '';
    if (statusLoading) return t('oc.composer.hint.statusLoading', '正在同步网关状态…');
    if (!chatConnected) return t('oc.composer.hint.connecting', '正在建立与设备的会话，请稍候…');
    if (chatStreaming) return getChatPhaseHint(chatPhase);
    if (!status?.running) return t('oc.composer.hint.gatewayDown', '网关未运行：请先点击「重启网关」或等待自动恢复后再发送。');
    if (deviceNetUp === false) return t('oc.composer.hint.networkOffline', '开发者套件未联网：对话需要访问云端模型 API，请先为开发者套件连接 Wi‑Fi 或网线。');
    if (!hasBoardModelSelection()) return t('oc.composer.hint.modelMissing', '尚未配置模型：请先在右侧面板保存模型配置后再发送。');
    if (!hasBoardModelCredentials()) return t('oc.composer.hint.modelCredentialMissing', '已选择模型，但未检测到可用 API Key；请在右侧补全凭据后再发送。');
    if (modelApiReachable === 'fail') {
      return localVendorApiVerifiedForCurrentConfig
        ? t('oc.composer.hint.modelApiBoardFailAfterVendorOk', '厂商 API 已验证可用，但套件端实际链路仍失败：请检查是否已保存到套件端、网关信任、套件端网络或运行时密钥。')
        : t('oc.composer.hint.modelApiFail', '模型连通检查失败：请检查 API Key、Base URL、网关信任状态或网络后重试。');
    }
    return '';
  }, [currentDevice, ocInstalled, deployRunning, statusLoading, chatConnected, chatStreaming, chatPhase, status?.running, deviceNetUp, modelApiReachable, config?.primaryModel, config?.modelGateway?.modelId, config?.modelGateway?.apiKey, config?.runtimeModel?.apiKey, localVendorApiVerifiedForCurrentConfig, t, getChatPhaseHint]);

  // ─── Post-install Guide State ───
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [dashboardTab, setDashboardTab] = useState<'gateway' | 'model' | 'feishu'>('gateway');
  const [setupStep, setSetupStep] = useState<SetupStep>('gateway');

  // ─── UI State ───
  const [panelOpen, setPanelOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [configTab, setConfigTab] = useState<ConfigTab>('model');
  const [modelGatewayApiKeyVisible, setModelGatewayApiKeyVisible] = useState(false);
  const [deployApiKeyVisible, setDeployApiKeyVisible] = useState(false);
  /** Studio agent-config 中的模型条目，供套件端委派预选 */
  const [studioDelegateModels, setStudioDelegateModels] = useState<Array<{ id: string; label: string; model: string }>>([]);
  const [delegateEntryId, setDelegateEntryId] = useState('');
  const [delegatePresetSaving, setDelegatePresetSaving] = useState(false);

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
  const deployStepStartedAtRef = useRef<number>(0);
  useEffect(() => {
    deployRunningRef.current = deployRunning;
  }, [deployRunning]);

  useEffect(() => {
    if (!deployRunning || deploySteps.length === 0) {
      setDeployStepEtaSec(null);
      setDeployStepElapsedSec(0);
      deployStepStartedAtRef.current = 0;
      return;
    }
    const idx = deploySteps.findIndex((s) => s === 'running');
    if (idx < 0) return;
    const order: DeployStepName[] = ['check', 'prepare', 'install', 'config'];
    const step = order[idx];
    const eta = DEPLOY_STEP_ETA_SECONDS[step] || null;
    setDeployStepEtaSec(eta);
    deployStepStartedAtRef.current = Date.now();
    setDeployStepElapsedSec(0);
    const iv = setInterval(() => {
      const elapsed = Math.round((Date.now() - deployStepStartedAtRef.current) / 1000);
      setDeployStepElapsedSec(elapsed);
    }, 1000);
    return () => clearInterval(iv);
  }, [deployRunning, deploySteps]);
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

  /** 预检 SSH 输出中的「依赖」失败：只认明确缺 node/npm 或 command not found，避免把「--- Node/NPM ---」、systemd「could not be found」等正常诊断文案误判 */
  const openclawDepPrecheckLooksFailed = (outLower: string) => {
    if (/\bnode 未安装\b/.test(outLower)) return true;
    if (/\bnpm 未安装\b/.test(outLower)) return true;
    if (/\bnode:\s*command not found\b/.test(outLower)) return true;
    if (/\bnpm:\s*command not found\b/.test(outLower)) return true;
    if (/command not found.*\bnode\b/.test(outLower)) return true;
    if (/command not found.*\bnpm\b/.test(outLower)) return true;
    if (/\bsh:\s*1?:\s*node:\s*not found\b/.test(outLower)) return true;
    if (/\bsh:\s*1?:\s*npm:\s*not found\b/.test(outLower)) return true;
    return false;
  };

  const runDeployPrecheck = async () => {
    if (!currentDevice || deployRunning) return;
    setDeployPrecheck({ network: 'checking', deps: 'checking', npm: 'checking', overall: 'checking', detail: '' });
    try {
      const statusRes = await fetchApi(`/api/devices/${currentDevice.id}/openclaw/status`);
      if (!statusRes.ok) {
        setDeployPrecheck({ network: 'fail', deps: 'skip', npm: 'skip', overall: 'fail', detail: `HTTP ${statusRes.status}` });
        return;
      }
      const checkRes = await fetchApi(`/api/devices/${currentDevice.id}/openclaw/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await checkRes.json().catch(() => ({} as { output?: string; error?: string }));
      const out = String(data?.output || data?.error || '').toLowerCase();
      const hasNpmErr = /npm err!|npm err|eai_again|etimedout|enetunreach|econnrefused|fetch.*failed|registry.*(?:timeout|timed out|reset)/i.test(out);
      const hasDepErr = openclawDepPrecheckLooksFailed(out);
      const ok = checkRes.ok && !hasDepErr;
      setDeployPrecheck({
        network: checkRes.ok ? (hasNpmErr ? 'fail' : 'ok') : 'fail',
        deps: ok ? 'ok' : 'fail',
        npm: hasNpmErr ? 'fail' : 'ok',
        overall: ok && !hasNpmErr ? 'ok' : (ok ? 'warn' : 'fail'),
        detail: String(data?.output || data?.error || '').slice(-300),
      });
      if (ok) {
        addToast?.(tRef.current('oc.deploy.precheck.ok', '预检完成：设备可安装 OpenClaw'), 'success');
      } else {
        addToast?.(tRef.current('oc.deploy.precheck.warn', '预检发现风险，建议先修复后再安装'), 'warning');
      }
    } catch (e: any) {
      setDeployPrecheck({ network: 'fail', deps: 'fail', npm: 'fail', overall: 'fail', detail: e?.message || '' });
      addToast?.(tRef.current('oc.deploy.precheck.fail', '预检失败，请检查设备连接后重试'), 'error');
    }
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
      void loadStatus();
      /** 「模型」页由专用 effect 顺序执行 loadConfig + 预选填充，避免覆盖 */
      if (dashboardTab !== 'model') {
        void loadConfig();
      }
    }
  }, [currentDevice, activeTab, dashboardTab]);

  useEffect(() => {
    if (!modelHealthStorageKey) {
      setModelHealthSnapshot(null);
      return;
    }
    try {
      const raw = localStorage.getItem(modelHealthStorageKey);
      if (!raw) {
        setModelHealthSnapshot(null);
        return;
      }
      const parsed = JSON.parse(raw) as ModelHealthSnapshot;
      setModelHealthSnapshot(parsed && typeof parsed.signature === 'string' ? parsed : null);
    } catch {
      setModelHealthSnapshot(null);
    }
  }, [modelHealthStorageKey, currentBoardModelHealthSignature]);

  /** Derive model readiness from prerequisites + cached real outcomes; avoid active probes that consume tokens */
  useEffect(() => {
    if (!currentDevice || activeTab !== 'openclaw') return;
    if (!status?.running || statusLoading) { setModelApiReachable('unknown'); return; }
    if (!hasBoardModelSelection()) { setModelApiReachable('unknown'); return; }
    if (deviceNetUp === false) { setModelApiReachable('fail'); return; }
    if (!hasBoardModelCredentials()) { setModelApiReachable('unknown'); return; }
    setModelApiReachable(hasHardModelFailureForCurrentConfig ? 'fail' : 'ok');
  }, [currentDevice?.id, activeTab, status?.running, statusLoading, config?.modelGateway?.modelId, config?.primaryModel, config?.runtimeModel?.apiKey, deviceNetUp, hasHardModelFailureForCurrentConfig]);

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
      setPanelOpen(true);
    }
  }, [activeTab, currentDevice, ocDeployPanelHintKey, status?.installed, status?.version, statusLoading, deployRunning]);

  /** 套件端已连 Wi‑Fi 且未安装 OpenClaw 时，使用工作室侧已保存的模型配置自动发起部署（与 POST /deploy/start 服务端逻辑一致） */
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
      if (cancelled || wifi.state !== 'up') return;

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
                '套件端已连接 Wi‑Fi，但工作室未保存模型凭据，无法自动安装 OpenClaw。请在设置中配置模型，或使用一键部署手动填写。',
              ),
              'info',
            );
          }
          return;
        }
        setDeployLastError('');
        setDeployRunning(true);
        setDeploySteps(['running', 'pending', 'pending', 'pending']);
        setDeployOutput('');
        deployLogBubbleInitializedRef.current = false;
        setPanelOpen(true);
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

    let ocKick: ReturnType<typeof setTimeout> | null = null;
    let iv: ReturnType<typeof setInterval> | null = null;
    ocKick = setTimeout(() => {
      void tick();
      iv = setInterval(tick, DEVICE_DIAGNOSTICS_POLL_MS);
    }, DEVICE_POLL_PHASE_OPENCLAW_WIFI_TICK_MS);
    return () => {
      cancelled = true;
      if (ocKick) clearTimeout(ocKick);
      if (iv) clearInterval(iv);
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
      setChatPhase('disconnected');
      return;
    }

    const socket = io(resolveSocketUrl(), socketIoClientOptions);
    socketRef.current = socket;

    socket.on('connect', () => {
      setChatConnected(false);
      setChatPhase('connecting');
      socket.emit('openclaw:start', { deviceId: currentDevice.id });
    });
    socket.on('openclaw:ready', () => {
      setChatConnected(true);
      setChatPhase('ready');
      void loadStatus();
    });
    socket.on('openclaw:phase', (data: { phase?: OpenClawChatPhase }) => {
      if (data?.phase) setChatPhase(data.phase);
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
      setChatPhase('completed');
      let completedWithUsefulAssistantText = false;
      setChatMessages((prev) => {
        const last = prev[prev.length - 1];
        completedWithUsefulAssistantText = !!(last && last.role === 'assistant' && last.text.trim() && !last.text.startsWith(tRef.current('oc.chat.errorPrefix', '**错误：**')));
        if (last && last.role === 'assistant' && !last.text.trim()) {
          return [...prev.slice(0, -1), { ...last, text: tRef.current('oc.chat.emptyResponse', 'OpenClaw 未返回有效内容，请检查网关状态或设备密码。') }];
        }
        return prev;
      });
      if (completedWithUsefulAssistantText) {
        markModelHealthy('chat');
      }
    });
    socket.on('openclaw:error', (data: { error: string }) => {
      setChatStreaming(false);
      setChatPhase('error');
      markModelFailure('chat');
      setChatMessages((prev) => [...prev, {
        id: nextChatMessageId(),
        role: 'assistant',
        text: `${tRef.current('oc.chat.errorPrefix', '**错误：**')} ${data.error}`,
      }]);
      addToast?.(data.error || tRef.current('oc.toast.chatErr', 'OpenClaw 对话异常'), 'error');
    });
    socket.on('openclaw:disconnected', () => { setChatConnected(false); setChatStreaming(false); setChatPhase('disconnected'); });
    socket.on('disconnect', () => { setChatConnected(false); setChatStreaming(false); setChatPhase('disconnected'); });
    socket.on('connect_error', () => { setChatConnected(false); setChatStreaming(false); setChatPhase('error'); });

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
      if (data.modelGateway) {
        setModelConfig(data.modelGateway);
      }
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
      return data;
    } catch (e: any) {
      addToast?.(tf('oc.toast.configFail', '加载配置失败: {{msg}}', { msg: e?.message || t('oc.err.network', '网络错误') }), 'error');
      return null;
    }
  };

  /** 将 Studio agent-config 中某条目的字段写入本页大模型表单（用于「预选模型」） */
  const applyStudioEntryToModelForm = (entry: {
    provider: string;
    model: string;
    baseUrl?: string;
    apiKey?: string;
    label?: string;
  }) => {
    const prov = String(entry.provider || '').trim();
    const api =
      prov === 'anthropic' || prov === 'anthropic-compatible' ? 'anthropic-messages' : 'openai-completions';
    const baseUrl = (entry.baseUrl || '').trim();
    const modelId = (entry.model || '').trim();
    const key = String(entry.apiKey || '');
    setModelConfig({
      baseUrl,
      modelId,
      apiKey: key,
      api,
      modelName: (entry.label || '').trim() || modelId,
    });
  };

  /**
   * 进入「模型」页：拉取 Studio 预选列表；先 loadConfig 再应用预选条目，避免套件端配置覆盖预选填充。
   */
  useEffect(() => {
    if (activeTab !== 'openclaw' || dashboardTab !== 'model' || !currentDevice) return;
    let cancelled = false;
    (async () => {
      const cfg = await fetchAgentConfig().catch(() => null);
      if (cancelled || !cfg) return;
      const models = cfg.models ?? [];
      setStudioDelegateModels(models.map((m) => ({ id: m.id, label: m.label, model: m.model })));
      const presetId = cfg.openclawDelegateProviderId?.trim() || '';
      setDelegateEntryId(presetId);

      await loadConfig();
      if (cancelled) return;

      if (presetId) {
        try {
          const res = await fetchApi(`/api/agent/config/entry/${encodeURIComponent(presetId)}`);
          const data = await res.json().catch(() => ({}));
          if (!res.ok || cancelled) return;
          if (data?.entry) {
            applyStudioEntryToModelForm(data.entry);
          }
        } catch {
          /* 预拉失败不拦截；用户仍可手动选预选 */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, dashboardTab, currentDevice?.id]);

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
    const out = (job.output || '')
      .split('\n')
      .map((l) => {
        const p = l.split('\r').filter((x) => x.trim().length > 0);
        const last = p.length > 0 ? p[p.length - 1] : '';
        return sanitizeDeployLogLine(last);
      })
      .join('\n');
    setDeployOutput(out);
    if (job.status === 'running') {
      setDeployLastError('');
      setDeploySteps(stepOrder.map((name) => job.steps?.[name] || 'pending'));
      setDeployRunning(true);
      return;
    }

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
      setDeployLastError('');
      setDeploySteps([]);
      addToast?.(tRef.current('oc.deploy.doneToast', '部署完成，网关正在重启'), 'success');
      setTimeout(async () => {
        await loadConfig();
        await loadStatus();
        if (deployFeishuAppId.trim() && deployFeishuAppSecret.trim()) {
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
            addToast?.(tRef.current('oc.toast.feishuSaved', '飞书配置已保存'), 'success');
            setTimeout(() => { loadConfig(); loadStatus(); }, 1500);
          } catch {
            addToast?.(tRef.current('oc.deploy.feishuFail', '飞书配置写入失败，请在控制面板中手动配置。'), 'warning');
          }
        }
        setShowSetupGuide(true);
        setSetupStep('model');
        setPanelOpen(true);
      }, 1200);
      return;
    }
    const err =
      job.error === 'oc.deployPoll.interrupted'
        ? tRef.current(
            'oc.deployPoll.interrupted',
            '长时间无法拉取部署进度（烧录或本机繁忙时常见）；套件端可能仍在安装。请查看下方日志或稍后重试。',
          )
        : job.error || tRef.current('oc.deploy.fail', '部署失败，请查看日志输出');
    setDeployLastError(err);
    setDeploySteps(normalizeDeployStepsFromJob(job));
    addToast?.(fillTemplate(tRef.current('oc.deploy.failMsg', '部署失败：{{detail}}'), { detail: err }), 'error');
  };

  applyDeployJobRef.current = applyDeployJob;

  const getActionLabel = (action: string) => {
    const map: Record<string, string> = { check: '诊断检查', doctor: '诊断并修复', 'restart-gateway': '重启网关', logs: '获取运行日志', prepare: '环境准备', upgrade: '升级 OpenClaw', uninstall: '卸载 OpenClaw', install: '安装 OpenClaw', 'gateway-pair': '信任本地网关身份' };
    return map[action] || action;
  };

  const runAction = async (action: string, body?: any) => {
    if (!currentDevice) return;
    setActiveOp(action);

    const isSlow = SLOW_ACTIONS.has(action);
    const startTime = Date.now();
    const actionLabel = getActionLabel(action);
    appendSystemMessage(`**任务: ${actionLabel}**\n\n正在后场执行，请稍候...`);

    let progressTimer: ReturnType<typeof setInterval> | null = null;
    if (isSlow) {
      progressTimer = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        updateLastAssistant(`**任务: ${actionLabel}**\n\n执行中 (${elapsed}s)\n\n_${action === 'install' || action === 'upgrade' || action === 'uninstall' ? '终端后台守护可能需要几分钟，若无新行请耐心等待执行完毕...' : '正在向套件端代理下发系统指令...' }_`);
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
        reportFetchApiFailure(res.status, `/api/devices/${currentDevice.id}/openclaw/${action}`, {
          message: t('oc.toast.badResponse', '操作完成，但响应格式异常'),
          code: 'BAD_RESPONSE_BODY',
        });
        return;
      }

      if (!res.ok) {
        const errMsg = data.error || data.message || `HTTP ${res.status}`;
        updateLastAssistant(`\`>>> ${action}\` _(${elapsed}s)_\n\n${t('oc.chat.errorPrefix', '**错误：**')} ${errMsg}`);
        reportFetchApiFailure(res.status, `/api/devices/${currentDevice.id}/openclaw/${action}`, data);
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
      const path = `/api/devices/${currentDevice.id}/openclaw/${action}`;
      const msg = err.name === 'AbortError'
        ? tf('oc.run.timeout', '操作超时 ({{s}}s)，命令可能仍在套件端运行', { s: Math.round(fetchTimeout / 1000) })
        : err.message;
      updateLastAssistant(`\`>>> ${action}\` _(${elapsed}s)_\n\n${t('oc.chat.errorPrefix', '**错误：**')} ${msg}`);
      if (err.name === 'AbortError') {
        reportFetchApiNetworkFailure(path, err, { aborted: true, messageOverride: msg });
      } else {
        reportFetchApiNetworkFailure(path, err, { messageOverride: msg });
      }
    } finally {
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
    setChatPhase('thinking');
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

    const requestBody: { config: typeof payload; persistOpenclawDelegatePreset?: string | null } = { config: payload };
    if (activeTab === 'model') {
      requestBody.persistOpenclawDelegatePreset = delegateEntryId.trim() || null;
    }

    setConfigBusy(true);
    try {
      const res = await fetchApi(`/api/devices/${currentDevice.id}/openclaw/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
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
      setConfigBusy(false);
    }
  };

  const testVendorApiConnection = async () => {
    if (!modelConfig.baseUrl.trim() || !modelConfig.apiKey.trim() || !modelConfig.modelId.trim()) {
      addToast?.(t('oc.test.vendorMissing', '请填写 Base URL、模型 ID 与 API Key'), 'warning');
      return;
    }
    const fingerprint = getVendorProbeFingerprint(modelConfig);
    const healthSignature = getModelHealthSignature({
      baseUrl: modelConfig.baseUrl,
      modelId: modelConfig.modelId,
      api: modelConfig.api,
      primaryModel: config?.primaryModel,
      runtimeProvider: config?.runtimeModel?.provider,
    });
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
      setVendorApiProbe({ status: passed ? 'ok' : 'fail', fingerprint });
      if (passed) markModelHealthy('manual', healthSignature);
      else markModelFailure('manual', healthSignature, true);
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
      setVendorApiProbe({ status: 'fail', fingerprint });
      markModelFailure('manual', healthSignature, true);
      addToast?.(t('oc.test.vendorFailNet', '厂商 API 测试失败（网络或服务异常）'), 'error');
    }
    setTimeout(() => setVendorApiTest('idle'), 5000);
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
      setDeployLastError('');
      setDeployRunning(true);
      setDeploySteps(['running', 'pending', 'pending', 'pending']);
      setDeployOutput('');
      setPanelOpen(true);
      const res = await fetchApi(`/api/devices/${currentDevice.id}/openclaw/deploy/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: deployProvider || 'custom',
          baseUrl,
          apiKey: deployApiKey.trim() || undefined,
          modelId: deployModelId.trim(),
          api,
          npmRegistry: deployNpmRegistry.trim() || undefined,
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

  /** 仅清前面板进度与轮询（不阻止 Wi‑Fi 自动安装） */
  const clearDeployUiState = (deviceId: string) => {
    stopDeployPolling();
    try {
      localStorage.removeItem(ocDeployJobLsKey(deviceId));
    } catch { /* ignore */ }
    setDeployRunning(false);
    setDeployJobId('');
    setDeploySteps([]);
    setDeployOutput('');
    setDeployLastError('');
    deployLogBubbleInitializedRef.current = false;
  };

  const stopLocalDeployAndBlockWifiAuto = (deviceId: string) => {
    try {
      sessionStorage.setItem(openclawWifiAutoUserBlockKey(deviceId), '1');
    } catch { /* ignore */ }
    try {
      sessionStorage.removeItem(`oc-wifi-auto-pending-${deviceId}`);
    } catch { /* ignore */ }
    clearDeployUiState(deviceId);
  };

  const handleCancelDeploy = async () => {
    if (!currentDevice || deployCancelLoading) return;

    const devId = currentDevice.id;

    if (!deployRunning && deploySteps.length > 0) {
      clearDeployUiState(devId);
      addToast?.(t('oc.deploy.dismissProgress', '已关闭部署进度'), 'info');
      return;
    }

    if (!deployRunning) return;
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

  /** 一键部署：四步进度条 + 取消部署（进行中中断；已失败/结束时关闭进度条） */
  const renderDeployMainStrip = () => {
    if (!deployRunning && deploySteps.length === 0) return null;
    const deployFailed = !deployRunning && deploySteps.some((s) => s === 'error');
    const canRetryDeploy = deployModelId.trim() && (deployApiKey.trim() || deployHasStudioKey);
    return (
      <div className={`oc-deploy-main-strip${deployFailed ? ' oc-deploy-main-strip--failed' : ''}`}>
        <div className="oc-deploy-main-strip-head">
          <span className="oc-deploy-main-strip-title">
            {deployRunning
              ? t('oc.deploy.mainStripRunning', '一键部署进行中')
              : deployFailed
                ? t('oc.deploy.mainStripFailed', '部署失败')
                : t('oc.deploy.mainStripProgress', '部署进度')}
          </span>
          <div className="oc-deploy-main-strip-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void handleCancelDeploy()}
              disabled={deployCancelLoading}
              title={
                deployCancelLoading
                  ? t('oc.ops.cancelBusy', '正在请求取消…')
                  : deployRunning
                    ? t('oc.deploy.cancelBtn', '取消部署')
                    : t('oc.deploy.closeStripBtn', '关闭')
              }
            >
              {deployCancelLoading
                ? t('oc.test.testing', '...')
                : deployRunning
                  ? t('oc.deploy.cancelBtn', '取消部署')
                  : t('oc.deploy.closeStripBtn', '关闭')}
            </button>
          </div>
        </div>
        {deployFailed && deployLastError.trim() ? (
          <div className="oc-deploy-main-hint oc-deploy-main-hint--error" role="alert">
            <span className="material-symbols-outlined oc-deploy-main-hint-icon" aria-hidden>
              error
            </span>
            <div className="oc-deploy-main-hint-body">
              <strong>{t('oc.deploy.failureBannerTitle', '任务已结束')}</strong>
              <p>{deployLastError}</p>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleOneClickInstall()}
                disabled={deployRunning || !canRetryDeploy}
                title={
                  !canRetryDeploy
                    ? t('oc.deploy.retryNeedModel', '请先填写模型 ID，并在 RDKClaw 设置中保存密钥或在此填写 API Key')
                    : undefined
                }
              >
                {t('oc.deploy.retryDeploy', '重新部署')}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void runAction('doctor')}
                disabled={!!activeOp || boardDeployBusy}
                title={boardDeployBusy ? t('oc.ops.disabledDuringDeploy', '部署进行中，请稍候再操作') : undefined}
              >
                {t('oc.deploy.quickRepair', '一键诊断修复')}
              </button>
            </div>
          </div>
        ) : null}
        {deployRunning ? (
          <div className="oc-deploy-main-hint" role="status" style={{ marginBottom: 8 }}>
            <span className="material-symbols-outlined oc-deploy-main-hint-icon" aria-hidden>
              schedule
            </span>
            <div className="oc-deploy-main-hint-body">
              <strong>{t('oc.deploy.eta.title', '安装进度提示')}</strong>
              <p>
                {deployStepEtaSec
                  ? (deployStepElapsedSec > deployStepEtaSec
                      ? tf('oc.deploy.eta.exceeded', '当前步骤已运行 {{elapsed}}s（超出预估 {{eta}}s），仍在执行中，请耐心等待…', { elapsed: deployStepElapsedSec, eta: deployStepEtaSec })
                      : tf('oc.deploy.eta.running', '当前步骤已运行 {{elapsed}}s，预计约 {{eta}}s（网络波动会影响耗时）', { elapsed: deployStepElapsedSec, eta: deployStepEtaSec }))
                  : tf('oc.deploy.eta.fallback', '当前步骤已运行 {{elapsed}}s', { elapsed: deployStepElapsedSec })}
              </p>
            </div>
          </div>
        ) : null}
        {renderDeployProgressTrack()}
      </div>
    );
  };

  /* ─── Helpers ─── */

  /** 套件端 OpenClaw 当前主模型（来自设备上的配置） */
  const getBoardModelNameForDisplay = () => {
    if (!config) return t('oc.summary.notConfigured', '未配置');
    if (config.primaryModel) {
      const parts = config.primaryModel.split('/');
      return parts.length > 1 ? parts[1] : config.primaryModel;
    }
    if (config.modelGateway?.modelId?.trim()) return config.modelGateway.modelId.trim();
    return t('oc.summary.notConfigured', '未配置');
  };

  function hasBoardModelSelection() {
    return !!(config?.primaryModel?.trim() || config?.modelGateway?.modelId?.trim());
  }

  function hasBoardModelCredentials() {
    return !!(config?.modelGateway?.apiKey?.trim() || config?.runtimeModel?.apiKey?.trim());
  }

  const getCurrentModel = () => getBoardModelNameForDisplay();

  /**
   * 顶栏「模型」：默认等于套件端当前模型。
   * 若已选「委派预选」且与套件端不一致，则显示「预选模型 · 板:套件端模型」，避免误以为预选未保存。
   */
  const getStatusBarModelDisplay = () => {
    const board = getBoardModelNameForDisplay();
    const id = delegateEntryId.trim();
    if (!id) return board;
    const entry = studioDelegateModels.find((m) => m.id === id);
    const d = entry?.model?.trim();
    if (!d) return board;
    if (d.toLowerCase() === board.toLowerCase()) return board;
    return `${d} · ${t('oc.status.boardShort', '板')}:${board}`;
  };

  const getStatusBarModelTitle = () => {
    const board = getBoardModelNameForDisplay();
    const id = delegateEntryId.trim();
    if (!id) {
      return t('oc.status.modelTitleBoardOnly', '此为套件端 OpenClaw 当前使用的模型（设备上的配置）。');
    }
    const entry = studioDelegateModels.find((m) => m.id === id);
    if (!entry) {
      return t('oc.status.modelTitleBoardOnly', '此为套件端 OpenClaw 当前使用的模型（设备上的配置）。');
    }
    return tf(
      'oc.status.modelTitleDelegate',
      '套件端当前：{{board}}。委派预检将写入 Studio 条目「{{label}}」（{{model}}）。若希望套件端对话也使用该模型，请在本页「大模型」保存相同配置并重启网关。',
      { board, label: entry.label, model: entry.model },
    );
  };

  const getModelStatusTitle = () => {
    if (modelApiReachable === 'ok') {
      return t('oc.status.modelApiOk', '模型 API 连通正常');
    }
    if (modelApiReachable === 'fail') {
      if (localVendorApiVerifiedForCurrentConfig) {
        return t('oc.status.modelReachabilityBoardFailAfterVendorOk', '本机直连厂商 API 已通过，但套件端实际链路仍不可达；请检查是否已保存到套件端、网关信任、套件端网络或运行时密钥。');
      }
      return t('oc.status.modelReachabilityFail', '模型连通检查失败 — 请检查 API Key、Base URL、网关信任或网络。');
    }
    if (modelApiReachable === 'checking') {
      return t('oc.status.modelApiChecking', '正在检测模型 API 连通性…');
    }
    if (hasBoardModelSelection()) {
      return hasBoardModelCredentials()
        ? t('oc.status.modelConfiguredPending', '模型已配置；将在条件满足时继续检测连通性。')
        : t('oc.status.modelCredentialsMissing', '已选择模型，但未检测到可用凭据；请在本页保存 API Key，或确认运行时 provider 已配置密钥。');
    }
    return getStatusBarModelTitle();
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
    const modelOk = hasBoardModelSelection() && hasBoardModelCredentials();
    const feishuOk = !!(config?.feishu?.appId && config?.feishu?.appSecret);
    if (deployRunning || deployCancelLoading) {
      return {
        gateway: 'deploying',
        model: modelOk ? 'ok' : 'unconfigured',
        feishu: feishuOk ? 'ok' : 'unconfigured',
      };
    }
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
    // deploying 阶段不把网关计为已完成，避免 3/3 与「安装中」并存
    if (s.model === 'ok') done++;
    if (s.feishu === 'ok') done++;
    return done;
  };

  const needsSetup = () => {
    const installed = !!(status?.installed ?? status?.version?.trim());
    const modelOk = hasBoardModelSelection() && hasBoardModelCredentials();
    return !installed || !modelOk;
  };

  const modelStatusDotClass =
    modelApiReachable === 'ok'
      ? 'online'
      : modelApiReachable === 'fail'
        ? (localVendorApiVerifiedForCurrentConfig ? 'warn' : 'offline')
        : hasBoardModelSelection()
          ? 'warn'
          : '';

  const modelStatusBadgeText =
    modelApiReachable === 'fail'
      ? (localVendorApiVerifiedForCurrentConfig
        ? t('oc.status.modelBoardOnlyFailShort', '套件端不可达')
        : t('oc.status.modelApiFailShort', 'API 不可达'))
      : '';

  const modelStatusBadgeColor = localVendorApiVerifiedForCurrentConfig
    ? 'var(--warning)'
    : 'var(--danger)';

  const MI = (name: string, cls?: string) => (
    <span className={`material-symbols-outlined ${cls || ''}`}>{name}</span>
  );

  const OcApiKeyRow = ({
    value,
    onChange,
    placeholder,
    visible,
    onToggleVisible,
    disabled = false,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    visible: boolean;
    onToggleVisible: () => void;
    disabled?: boolean;
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
          disabled={disabled}
        />
        <button
          type="button"
          className="oc-secret-toggle"
          onClick={onToggleVisible}
          disabled={disabled}
          aria-label={visible ? t('oc.aria.hideApiKey', '隐藏 API Key') : t('oc.aria.showApiKey', '显示 API Key')}
          aria-pressed={visible}
          title={visible ? t('oc.aria.hideApiKey', '隐藏 API Key') : t('oc.aria.showApiKey', '显示 API Key')}
        >
          {MI(visible ? 'visibility_off' : 'visibility', 'oc-secret-toggle-icon')}
        </button>
      </div>
    </div>
  );

  /* ═══════════════════════════════════════════
     Render - Empty State
     ═══════════════════════════════════════════ */

  if (!currentDevice) {
    return (
      <div className="config-page page-center">
        <div className="empty-state">
          <div className="empty-state-icon">{MI('hub')}</div>
          <h3 className="empty-state-title">{t('oc.empty.title', '连接设备后管理 OpenClaw')}</h3>
          <p className="empty-state-desc">{t('oc.empty.desc', '先添加并选择一台 RDK 开发者套件，即可部署与配置 OpenClaw。')}</p>
          <button type="button" className="btn btn-primary" onClick={() => setShowAddDevice(true)}>
            {t('oc.empty.addDevice', '添加设备')}
          </button>
        </div>
      </div>
    );
  }

  const summary = getConfigSummary();

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
          setupStatus.gateway === 'deploying'
            ? t('oc.setup.ocDeploying', '一键部署中…')
            : setupStatus.gateway === 'ok'
              ? (status?.running
                  ? (deviceNetUp === false ? t('oc.setup.ocRunningNoNet', '运行中 · 未联网') : t('oc.setup.ocWithGw', '已安装 · 网关运行中'))
                  : t('oc.setup.ocInstalledOnly', '已安装'))
              : setupStatus.gateway === 'warn'
                ? t('oc.status.checking', '检测中...')
                : t('oc.status.notInstalled', '未安装'),
        statusClass:
          setupStatus.gateway === 'deploying'
            ? 'badge-accent'
            : setupStatus.gateway === 'ok'
              ? (status?.running && deviceNetUp === false ? 'badge-accent' : 'badge-ok')
              : setupStatus.gateway === 'warn' ? 'badge-accent' : 'badge-danger',
        action: () => {
          setPanelOpen(true);
          setDashboardTab('gateway');
        },
        actionLabel:
          setupStatus.gateway === 'deploying'
            ? t('oc.action.viewProgress', '查看进度')
            : setupStatus.gateway === 'ok'
              ? t('oc.action.view', '查看')
              : t('oc.action.deploy', '一键部署 OpenClaw'),
      },
      {
        key: 'model',
        icon: 'psychology',
        label: t('oc.setup.model', '模型'),
        status: setupStatus.model === 'ok'
          ? getCurrentModel()
          : hasBoardModelSelection()
            ? t('oc.setup.modelNeedsCredential', '已选模型，待补凭据')
            : t('oc.summary.notConfigured', '未配置'),
        statusClass: setupStatus.model === 'ok' ? 'badge-ok' : hasBoardModelSelection() ? 'badge-accent' : 'badge-muted',
        action: () => {
          setPanelOpen(true);
          setConfigTab('model');
          setDashboardTab('model');
        },
        actionLabel: setupStatus.model === 'ok' ? t('oc.action.edit', '修改') : t('oc.action.configure', '配置'),
      },
      {
        key: 'feishu',
        icon: 'forum',
        label: t('oc.setup.feishu', '飞书'),
        status: setupStatus.feishu === 'ok' ? t('oc.summary.configured', '已配置') : t('oc.summary.notConfigured', '未配置'),
        statusClass: setupStatus.feishu === 'ok' ? 'badge-ok' : 'badge-muted',
        action: () => {
          setPanelOpen(true);
          setConfigTab('feishu');
          setDashboardTab('feishu');
        },
        actionLabel: setupStatus.feishu === 'ok' ? t('oc.action.edit', '修改') : t('oc.action.configure', '配置'),
      },
    ];

    return (
      <div className="oc-setup-checklist">
        <div className="oc-setup-checklist-header">
          <span className="oc-setup-checklist-header-title">
            {MI('checklist', 'oc-setup-icon')}
            <span>{t('oc.setup.header', '配置状态')}</span>
          </span>
          <span className="oc-setup-progress">{setupDone}/3</span>
        </div>
        <div className="oc-setup-checklist-body">
          {items.map((item) => (
            <div key={item.key} className={`oc-setup-item ${setupStep === item.key && showSetupGuide ? 'highlight' : ''}`}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                {MI(item.icon)}
                <span className="oc-setup-item-label">{item.label}</span>
                <span className={`badge ${item.statusClass}`} style={{ fontSize: '0.75rem' }}>{item.status}</span>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm oc-setup-item-action"
                onClick={item.action}
                style={{ fontSize: '0.75rem', padding: '2px 8px', flexShrink: 0 }}
                disabled={
                  boardDeployBusy &&
                  item.key === 'gateway' &&
                  setupStatus.gateway !== 'ok' &&
                  setupStatus.gateway !== 'deploying'
                }
                aria-busy={
                  boardDeployBusy &&
                  item.key === 'gateway' &&
                  setupStatus.gateway !== 'ok' &&
                  setupStatus.gateway !== 'deploying'
                }
                title={
                  boardDeployBusy &&
                  item.key === 'gateway' &&
                  setupStatus.gateway !== 'ok' &&
                  setupStatus.gateway !== 'deploying'
                    ? t('oc.setup.actionDisabledDeploying', '部署进行中，请稍候')
                    : undefined
                }
              >
                {item.actionLabel}
              </button>
            </div>
          ))}
        </div>
        {deviceNetUp === false && setupStatus.gateway === 'ok' && (
          <div className="oc-setup-guide-hint" style={{ borderColor: 'var(--color-accent, #e67e22)' }}>
            {t('oc.setup.hint.networkOffline', '开发者套件当前未联网，网关虽在运行但无法访问云端模型。请先通过右上角 WiFi 图标为开发者套件配网。')}
          </div>
        )}
        {showSetupGuide && needsSetup() && (
          <div className="oc-setup-guide-hint">
            {(deployRunning || deployCancelLoading)
              ? t('oc.setup.hint.deploying', '正在执行一键部署，请稍候完成安装与配置写入。')
              : setupStatus.gateway !== 'ok'
                ? (ocInstalled
                  ? t('oc.setup.hint.recoverGateway', 'OpenClaw 已安装，但网关还没有恢复起来。请点击上方「重启网关」，或在右侧面板保存一次配置以触发修复。')
                  : t('oc.setup.hint.needInstall', '请先安装 OpenClaw：使用「一键部署」或展开下方面板按步骤安装'))
                : setupStatus.model !== 'ok'
              ? t('oc.setup.hint.model', 'OpenClaw 已安装，请配置模型以启用对话')
              : t('oc.setup.hint.feishu', '基础配置已完成！可选配置飞书以接入消息渠道')}
            <button className="btn btn-ghost btn-sm" onClick={() => setShowSetupGuide(false)} style={{ fontSize: '0.75rem', marginLeft: 'auto' }}>{t('oc.setup.dismiss', '关闭引导')}</button>
          </div>
        )}
      </div>
    );
  };

  /** 一键部署前：套件端需能访问外网（信息提示，避免与主 CTA 抢同一套橙色） */
  const deployWifiPrereqNotice = (
    <div role="note" className="oc-deploy-wifi-prereq">
      <span className="oc-deploy-wifi-prereq-icon" aria-hidden>{MI('wifi')}</span>
      <p className="oc-deploy-wifi-prereq-text">
        {t(
          'oc.deploy.wifiPrereq',
          '一键部署需要从套件端下载依赖，请先为开发者套件连接 Wi‑Fi（或网线）并确保能访问互联网。若尚未配网，可点击界面右上角的 Wi‑Fi 图标进行配网，完成后再开始部署。',
        )}
      </p>
    </div>
  );


  const renderSetupWizard = () => (
    <div className="oc-setup-wizard">
      <div className="oc-setup-wizard-card">
        <header className="oc-setup-wizard-hero">
          <div className="oc-setup-wizard-icon-wrap" aria-hidden>
            {MI('rocket_launch')}
          </div>
          <h1 className="oc-setup-wizard-title">{t('oc.deploy.title', '一键部署 OpenClaw')}</h1>
          <p className="oc-setup-wizard-lead">
            {t('oc.chat.needInstall', '尚未检测到 OpenClaw CLI。请使用「一键部署」安装运行时与依赖，再在套件端配置模型。')}
          </p>
        </header>

        {deployWifiPrereqNotice}

        <section className="oc-setup-wizard-section" aria-labelledby="oc-deploy-model-heading">
          <h2 id="oc-deploy-model-heading" className="oc-setup-wizard-section-title">
            {t('oc.setup.header', '配置大模型 (可选，部署后可改)')}
          </h2>
          <div className="oc-setup-wizard-precheck" role="status" aria-live="polite">
            <div className="oc-setup-wizard-precheck-head">
              <strong>{t('oc.deploy.precheck.title', '安装前预检')}</strong>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void runDeployPrecheck()}
                disabled={deployRunning || deployPrecheck.overall === 'checking'}
              >
                {deployPrecheck.overall === 'checking' ? t('oc.deploy.precheck.running', '预检中...') : t('oc.deploy.precheck.run', '运行预检')}
              </button>
            </div>
            <div className="oc-setup-wizard-precheck-items">
              <span className={`badge ${deployPrecheck.network === 'ok' ? 'badge-ok' : deployPrecheck.network === 'fail' ? 'badge-danger' : 'badge-muted'}`}>{t('oc.deploy.precheck.network', '网络')}:{deployPrecheck.network}</span>
              <span className={`badge ${deployPrecheck.deps === 'ok' ? 'badge-ok' : deployPrecheck.deps === 'fail' ? 'badge-danger' : 'badge-muted'}`}>{t('oc.deploy.precheck.deps', '依赖')}:{deployPrecheck.deps}</span>
              <span className={`badge ${deployPrecheck.npm === 'ok' ? 'badge-ok' : deployPrecheck.npm === 'fail' ? 'badge-danger' : 'badge-muted'}`}>npm:{deployPrecheck.npm}</span>
            </div>
            {deployPrecheck.detail ? <p className="oc-setup-wizard-precheck-detail">{deployPrecheck.detail}</p> : null}
            <p className="oc-setup-wizard-micro">
              {t(
                'oc.deploy.precheck.notBlocking',
                '预检仅作参考，不会禁用「开始部署」。尚未安装 OpenClaw 时，诊断里网关未运行、openclaw 未安装属预期。',
              )}
            </p>
          </div>
          <p className="oc-setup-wizard-micro">{t('oc.deploy.defaultConfigHint', '默认沿用 RDKClaw 当前模型配置；你也可以在下方手动覆盖。')}</p>
          <p className="oc-setup-wizard-studio-sync">{t('oc.deploy.syncedWithStudio', '模型与 Base URL 默认与 RDKClaw 设置中的当前模型对齐；若已保存 API Key，可直接部署无需重复填写。')}</p>

          <div className="oc-setup-wizard-fields">
            <div className="oc-form-row">
              <span className="oc-form-label">{t('oc.form.baseUrl', 'Base URL')}</span>
              <input
                className="input"
                type="text"
                value={deployBaseUrl}
                onChange={(e) => { setDeployBaseUrl(e.target.value); setDeployProvider(''); }}
                placeholder="https://ark.cn-beijing.volces.com/api/v3"
                disabled={deployRunning}
              />
            </div>
            <div className="oc-form-row">
              <span className="oc-form-label">{t('oc.form.modelId', '模型 ID')}</span>
              <input
                className="input"
                type="text"
                value={deployModelId}
                onChange={(e) => setDeployModelId(e.target.value)}
                placeholder="doubao-1.5-pro-256k / deepseek-chat"
                disabled={deployRunning}
              />
            </div>
            <div className="oc-form-row">
              <span className="oc-form-label">{t('oc.deploy.npmRegistry', 'npm 源 (可选)')}</span>
              <select
                className="select"
                value={deployNpmRegistry}
                onChange={(e) => setDeployNpmRegistry(e.target.value)}
                disabled={deployRunning}
              >
                <option value="">{t('oc.deploy.npmRegistry.auto', '自动 (默认)')}</option>
                <option value="https://registry.npmmirror.com">npmmirror.com</option>
                <option value="https://registry.npmjs.org">registry.npmjs.org</option>
              </select>
            </div>
            <OcApiKeyRow
              value={deployApiKey}
              onChange={setDeployApiKey}
              placeholder={deployProvider && PROVIDER_PRESETS[deployProvider]?.keyHint || 'sk-...'}
              visible={deployApiKeyVisible}
              onToggleVisible={() => setDeployApiKeyVisible((v) => !v)}
              disabled={deployRunning}
            />
          </div>

          <div className="oc-setup-wizard-cta">
            <button
              type="button"
              className="btn btn-primary oc-setup-wizard-submit"
              onClick={() => void handleOneClickInstall()}
              disabled={deployRunning || !deployModelId.trim() || (!deployApiKey.trim() && !deployHasStudioKey)}
            >
              {deployRunning ? t('oc.deploy.runningShort', '部署中...') : t('oc.deploy.startBtn', '开始部署')}
            </button>
          </div>
        </section>

        {(deployRunning || deployOutput.trim() || deploySteps.length > 0) && (
          <div className="oc-setup-deploy-block">
            {renderDeployMainStrip()}
            <OcDeployLogPanel
              text={deployOutput}
              deployRunning={deployRunning}
              waitingLabel={t('oc.deploy.waitingLogs', '等待输出…')}
              addToast={addToast}
              copyOk={t('oc.deploy.copyOk', '日志已复制到剪贴板')}
              copyFail={t('oc.deploy.copyFail', '复制失败，请手动选择日志')}
              title={t('oc.deploy.logPanelTitle', '套件端安装日志')}
              subtitle={t('oc.deploy.logPanelSubtitle', 'SSH 实时输出 · npm 下载与安装可能持续数分钟')}
              truncatedHint={tf('oc.deploy.logTruncated', '日志过长，仅显示最后 {{n}} 行', { n: DEPLOY_LOG_MAX_LINES })}
              copyLabel={t('oc.deploy.copyLog', '复制全部')}
              copyEmptyHint={t('oc.deploy.copyEmptyHint', '暂无可复制的日志')}
              liveLabel={t('oc.deploy.badgeLive', '实时')}
            />
            <div className="oc-setup-deploy-actions">
              {deployCancelLoading ? (
                <button type="button" className="btn btn-ghost btn-sm" disabled>{t('oc.test.testing', '...')}</button>
              ) : deployRunning ? (
                <button type="button" className="btn btn-danger btn-sm" onClick={() => void handleCancelDeploy()}>{t('oc.deploy.cancelBtn', '取消部署')}</button>
              ) : null}
              {!deployRunning && !!deployOutput && deployOutput.length > 50 && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm oc-setup-ai-help-btn"
                  onClick={() => {
                    chatStore.setChatExpanded(true);
                    chatStore.handleCommand(
                      { preventDefault: () => {} } as any,
                      {
                        messageOverride:
                          '我在 RDK 部署 OpenClaw 时遇到卡点/失败，请帮我分析原因并提供最简单确切的解决命令方案(如果有 apt / node js 安装网络问题，请告诉我怎么解决)：\n\n```\n'
                          + deployOutput.slice(-2500)
                          + '\n```',
                        chatPreviewText: t('oc.deploy.aiHelpPreview', '请根据部署日志分析卡点'),
                      },
                    );
                  }}
                >
                  {t('oc.deploy.aiHelp', '让助手分析此日志')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderDashboardTabs = () => (
    <div className="oc-panel-body">
      <div className="oc-panel-nav" role="tablist" aria-label={t('oc.panel.title', '控制面板')}>
        {(['gateway', 'model', 'feishu'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={dashboardTab === tab}
            className={`oc-tab-btn ${dashboardTab === tab ? 'active' : ''}`}
            onClick={() => setDashboardTab(tab)}
          >
            {tab === 'gateway' ? t('oc.ops.gateway', 'Gateway 网关') : tab === 'model' ? t('oc.setup.model', '模型') : t('oc.setup.feishu', '接入飞书')}
          </button>
        ))}
      </div>

      <div className="oc-panel-tab-scroll">
        {dashboardTab === 'gateway' && (
          <div className="oc-tab-content">
            <div style={{ marginBottom: 20 }}>{renderSetupChecklist()}</div>
            <span className="oc-section-title">{t('oc.ops.gateway', 'Gateway 网关')}</span>
            <div className="oc-actions-grid">
              <button type="button" className={`chip ${activeOp === 'check' ? 'active' : ''}`} onClick={() => runAction('check')} disabled={activeOp === 'check' || boardDeployBusy} title={boardDeployBusy ? t('oc.ops.disabledDuringDeploy', '部署进行中，请稍候再操作') : undefined}>{t('oc.ops.check', '诊断检查')}</button>
              <button type="button" className={`chip ${activeOp === 'doctor' ? 'active' : ''}`} onClick={() => runAction('doctor')} disabled={activeOp === 'doctor' || boardDeployBusy} title={boardDeployBusy ? t('oc.ops.disabledDuringDeploy', '部署进行中，请稍候再操作') : undefined}>{t('oc.ops.doctor', '诊断并修复')}</button>
              <button type="button" className={`chip ${activeOp === 'restart-gateway' ? 'active' : ''}`} onClick={() => runAction('restart-gateway')} disabled={activeOp === 'restart-gateway' || boardDeployBusy} title={boardDeployBusy ? t('oc.ops.disabledDuringDeploy', '部署进行中，请稍候再操作') : undefined}>{t('oc.ops.restartGw', '重启网关')}</button>
              <button type="button" className={`chip ${activeOp === 'logs' ? 'active' : ''}`} onClick={() => runAction('logs', { limit: 300 })} disabled={activeOp === 'logs' || boardDeployBusy} title={boardDeployBusy ? t('oc.ops.disabledDuringDeploy', '部署进行中，请稍候再操作') : undefined}>{t('oc.ops.logs', '查看日志')}</button>
            </div>
            
            <div className="divider oc-divider-spaced" />
            <span className="oc-section-title">{t('oc.ops.prepare', '升级管线')}</span>
            <div className="oc-actions-grid">
              <button type="button" className={`chip ${activeOp === 'prepare' ? 'active' : ''}`} onClick={() => runAction('prepare')} disabled={activeOp === 'prepare' || boardDeployBusy} title={boardDeployBusy ? t('oc.ops.disabledDuringDeploy', '部署进行中，请稍候再操作') : undefined}>{t('oc.ops.prepare', '环境准备')}</button>
              <button type="button" className={`chip ${activeOp === 'upgrade' ? 'active' : ''}`} onClick={() => runAction('upgrade')} disabled={activeOp === 'upgrade' || boardDeployBusy} title={boardDeployBusy ? t('oc.ops.disabledDuringDeploy', '部署进行中，请稍候再操作') : undefined}>{t('oc.ops.upgrade', '升级')}</button>
              <button
                type="button"
                className="chip oc-chip-danger"
                onClick={() => setConfirmAction({ action: 'uninstall', label: t('oc.ops.uninstall', '卸载 OpenClaw') })}
                disabled={!!activeOp || boardDeployBusy}
                title={boardDeployBusy ? t('oc.ops.disabledDuringDeploy', '部署进行中，请稍候再操作') : undefined}
              >
                {t('oc.uninstall', '卸载')}
              </button>
            </div>
            
            <div className="divider oc-divider-spaced" />
            <span className="oc-section-title">{t('oc.deploy.title', '重新部署 / 修复')}</span>
            <p className="oc-section-lead">{t('oc.deploy.panelRedeployLead', '直接在这里修改配置可再次下发全局部署。')}</p>
            <div className="oc-deploy-inline-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleOneClickInstall()} disabled={deployRunning} title={deployRunning ? t('oc.ops.disabledDuringDeploy', '部署进行中，请稍候再操作') : undefined}>{t('oc.deploy.startBtn', '开始部署')}</button>
              {deployRunning && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void handleCancelDeploy()}
                  disabled={deployCancelLoading}
                  title={deployCancelLoading ? t('oc.ops.cancelBusy', '正在请求取消…') : t('oc.deploy.cancelBtn', '取消部署')}
                >
                  {t('oc.deploy.cancelBtn', '取消部署')}
                </button>
              )}
            </div>
          </div>
        )}

        {dashboardTab === 'model' && (
          <div className="oc-tab-content">
            <span className="oc-section-title">{t('oc.setup.model', '大模型 API 配置')}</span>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              {t(
                'oc.boardDelegate.hint.compact',
                '默认使用 RDKClaw 当前模型。你可在此选择一个已保存条目并自动填充下方字段，再保存写入套件端。',
              )}
            </div>
            <div className="oc-form-row">
              <span className="oc-form-label">{t('oc.boardDelegate.preset', '默认模型')}</span>
              <select
                className="select"
                value={delegateEntryId}
                onChange={(e) => {
                  const v = e.target.value;
                  setDelegateEntryId(v);
                  if (!v) {
                    void loadConfig();
                    return;
                  }
                  setDelegatePresetSaving(true);
                  void fetchApi(`/api/agent/config/entry/${encodeURIComponent(v)}`)
                    .then(async (res) => {
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        addToast?.(
                          tf('oc.boardDelegate.loadEntryFail', '无法加载该模型条目: {{msg}}', {
                            msg: String(data?.message || data?.error || res.status),
                          }),
                          'error',
                        );
                        return;
                      }
                      const ent = data?.entry;
                      if (ent) applyStudioEntryToModelForm(ent);
                    })
                    .catch((err: unknown) => {
                      addToast?.(
                        tf('oc.boardDelegate.loadEntryFail', '无法加载该模型条目: {{msg}}', {
                          msg: err instanceof Error ? err.message : String(err),
                        }),
                        'error',
                      );
                    })
                    .finally(() => setDelegatePresetSaving(false));
                }}
                disabled={delegatePresetSaving || boardDeployBusy}
                aria-label={t('oc.boardDelegate.preset', '默认模型')}
              >
                <option value="">{t('oc.boardDelegate.followDock', '与 RDKClaw 当前模型保持一致（默认）')}</option>
                {studioDelegateModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.model}
                  </option>
                ))}
              </select>
            </div>
            <div className="oc-form-row">
              <span className="oc-form-label">{t('oc.form.baseUrl', 'Base URL')}</span>
              <input
                className="input"
                type="text"
                value={modelConfig.baseUrl}
                onChange={(e) => { setModelConfig({ ...modelConfig, baseUrl: e.target.value }); }}
                placeholder="https://ark.cn-beijing.volces.com/api/v3"
                disabled={configBusy || boardDeployBusy}
              />
            </div>
            <div className="oc-form-row">
              <span className="oc-form-label">{t('oc.form.modelId', '模型 ID')}</span>
              <input
                className="input"
                type="text"
                value={modelConfig.modelId}
                onChange={(e) => setModelConfig({ ...modelConfig, modelId: e.target.value })}
                placeholder="doubao-1.5-pro-256k / deepseek-chat / gpt-4o"
                disabled={configBusy || boardDeployBusy}
              />
            </div>
            <OcApiKeyRow
              value={modelConfig.apiKey}
              onChange={(apiKey) => setModelConfig({ ...modelConfig, apiKey })}
              placeholder={'sk-...'}
              visible={modelGatewayApiKeyVisible}
              onToggleVisible={() => setModelGatewayApiKeyVisible((v) => !v)}
              disabled={configBusy || boardDeployBusy}
            />
            <div className="oc-form-row">
              <span className="oc-form-label">{t('oc.form.protocol', '协议')}</span>
              <select
                className="select"
                value={modelConfig.api}
                onChange={(e) => setModelConfig({ ...modelConfig, api: e.target.value })}
                aria-label={t('oc.aria.apiProtocol', 'API 协议')}
                disabled={configBusy || boardDeployBusy}
              >
                {API_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="divider oc-divider-spaced" />
            <span className="oc-section-title">{t('oc.form.thinkingDefault', '深入配置 (Agent)')}</span>
            <div className="oc-form-row">
              <span className="oc-form-label">{t('oc.form.thinkingDefault', '思考档位')}</span>
              <select className="select" value={agentDefaults.thinkingDefault} onChange={(e) => setAgentDefaults({ ...agentDefaults, thinkingDefault: e.target.value })} disabled={configBusy || boardDeployBusy}>
                <option value="">{t('oc.form.agentDefaultInherit', '不修改')}</option>
                <option value="off">off</option>
                <option value="low">low</option>
                <option value="high">high</option>
              </select>
            </div>
            
            <div className="divider oc-divider-spaced" />
            <div className="oc-form-actions" style={{ flexWrap: 'wrap', gap: 6 }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => saveConfig('model')} disabled={configBusy || boardDeployBusy} title={boardDeployBusy ? t('oc.ops.disabledDuringDeploy', '部署进行中，请稍候再操作') : undefined}>{configBusy ? t('oc.test.testing', '...') : t('oc.save', '保存')}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={testVendorApiConnection} disabled={vendorApiTest === 'testing' || configBusy || boardDeployBusy} title={boardDeployBusy ? t('oc.ops.disabledDuringDeploy', '部署进行中，请稍候再操作') : undefined}>
                {vendorApiTest === 'testing' ? t('oc.test.testing', '...') : vendorApiTest === 'ok' ? t('oc.test.vendorOkLabel', '厂商 API 正常') : t('oc.test.vendorRun', '测试厂商 API')}
              </button>
            </div>
          </div>
        )}

        {dashboardTab === 'feishu' && (
          <div className="oc-tab-content">
            <span className="oc-section-title">{t('oc.channel.title', '通道接入配置')}</span>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>{t('oc.feishu.botConfig', '飞书机器人')}</div>
            <div className="oc-form-row">
              <span className="oc-form-label">{t('oc.form.appId', 'App ID')}</span>
              <input className="input" type="text" value={feishuConfig.appId} onChange={(e) => setFeishuConfig({ ...feishuConfig, appId: e.target.value })} placeholder="cli_..." disabled={configBusy || boardDeployBusy} />
            </div>
            <div className="oc-form-row">
              <span className="oc-form-label">{t('oc.form.secret', 'Secret')}</span>
              <input className="input" type="password" value={feishuConfig.appSecret} onChange={(e) => setFeishuConfig({ ...feishuConfig, appSecret: e.target.value })} placeholder="..." disabled={configBusy || boardDeployBusy} />
            </div>
            <div className="oc-form-grid-3">
              <div className="oc-deploy-field">
                <label>{t('oc.feishu.conn', '连接')}</label>
                <select className="select" value={feishuConfig.connectionMode} onChange={(e) => setFeishuConfig({ ...feishuConfig, connectionMode: e.target.value as any })} disabled={configBusy || boardDeployBusy}>
                  <option value="websocket">websocket</option>
                  <option value="webhook">webhook</option>
                </select>
              </div>
            </div>
            <div className="oc-form-actions" style={{ marginTop: 16 }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => saveConfig('feishu')} disabled={configBusy || boardDeployBusy} title={boardDeployBusy ? t('oc.ops.disabledDuringDeploy', '部署进行中，请稍候再操作') : undefined}>{configBusy ? t('oc.test.testing', '...') : t('oc.save', '保存')}</button>
            </div>

            <div className="divider oc-divider-spaced" />
            <span className="oc-section-title">{t('oc.pairing.gatewayTrustTitle', '客户端配对 (Pairing)')}</span>
            <div className="oc-pairing-row">
              <select className="select" value={pairingChannel} onChange={(e) => setPairingChannel(e.target.value)}>
                <option value="feishu">feishu</option>
                <option value="telegram">telegram</option>
              </select>
              <input className="input" type="text" value={pairingCode} onChange={(e) => setPairingCode(e.target.value.toUpperCase())} placeholder={t('oc.pairing.codePh', '配对码')} />
              <button type="button" className="btn btn-primary btn-sm" onClick={() => runAction('pairing/approve', { channel: pairingChannel, code: pairingCode.trim() })} disabled={activeOp === 'pairing/approve' || !pairingCode.trim() || boardDeployBusy} title={boardDeployBusy ? t('oc.ops.disabledDuringDeploy', '部署进行中，请稍候再操作') : undefined}>{t('oc.pairing.approve', '批准')}</button>
            </div>
            <button type="button" className={`chip oc-pairing-trust-chip ${activeOp === 'gateway-pair' ? 'active' : ''}`} onClick={() => runAction('gateway-pair', { mode: 'force' })} disabled={activeOp === 'gateway-pair' || boardDeployBusy} title={boardDeployBusy ? t('oc.ops.disabledDuringDeploy', '部署进行中，请稍候再操作') : undefined}>一键信任本机网关</button>
          </div>
        )}
      </div>
    </div>
  );

  /* ═══════════════════════════════════════════
     Render - Main Dual View
     ═══════════════════════════════════════════ */

  /** 部署中或仍有步骤/日志时保持向导布局。否则 status 一旦显示「已安装」会切到主布局，向导内的安装日志整块被卸掉（切换标签回来时像「消失」）。 */
  const ocLayoutDeployActive =
    deployRunning || deployCancelLoading || deploySteps.length > 0;
  const ocLayoutWizardOnly = !ocInstalled || ocLayoutDeployActive;

  return (
    <div
      className={`oc-layout ${ocLayoutWizardOnly ? 'oc-layout--wizard' : ''} ${!panelOpen ? 'panel-collapsed' : ''} ${mobilePanel ? 'panel-open-mobile' : ''} ${ocLayoutDeployActive ? 'oc-layout--deploying' : ''}`}
      aria-busy={deployRunning || deployCancelLoading}
    >
      {ocLayoutWizardOnly ? (
        renderSetupWizard()
      ) : (
        <>
          {/* ════════════ Left: Chat ════════════ */}
          <div className="oc-main">
            {/* Status bar */}
            <div className="oc-status-bar">
              <div className="oc-status-item">
                <span className={`status-dot ${status?.running ? 'online' : ''}`} />
                <span className="oc-status-label">{t('oc.status.gateway', '网关')}</span>
                <span className="oc-status-value">{statusLoading ? t('oc.test.testing', '...') : status?.running ? t('oc.status.running', '运行中') : t('oc.ops.hint.stop', '停止')}</span>
              </div>
              <div className="oc-status-item">
                <span className={`status-dot ${deviceNetUp === null ? '' : deviceNetUp ? 'online' : 'offline'}`} />
                <span className="oc-status-label">{t('oc.status.network', '网络')}</span>
                <span className="oc-status-value">
                  {deviceNetUp === null ? '...' : deviceNetUp ? t('oc.status.networkUp', '已联网') : t('oc.status.networkDown', '未联网')}
                </span>
              </div>
              <div className="oc-status-item">
                <span className={`status-dot ${modelStatusDotClass}`} />
                <span className="oc-status-label">{t('oc.status.model', '模型')}</span>
                <span
                  className="oc-status-value"
                  style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={getModelStatusTitle()}
                >
                  {getStatusBarModelDisplay()}
                  {modelStatusBadgeText && (
                    <span style={{ color: modelStatusBadgeColor, fontSize: '0.7rem', marginLeft: 4 }}>
                      {modelStatusBadgeText}
                    </span>
                  )}
                </span>
              </div>
              <div className="oc-status-bar-actions">
                <button type="button" className="btn btn-primary btn-sm oc-toolbar-btn" onClick={() => { runAction('restart-gateway'); setShowSetupGuide(true); }} disabled={activeOp === 'restart-gateway' || boardDeployBusy} title={boardDeployBusy ? t('oc.ops.disabledDuringDeploy', '部署进行中，请稍候再操作') : undefined}>{t('oc.ops.restartGw', '重启网关')}</button>
                <button type="button" className="btn btn-ghost btn-sm oc-toolbar-btn" onClick={() => void loadStatus()} disabled={statusLoading}>{t('oc.title.refreshStatus', '刷新状态')}</button>
              </div>
            </div>

            <div className="oc-chat-header">
              <div className="oc-chat-header-meta">
                <span className="oc-chat-header-label">{t('oc.chat.columnTitle', '对话')}</span>
                <span className={`oc-chat-phase ${chatPhaseToneClass}`}>{getChatPhaseLabel(chatPhase)}</span>
              </div>
              <div className="oc-status-bar-actions">
                <button type="button" className="btn btn-ghost btn-sm oc-toolbar-btn" onClick={() => { setChatMessages([]); setChatStreaming(false); }} disabled={chatMessages.length === 0} title={chatMessages.length === 0 ? t('oc.chat.clearDisabled', '暂无对话可清空') : t('oc.chat.clear', '清空')}>{t('oc.chat.clear', '清空')}</button>
              </div>
            </div>

            {renderDeployMainStrip()}

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
                  <strong>
                    {deviceNetUp === false
                      ? t('oc.chat.emptyOffline', '开发者套件未联网，暂时无法对话')
                      : !status?.running
                        ? t('oc.chat.emptyGwDown', '网关未运行')
                        : !hasBoardModelSelection()
                          ? t('oc.chat.emptyModelMissing', '尚未配置模型')
                          : !hasBoardModelCredentials()
                            ? t('oc.chat.emptyModelCredentialMissing', '模型凭据未就绪')
                        : modelApiReachable === 'fail'
                          ? (localVendorApiVerifiedForCurrentConfig
                            ? t('oc.chat.emptyBoardModelFail', '套件端模型链路不可达')
                            : t('oc.chat.emptyModelFail', '模型 API 不可达'))
                          : t('oc.chat.readyTitle', '可以开始对话')}
                  </strong>
                  {deviceNetUp === false && (
                    <p className="oc-chat-empty-sub">{t('oc.chat.emptyOfflineSub', '对话需要通过网络访问云端大模型。请先点击右上角 WiFi 图标为开发者套件配网。')}</p>
                  )}
                  {deviceNetUp !== false && !status?.running && ocInstalled && (
                    <p className="oc-chat-empty-sub">{t('oc.chat.emptyGwDownSub', '请点击上方「重启网关」恢复后再试。')}</p>
                  )}
                  {deviceNetUp !== false && status?.running && !hasBoardModelSelection() && (
                    <p className="oc-chat-empty-sub">{t('oc.chat.emptyModelMissingSub', '请先在右侧面板填写并保存模型配置，再开始对话。')}</p>
                  )}
                  {deviceNetUp !== false && status?.running && hasBoardModelSelection() && !hasBoardModelCredentials() && (
                    <p className="oc-chat-empty-sub">{t('oc.chat.emptyModelCredentialMissingSub', '模型已选择，但当前未检测到可用 API Key。请在右侧面板补全凭据，或确认运行时 provider 已保存密钥。')}</p>
                  )}
                  {deviceNetUp !== false && status?.running && modelApiReachable === 'fail' && (
                    <p className="oc-chat-empty-sub">{
                      localVendorApiVerifiedForCurrentConfig
                        ? t('oc.chat.emptyBoardModelFailSub', '厂商 API 已通过；当前问题在套件端链路。请检查是否已保存到套件端、网关信任、套件端网络或运行时密钥。')
                        : t('oc.chat.emptyModelFailSub', '请在右侧面板检查模型 API Key、Base URL、网关信任状态，或点击「测试厂商 API」排查。')
                    }</p>
                  )}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {!deployRunning && (
              <div className="oc-composer-wrap">
                {ocComposerBlockHint ? (
                  <div className="oc-composer-hint" role="status">
                    <span className="material-symbols-outlined oc-composer-hint-icon" aria-hidden>info</span>
                    <span>{ocComposerBlockHint}</span>
                  </div>
                ) : null}
                <div className="oc-composer-shell">
                  <div style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', paddingBottom: '7px' }}>
                    {MI('smart_toy')}
                  </div>
                  <textarea
                    className="oc-composer-textarea"
                    rows={1}
                    value={ocComposerText}
                    onChange={(e) => setOcComposerText(e.target.value)}
                    placeholder={t('dock.input.openclaw', '自然语言描述您的需求，遇到问题可随时问我，或执行网关动作...')}
                    disabled={!ocComposerEditable}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || e.shiftKey || (e.nativeEvent as KeyboardEvent).isComposing) return;
                      e.preventDefault();
                      submitOcComposer();
                    }}
                  />
                  <button
                    type="button"
                    className={`oc-composer-send ${currentDevice && openclawAgentReady && !chatStreaming && ocComposerText.trim() ? 'is-active' : ''}`}
                    onClick={submitOcComposer}
                    disabled={!currentDevice || !openclawAgentReady || chatStreaming || !ocComposerText.trim()}
                    title={
                      !openclawAgentReady && ocComposerText.trim()
                        ? ocComposerBlockHint || t('oc.composer.sendDisabledTitle', '当前无法发送到套件端 Agent')
                        : t('dock.send', '发送')
                    }
                  >
                    <OcComposerSendIcon />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ════════════ Right: Dashboard Tabs ════════════ */}
          {panelOpen && (
            <div className="oc-panel">
              <div className="oc-panel-header">
                <strong>{t('oc.panel.title', '控制面板')}</strong>
              </div>
              {renderDashboardTabs()}
            </div>
          )}
        </>
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
                disabled={activeOp === 'uninstall'}
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
