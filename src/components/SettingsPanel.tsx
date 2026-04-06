import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAppState } from '../hooks/useAppState';
import { useI18n } from '../i18n/use-i18n';
import {
  approveFeishuPairing,
  fetchAgentConfig,
  fetchFeishuBoundUsers,
  fetchFeishuConfig,
  fetchFeishuPairingRequests,
  fetchFeishuRuntimeStatus,
  restartFeishuRuntime,
  saveAgentConfig,
  exportAgentConfig,
  importAgentConfig,
  type AgentConfigExportPayload,
  saveFeishuConfig,
  type FeishuRuntimeStatus,
  rejectFeishuPairing,
  startFeishuRuntime,
  stopFeishuRuntime,
  fetchRDKClawPersona,
  saveRDKClawPersona,
  type PersonaProfile,
  fetchRDKClawForumAuth,
  saveRDKClawForumCredential,
  clearRDKClawForumAuth,
  type ForumAuthView,
  fetchWeixinAccounts,
  removeWeixinAccount,
  restartWeixinChannel,
} from '../api';
import { RDK_SSO_SESSION_MIRROR_KEY, fetchApi, resolveApiUrl, resolveApiUrlAbsolute } from '../utils/apiBase';
import { isDesktop } from '../utils/env';
import { fillTemplate } from '../i18n/en-extras';
import { useAuth } from '../hooks/useAuth';
import { trackUiAction } from '../analytics/client';
import { useConfirmRemoveDevice } from '../hooks/useConfirmRemoveDevice';

/* ═══════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════ */

const AI_PROVIDER_DEFAULTS: Record<string, { label: string; model: string; baseUrl: string; protocol?: string }> = {
  qwen: { label: '通义千问 (Qwen)', model: 'qwen-plus', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  deepseek: { label: 'DeepSeek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' },
  doubao: { label: '豆包 (Doubao)', model: 'doubao-1.5-pro-256k', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  openai: { label: 'OpenAI', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { label: 'Anthropic (Claude)', model: 'claude-sonnet-4-20250514', baseUrl: 'https://api.anthropic.com', protocol: 'anthropic' },
  gemini: { label: 'Google Gemini', model: 'gemini-2.5-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  stepfun: { label: '阶跃星辰 (Step)', model: 'step-2-16k', baseUrl: 'https://api.stepfun.com/v1' },
  minimax: { label: 'MiniMax', model: 'MiniMax-Text-01', baseUrl: 'https://api.minimax.chat/v1' },
  yi: { label: '零一万物 (Yi)', model: 'yi-lightning', baseUrl: 'https://api.lingyiwanwu.com/v1' },
  baichuan: { label: '百川智能', model: 'Baichuan4-Air', baseUrl: 'https://api.baichuan-ai.com/v1' },
  moonshot: { label: 'Moonshot', model: 'moonshot-v1-8k', baseUrl: 'https://api.moonshot.cn/v1' },
  zhipu: { label: '智谱 AI (GLM)', model: 'glm-4-flash', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  siliconflow: { label: 'SiliconFlow', model: 'deepseek-ai/DeepSeek-V3', baseUrl: 'https://api.siliconflow.cn/v1' },
  groq: { label: 'Groq', model: 'llama-3.3-70b-versatile', baseUrl: 'https://api.groq.com/openai/v1' },
  openrouter: { label: 'OpenRouter', model: 'openai/gpt-4o-mini', baseUrl: 'https://openrouter.ai/api/v1' },
  xai: { label: 'xAI (Grok)', model: 'grok-2-latest', baseUrl: 'https://api.x.ai/v1' },
  ollama: { label: 'Ollama (本地)', model: 'qwen2.5:7b', baseUrl: 'http://127.0.0.1:11434/v1' },
  /** 与 server/agent/provider-setup.ts PROVIDER_DEFAULTS 对齐，模型留空保存时才能回落到有效 model */
  /** 与 config/rdkclaw-provider.defaults.json 内置预设一致（占位示例，非 OpenAI 官网） */
  'openai-compatible': {
    label: 'OpenAI 兼容协议',
    model: 'doubao-seed-2.0-pro',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
  },
  'anthropic-compatible': { label: 'Anthropic 兼容协议', model: 'claude-sonnet-4-20250514', baseUrl: '', protocol: 'anthropic' },
};

const AI_PROVIDER_OPTIONS = Object.entries(AI_PROVIDER_DEFAULTS).map(([value, item]) => ({
  value,
  label: item.label,
}));

type SectionId =
  | 'account'
  | 'ai-engine'
  | 'persona'
  | 'feishu'
  | 'weixin'
  | 'connection'
  | 'forum';

/* ═══════════════════════════════════════════
   Component
   ═══════════════════════════════════════════ */

export default function SettingsPanel() {
  const {
    showSettings, setShowSettings,
    autoReconnect, setAutoReconnect,
    connectionTimeout, setConnectionTimeout, addToast,
    devices, setShowAddDevice,
  } = useAppState();
  const confirmRemoveDevice = useConfirmRemoveDevice();
  const { user, ssoEnabled, ssoRequired, logout } = useAuth();
  const showAccountSection = ssoEnabled || ssoRequired;
  const { t } = useI18n();
  const tf = useCallback(
    (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars),
    [t],
  );

  useEffect(() => {
    if (showSettings) trackUiAction('settings_open', {});
  }, [showSettings]);

  const SECTIONS = useMemo(() => [
    ...(showAccountSection
      ? [{ id: 'account' as const, label: t('settings.sec.account', '账户与安全') }]
      : []),
    { id: 'ai-engine' as const, label: t('settings.sec.ai', 'AI 引擎') },
    { id: 'persona' as const, label: t('settings.sec.persona', '人格与行为') },
    { id: 'feishu' as const, label: t('settings.sec.feishu', '飞书') },
    { id: 'weixin' as const, label: t('settings.sec.weixin', '微信') },
    { id: 'connection' as const, label: t('settings.sec.connection', '设备连接') },
    { id: 'forum' as const, label: t('settings.sec.forum', '社区论坛') },
  ], [t, showAccountSection]);

  /* ── Active nav section (IntersectionObserver) ── */
  const [activeSection, setActiveSection] = useState<SectionId>('ai-engine');
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Map<SectionId, HTMLElement>>(new Map());

  const registerSectionRef = useCallback((id: SectionId) => (el: HTMLElement | null) => {
    if (el) sectionRefs.current.set(id, el);
    else sectionRefs.current.delete(id);
  }, []);

  useEffect(() => {
    const root = scrollAreaRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id as SectionId);
            break;
          }
        }
      },
      { root, rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    );
    for (const el of sectionRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [showSettings]);

  const scrollToSection = (id: SectionId) => {
    setActiveSection(id);
    sectionRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /** 打开设置时与侧栏第一项对齐，避免「高亮账户但视口仍在 AI」 */
  useEffect(() => {
    if (!showSettings) return;
    const first: SectionId = showAccountSection ? 'account' : 'ai-engine';
    setActiveSection(first);
    const t = window.setTimeout(() => {
      sectionRefs.current.get(first)?.scrollIntoView({ block: 'start' });
    }, 0);
    return () => clearTimeout(t);
  }, [showSettings, showAccountSection]);

  /* ── AI Model State ── */
  const [aiProvider, setAiProvider] = useState('openai-compatible');
  const [aiModel, setAiModel] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiLabel, setAiLabel] = useState('');
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiSavedModels, setAiSavedModels] = useState<Array<{
    id: string; label: string; provider: string; model: string;
    hasApiKey: boolean; baseUrl?: string; isActive: boolean;
    isQuickLane?: boolean;
    thinkingDefault?: string;
    reasoningVisibility?: string;
    samplingTemperature?: string;
    samplingTopP?: string;
  }>>([]);
  /** 服务端：快速回答绑定的条目 id */
  const [quickLaneModelId, setQuickLaneModelId] = useState('');
  /** 快速区块当前编辑的条目 id（新建草稿时为空） */
  const [quickSelectedAiModelId, setQuickSelectedAiModelId] = useState('');
  const [aiThinkingDefault, setAiThinkingDefault] = useState('high');
  const [aiReasoningVisibility, setAiReasoningVisibility] = useState('stream');
  const [aiSamplingTemperature, setAiSamplingTemperature] = useState('0.1');
  const [aiSamplingTopP, setAiSamplingTopP] = useState('1');
  const [quickAiProvider, setQuickAiProvider] = useState('openai-compatible');
  const [quickAiModel, setQuickAiModel] = useState('');
  const [quickAiApiKey, setQuickAiApiKey] = useState('');
  const [quickAiBaseUrl, setQuickAiBaseUrl] = useState('');
  const [quickAiLabel, setQuickAiLabel] = useState('');
  const [quickAiThinkingDefault, setQuickAiThinkingDefault] = useState('high');
  const [quickAiReasoningVisibility, setQuickAiReasoningVisibility] = useState('stream');
  const [quickAiSamplingTemperature, setQuickAiSamplingTemperature] = useState('0');
  const [quickAiSamplingTopP, setQuickAiSamplingTopP] = useState('1');
  const [selectedAiModelId, setSelectedAiModelId] = useState('');
  /** AI 引擎卡片内：同一位置切换深度 / 快速，表单状态仍各自独立 */
  const [aiEngineLaneTab, setAiEngineLaneTab] = useState<'thinking' | 'quick'>('thinking');
  const [aiSaving, setAiSaving] = useState(false);
  const [thinkingVendorTest, setThinkingVendorTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [quickVendorTest, setQuickVendorTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [aiEnvApiKeyAvailable, setAiEnvApiKeyAvailable] = useState(false);
  const [studioDefaultPreset, setStudioDefaultPreset] = useState<{
    id: string;
    label: string;
    inRegistry: boolean;
    isActive: boolean;
  } | null>(null);
  const [studioQuickDefaultPreset, setStudioQuickDefaultPreset] = useState<{
    id: string;
    label: string;
    inRegistry: boolean;
    isQuickLane: boolean;
  } | null>(null);
  const importAgentConfigRef = useRef<HTMLInputElement | null>(null);
  const loadedAiProviderRef = useRef('');
  const quickLoadedAiProviderRef = useRef('');

  const applyAiModelToForm = (entry: typeof aiSavedModels[number]) => {
    setSelectedAiModelId(entry.id);
    setAiLabel(entry.label || '');
    setAiProvider(entry.provider || 'openai-compatible');
    setAiModel(entry.model || '');
    setAiBaseUrl(entry.baseUrl || '');
    setAiThinkingDefault((entry.thinkingDefault || '').trim());
    setAiReasoningVisibility((entry.reasoningVisibility || '').trim());
    setAiSamplingTemperature((entry.samplingTemperature || '').trim());
    setAiSamplingTopP((entry.samplingTopP || '').trim());
    setAiApiKey('');
    loadedAiProviderRef.current = entry.provider || 'openai-compatible';
  };

  const applyQuickFormFromEntry = (entry: typeof aiSavedModels[number]) => {
    setQuickSelectedAiModelId(entry.id);
    setQuickAiLabel(entry.label || '');
    setQuickAiProvider(entry.provider || 'openai-compatible');
    setQuickAiModel(entry.model || '');
    setQuickAiBaseUrl(entry.baseUrl || '');
    setQuickAiThinkingDefault((entry.thinkingDefault || '').trim());
    setQuickAiReasoningVisibility((entry.reasoningVisibility || '').trim());
    setQuickAiSamplingTemperature((entry.samplingTemperature || '').trim());
    setQuickAiSamplingTopP((entry.samplingTopP || '').trim());
    setQuickAiApiKey('');
    quickLoadedAiProviderRef.current = entry.provider || 'openai-compatible';
  };

  const refreshAiConfig = async () => {
    const cfg = await fetchAgentConfig();
    const models = cfg.models || [];
    setAiSavedModels(models);
    setAiEnvApiKeyAvailable(!!cfg.envApiKeyAvailable);
    setStudioDefaultPreset(cfg.studioDefaultPreset ?? null);
    setStudioQuickDefaultPreset(cfg.studioQuickDefaultPreset ?? null);
    const nextQuick = cfg.quickActiveModelId?.trim() || '';
    setQuickLaneModelId(nextQuick);
    const aid = cfg.activeModelId?.trim();
    const active = aid
      ? models.find((item) => item.id === aid)
      : models.find((item) => item.isActive);
    const quickTarget = nextQuick ? models.find((m) => m.id === nextQuick) : undefined;

    const resolved = active || models[0];
    if (resolved) {
      applyAiModelToForm(resolved);
    } else {
      setSelectedAiModelId('');
      setAiLabel('');
      setAiProvider(cfg.provider || 'openai-compatible');
      setAiModel(cfg.model || '');
      setAiBaseUrl(cfg.baseUrl || '');
      setAiThinkingDefault((cfg.thinkingDefault || '').trim());
      setAiReasoningVisibility((cfg.reasoningVisibility || '').trim());
      setAiSamplingTemperature((cfg.samplingTemperature || '').trim());
      setAiSamplingTopP((cfg.samplingTopP || '').trim());
      setAiApiKey('');
    }

    if (quickTarget) {
      applyQuickFormFromEntry(quickTarget);
    } else {
      setQuickSelectedAiModelId('');
      setQuickAiLabel('');
      setQuickAiProvider('openai-compatible');
      setQuickAiModel('');
      setQuickAiBaseUrl(AI_PROVIDER_DEFAULTS['openai-compatible'].baseUrl);
      setQuickAiThinkingDefault('');
      setQuickAiReasoningVisibility('');
      setQuickAiSamplingTemperature('');
      setQuickAiSamplingTopP('');
      setQuickAiApiKey('');
      quickLoadedAiProviderRef.current = 'openai-compatible';
    }

    setAiConfigured(
      !!(resolved?.hasApiKey || quickTarget?.hasApiKey || cfg.envApiKeyAvailable),
    );
  };

  /* ── Feishu State ── */
  const [feishuStatus, setFeishuStatus] = useState<FeishuRuntimeStatus | null>(null);
  const [feishuBoundUsers, setFeishuBoundUsers] = useState<Array<{ openId: string; boundAt: number }>>([]);
  const [feishuLoading, setFeishuLoading] = useState(false);
  const [feishuSaving, setFeishuSaving] = useState(false);
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');
  const [feishuVerificationToken, setFeishuVerificationToken] = useState('');
  const [feishuEncryptKey, setFeishuEncryptKey] = useState('');
  const [feishuEnabled, setFeishuEnabled] = useState(true);
  const [feishuConnectionMode, setFeishuConnectionMode] = useState<'websocket' | 'webhook'>('websocket');
  const [feishuDomain, setFeishuDomain] = useState<'feishu' | 'lark'>('feishu');
  const [feishuDmPolicy, setFeishuDmPolicy] = useState<'pairing' | 'allowlist' | 'open'>('pairing');
  const [feishuSyncWithStudio, setFeishuSyncWithStudio] = useState(true);
  const [feishuMirrorToStudioChat, setFeishuMirrorToStudioChat] = useState(true);
  const [feishuAckOnReceive, setFeishuAckOnReceive] = useState(true);
  const [feishuAckOnRunning, setFeishuAckOnRunning] = useState(true);
  const [feishuAckStyle, setFeishuAckStyle] = useState<'text' | 'emoji' | 'off'>('text');
  const [feishuMasks, setFeishuMasks] = useState({ appSecretMasked: '', verificationTokenMasked: '', encryptKeyMasked: '' });
  const [feishuPairings, setFeishuPairings] = useState<Array<{
    openId: string; rawOpenId: string; chatId: string; code: string;
    expireAt: number; createdAt: number;
  }>>([]);

  /* ── RDKClaw Persona（执行策略由服务端默认托管，不在设置中展示）── */
  const [persona, setPersona] = useState<PersonaProfile>({
    name: '小地瓜', extraInstructions: '', riskLevel: 'balanced',
    delegationBias: 'balanced', autonomyLevel: 'assisted',
  });
  const [rdkclawLoading, setRdkclawLoading] = useState(false);
  const [rdkclawSaving, setRdkclawSaving] = useState(false);

  /* ── Forum State ── */
  const [forumAuth, setForumAuth] = useState<ForumAuthView>({
    username: '', hasPassword: false, hasCookie: false, hasAppSsoAccessTokenSaved: false, linkedFromAppSso: false,
    hasApiKey: false, hasApiUsername: false,
    lastVerified: null, lastVerifyResult: null,
  });
  const [forumUsernameInput, setForumUsernameInput] = useState('');
  const [forumPasswordInput, setForumPasswordInput] = useState('');
  const [forumSaving, setForumSaving] = useState(false);
  const [forumVerifyMsg, setForumVerifyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [floatingBallEnabled, setFloatingBallEnabled] = useState(true);

  /** 桌面端启动即同步主进程 prefs（默认开启），不依赖是否打开设置面板 */
  useEffect(() => {
    if (!isDesktop()) return;
    void window.rdkDesktop?.getFloatingBallPrefs?.().then((p) => {
      setFloatingBallEnabled(p.enabled !== false);
    }).catch(() => {});
  }, []);

  /* ── WeChat State ── */
  const [weixinAccounts, setWeixinAccounts] = useState<Array<{ accountId: string; nickname: string; boundAt: number }>>([]);
  const [weixinLoginLoading, setWeixinLoginLoading] = useState(false);
  const [weixinQrCode, setWeixinQrCode] = useState<string | null>(null);
  const [weixinQrBroken, setWeixinQrBroken] = useState(false);
  const [weixinLoginStatus, setWeixinLoginStatus] = useState<string>('');
  const [weixinLoginEventSource, setWeixinLoginEventSource] = useState<EventSource | null>(null);
  const weixinQrBlobUrlRef = useRef<string | null>(null);
  const [weixinRemovingId, setWeixinRemovingId] = useState<string | null>(null);
  const [weixinRestarting, setWeixinRestarting] = useState(false);

  /**
   * Close EventSource when the panel unmounts or hides,
   * preventing leaked SSE connections when user dismisses settings.
   */
  useEffect(() => {
    if (!showSettings) {
      if (weixinQrBlobUrlRef.current) {
        URL.revokeObjectURL(weixinQrBlobUrlRef.current);
        weixinQrBlobUrlRef.current = null;
      }
    }
    if (!showSettings && weixinLoginEventSource) {
      weixinLoginEventSource.close();
      setWeixinLoginEventSource(null);
      setWeixinLoginLoading(false);
      setWeixinQrCode(null);
      setWeixinQrBroken(false);
      setWeixinLoginStatus('');
    }
  }, [showSettings, weixinLoginEventSource]);

  /* ═══════════════════════════════════════════
     Data Loading
     ═══════════════════════════════════════════ */

  const refreshRdkclawData = async () => {
    const [personaRes, forumAuthRes] = await Promise.all([fetchRDKClawPersona(), fetchRDKClawForumAuth()]);
    setPersona(personaRes.persona);
    setForumAuth(forumAuthRes.auth);
  };

  const refreshFeishuData = async () => {
    const [statusRes, boundRes, cfgRes, pairingRes] = await Promise.all([
      fetchFeishuRuntimeStatus(), fetchFeishuBoundUsers(),
      fetchFeishuConfig(), fetchFeishuPairingRequests(),
    ]);
    setFeishuStatus(statusRes.status);
    setFeishuBoundUsers(boundRes.users);
    setFeishuPairings(pairingRes.requests);
    setFeishuAppId(cfgRes.config.appId || '');
    setFeishuEnabled(!!cfgRes.config.enabled);
    setFeishuConnectionMode(cfgRes.config.connectionMode || 'websocket');
    setFeishuDomain(cfgRes.config.domain || 'feishu');
    setFeishuDmPolicy(cfgRes.config.dmPolicy || 'pairing');
    setFeishuSyncWithStudio(typeof cfgRes.config.syncWithStudio === 'boolean' ? cfgRes.config.syncWithStudio : true);
    setFeishuMirrorToStudioChat(typeof cfgRes.config.mirrorToStudioChat === 'boolean' ? cfgRes.config.mirrorToStudioChat : true);
    setFeishuAckOnReceive(typeof cfgRes.config.ackOnReceive === 'boolean' ? cfgRes.config.ackOnReceive : true);
    setFeishuAckOnRunning(typeof cfgRes.config.ackOnRunning === 'boolean' ? cfgRes.config.ackOnRunning : true);
    setFeishuAckStyle(cfgRes.config.ackStyle || 'text');
    setFeishuMasks({
      appSecretMasked: cfgRes.config.appSecretMasked || '',
      verificationTokenMasked: cfgRes.config.verificationTokenMasked || '',
      encryptKeyMasked: cfgRes.config.encryptKeyMasked || '',
    });
  };

  const loadWeixinData = async () => {
    try {
      const res = await fetchWeixinAccounts();
      if (res.ok) setWeixinAccounts(res.accounts);
    } catch { /* ignore：打开设置时由外层 Promise.all 统一提示 */ }
  };

  useEffect(() => {
    if (!showSettings) return;
    setRdkclawLoading(true);
    Promise.all([
      refreshAiConfig(),
      refreshRdkclawData(),
      refreshFeishuData().then(() => setFeishuLoading(false)),
      loadWeixinData(),
    ])
      .catch(() => addToast(t('toast.readConfigFail', '读取配置失败'), 'error'))
      .finally(() => setRdkclawLoading(false));
  }, [showSettings, t]);

  /* ═══════════════════════════════════════════
     Handlers
     ═══════════════════════════════════════════ */

  const handleSavePersona = async () => {
    setRdkclawSaving(true);
    try {
      const res = await saveRDKClawPersona(persona);
      setPersona(res.persona);
      addToast(t('toast.personaSaved', '人格设定已保存'), 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      const timedOut = (e as { name?: string }).name === 'TimeoutError' || /abort|timeout/i.test(msg);
      addToast(
        timedOut
          ? t('toast.personaSaveTimeout', '保存超时：请确认本机后端已启动且桌面端能连上 API（可重试）')
          : t('toast.personaSaveFail', '保存人格设定失败'),
        'error',
      );
    }
    finally { setRdkclawSaving(false); }
  };

  const handleSaveForumCredential = async () => {
    const username = forumUsernameInput.trim();
    const password = forumPasswordInput.trim();
    if (!username || !password) { addToast(t('toast.forumNeedCreds', '请填写论坛用户名和密码'), 'warning'); return; }
    setForumSaving(true);
    setForumVerifyMsg(null);
    try {
      const res = await saveRDKClawForumCredential({ username, password });
      setForumPasswordInput('');
      setForumAuth(res.auth);
      setForumVerifyMsg({
        ok: res.verified,
        text: res.verified
          ? t('settings.forum.verifyOk', '凭据已保存，SSO 验证通过')
          : tf('settings.forum.verifyFailDetail', '凭据已保存，但验证未通过: {{detail}}', { detail: res.verifyDetail }),
      });
      addToast(
        res.verified ? t('toast.forumSavedOk', '论坛凭据验证成功') : t('toast.forumSavedWarn', '凭据已保存，SSO 验证未通过'),
        res.verified ? 'success' : 'warning',
      );
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('toast.forumSaveFail', '保存失败'), 'error');
    } finally { setForumSaving(false); }
  };

  const handleClearForumAuth = async () => {
    setForumSaving(true);
    try {
      const res = await clearRDKClawForumAuth();
      setForumUsernameInput(''); setForumPasswordInput('');
      await refreshRdkclawData();
      addToast(res.message || t('toast.forumCleared', '论坛认证已清空'), 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('toast.forumClearFail', '清空论坛认证失败'), 'error');
    } finally { setForumSaving(false); }
  };

  const handleSaveFeishu = async () => {
    setFeishuSaving(true);
    try {
      await saveFeishuConfig({
        enabled: feishuEnabled, connectionMode: feishuConnectionMode,
        domain: feishuDomain, dmPolicy: feishuDmPolicy,
        syncWithStudio: feishuSyncWithStudio, mirrorToStudioChat: feishuMirrorToStudioChat,
        ackOnReceive: feishuAckOnReceive, ackOnRunning: feishuAckOnRunning,
        ackStyle: feishuAckStyle, appId: feishuAppId,
        appSecret: feishuAppSecret || undefined,
        verificationToken: feishuVerificationToken || undefined,
        encryptKey: feishuEncryptKey || undefined,
      });
      setFeishuAppSecret(''); setFeishuVerificationToken(''); setFeishuEncryptKey('');
      await refreshFeishuData();
      addToast(t('toast.feishuSaved', '飞书配置已保存'), 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('toast.feishuSaveFail', '保存飞书配置失败'), 'error');
    } finally { setFeishuSaving(false); }
  };

  const handleFeishuRuntime = async (action: 'start' | 'stop' | 'restart') => {
    try {
      if (action === 'start') await startFeishuRuntime();
      if (action === 'stop') await stopFeishuRuntime();
      if (action === 'restart') await restartFeishuRuntime();
      await refreshFeishuData();
      addToast(
        action === 'start'
          ? t('toast.feishuCh.started', '飞书通道已启动')
          : action === 'stop'
            ? t('toast.feishuCh.stopped', '飞书通道已停止')
            : t('toast.feishuCh.restarted', '飞书通道已重启'),
        'success',
      );
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('toast.feishuRuntimeFail', '飞书运行态操作失败'), 'error');
    }
  };

  const handlePairingDecision = async (code: string, decision: 'approve' | 'reject') => {
    try {
      if (decision === 'approve') { await approveFeishuPairing(code); addToast(t('toast.pairApprove', '配对审批已通过'), 'success'); }
      else { await rejectFeishuPairing(code); addToast(t('toast.pairReject', '配对请求已拒绝'), 'success'); }
      await refreshFeishuData();
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('toast.pairFail', '处理配对请求失败'), 'error');
    }
  };

  const handleSaveThinkingAiConfig = async () => {
    const selectedEntry = aiSavedModels.find((item) => item.id === selectedAiModelId);
    if (!aiApiKey.trim() && !selectedEntry?.hasApiKey && !aiEnvApiKeyAvailable) {
      addToast(t('toast.needApiKey', '请填写 API Key'), 'warning');
      return;
    }
    const providerDefaults = AI_PROVIDER_DEFAULTS[aiProvider] || AI_PROVIDER_DEFAULTS['openai-compatible'];
    const trimmedModelInput = aiModel.trim();
    const effectiveModel = (trimmedModelInput || providerDefaults.model || '').trim();
    if (!effectiveModel) {
      addToast(t('toast.needModelName', '请填写模型名称'), 'warning');
      return;
    }
    const providerChanged = selectedEntry && selectedEntry.provider !== aiProvider;
    const modelChanged = selectedEntry && selectedEntry.model !== effectiveModel;
    const autoLabel = `${aiProvider}/${effectiveModel}`;
    const label = (providerChanged || modelChanged) ? autoLabel : (aiLabel.trim() || autoLabel);
    setAiSaving(true);
    try {
      await saveAgentConfig({
        action: 'upsert',
        id: selectedAiModelId || undefined,
        label,
        provider: aiProvider,
        model: effectiveModel,
        apiKey: aiApiKey || undefined,
        baseUrl: aiBaseUrl || providerDefaults.baseUrl || undefined,
        setActive: true,
        thinkingDefault: aiThinkingDefault,
        reasoningVisibility: aiReasoningVisibility,
        samplingTemperature: aiSamplingTemperature,
        samplingTopP: aiSamplingTopP,
      });
    } catch (err) {
      addToast(
        tf('toast.aiSaveFailMsg', '保存失败: {{msg}}', {
          msg: err instanceof Error ? err.message : t('toast.unknownErr', '未知错误'),
        }),
        'error',
      );
      return;
    } finally {
      setAiSaving(false);
    }
    try {
      await refreshAiConfig();
    } catch {
      /* ignore */
    }
    const savedModel = `${aiProvider}/${effectiveModel}`;
    addToast(
      selectedAiModelId
        ? tf('toast.aiModelUpdated', '模型已更新: {{name}}', { name: savedModel })
        : tf('toast.aiModelAdded', '已新增并启用: {{name}}', { name: savedModel }),
      'success',
    );
  };

  const handleSaveQuickAiConfig = async () => {
    const selectedEntry = aiSavedModels.find((item) => item.id === quickSelectedAiModelId);
    if (!quickAiApiKey.trim() && !selectedEntry?.hasApiKey && !aiEnvApiKeyAvailable) {
      addToast(t('toast.needApiKey', '请填写 API Key'), 'warning');
      return;
    }
    const providerDefaults = AI_PROVIDER_DEFAULTS[quickAiProvider] || AI_PROVIDER_DEFAULTS['openai-compatible'];
    const trimmedModelInput = quickAiModel.trim();
    const effectiveModel = (trimmedModelInput || providerDefaults.model || '').trim();
    if (!effectiveModel) {
      addToast(t('toast.needModelName', '请填写模型名称'), 'warning');
      return;
    }
    const providerChanged = selectedEntry && selectedEntry.provider !== quickAiProvider;
    const modelChanged = selectedEntry && selectedEntry.model !== effectiveModel;
    const autoLabel = `${quickAiProvider}/${effectiveModel}`;
    const label = (providerChanged || modelChanged) ? autoLabel : (quickAiLabel.trim() || autoLabel);
    const activeRowId = aiSavedModels.find((r) => r.isActive)?.id;
    const isQuickNewDraft = !quickSelectedAiModelId;
    let setActive = false;
    if (!isQuickNewDraft && activeRowId && quickSelectedAiModelId === activeRowId) {
      setActive = true;
    }
    setAiSaving(true);
    let saveResult: Awaited<ReturnType<typeof saveAgentConfig>> | null = null;
    try {
      saveResult = await saveAgentConfig({
        action: 'upsert',
        id: quickSelectedAiModelId || undefined,
        label,
        provider: quickAiProvider,
        model: effectiveModel,
        apiKey: quickAiApiKey || undefined,
        baseUrl: quickAiBaseUrl || providerDefaults.baseUrl || undefined,
        setActive,
        thinkingDefault: quickAiThinkingDefault,
        reasoningVisibility: quickAiReasoningVisibility,
        samplingTemperature: quickAiSamplingTemperature,
        samplingTopP: quickAiSamplingTopP,
      });
    } catch (err) {
      addToast(
        tf('toast.aiSaveFailMsg', '保存失败: {{msg}}', {
          msg: err instanceof Error ? err.message : t('toast.unknownErr', '未知错误'),
        }),
        'error',
      );
      return;
    } finally {
      setAiSaving(false);
    }
    if (isQuickNewDraft && saveResult?.savedId) {
      setAiSaving(true);
      try {
        await saveAgentConfig({ action: 'switch_quick', id: saveResult.savedId });
      } catch (err) {
        addToast(
          tf('toast.aiSaveFailMsg', '已保存但未绑定为快速回答: {{msg}}', {
            msg: err instanceof Error ? err.message : t('toast.unknownErr', '未知错误'),
          }),
          'warning',
        );
      } finally {
        setAiSaving(false);
      }
    }
    try {
      await refreshAiConfig();
    } catch {
      /* ignore */
    }
    const savedModel = `${quickAiProvider}/${effectiveModel}`;
    addToast(
      quickSelectedAiModelId
        ? tf('toast.aiModelUpdated', '模型已更新: {{name}}', { name: savedModel })
        : tf('toast.aiModelAddedQuickBound', '已新增并设为快速回答: {{name}}', { name: savedModel }),
      'success',
    );
  };

  const handleDeleteThinkingAiModel = async () => {
    if (!selectedAiModelId) {
      addToast(t('toast.pickModel', '请先选择一个模型'), 'warning');
      return;
    }
    const entry = aiSavedModels.find((item) => item.id === selectedAiModelId);
    setAiSaving(true);
    try {
      await saveAgentConfig({ action: 'delete', id: selectedAiModelId });
    } catch (err) {
      addToast(
        tf('toast.aiDeleteFailMsg', '删除失败: {{msg}}', {
          msg: err instanceof Error ? err.message : t('toast.unknownErr', '未知错误'),
        }),
        'error',
      );
      return;
    } finally {
      setAiSaving(false);
    }
    try {
      await refreshAiConfig();
    } catch {
      /* ignore */
    }
    addToast(
      tf('toast.aiDeleted', '已删除: {{id}}', {
        id: entry ? `${entry.provider}/${entry.model}` : selectedAiModelId,
      }),
      'success',
    );
  };

  const handleDeleteQuickAiModel = async () => {
    if (!quickSelectedAiModelId) {
      addToast(t('toast.pickModel', '请先选择一个模型'), 'warning');
      return;
    }
    const entry = aiSavedModels.find((item) => item.id === quickSelectedAiModelId);
    setAiSaving(true);
    try {
      await saveAgentConfig({ action: 'delete', id: quickSelectedAiModelId });
    } catch (err) {
      addToast(
        tf('toast.aiDeleteFailMsg', '删除失败: {{msg}}', {
          msg: err instanceof Error ? err.message : t('toast.unknownErr', '未知错误'),
        }),
        'error',
      );
      return;
    } finally {
      setAiSaving(false);
    }
    try {
      await refreshAiConfig();
    } catch {
      /* ignore */
    }
    addToast(
      tf('toast.aiDeleted', '已删除: {{id}}', {
        id: entry ? `${entry.provider}/${entry.model}` : quickSelectedAiModelId,
      }),
      'success',
    );
  };

  const handleCreateNewThinkingModel = () => {
    setSelectedAiModelId('');
    setAiLabel('');
    setAiProvider('openai-compatible');
    setAiModel('');
    setAiBaseUrl(AI_PROVIDER_DEFAULTS['openai-compatible'].baseUrl);
    setAiThinkingDefault('');
    setAiReasoningVisibility('');
    setAiSamplingTemperature('');
    setAiSamplingTopP('');
    setAiApiKey('');
  };

  const handleCreateNewQuickModel = () => {
    setQuickSelectedAiModelId('');
    setQuickAiLabel('');
    setQuickAiProvider('openai-compatible');
    setQuickAiModel('');
    setQuickAiBaseUrl(AI_PROVIDER_DEFAULTS['openai-compatible'].baseUrl);
    setQuickAiThinkingDefault('');
    setQuickAiReasoningVisibility('');
    setQuickAiSamplingTemperature('');
    setQuickAiSamplingTopP('');
    setQuickAiApiKey('');
  };

  /** 与 OpenClaw「测试 API」一致：本机直连厂商，不经套件端 Gateway */
  const handleTestVendorApi = useCallback(
    async (lane: 'thinking' | 'quick') => {
      const setVendorTest = lane === 'thinking' ? setThinkingVendorTest : setQuickVendorTest;
      const entryId = lane === 'thinking' ? selectedAiModelId.trim() : quickSelectedAiModelId.trim();
      const provider = lane === 'thinking' ? aiProvider : quickAiProvider;
      const baseUrlRaw = lane === 'thinking' ? aiBaseUrl : quickAiBaseUrl;
      const modelRaw = lane === 'thinking' ? aiModel : quickAiModel;
      const apiKeyRaw = lane === 'thinking' ? aiApiKey : quickAiApiKey;
      const selectedEntry = entryId ? aiSavedModels.find((i) => i.id === entryId) : undefined;
      const providerDefaults = AI_PROVIDER_DEFAULTS[provider] || AI_PROVIDER_DEFAULTS['openai-compatible'];
      const baseUrl = (baseUrlRaw.trim() || providerDefaults.baseUrl || '').trim();
      const model = (modelRaw.trim() || providerDefaults.model || '').trim();
      if (!baseUrl || !model) {
        addToast(
          t(
            'settings.ai.vendorTestNeedEndpoint',
            '请填写 Base URL 与模型名称后再测试（当前表单为空或仅有服务商占位）。',
          ),
          'warning',
        );
        return;
      }
      const apiKey = apiKeyRaw.trim();
      if (!apiKey && !selectedEntry?.hasApiKey && !aiEnvApiKeyAvailable) {
        addToast(
          t(
            'settings.ai.vendorTestNeedKey',
            '请填写 API Key，或绑定已保存密钥的配置 / 设置环境变量 OPENAI_API_KEY。',
          ),
          'warning',
        );
        return;
      }
      setVendorTest('testing');
      try {
        const res = await fetchApi('/api/agent/config/vendor-ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entryId: entryId || undefined,
            baseUrl,
            model,
            provider,
            ...(apiKey ? { apiKey } : {}),
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          latencyMs?: number;
          detail?: string;
          status?: number;
          error?: string;
        };
        const passed = !!data?.ok;
        setVendorTest(passed ? 'ok' : 'fail');
        if (passed) {
          const ms = typeof data.latencyMs === 'number' ? data.latencyMs : null;
          addToast(
            ms != null
              ? tf('oc.test.vendorOkMs', '厂商 API 可用（{{ms}} ms）', { ms: String(ms) })
              : t('oc.test.vendorOk', '厂商 API 可用'),
            'success',
          );
        } else {
          const detail = [data?.detail, data?.status ? `HTTP ${data.status}` : '', data?.error]
            .filter(Boolean)
            .join(' · ');
          addToast(detail || t('oc.test.vendorFail', '厂商 API 测试失败'), 'warning');
        }
      } catch {
        setVendorTest('fail');
        addToast(t('oc.test.vendorFailNet', '厂商 API 测试失败（网络或服务异常）'), 'error');
      }
      setTimeout(() => setVendorTest('idle'), 5000);
    },
    [
      selectedAiModelId,
      quickSelectedAiModelId,
      aiProvider,
      quickAiProvider,
      aiBaseUrl,
      quickAiBaseUrl,
      aiModel,
      quickAiModel,
      aiApiKey,
      quickAiApiKey,
      aiSavedModels,
      aiEnvApiKeyAvailable,
      addToast,
      t,
      tf,
    ],
  );

  const handleRestoreStudioDefaultModel = async () => {
    if (!studioDefaultPreset) return;
    setAiSaving(true);
    try {
      await saveAgentConfig({ action: 'restore_bootstrap_preset' });
    } catch (err) {
      addToast(
        tf('toast.aiRestoreDefaultFail', '恢复默认模型失败: {{msg}}', {
          msg: err instanceof Error ? err.message : t('toast.unknownErr', '未知错误'),
        }),
        'error',
      );
      return;
    } finally {
      setAiSaving(false);
    }
    try {
      await refreshAiConfig();
    } catch {
      /* ignore */
    }
    addToast(
      t('toast.aiRestoredDefault', '已切换为 RDK Studio 内置默认模型（与首次安装一致）'),
      'success',
    );
  };

  const handleExportAgentConfig = async () => {
    try {
      const data = await exportAgentConfig(true);
      const registry = data?.registry;
      if (!registry || typeof registry !== 'object') {
        throw new Error(t('toast.exportFail', '导出失败'));
      }
      if (!Array.isArray(registry.entries) || registry.entries.length === 0) {
        throw new Error(
          t('toast.exportNoEntries', '当前没有已保存的模型配置可导出，请先在「AI 引擎」中添加并保存至少一条配置'),
        );
      }
      const fileName = `rdkstudio-agent-config-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const json = JSON.stringify(registry, null, 2);
      const save = typeof window !== 'undefined' ? window.rdkDesktop?.saveTextFile : undefined;
      if (save) {
        const r = await save({
          defaultPath: fileName,
          content: json,
          title: t('settings.ai.export', '导出'),
        });
        if (r?.canceled) return;
        if (!r?.ok) throw new Error(r?.error || t('toast.exportFail', '导出失败'));
        addToast(t('toast.exportOk', '模型配置已导出'), 'success');
        return;
      }
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = fileName;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor); anchor.click();
      document.body.removeChild(anchor); URL.revokeObjectURL(url);
      addToast(t('toast.exportOk', '模型配置已导出'), 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('toast.exportFail', '导出失败'), 'error');
    }
  };

  const handleImportAgentConfig = async (file: File) => {
    setAiSaving(true);
    try {
      const text = await file.text();
      const raw = JSON.parse(text) as AgentConfigExportPayload & { registry?: AgentConfigExportPayload; ok?: boolean };
      /** 兼容直接保存了「完整 API 响应」或嵌套 registry 的备份文件 */
      const parsed: AgentConfigExportPayload =
        raw && typeof raw === 'object' && raw.registry && Array.isArray(raw.registry.entries) ? raw.registry : raw;
      if (!Array.isArray(parsed?.entries) || parsed.entries.length === 0) throw new Error(t('err.importNoEntries', '导入文件无有效 entries'));
      await importAgentConfig({ registry: parsed, setActiveId: parsed.activeId || undefined, merge: true });
    } catch (error) {
      addToast(
        error instanceof Error
          ? tf('toast.importFailMsg', '导入失败：{{msg}}', { msg: error.message })
          : t('toast.importFail', '导入失败'),
        'error',
      );
      return;
    } finally {
      setAiSaving(false);
      if (importAgentConfigRef.current) importAgentConfigRef.current.value = '';
    }
    try {
      await refreshAiConfig();
    } catch {
      /* ignore */
    }
    addToast(t('toast.importOk', '模型配置导入成功'), 'success');
  };

  const applyAiProviderPreset = (lane: 'thinking' | 'quick', nextProvider: string) => {
    if (lane === 'thinking') {
      const prevDefaults = AI_PROVIDER_DEFAULTS[aiProvider];
      const nextDefaults = AI_PROVIDER_DEFAULTS[nextProvider] || AI_PROVIDER_DEFAULTS['openai-compatible'];
      const shouldReplaceModel = !aiModel || aiModel === prevDefaults?.model;
      const shouldReplaceBaseUrl = !aiBaseUrl || aiBaseUrl === prevDefaults?.baseUrl;
      setAiLabel('');
      setAiProvider(nextProvider);
      if (shouldReplaceModel) setAiModel(nextDefaults.model);
      if (shouldReplaceBaseUrl) setAiBaseUrl(nextDefaults.baseUrl);
      return;
    }
    const prevDefaults = AI_PROVIDER_DEFAULTS[quickAiProvider];
    const nextDefaults = AI_PROVIDER_DEFAULTS[nextProvider] || AI_PROVIDER_DEFAULTS['openai-compatible'];
    const shouldReplaceModel = !quickAiModel || quickAiModel === prevDefaults?.model;
    const shouldReplaceBaseUrl = !quickAiBaseUrl || quickAiBaseUrl === prevDefaults?.baseUrl;
    setQuickAiLabel('');
    setQuickAiProvider(nextProvider);
    if (shouldReplaceModel) setQuickAiModel(nextDefaults.model);
    if (shouldReplaceBaseUrl) setQuickAiBaseUrl(nextDefaults.baseUrl);
  };

  /* ── WeChat Handlers ── */

  /** 与 fetch 一致：相对路径走当前页 / rdkDesktop.apiBase，避免服务端拼的绝对 URL 与浏览器入口 Host/HTTPS 不一致导致二维码 404 */
  const resolveWeixinQrImgSrc = (raw: string) => {
    const s = String(raw || '').trim();
    if (!s) return s;
    try {
      if (/^https?:\/\//i.test(s)) {
        const u = new URL(s);
        return resolveApiUrl(`${u.pathname}${u.search}`);
      }
    } catch {
      /* ignore */
    }
    return resolveApiUrl(s.startsWith('/') ? s : `/${s}`);
  };

  /** 用 fetchApi 拉取二进制并生成 Blob URL，避免 img 直接请求时拿不到会话/拿到 401 JSON 却显示为裂图 */
  const loadWeixinQrPreviewAsObjectUrl = async (raw: string): Promise<string> => {
    const pathOrUrl = resolveWeixinQrImgSrc(raw);
    const res = await fetchApi(pathOrUrl, { credentials: 'include' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        tf('settings.weixin.qrHttpErr', '加载二维码失败：HTTP {{status}} {{detail}}', {
          status: res.status,
          detail: text.slice(0, 160),
        }),
      );
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) {
      throw new Error(
        tf('settings.weixin.qrInvalidType', '无效的响应类型（非图片）: {{ct}}', { ct: ct || '(empty)' }),
      );
    }
    const blob = await res.blob();
    if (blob.size < 32) {
      throw new Error(t('settings.weixin.qrDataTooShort', '图片数据过短'));
    }
    return URL.createObjectURL(blob);
  };

  const closeWeixinLogin = () => {
    if (weixinQrBlobUrlRef.current) {
      URL.revokeObjectURL(weixinQrBlobUrlRef.current);
      weixinQrBlobUrlRef.current = null;
    }
    weixinLoginEventSource?.close();
    setWeixinLoginEventSource(null);
    setWeixinLoginLoading(false);
    setWeixinQrCode(null);
    setWeixinQrBroken(false);
    setWeixinLoginStatus('');
  };

  const startWeixinLogin = () => {
    closeWeixinLogin();
    setWeixinLoginLoading(true);
    setWeixinLoginStatus(t('settings.weixin.fetchQr', '正在获取二维码...'));

    let settled = false;
    const loginUrl = resolveApiUrlAbsolute(
      (() => {
        const base = resolveApiUrl('/api/rdkclaw/weixin/login');
        try {
          const sid = window.localStorage.getItem(RDK_SSO_SESSION_MIRROR_KEY)?.trim();
          if (sid && /^[a-f0-9]{64}$/i.test(sid)) {
            const sep = base.includes('?') ? '&' : '?';
            return `${base}${sep}rdk_sso_session=${encodeURIComponent(sid)}`;
          }
        } catch { /* ignore */ }
        return base;
      })(),
    );
    const es = new EventSource(loginUrl);
    setWeixinLoginEventSource(es);

    es.addEventListener('qrcode', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.qrcode) {
          setWeixinQrBroken(false);
          if (weixinQrBlobUrlRef.current) {
            URL.revokeObjectURL(weixinQrBlobUrlRef.current);
            weixinQrBlobUrlRef.current = null;
          }
          setWeixinQrCode(null);
          void loadWeixinQrPreviewAsObjectUrl(data.qrcode)
            .then((objectUrl) => {
              weixinQrBlobUrlRef.current = objectUrl;
              setWeixinQrCode(objectUrl);
              setWeixinLoginStatus(t('settings.weixin.scanBelow', '请用微信扫描下方二维码'));
            })
            .catch(() => {
              setWeixinQrBroken(true);
              addToast(
                t('settings.weixin.qrLoadFail', '二维码图片无法显示，请关闭后重试；若仍失败请更新 RDK Studio'),
                'error',
              );
            });
        }
      } catch { /* ignore */ }
    });
    es.addEventListener('scanned', () => {
      setWeixinLoginStatus(t('settings.weixin.confirmInWechat', '已扫码，请在微信中确认...'));
    });
    es.addEventListener('log', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.message) setWeixinLoginStatus(data.message);
      } catch { /* ignore */ }
    });
    es.addEventListener('bound', (e) => {
      if (settled) return;
      settled = true;
      try {
        const data = JSON.parse(e.data);
        addToast(tf('toast.weixinBound', '微信已绑定: {{name}}', { name: data.nickname || data.accountId }), 'success');
        loadWeixinData();
      } catch { /* ignore */ }
      closeWeixinLogin();
    });
    es.addEventListener('weixin_login_fail', (e) => {
      if (settled) return;
      settled = true;
      try {
        const data = JSON.parse((e as MessageEvent).data || '{}');
        addToast(
          tf('toast.weixinLoginFailMsg', '登录失败: {{msg}}', {
            msg: data.message || t('toast.unknownErr', '未知错误'),
          }),
          'error',
        );
      } catch { /* ignore */ }
      closeWeixinLogin();
    });
    es.addEventListener('done', () => { if (!settled) closeWeixinLogin(); });
    es.onerror = () => {
      if (settled) return;
      settled = true;
      addToast(t('toast.weixinEsLost', '连接中断，请重试'), 'error');
      closeWeixinLogin();
    };
  };

  /* ═══════════════════════════════════════════
     Render
     ═══════════════════════════════════════════ */

  const H = ({ title, desc }: { title: string; desc?: string }) => (
    <div className="settings-section-header">
      <h3 className="settings-section-title">{title}</h3>
      {desc ? <p className="settings-section-desc">{desc}</p> : null}
    </div>
  );

  const feishuRunning = feishuStatus?.runtime?.running;
  const feishuConnected = feishuRunning && feishuStatus?.runtime?.connected;

  /** 必须挂到 document.body：settings-drawer 的 transform 会让内部 position:fixed 只覆盖抽屉，主界面大字会透出 */
  const weixinQrPortal =
    weixinLoginLoading && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="modal-overlay modal-overlay--weixin-qr"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-weixin-qr-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeWeixinLogin();
            }}
          >
            <div
              className="modal-content settings-weixin-qr-modal"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 400, width: '100%' }}
            >
              <div className="modal-header settings-weixin-qr-header">
                <span id="settings-weixin-qr-title" className="modal-title">
                  {t('settings.weixin.modalTitle', '扫码连接 RDKClaw')}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={closeWeixinLogin} aria-label={t('settings.modal.close', '关闭')}>
                  &times;
                </button>
              </div>
              <div className="modal-body settings-weixin-qr-body">
                {weixinQrCode ? (
                  <>
                    <div className="settings-qr-container">
                      {!weixinQrBroken ? (
                        <img
                          src={weixinQrCode}
                          alt={t('settings.weixin.qrAlt', '微信扫码')}
                          className="settings-qr-img"
                          onError={() => {
                            setWeixinQrBroken(true);
                            addToast(
                              t('settings.weixin.qrLoadFail', '二维码图片无法显示，请关闭后重试；若仍失败请更新 RDK Studio'),
                              'error',
                            );
                          }}
                        />
                      ) : (
                        <p className="settings-hint settings-weixin-qr-fallback" style={{ margin: 0 }}>
                          {t('settings.weixin.qrLoadFailHint', '图片解码失败，请关闭弹窗后重试「扫码连接 RDKClaw」。')}
                        </p>
                      )}
                    </div>
                    <p className="settings-weixin-qr-hint">
                      {weixinLoginStatus || t('settings.weixin.scanHint', '请用微信扫一扫')}
                    </p>
                  </>
                ) : (
                  <div className="settings-weixin-qr-loading">
                    <div className="spinner" style={{ margin: '0 auto 16px' }} />
                    <p className="settings-weixin-qr-loading-text">
                      {weixinLoginStatus || t('settings.weixin.fetchQr', '正在获取二维码...')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  if (!showSettings) return weixinQrPortal;

  return (
    <>
      {weixinQrPortal}
      <div className="settings-overlay" onClick={() => setShowSettings(false)}>
      <div className="settings-drawer" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <div className="settings-title">{t('settings.title', 'RDKClaw 设置')}</div>
          <button type="button" className="btn-icon" onClick={() => setShowSettings(false)}>×</button>
        </div>

        <div className="settings-layout">
            <nav className="settings-section-nav">
              {SECTIONS.map((s) => (
                <button key={s.id} type="button"
                  className={`settings-section-nav-item ${activeSection === s.id ? 'active' : ''}`}
                  onClick={() => scrollToSection(s.id)}
                >{s.label}</button>
              ))}
            </nav>

            <div className="settings-scroll-area" ref={scrollAreaRef}>

              {showAccountSection && (
                <>
                  <section id="account" className="settings-section" ref={registerSectionRef('account')}>
                    <H
                      title={t('settings.account.title', '账户与安全')}
                      desc={t(
                        'settings.account.desc',
                        '当前通过 D-Robotics 统一登录使用工作台。退出后将清除本会话，设备列表仍保存在本机与服务端。',
                      )}
                    />
                    <div className="settings-card">
                      <div className="settings-row">
                        <span className="settings-row-label">{t('settings.account.signedIn', '已登录')}</span>
                        <div className="settings-row-value">
                          <span className="settings-row-static">
                            {user?.name || user?.email || user?.id || t('settings.account.sessionOnly', '已建立会话')}
                          </span>
                        </div>
                      </div>
                      {user?.email && (
                        <div className="settings-row">
                          <span className="settings-row-label">{t('settings.account.email', '邮箱')}</span>
                          <div className="settings-row-value">
                            <span className="settings-row-static">{user.email}</span>
                          </div>
                        </div>
                      )}
                      <div className="settings-account-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm settings-account-logout"
                          onClick={() => {
                            void logout();
                          }}
                        >
                          {t('settings.account.logout', '退出登录')}
                        </button>
                      </div>
                    </div>
                  </section>
                  <hr className="settings-section-divider" />
                </>
              )}

              {/* ══ AI 引擎 ══ */}
              <section id="ai-engine" className="settings-section" ref={registerSectionRef('ai-engine')}>
                <H
                  title={t('settings.ai.title', 'AI 引擎')}
                  desc={t(
                    'settings.ai.desc',
                    '驱动 RDKClaw 的模型与工具链：面向真实套件端联调、排障与自动化。请在此选择服务商并配置 API Key。',
                  )}
                />
                <div className="settings-card settings-card--ai">
                  <div className="settings-row" style={{ borderTop: 'none', paddingTop: 0 }}>
                    <span className="settings-row-label">{t('settings.ai.editingLane', '编辑')}</span>
                    <div className="settings-row-value settings-row-value--stack settings-ai-lane-row">
                      <div className="settings-segmented" role="tablist" aria-label={t('settings.ai.laneTabs', '深度或快速配置')}>
                        <button
                          type="button"
                          role="tab"
                          className="settings-segmented-btn"
                          aria-selected={aiEngineLaneTab === 'thinking'}
                          aria-pressed={aiEngineLaneTab === 'thinking'}
                          onClick={() => setAiEngineLaneTab('thinking')}
                        >
                          {t('settings.ai.laneThinking', '深度思考')}
                        </button>
                        <button
                          type="button"
                          role="tab"
                          className="settings-segmented-btn"
                          aria-selected={aiEngineLaneTab === 'quick'}
                          aria-pressed={aiEngineLaneTab === 'quick'}
                          onClick={() => setAiEngineLaneTab('quick')}
                        >
                          {t('settings.ai.laneQuick', '快速回答')}
                        </button>
                      </div>
                      <span className="settings-ai-lane-hint">
                        {t('settings.ai.laneSwitchHint', '深度与快速两套配置独立保存。')}
                      </span>
                    </div>
                  </div>
                  {studioDefaultPreset ? (
                    <div className="settings-row">
                      <span className="settings-row-label">{t('settings.ai.builtin', '内置模型')}</span>
                      <div className="settings-row-value settings-row-value--stack">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={aiSaving || studioDefaultPreset.isActive}
                          title={studioDefaultPreset.label}
                          onClick={() => void handleRestoreStudioDefaultModel()}
                        >
                          {studioDefaultPreset.isActive
                            ? t('settings.ai.builtin.current', '当前为系统内置')
                            : t('settings.ai.builtin.use', '使用系统内置模型')}
                        </button>
                        <span className="settings-ai-lane-hint" style={{ maxWidth: 'none' }}>
                          {t(
                            'settings.ai.builtin.hint',
                            '一键启用安装包自带的模型预设（与下方手动填写示例不同）。',
                          )}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="settings-row">
                      <span className="settings-row-label">{t('settings.ai.builtin', '内置模型')}</span>
                      <div className="settings-row-value settings-row-value--stack">
                        <span className="settings-ai-lane-hint" style={{ fontSize: '0.75rem', maxWidth: 'none' }}>
                          {import.meta.env.DEV
                            ? t(
                                'settings.ai.builtin.missing',
                                '未检测到安装包内置预设文件。开发目录请从项目根启动；可设置环境变量 RDK_PROVIDER_BOOTSTRAP_FILE 指向 rdkclaw-provider.defaults.json。',
                              )
                            : t(
                                'settings.ai.builtin.missingShort',
                                '未检测到内置预设。请使用官方安装包，或由管理员配置。',
                              )}
                        </span>
                      </div>
                    </div>
                  )}
                  {aiEngineLaneTab === 'thinking' ? (
                  <>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.ai.currentModel', '当前模型')}</span>
                    <div className="settings-row-value">
                      <div className="settings-ai-model-row">
                      <select
                        className="select"
                        title={t('settings.ai.savedModels.title', '已保存模型')}
                        aria-label={t('settings.ai.savedModels.aria', '已保存模型')}
                        value={selectedAiModelId}
                        disabled={aiSaving}
                        onChange={async (e) => {
                          const id = e.target.value;
                          if (!id) {
                            handleCreateNewThinkingModel();
                            return;
                          }
                          const entry = aiSavedModels.find((i) => i.id === id);
                          if (!entry) return;
                          if (!entry.isActive) {
                            if (!entry.hasApiKey && !aiEnvApiKeyAvailable) {
                              applyAiModelToForm(entry);
                              addToast(
                                t(
                                  'toast.aiNoKeyWarn',
                                  '该模型未配置 API Key，请先编辑并保存后再切换（或配置环境变量 OPENAI_API_KEY）',
                                ),
                                'warning',
                              );
                              return;
                            }
                            applyAiModelToForm(entry);
                            setAiSaving(true);
                            let switchResult: Awaited<ReturnType<typeof saveAgentConfig>> | null = null;
                            try {
                              switchResult = await saveAgentConfig({ action: 'switch', id });
                              if (switchResult.active?.id === id) {
                                applyAiModelToForm({
                                  id: switchResult.active.id,
                                  label: entry.label,
                                  provider: switchResult.active.provider,
                                  model: switchResult.active.model,
                                  hasApiKey: switchResult.active.hasApiKey,
                                  baseUrl: switchResult.active.baseUrl,
                                  thinkingDefault: entry.thinkingDefault,
                                  reasoningVisibility: entry.reasoningVisibility,
                                  samplingTemperature: entry.samplingTemperature,
                                  samplingTopP: entry.samplingTopP,
                                  isActive: true,
                                });
                              }
                            } catch (err) {
                              await refreshAiConfig().catch(() => {});
                              addToast(
                                tf('toast.aiSwitchFailMsg', '切换失败: {{msg}}', {
                                  msg:
                                    err instanceof Error ? err.message : t('toast.unknownErr', '未知错误'),
                                }),
                                'error',
                              );
                              return;
                            } finally {
                              setAiSaving(false);
                            }
                            try {
                              await refreshAiConfig();
                            } catch {
                              /* ignore */
                            }
                            const name = switchResult?.active
                              ? `${switchResult.active.provider}/${switchResult.active.model}`
                              : `${entry.provider}/${entry.model}`;
                            addToast(tf('toast.aiSwitchedTo', '已切换到 {{name}}', { name }), 'success');
                            return;
                          }
                          applyAiModelToForm(entry);
                        }}
                      >
                        <option value="">{t('settings.ai.newProfile', '+ 新建配置')}</option>
                        {studioDefaultPreset?.inRegistry ? (
                          <option value={studioDefaultPreset.id}>
                            {t('settings.ai.systemDefaultThinking', '系统默认（深度思考）')}
                            {' — '}
                            {studioDefaultPreset.label}
                          </option>
                        ) : null}
                        {aiSavedModels
                          .filter((i) => !studioDefaultPreset?.inRegistry || i.id !== studioDefaultPreset.id)
                          .map((i) => {
                            const realName = `${i.provider}/${i.model}`;
                            const display =
                              i.label && i.label !== realName ? `${i.label} (${realName})` : realName;
                            const keyStatus = i.hasApiKey ? '' : t('settings.ai.noKeySuffix', ' [未配置Key]');
                            const mark = `${i.isActive ? ' ✓' : ''}${i.isQuickLane ? ' ⚡' : ''}`;
                            return (
                              <option key={i.id} value={i.id}>
                                {display}
                                {keyStatus}
                                {mark}
                              </option>
                            );
                          })}
                      </select>
                      {aiConfigured && (
                        <span className="settings-status-badge ok">{t('settings.ai.configured', '已配置')}</span>
                      )}
                      </div>
                    </div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.ai.provider', '服务商')}</span>
                    <div className="settings-row-value">
                      <select
                        className="select"
                        title={t('settings.ai.provider', '服务商')}
                        aria-label={t('settings.ai.provider', '服务商')}
                        value={aiProvider}
                        onChange={(e) => applyAiProviderPreset('thinking', e.target.value)}
                      >
                        {AI_PROVIDER_OPTIONS.map((i) => (
                          <option key={i.value} value={i.value}>
                            {i.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.ai.model', '模型')}</span>
                    <div className="settings-row-value">
                      <div className="settings-ai-inline-row">
                      <input
                        type="text"
                        className="input"
                        title={t('settings.ai.model', '模型')}
                        aria-label={t('settings.ai.model', '模型')}
                        placeholder={AI_PROVIDER_DEFAULTS[aiProvider]?.model}
                        value={aiModel}
                        onChange={(e) => {
                          setAiModel(e.target.value);
                          setAiLabel('');
                        }}
                      />
                      {AI_PROVIDER_DEFAULTS[aiProvider]?.model ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={aiSaving}
                          title={t('settings.ai.fillExampleHint', '填入该服务商占位符中的示例模型名与 Base URL，保存后生效')}
                          onClick={() => {
                            const d = AI_PROVIDER_DEFAULTS[aiProvider];
                            if (!d?.model) return;
                            setAiModel(d.model);
                            if (d.baseUrl) setAiBaseUrl(d.baseUrl);
                            setAiLabel('');
                          }}
                        >
                          {t('settings.ai.fillExample', '填入示例模型')}
                        </button>
                      ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">API Key</span>
                    <div className="settings-row-value settings-row-value--stretch">
                      <input
                        type="password"
                        className="input"
                        title="API Key"
                        aria-label="API Key"
                        placeholder={
                          aiConfigured && aiProvider === loadedAiProviderRef.current
                            ? t('settings.ai.apiKey.placeholder.saved', '已保存，留空不更新')
                            : t('settings.ai.apiKey.placeholder.input', '请输入 API Key')
                        }
                        value={aiApiKey}
                        onChange={(e) => setAiApiKey(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">Base URL</span>
                    <div className="settings-row-value settings-row-value--stretch">
                      <input
                        type="text"
                        className="input"
                        title="Base URL"
                        aria-label="Base URL"
                        placeholder={AI_PROVIDER_DEFAULTS[aiProvider]?.baseUrl || 'https://...'}
                        value={aiBaseUrl}
                        onChange={(e) => setAiBaseUrl(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="settings-row settings-row--top">
                    <span className="settings-row-label">{t('settings.ai.vendorTest', '连通性')}</span>
                    <div className="settings-row-value settings-row-value--stretch settings-row-value--stack">
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => void handleTestVendorApi('thinking')}
                          disabled={thinkingVendorTest === 'testing' || aiSaving}
                        >
                          {thinkingVendorTest === 'testing'
                            ? '...'
                            : thinkingVendorTest === 'ok'
                              ? t('oc.test.vendorOkLabel', '厂商 API 正常')
                              : t('oc.test.vendorRun', '测试厂商 API')}
                        </button>
                      </div>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.35, maxWidth: 420 }}>
                        {t(
                          'settings.ai.vendorTestHint',
                          '从本机测试 API 连通性；已保存密钥或环境变量 OPENAI_API_KEY 时 Key 可留空。',
                        )}
                      </span>
                    </div>
                  </div>
                  <div style={{ paddingTop: 2 }}>
                    <details className="settings-details-block">
                      <summary className="settings-details-summary">
                        {t('settings.ai.advanced', '高级参数（推理与采样）')}
                      </summary>
                      <div className="settings-details-body">
                        <p className="settings-ai-advanced-hint">
                          {t(
                            'settings.ai.brainAdvancedHint',
                            '思考档位与推理可见性；留空则用运行时默认。温度 / top_p 留空则不传给 API。',
                          )}
                        </p>
                        <div className="settings-ai-advanced-grid">
                          <label className="settings-ai-advanced-field">
                            <span>{t('settings.ai.thinkingDefault', '思考档位')}</span>
                            <select
                              className="select"
                              title={t('settings.ai.thinkingDefault', '思考档位')}
                              aria-label={t('settings.ai.thinkingDefault', '思考档位')}
                              value={aiThinkingDefault}
                              onChange={(e) => setAiThinkingDefault(e.target.value)}
                            >
                              <option value="">{t('settings.ai.brainInherit', '默认 (high)')}</option>
                              <option value="off">off</option>
                              <option value="minimal">minimal</option>
                              <option value="low">low</option>
                              <option value="medium">medium</option>
                              <option value="high">high</option>
                              <option value="xhigh">xhigh</option>
                              <option value="adaptive">adaptive</option>
                            </select>
                          </label>
                          <label className="settings-ai-advanced-field">
                            <span>{t('settings.ai.reasoningVisibility', '推理可见性')}</span>
                            <select
                              className="select"
                              title={t('settings.ai.reasoningVisibility', '推理可见性')}
                              aria-label={t('settings.ai.reasoningVisibility', '推理可见性')}
                              value={aiReasoningVisibility}
                              onChange={(e) => setAiReasoningVisibility(e.target.value)}
                            >
                              <option value="">{t('settings.ai.brainStreamDefault', '默认 (stream)')}</option>
                              <option value="off">off</option>
                              <option value="on">on</option>
                              <option value="stream">stream</option>
                            </select>
                          </label>
                          <label className="settings-ai-advanced-field">
                            <span>{t('settings.ai.samplingTemperature', '温度 temperature')}</span>
                            <input
                              type="text"
                              className="input"
                              inputMode="decimal"
                              title={t('settings.ai.samplingTemperature', '温度 temperature')}
                              aria-label={t('settings.ai.samplingTemperature', '温度 temperature')}
                              placeholder={t('settings.ai.samplingPlaceholder', '如 0.7，留空默认')}
                              value={aiSamplingTemperature}
                              onChange={(e) => setAiSamplingTemperature(e.target.value)}
                            />
                          </label>
                          <label className="settings-ai-advanced-field">
                            <span>{t('settings.ai.samplingTopP', 'top_p')}</span>
                            <input
                              type="text"
                              className="input"
                              inputMode="decimal"
                              title={t('settings.ai.samplingTopP', 'top_p')}
                              aria-label={t('settings.ai.samplingTopP', 'top_p')}
                              placeholder={t('settings.ai.topPPlaceholder', '如 0.9，留空不传')}
                              value={aiSamplingTopP}
                              onChange={(e) => setAiSamplingTopP(e.target.value)}
                            />
                          </label>
                        </div>
                      </div>
                      </details>
                  </div>
                  </>
                  ) : (
                  <>
                  {studioQuickDefaultPreset && !studioQuickDefaultPreset.inRegistry ? (
                    <div className="settings-row" style={{ minHeight: 'auto', alignItems: 'flex-start' }}>
                      <span className="settings-row-label" />
                      <div className="settings-row-value" style={{ justifyContent: 'flex-start' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                          {t(
                            'settings.ai.systemDefaultRestoreHint',
                            '若列表里没有「系统默认（快速）」，可先点击下方「使用系统内置模型」将安装包预设合并进本地后再选。',
                          )}
                        </span>
                      </div>
                    </div>
                  ) : null}
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.ai.currentModel', '当前模型')}</span>
                    <div className="settings-row-value">
                      <div className="settings-ai-model-row">
                      <select
                        className="select"
                        title={t('settings.ai.savedModels.title', '已保存模型')}
                        aria-label={t('settings.ai.savedModels.aria', '已保存模型')}
                        value={
                          quickSelectedAiModelId.trim() ||
                          (aiSavedModels.length > 0 ? '__quick_pick__' : '')
                        }
                        disabled={aiSaving}
                        onChange={async (e) => {
                          const raw = e.target.value;
                          if (raw === '__quick_pick__') return;
                          const id = raw;
                          if (!id) {
                            handleCreateNewQuickModel();
                            return;
                          }
                          const entry = aiSavedModels.find((i) => i.id === id);
                          if (!entry) return;
                          const bound = quickLaneModelId.trim();
                          if (bound !== entry.id) {
                            if (!entry.hasApiKey && !aiEnvApiKeyAvailable) {
                              applyQuickFormFromEntry(entry);
                              addToast(
                                t(
                                  'toast.aiNoKeyWarn',
                                  '该模型未配置 API Key，请先编辑并保存后再切换（或配置环境变量 OPENAI_API_KEY）',
                                ),
                                'warning',
                              );
                              return;
                            }
                            applyQuickFormFromEntry(entry);
                            setAiSaving(true);
                            try {
                              await saveAgentConfig({ action: 'switch_quick', id: entry.id });
                              await refreshAiConfig();
                              const name = `${entry.provider}/${entry.model}`;
                              addToast(
                                tf('toast.aiQuickLaneUpdated', '快速回答模型已设为：{{name}}', { name }),
                                'success',
                              );
                            } catch (err) {
                              await refreshAiConfig().catch(() => {});
                              addToast(
                                tf('toast.aiSwitchFailMsg', '切换失败: {{msg}}', {
                                  msg:
                                    err instanceof Error ? err.message : t('toast.unknownErr', '未知错误'),
                                }),
                                'error',
                              );
                            } finally {
                              setAiSaving(false);
                            }
                            return;
                          }
                          applyQuickFormFromEntry(entry);
                        }}
                      >
                        {!quickSelectedAiModelId.trim() && aiSavedModels.length > 0 ? (
                          <option value="__quick_pick__" disabled>
                            {t('settings.ai.pickQuickModel', '请选择快速回答所用配置')}
                          </option>
                        ) : null}
                        <option value="">{t('settings.ai.newProfile', '+ 新建配置')}</option>
                        {studioQuickDefaultPreset?.inRegistry ? (
                          <option value={studioQuickDefaultPreset.id}>
                            {t('settings.ai.systemDefaultQuick', '系统默认（快速回答）')}
                            {' — '}
                            {studioQuickDefaultPreset.label}
                          </option>
                        ) : null}
                        {aiSavedModels
                          .filter(
                            (i) =>
                              !studioQuickDefaultPreset?.inRegistry ||
                              i.id !== studioQuickDefaultPreset.id,
                          )
                          .map((i) => {
                            const realName = `${i.provider}/${i.model}`;
                            const display =
                              i.label && i.label !== realName ? `${i.label} (${realName})` : realName;
                            const keyStatus = i.hasApiKey ? '' : t('settings.ai.noKeySuffix', ' [未配置Key]');
                            const mark = `${i.isActive ? ' ✓' : ''}${i.isQuickLane ? ' ⚡' : ''}`;
                            return (
                              <option key={i.id} value={i.id}>
                                {display}
                                {keyStatus}
                                {mark}
                              </option>
                            );
                          })}
                      </select>
                      {aiConfigured && (
                        <span className="settings-status-badge ok">{t('settings.ai.configured', '已配置')}</span>
                      )}
                      </div>
                    </div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.ai.provider', '服务商')}</span>
                    <div className="settings-row-value">
                      <select
                        className="select"
                        title={t('settings.ai.provider', '服务商')}
                        aria-label={t('settings.ai.provider', '服务商')}
                        value={quickAiProvider}
                        onChange={(e) => applyAiProviderPreset('quick', e.target.value)}
                      >
                        {AI_PROVIDER_OPTIONS.map((i) => (
                          <option key={i.value} value={i.value}>
                            {i.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.ai.model', '模型')}</span>
                    <div className="settings-row-value">
                      <div className="settings-ai-inline-row">
                      <input
                        type="text"
                        className="input"
                        title={t('settings.ai.model', '模型')}
                        aria-label={t('settings.ai.model', '模型')}
                        placeholder={AI_PROVIDER_DEFAULTS[quickAiProvider]?.model}
                        value={quickAiModel}
                        onChange={(e) => {
                          setQuickAiModel(e.target.value);
                          setQuickAiLabel('');
                        }}
                      />
                      {AI_PROVIDER_DEFAULTS[quickAiProvider]?.model ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={aiSaving}
                          title={t('settings.ai.fillExampleHint', '填入该服务商占位符中的示例模型名与 Base URL，保存后生效')}
                          onClick={() => {
                            const d = AI_PROVIDER_DEFAULTS[quickAiProvider];
                            if (!d?.model) return;
                            setQuickAiModel(d.model);
                            if (d.baseUrl) setQuickAiBaseUrl(d.baseUrl);
                            setQuickAiLabel('');
                          }}
                        >
                          {t('settings.ai.fillExample', '填入示例模型')}
                        </button>
                      ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">API Key</span>
                    <div className="settings-row-value settings-row-value--stretch">
                      <input
                        type="password"
                        className="input"
                        title="API Key"
                        aria-label="API Key"
                        placeholder={
                          aiConfigured && quickAiProvider === quickLoadedAiProviderRef.current
                            ? t('settings.ai.apiKey.placeholder.saved', '已保存，留空不更新')
                            : t('settings.ai.apiKey.placeholder.input', '请输入 API Key')
                        }
                        value={quickAiApiKey}
                        onChange={(e) => setQuickAiApiKey(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">Base URL</span>
                    <div className="settings-row-value settings-row-value--stretch">
                      <input
                        type="text"
                        className="input"
                        title="Base URL"
                        aria-label="Base URL"
                        placeholder={AI_PROVIDER_DEFAULTS[quickAiProvider]?.baseUrl || 'https://...'}
                        value={quickAiBaseUrl}
                        onChange={(e) => setQuickAiBaseUrl(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="settings-row settings-row--top">
                    <span className="settings-row-label">{t('settings.ai.vendorTest', '连通性')}</span>
                    <div className="settings-row-value settings-row-value--stretch settings-row-value--stack">
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => void handleTestVendorApi('quick')}
                          disabled={quickVendorTest === 'testing' || aiSaving}
                        >
                          {quickVendorTest === 'testing'
                            ? '...'
                            : quickVendorTest === 'ok'
                              ? t('oc.test.vendorOkLabel', '厂商 API 正常')
                              : t('oc.test.vendorRun', '测试厂商 API')}
                        </button>
                      </div>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.35, maxWidth: 420 }}>
                        {t(
                          'settings.ai.vendorTestHint',
                          '从本机测试 API 连通性；已保存密钥或环境变量 OPENAI_API_KEY 时 Key 可留空。',
                        )}
                      </span>
                    </div>
                  </div>
                  <div style={{ paddingTop: 2 }}>
                    <details className="settings-details-block">
                      <summary className="settings-details-summary">
                        {t('settings.ai.advanced', '高级参数（推理与采样）')}
                      </summary>
                      <div className="settings-details-body">
                        <p className="settings-ai-advanced-hint">
                          {t(
                            'settings.ai.brainAdvancedHint',
                            '思考档位与推理可见性；留空则用运行时默认。温度 / top_p 留空则不传给 API。',
                          )}
                        </p>
                        <div className="settings-ai-advanced-grid">
                          <label className="settings-ai-advanced-field">
                            <span>{t('settings.ai.thinkingDefault', '思考档位')}</span>
                            <select
                              className="select"
                              title={t('settings.ai.thinkingDefault', '思考档位')}
                              aria-label={t('settings.ai.thinkingDefault', '思考档位')}
                              value={quickAiThinkingDefault}
                              onChange={(e) => setQuickAiThinkingDefault(e.target.value)}
                            >
                              <option value="">{t('settings.ai.brainInherit', '默认 (high)')}</option>
                              <option value="off">off</option>
                              <option value="minimal">minimal</option>
                              <option value="low">low</option>
                              <option value="medium">medium</option>
                              <option value="high">high</option>
                              <option value="xhigh">xhigh</option>
                              <option value="adaptive">adaptive</option>
                            </select>
                          </label>
                          <label className="settings-ai-advanced-field">
                            <span>{t('settings.ai.reasoningVisibility', '推理可见性')}</span>
                            <select
                              className="select"
                              title={t('settings.ai.reasoningVisibility', '推理可见性')}
                              aria-label={t('settings.ai.reasoningVisibility', '推理可见性')}
                              value={quickAiReasoningVisibility}
                              onChange={(e) => setQuickAiReasoningVisibility(e.target.value)}
                            >
                              <option value="">{t('settings.ai.brainStreamDefault', '默认 (stream)')}</option>
                              <option value="off">off</option>
                              <option value="on">on</option>
                              <option value="stream">stream</option>
                            </select>
                          </label>
                          <label className="settings-ai-advanced-field">
                            <span>{t('settings.ai.samplingTemperature', '温度 temperature')}</span>
                            <input
                              type="text"
                              className="input"
                              inputMode="decimal"
                              title={t('settings.ai.samplingTemperature', '温度 temperature')}
                              aria-label={t('settings.ai.samplingTemperature', '温度 temperature')}
                              placeholder={t('settings.ai.samplingPlaceholder', '如 0.7，留空默认')}
                              value={quickAiSamplingTemperature}
                              onChange={(e) => setQuickAiSamplingTemperature(e.target.value)}
                            />
                          </label>
                          <label className="settings-ai-advanced-field">
                            <span>{t('settings.ai.samplingTopP', 'top_p')}</span>
                            <input
                              type="text"
                              className="input"
                              inputMode="decimal"
                              title={t('settings.ai.samplingTopP', 'top_p')}
                              aria-label={t('settings.ai.samplingTopP', 'top_p')}
                              placeholder={t('settings.ai.topPPlaceholder', '如 0.9，留空不传')}
                              value={quickAiSamplingTopP}
                              onChange={(e) => setQuickAiSamplingTopP(e.target.value)}
                            />
                          </label>
                        </div>
                      </div>
                    </details>
                  </div>
                  </>
                  )}
                  <div className="settings-ai-footer">
                    <div className="settings-ai-footer__bar">
                      <div className="settings-ai-footer__primary">
                        {aiEngineLaneTab === 'thinking' ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={handleSaveThinkingAiConfig}
                              disabled={aiSaving}
                            >
                              {aiSaving ? '...' : selectedAiModelId ? t('settings.ai.save', '保存') : t('settings.ai.addEnable', '新增并启用')}
                            </button>
                            {selectedAiModelId ? (
                              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={handleDeleteThinkingAiModel} disabled={aiSaving}>
                                {t('settings.ai.delete', '删除')}
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={handleSaveQuickAiConfig}
                              disabled={aiSaving}
                            >
                              {aiSaving ? '...' : quickSelectedAiModelId ? t('settings.ai.save', '保存') : t('settings.ai.addEnable', '新增并启用')}
                            </button>
                            {quickSelectedAiModelId ? (
                              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={handleDeleteQuickAiModel} disabled={aiSaving}>
                                {t('settings.ai.delete', '删除')}
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                      <div className="settings-ai-footer__tools" aria-label={t('settings.ai.backupTools', '配置备份')}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={handleExportAgentConfig} disabled={aiSaving}>
                          {t('settings.ai.export', '导出')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => importAgentConfigRef.current?.click()} disabled={aiSaving}>
                          {t('settings.ai.import', '导入')}
                        </button>
                        <input
                          ref={importAgentConfigRef}
                          type="file"
                          className="sr-only"
                          accept=".json"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleImportAgentConfig(f);
                          }}
                          title={t('settings.ai.import.title', '导入')}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══ 2. 人格与行为 ══ */}
              <section id="persona" className="settings-section" ref={registerSectionRef('persona')}>
                <H title={t('settings.persona.title', '人格与行为')} desc={t('settings.persona.desc', '核心人格由系统层托管（非用户可编辑文件），这里调整运行偏好和自治程度。')} />
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.persona.name', '名称')}</span>
                    <div className="settings-row-value settings-row-value--stretch"><input className="input" title={t('settings.persona.name', '名称')} aria-label={t('settings.persona.name', '名称')} value={persona.name} onChange={e => setPersona(p => ({ ...p, name: e.target.value }))} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.persona.extra', '额外指令')}</span>
                    <div className="settings-row-value settings-row-value--stretch"><textarea className="input" title={t('settings.persona.extra', '额外指令')} aria-label={t('settings.persona.extra', '额外指令')} rows={2} value={persona.extraInstructions} onChange={e => setPersona(p => ({ ...p, extraInstructions: e.target.value }))} placeholder={t('settings.persona.extra.ph', '如「本次优先用英文回复」')} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.persona.risk', '风险偏好')}</span>
                    <div className="settings-row-value settings-row-value--stretch"><select className="select" title={t('settings.persona.risk', '风险偏好')} aria-label={t('settings.persona.risk', '风险偏好')} value={persona.riskLevel} onChange={e => setPersona(p => ({ ...p, riskLevel: e.target.value as PersonaProfile['riskLevel'] }))}><option value="conservative">{t('settings.persona.risk.conservative', '保守')}</option><option value="balanced">{t('settings.persona.risk.balanced', '均衡')}</option><option value="aggressive">{t('settings.persona.risk.aggressive', '激进')}</option></select></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.persona.autonomy', '自治等级')}</span>
                    <div className="settings-row-value settings-row-value--stretch"><select className="select" title={t('settings.persona.autonomy', '自治等级')} aria-label={t('settings.persona.autonomy', '自治等级')} value={persona.autonomyLevel} onChange={e => setPersona(p => ({ ...p, autonomyLevel: e.target.value as PersonaProfile['autonomyLevel'] }))}><option value="manual">{t('settings.persona.autonomy.manual', '手动')}</option><option value="assisted">{t('settings.persona.autonomy.assisted', '辅助')}</option><option value="autonomous">{t('settings.persona.autonomy.autonomous', '自主')}</option></select></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.persona.delegation', '委派倾向')}</span>
                    <div className="settings-row-value settings-row-value--stretch"><select className="select" title={t('settings.persona.delegation', '委派倾向')} aria-label={t('settings.persona.delegation.hint', '委派倾向：均衡为默认，RDKClaw 与套件端 OpenClaw 协同；Studio 优先偏重 SSH，套件端优先偏重 assess→delegate')} value={persona.delegationBias} onChange={e => setPersona(p => ({ ...p, delegationBias: e.target.value as PersonaProfile['delegationBias'] }))}><option value="balanced">{t('settings.persona.delegation.balancedRec', '均衡（推荐）')}</option><option value="local-first">{t('settings.persona.delegation.studio', 'Studio 优先')}</option><option value="board-first">{t('settings.persona.delegation.board', '套件端优先')}</option></select></div>
                  </div>
                  <div className="settings-policy-footer">
                    <button type="button" className="btn btn-primary btn-sm" onClick={handleSavePersona} disabled={rdkclawSaving}>{rdkclawSaving ? '...' : t('settings.persona.save', '保存')}</button>
                  </div>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══ 3. 飞书 ══ */}
              <section id="feishu" className="settings-section" ref={registerSectionRef('feishu')}>
                <H title={t('settings.feishu.title', '消息渠道 · 飞书')} desc={t('settings.feishu.desc', '通过飞书机器人收发消息，让 RDKClaw 成为你的飞书助手。')} />
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.feishu.channelStatus', '通道状态')}</span>
                    <div className="settings-row-value settings-row-value--control">
                      <span className={`settings-status-badge ${feishuConnected ? 'ok' : feishuRunning ? 'ok' : 'off'}`}>
                        {feishuConnected ? t('settings.feishu.status.connected', '已连接') : feishuRunning ? t('settings.feishu.status.waiting', '等待事件') : t('settings.feishu.status.off', '未启动')}
                      </span>
                    </div>
                  </div>
                  <div className="settings-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleFeishuRuntime('start')}>{t('settings.feishu.start', '启动')}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleFeishuRuntime('stop')}>{t('settings.feishu.stop', '停止')}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleFeishuRuntime('restart')}>{t('settings.feishu.restart', '重启')}</button>
                  </div>
                </div>
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">App ID</span>
                    <div className="settings-row-value"><input type="text" className="input" title="App ID" aria-label="App ID" placeholder="cli_xxx" value={feishuAppId} onChange={e => setFeishuAppId(e.target.value)} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">App Secret</span>
                    <div className="settings-row-value"><input type="password" className="input" title="App Secret" aria-label="App Secret" placeholder={feishuMasks.appSecretMasked ? `${feishuMasks.appSecretMasked}${t('settings.feishu.maskKeep', '（留空不改）')}` : t('settings.feishu.enter', '请输入')} value={feishuAppSecret} onChange={e => setFeishuAppSecret(e.target.value)} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.feishu.connMode', '连接模式')}</span>
                    <div className="settings-row-value"><select className="select" title={t('settings.feishu.connMode', '连接模式')} aria-label={t('settings.feishu.connMode', '连接模式')} value={feishuConnectionMode} onChange={e => setFeishuConnectionMode(e.target.value as 'websocket' | 'webhook')}><option value="websocket">WebSocket</option><option value="webhook">Webhook</option></select></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.feishu.dmPolicy', '私信策略')}</span>
                    <div className="settings-row-value"><select className="select" title={t('settings.feishu.dmPolicy', '私信策略')} aria-label={t('settings.feishu.dmPolicy', '私信策略')} value={feishuDmPolicy} onChange={e => setFeishuDmPolicy(e.target.value as 'pairing' | 'allowlist' | 'open')}><option value="pairing">{t('settings.feishu.dm.pairing', '配对')}</option><option value="allowlist">{t('settings.feishu.dm.allowlist', '白名单')}</option><option value="open">{t('settings.feishu.dm.open', '开放')}</option></select></div>
                  </div>
                  <div className="settings-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveFeishu} disabled={feishuSaving}>{feishuSaving ? '...' : t('settings.feishu.saveConfig', '保存配置')}</button>
                  </div>
                </div>

                <div className="settings-card">
                  <details className="settings-details-block" style={{ border: 'none', background: 'transparent', padding: 0 }}>
                    <summary className="settings-details-summary">{t('settings.feishu.stepsTitle', '接入步骤')}</summary>
                    <div className="settings-details-body">
                      <ol className="settings-steps">
                        <li className="settings-step"><span className="settings-step-num">1</span>{t('settings.feishu.step1', '在飞书开放平台创建自建应用，获取 App ID / Secret')}</li>
                        <li className="settings-step"><span className="settings-step-num">2</span>{t('settings.feishu.step2', '开启事件订阅 im.message.receive_v1，选择 WebSocket 模式')}</li>
                        <li className="settings-step"><span className="settings-step-num">3</span>{t('settings.feishu.step3', '填入上方配置并保存，点击「启动」')}</li>
                        <li className="settings-step"><span className="settings-step-num">4</span>{t('settings.feishu.step4', '在飞书私信机器人，使用配对码完成绑定')}</li>
                      </ol>
                    </div>
                  </details>
                </div>

                {(feishuPairings.length > 0 || feishuBoundUsers.length > 0) && (
                  <div className="settings-card">
                    {feishuPairings.length > 0 && <>
                      <h4 className="settings-card-title">{t('settings.feishu.pending', '待审批配对')}</h4>
                      {feishuPairings.map(item => (
                        <div className="settings-row" key={item.code}>
                          <span className="settings-row-label">{item.code}</span>
                          <div className="settings-actions">
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => handlePairingDecision(item.code, 'approve')}>{t('settings.feishu.approve', '批准')}</button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => handlePairingDecision(item.code, 'reject')}>{t('settings.feishu.reject', '拒绝')}</button>
                          </div>
                        </div>
                      ))}
                    </>}
                    {feishuBoundUsers.length > 0 && <>
                      <h4 className="settings-card-title">{tf('settings.feishu.boundCount', '已绑定 ({{n}})', { n: feishuBoundUsers.length })}</h4>
                      {feishuBoundUsers.map(u => (
                        <div className="settings-row" key={u.openId}>
                          <span className="settings-row-label">{u.openId}</span>
                          <span className="settings-hint">{new Date(u.boundAt).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </>}
                  </div>
                )}
              </section>

              <hr className="settings-section-divider" />

              {/* ══ 4. 微信 ══ */}
              <section id="weixin" className="settings-section" ref={registerSectionRef('weixin')}>
                <H title={t('settings.weixin.title', '消息渠道 · 微信')} desc={t('settings.weixin.desc', '扫码绑定个人微信，随时随地与 RDKClaw 对话。')} />
                <div className="settings-card settings-card--weixin">
                  {weixinAccounts.length > 0 ? (
                    <ul className="settings-weixin-list" role="list">
                      {weixinAccounts.map((a) => {
                        const label = a.nickname?.trim() || a.accountId;
                        return (
                          <li className="settings-weixin-row" key={a.accountId}>
                            <span className="settings-weixin-row__id" title={a.accountId}>{label}</span>
                            <time className="settings-weixin-row__date" dateTime={new Date(a.boundAt).toISOString()}>
                              {new Date(a.boundAt).toLocaleDateString()}
                            </time>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm settings-weixin-remove"
                              disabled={weixinRemovingId === a.accountId}
                              onClick={async () => {
                                setWeixinRemovingId(a.accountId);
                                try {
                                  const res = await removeWeixinAccount(a.accountId);
                                  if (res.ok) {
                                    addToast(t('toast.weixinRemoved', '已移除'), 'info');
                                    await loadWeixinData();
                                  } else {
                                    addToast(
                                      t('toast.weixinRemoveFail', '移除失败，请重试'),
                                      'error',
                                    );
                                  }
                                } catch {
                                  addToast(t('toast.weixinRemoveFail', '移除失败，请重试'), 'error');
                                } finally {
                                  setWeixinRemovingId(null);
                                }
                              }}
                            >
                              {t('settings.weixin.remove', '移除')}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="settings-weixin-empty settings-hint">{t('settings.weixin.none', '暂未绑定微信账号')}</p>
                  )}

                  <div className="settings-weixin-footer">
                    <button type="button" className="btn btn-primary btn-sm" onClick={startWeixinLogin} disabled={weixinLoginLoading}>
                      {t('settings.weixin.scan', '扫码连接 RDKClaw')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={weixinRestarting}
                      onClick={async () => {
                        setWeixinRestarting(true);
                        try {
                          const res = await restartWeixinChannel();
                          if (res.ok) {
                            addToast(t('toast.weixinRestarted', '已重启'), 'info');
                          } else {
                            addToast(t('toast.weixinRestartFail', '重启渠道失败'), 'error');
                          }
                        } catch {
                          addToast(t('toast.weixinRestartFail', '重启渠道失败'), 'error');
                        } finally {
                          setWeixinRestarting(false);
                        }
                      }}
                    >
                      {t('settings.weixin.restartCh', '重启渠道')}
                    </button>
                  </div>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══ 5. 设备连接 ══ */}
              <section id="connection" className="settings-section" ref={registerSectionRef('connection')}>
                <H
                  title={t('settings.conn.title', '设备连接')}
                  desc={t('settings.conn.descWithDevices', '管理已保存的 SSH 设备、超时与自动连接。')}
                />
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.conn.savedDevices', '已保存的设备')}</span>
                    <div className="settings-row-value settings-row-value--stretch settings-row-value--stack">
                      {devices.length === 0 ? (
                        <span className="settings-row-static" style={{ color: 'var(--text-muted)' }}>{t('settings.conn.noDevices', '暂无设备')}</span>
                      ) : (
                        devices.map((d) => (
                          <div
                            key={d.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '8px 10px',
                              borderRadius: 8,
                              border: '1px solid var(--line, var(--border))',
                              background: 'var(--bg-inset, rgba(0,0,0,0.04))',
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{d.name}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>{d.ip}{d.port && d.port !== 22 ? `:${d.port}` : ''}</div>
                            </div>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => confirmRemoveDevice(d)}
                            >
                              {t('settings.conn.removeDevice', '移除')}
                            </button>
                          </div>
                        ))
                      )}
                      <button type="button" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setShowAddDevice(true); setShowSettings(false); }}>
                        {t('settings.conn.addDevice', '添加设备')}
                      </button>
                    </div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.conn.timeout', '连接超时 (秒)')}</span>
                    <div className="settings-row-value settings-row-value--control">
                      <input type="number" className="input settings-input-narrow" title={t('settings.conn.timeout.title', '超时')} aria-label={t('settings.conn.timeout.title', '超时')} value={connectionTimeout} onChange={e => setConnectionTimeout(Number(e.target.value))} />
                    </div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.conn.auto', '启动时自动连接')}</span>
                    <div className="settings-row-value settings-row-value--control">
                      <input type="checkbox" className="settings-checkbox" title={t('settings.conn.auto', '启动时自动连接')} aria-label={t('settings.conn.auto', '启动时自动连接')} checked={autoReconnect} onChange={e => { setAutoReconnect(e.target.checked); addToast(t('settings.conn.updated', '已更新'), 'success'); }} />
                    </div>
                  </div>
                  {isDesktop() && (
                    <div className="settings-row">
                      <span className="settings-row-label">{t('settings.conn.floatingBall', '桌面悬浮球')}</span>
                      <div className="settings-row-value settings-row-value--control">
                        <input
                          type="checkbox"
                          className="settings-checkbox"
                          title={t('settings.conn.floatingBall', '桌面悬浮球')}
                          aria-label={t('settings.conn.floatingBall', '桌面悬浮球')}
                          checked={floatingBallEnabled}
                          onChange={async (e) => {
                            const v = e.target.checked;
                            setFloatingBallEnabled(v);
                            try {
                              await window.rdkDesktop?.setFloatingBallEnabled?.(v);
                              addToast(
                                v ? t('settings.conn.floatingBall.on', '已启用桌面悬浮球') : t('settings.conn.floatingBall.off', '已停用桌面悬浮球'),
                                'success',
                              );
                            } catch {
                              addToast(t('settings.conn.floatingBall.fail', '悬浮球设置保存失败'), 'error');
                            }
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══ 6. 社区论坛 ══ */}
              <section id="forum" className="settings-section" ref={registerSectionRef('forum')}>
                <H
                  title={t('settings.forum.title', '社区论坛')}
                  desc={t(
                    'settings.forum.desc',
                    '与主应用账号一致时通常自动同步；若失败，在此保存论坛用户名与密码并验证。',
                  )}
                />
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.forum.user', '论坛用户')}</span>
                    <div className="settings-row-value settings-row-value--stretch settings-row-value--stack settings-row-value--forum-user">
                      <span className="settings-row-static">{forumAuth.username || t('settings.forum.notSet', '未配置')}</span>
                      {forumAuth.linkedFromAppSso ? (
                        <span className="settings-status-badge ok">{t('settings.forum.linkedSso', '已与主账号同步')}</span>
                      ) : forumAuth.lastVerifyResult === 'ok' ? (
                        <span className="settings-status-badge ok">{t('settings.forum.ssoOk', 'SSO 验证通过')}</span>
                      ) : null}
                      {forumAuth.lastVerifyResult === 'failed' && <span className="settings-status-badge error">{t('settings.forum.ssoFail', '验证失败')}</span>}
                    </div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.forum.username', '用户名')}</span>
                    <div className="settings-row-value settings-row-value--stretch"><input type="text" className="input" title={t('settings.forum.username', '用户名')} aria-label={t('settings.forum.username', '用户名')} placeholder={t('settings.forum.username.ph', '论坛用户名')} value={forumUsernameInput} onChange={e => setForumUsernameInput(e.target.value)} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.forum.password', '密码')}</span>
                    <div className="settings-row-value settings-row-value--stretch"><input type="password" className="input" title={t('settings.forum.password', '密码')} aria-label={t('settings.forum.password', '密码')} placeholder={t('settings.forum.password.ph', '论坛密码')} value={forumPasswordInput} onChange={e => setForumPasswordInput(e.target.value)} /></div>
                  </div>
                  {forumVerifyMsg && (
                    <div className={`settings-status-badge ${forumVerifyMsg.ok ? 'ok' : 'error'}`}>
                      {forumVerifyMsg.text}
                    </div>
                  )}
                  <div className="settings-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveForumCredential} disabled={forumSaving}>{forumSaving ? t('settings.forum.verify', '验证中...') : t('settings.forum.saveVerify', '保存并验证')}</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={handleClearForumAuth} disabled={forumSaving}>{t('settings.forum.clear', '清空')}</button>
                  </div>
                  {forumAuth.hasAppSsoAccessTokenSaved && !forumAuth.hasCookie ? (
                    <span className="settings-hint" style={{ display: 'block', marginBottom: '0.5rem' }}>
                      {t(
                        'settings.forum.tokenHeldNoCookie',
                        '若无法发帖，请使用「保存并验证」提交论坛密码，或重新登录主账号后再试。',
                      )}
                    </span>
                  ) : null}
                  <span className="settings-hint">
                    {t(
                      'settings.forum.hint',
                      '退出主账号会清除自动同步的论坛会话；手动保存的凭据保留在本地直至清空。',
                    )}
                  </span>
                </div>
              </section>

            </div>
          </div>
      </div>
    </div>
    </>
  );
}
