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
  fetchRDKClawPolicy,
  saveRDKClawPolicy,
  type PersonaProfile,
  type RDKClawPolicy,
  fetchRDKClawSecurityAudit,
  clearRDKClawSecurityAudit,
  type SecurityAuditLogEntry,
  fetchRDKClawForumAuth,
  saveRDKClawForumCredential,
  clearRDKClawForumAuth,
  type ForumAuthView,
  fetchWeixinAccounts,
  removeWeixinAccount,
  restartWeixinChannel,
} from '../api';
import { RDK_SSO_SESSION_MIRROR_KEY, fetchApi, resolveApiUrl } from '../utils/apiBase';
import { fillTemplate } from '../i18n/en-extras';
import { useAuth } from '../hooks/useAuth';
import { trackUiAction } from '../analytics/client';

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
  'openai-compatible': { label: 'OpenAI 兼容协议', model: '', baseUrl: '' },
  'anthropic-compatible': { label: 'Anthropic 兼容协议', model: '', baseUrl: '', protocol: 'anthropic' },
};

const AI_PROVIDER_OPTIONS = Object.entries(AI_PROVIDER_DEFAULTS).map(([value, item]) => ({
  value,
  label: item.label,
}));

type SectionId =
  | 'account'
  | 'ai-engine'
  | 'persona'
  | 'policy'
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
    devices, removeDevice, setShowAddDevice,
  } = useAppState();
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
    { id: 'policy' as const, label: t('settings.sec.policy', '执行策略') },
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
    sectionRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ── AI Model State ── */
  const [aiProvider, setAiProvider] = useState('qwen');
  const [aiModel, setAiModel] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiLabel, setAiLabel] = useState('');
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiSavedModels, setAiSavedModels] = useState<Array<{
    id: string; label: string; provider: string; model: string;
    hasApiKey: boolean; baseUrl?: string; isActive: boolean;
  }>>([]);
  const [selectedAiModelId, setSelectedAiModelId] = useState('');
  const [aiSaving, setAiSaving] = useState(false);
  const [aiEnvApiKeyAvailable, setAiEnvApiKeyAvailable] = useState(false);
  const [studioDefaultPreset, setStudioDefaultPreset] = useState<{
    id: string;
    label: string;
    inRegistry: boolean;
    isActive: boolean;
  } | null>(null);
  const importAgentConfigRef = useRef<HTMLInputElement | null>(null);
  const loadedAiProviderRef = useRef('');

  const applyAiModelToForm = (entry: typeof aiSavedModels[number]) => {
    setSelectedAiModelId(entry.id);
    setAiLabel(entry.label || '');
    setAiProvider(entry.provider || 'qwen');
    setAiModel(entry.model || '');
    setAiBaseUrl(entry.baseUrl || '');
    setAiApiKey('');
    loadedAiProviderRef.current = entry.provider || 'qwen';
  };

  const refreshAiConfig = async () => {
    const cfg = await fetchAgentConfig();
    const models = cfg.models || [];
    setAiSavedModels(models);
    setAiEnvApiKeyAvailable(!!cfg.envApiKeyAvailable);
    setStudioDefaultPreset(cfg.studioDefaultPreset ?? null);
    const aid = cfg.activeModelId?.trim();
    const active = aid
      ? models.find((item) => item.id === aid)
      : models.find((item) => item.isActive);
    const resolved = active || models[0];
    if (resolved) {
      applyAiModelToForm(resolved);
      setAiConfigured(!!resolved.hasApiKey || !!cfg.envApiKeyAvailable);
      return;
    }
    setAiConfigured(false);
    setSelectedAiModelId('');
    setAiLabel('');
    setAiProvider(cfg.provider || 'qwen');
    setAiModel(cfg.model || '');
    setAiBaseUrl(cfg.baseUrl || '');
    setAiApiKey('');
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

  /* ── RDKClaw Persona & Policy ── */
  const [persona, setPersona] = useState<PersonaProfile>({
    name: 'RDKClaw', extraInstructions: '', riskLevel: 'balanced',
    delegationBias: 'balanced', autonomyLevel: 'assisted',
  });
  const [policy, setPolicy] = useState<RDKClawPolicy>({
    approval: { mode: 'risk-based', riskThreshold: 'medium' },
    permission: {
      workspaceBoundaryEnabled: true,
      devicePathBoundaryEnabled: true,
      hostMutationGuardEnabled: true,
      commandDangerGuardEnabled: true,
      auditLogEnabled: true,
    },
    memory: { mainSessionReadsMemory: true, sharedSessionBlocksMemory: false, dailyMemoryDays: 7 },
    network: { enabled: true, maxFetchChars: 30000, requireApproval: false },
    context: { contextTokens: 128000, maxHistoryShare: 0.5, softTrimRatio: 0.3, hardClearRatio: 0.5, keepLastAssistants: 3 },
  });
  const [securityAudit, setSecurityAudit] = useState<SecurityAuditLogEntry[]>([]);
  const [securityAuditLoading, setSecurityAuditLoading] = useState(false);
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

  /* ── WeChat State ── */
  const [weixinAccounts, setWeixinAccounts] = useState<Array<{ accountId: string; nickname: string; boundAt: number }>>([]);
  const [weixinLoginLoading, setWeixinLoginLoading] = useState(false);
  const [weixinQrCode, setWeixinQrCode] = useState<string | null>(null);
  const [weixinQrBroken, setWeixinQrBroken] = useState(false);
  const [weixinLoginStatus, setWeixinLoginStatus] = useState<string>('');
  const [weixinLoginEventSource, setWeixinLoginEventSource] = useState<EventSource | null>(null);
  const weixinQrBlobUrlRef = useRef<string | null>(null);

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
    const [personaRes, policyRes, forumAuthRes, auditRes] = await Promise.all([
      fetchRDKClawPersona(), fetchRDKClawPolicy(), fetchRDKClawForumAuth(), fetchRDKClawSecurityAudit(20),
    ]);
    setPersona(personaRes.persona);
    setPolicy(policyRes.policy);
    setForumAuth(forumAuthRes.auth);
    setSecurityAudit(auditRes.items || []);
  };

  const refreshSecurityAudit = async () => {
    setSecurityAuditLoading(true);
    try {
      const res = await fetchRDKClawSecurityAudit(30);
      setSecurityAudit(res.items || []);
    } catch {
      addToast(t('toast.readAuditFail', '读取安全审计失败'), 'error');
    } finally {
      setSecurityAuditLoading(false);
    }
  };

  const handleClearSecurityAudit = async () => {
    setSecurityAuditLoading(true);
    try {
      await clearRDKClawSecurityAudit();
      setSecurityAudit([]);
      addToast(t('toast.auditCleared', '安全审计已清空'), 'success');
    } catch {
      addToast(t('toast.auditClearFail', '清空安全审计失败'), 'error');
    } finally {
      setSecurityAuditLoading(false);
    }
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
    } catch { /* ignore */ }
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
    } catch { addToast(t('toast.personaSaveFail', '保存人格设定失败'), 'error'); }
    finally { setRdkclawSaving(false); }
  };

  const handleSavePolicy = async () => {
    setRdkclawSaving(true);
    try {
      const res = await saveRDKClawPolicy(policy);
      setPolicy(res.policy);
      addToast(t('toast.policySaved', '执行策略已保存'), 'success');
    } catch { addToast(t('toast.policySaveFail', '保存执行策略失败'), 'error'); }
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

  const handleSaveAiConfig = async () => {
    const selectedEntry = aiSavedModels.find((item) => item.id === selectedAiModelId);
    if (!aiApiKey.trim() && !selectedEntry?.hasApiKey) { addToast(t('toast.needApiKey', '请填写 API Key'), 'warning'); return; }
    const providerDefaults = AI_PROVIDER_DEFAULTS[aiProvider] || AI_PROVIDER_DEFAULTS['openai-compatible'];
    const effectiveModel = aiModel || providerDefaults.model;
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
      });
      await refreshAiConfig();
      const savedModel = `${aiProvider}/${effectiveModel}`;
      addToast(
        selectedAiModelId
          ? tf('toast.aiModelUpdated', '模型已更新: {{name}}', { name: savedModel })
          : tf('toast.aiModelAdded', '已新增并启用: {{name}}', { name: savedModel }),
        'success',
      );
    } catch (err) {
      addToast(
        tf('toast.aiSaveFailMsg', '保存失败: {{msg}}', {
          msg: err instanceof Error ? err.message : t('toast.unknownErr', '未知错误'),
        }),
        'error',
      );
    } finally {
      setAiSaving(false);
    }
  };

  const handleDeleteAiModel = async () => {
    if (!selectedAiModelId) { addToast(t('toast.pickModel', '请先选择一个模型'), 'warning'); return; }
    const entry = aiSavedModels.find((item) => item.id === selectedAiModelId);
    setAiSaving(true);
    try {
      await saveAgentConfig({ action: 'delete', id: selectedAiModelId });
      await refreshAiConfig();
      addToast(
        tf('toast.aiDeleted', '已删除: {{id}}', {
          id: entry ? `${entry.provider}/${entry.model}` : selectedAiModelId,
        }),
        'success',
      );
    } catch (err) {
      addToast(
        tf('toast.aiDeleteFailMsg', '删除失败: {{msg}}', {
          msg: err instanceof Error ? err.message : t('toast.unknownErr', '未知错误'),
        }),
        'error',
      );
    } finally {
      setAiSaving(false);
    }
  };

  const handleCreateNewAiModel = () => {
    setSelectedAiModelId(''); setAiLabel('');
    setAiProvider('qwen');
    setAiModel(AI_PROVIDER_DEFAULTS.qwen.model);
    setAiBaseUrl(AI_PROVIDER_DEFAULTS.qwen.baseUrl);
    setAiApiKey('');
  };

  const handleRestoreStudioDefaultModel = async () => {
    if (!studioDefaultPreset) return;
    setAiSaving(true);
    try {
      await saveAgentConfig({ action: 'restore_bootstrap_preset' });
      await refreshAiConfig();
      addToast(
        t('toast.aiRestoredDefault', '已切换为 RDK Studio 内置默认模型（与首次安装一致）'),
        'success',
      );
    } catch (err) {
      addToast(
        tf('toast.aiRestoreDefaultFail', '恢复默认模型失败: {{msg}}', {
          msg: err instanceof Error ? err.message : t('toast.unknownErr', '未知错误'),
        }),
        'error',
      );
    } finally {
      setAiSaving(false);
    }
  };

  const handleExportAgentConfig = async () => {
    try {
      const data = await exportAgentConfig(true);
      const fileName = `rdkstudio-agent-config-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const blob = new Blob([JSON.stringify(data.registry, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = fileName;
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
      const parsed = JSON.parse(text) as AgentConfigExportPayload;
      if (!Array.isArray(parsed?.entries) || parsed.entries.length === 0) throw new Error(t('err.importNoEntries', '导入文件无有效 entries'));
      await importAgentConfig({ registry: parsed, setActiveId: parsed.activeId || undefined, merge: true });
      await refreshAiConfig();
      addToast(t('toast.importOk', '模型配置导入成功'), 'success');
    } catch (error) {
      addToast(
        error instanceof Error
          ? tf('toast.importFailMsg', '导入失败：{{msg}}', { msg: error.message })
          : t('toast.importFail', '导入失败'),
        'error',
      );
    } finally {
      setAiSaving(false);
      if (importAgentConfigRef.current) importAgentConfigRef.current.value = '';
    }
  };

  const applyAiProviderPreset = (nextProvider: string) => {
    const prevDefaults = AI_PROVIDER_DEFAULTS[aiProvider];
    const nextDefaults = AI_PROVIDER_DEFAULTS[nextProvider] || AI_PROVIDER_DEFAULTS['openai-compatible'];
    const shouldReplaceModel = !aiModel || aiModel === prevDefaults?.model;
    const shouldReplaceBaseUrl = !aiBaseUrl || aiBaseUrl === prevDefaults?.baseUrl;
    setAiLabel('');
    setAiProvider(nextProvider);
    if (shouldReplaceModel) setAiModel(nextDefaults.model);
    if (shouldReplaceBaseUrl) setAiBaseUrl(nextDefaults.baseUrl);
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
      throw new Error(`HTTP ${res.status} ${text.slice(0, 160)}`);
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) {
      throw new Error(`无效响应类型: ${ct || '(空)'}`);
    }
    const blob = await res.blob();
    if (blob.size < 32) {
      throw new Error('图片数据过短');
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
    const loginUrl = (() => {
      const base = resolveApiUrl('/api/rdkclaw/weixin/login');
      try {
        const sid = window.localStorage.getItem(RDK_SSO_SESSION_MIRROR_KEY)?.trim();
        if (sid && /^[a-f0-9]{64}$/i.test(sid)) {
          const sep = base.includes('?') ? '&' : '?';
          return `${base}${sep}rdk_sso_session=${encodeURIComponent(sid)}`;
        }
      } catch { /* ignore */ }
      return base;
    })();
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
    es.addEventListener('error', (e) => {
      if (settled) return;
      settled = true;
      try {
        const data = JSON.parse((e as any).data || '{}');
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
                  {t('settings.weixin.modalTitle', '微信扫码连接')}
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
                          {t('settings.weixin.qrLoadFailHint', '图片解码失败，请关闭弹窗后重试「扫码连接」。')}
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
                      <div className="settings-actions">
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
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

              {/* ══ 1. AI 引擎 ══ */}
              <section id="ai-engine" className="settings-section" ref={registerSectionRef('ai-engine')}>
                <H title={t('settings.ai.title', 'AI 引擎')} desc={t('settings.ai.desc', 'RDKClaw 的思考核心。选择服务商、填入 API Key 即可启用。')} />
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.ai.currentModel', '当前模型')}</span>
                    <div className="settings-row-value">
                      <select className="select" title={t('settings.ai.savedModels.title', '已保存模型')} aria-label={t('settings.ai.savedModels.aria', '已保存模型')} value={selectedAiModelId} disabled={aiSaving}
                        onChange={async (e) => {
                          const id = e.target.value;
                          if (!id) { handleCreateNewAiModel(); return; }
                          const entry = aiSavedModels.find(i => i.id === id);
                          if (!entry) return;
                          if (!entry.isActive) {
                            if (!entry.hasApiKey && !aiEnvApiKeyAvailable) {
                              applyAiModelToForm(entry);
                              addToast(t('toast.aiNoKeyWarn', '该模型未配置 API Key，请先编辑并保存后再切换（或配置环境变量 OPENAI_API_KEY）'), 'warning');
                              return;
                            }
                            applyAiModelToForm(entry);
                            setAiSaving(true);
                            try {
                              const result = await saveAgentConfig({ action: 'switch', id });
                              if (result.active?.id === id) {
                                applyAiModelToForm({
                                  id: result.active.id,
                                  label: entry.label,
                                  provider: result.active.provider,
                                  model: result.active.model,
                                  hasApiKey: result.active.hasApiKey,
                                  baseUrl: result.active.baseUrl,
                                  isActive: true,
                                });
                              }
                              await refreshAiConfig();
                              const name = result.active
                                ? `${result.active.provider}/${result.active.model}`
                                : `${entry.provider}/${entry.model}`;
                              addToast(tf('toast.aiSwitchedTo', '已切换到 {{name}}', { name }), 'success');
                            } catch (err) {
                              await refreshAiConfig().catch(() => {});
                              addToast(
                                tf('toast.aiSwitchFailMsg', '切换失败: {{msg}}', {
                                  msg: err instanceof Error ? err.message : t('toast.unknownErr', '未知错误'),
                                }),
                                'error',
                              );
                            } finally {
                              setAiSaving(false);
                            }
                            return;
                          }
                          applyAiModelToForm(entry);
                        }}>
                        <option value="">{t('settings.ai.newProfile', '+ 新建配置')}</option>
                        {aiSavedModels.map(i => {
                          const realName = `${i.provider}/${i.model}`;
                          const display = (i.label && i.label !== realName) ? `${i.label} (${realName})` : realName;
                          const keyStatus = i.hasApiKey ? '' : t('settings.ai.noKeySuffix', ' [未配置Key]');
                          return <option key={i.id} value={i.id}>{display}{keyStatus}{i.isActive ? ' ✓' : ''}</option>;
                        })}
                      </select>
                      {aiConfigured && <span className="settings-status-badge ok">{t('settings.ai.configured', '已配置')}</span>}
                    </div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.ai.provider', '服务商')}</span>
                    <div className="settings-row-value">
                      <select className="select" title={t('settings.ai.provider', '服务商')} aria-label={t('settings.ai.provider', '服务商')} value={aiProvider} onChange={e => applyAiProviderPreset(e.target.value)}>
                        {AI_PROVIDER_OPTIONS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.ai.model', '模型')}</span>
                    <div className="settings-row-value"><input type="text" className="input" title={t('settings.ai.model', '模型')} aria-label={t('settings.ai.model', '模型')} placeholder={AI_PROVIDER_DEFAULTS[aiProvider]?.model} value={aiModel} onChange={e => { setAiModel(e.target.value); setAiLabel(''); }} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">API Key</span>
                    <div className="settings-row-value"><input type="password" className="input" title="API Key" aria-label="API Key" placeholder={(aiConfigured && aiProvider === loadedAiProviderRef.current) ? t('settings.ai.apiKey.placeholder.saved', '已保存，留空不更新') : t('settings.ai.apiKey.placeholder.input', '请输入 API Key')} value={aiApiKey} onChange={e => setAiApiKey(e.target.value)} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">Base URL</span>
                    <div className="settings-row-value"><input type="text" className="input" title="Base URL" aria-label="Base URL" placeholder={AI_PROVIDER_DEFAULTS[aiProvider]?.baseUrl || 'https://...'} value={aiBaseUrl} onChange={e => setAiBaseUrl(e.target.value)} /></div>
                  </div>
                  {studioDefaultPreset && (
                    <div className="settings-row">
                      <span className="settings-row-label">{t('settings.ai.studioDefault', '内置默认')}</span>
                      <div className="settings-row-value" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                        <span className="settings-hint" style={{ margin: 0 }}>
                          {studioDefaultPreset.label}
                          {' · '}
                          {t(
                            'settings.ai.studioDefault.desc',
                            '与安装包首次启动一致。若已配置自有 API Key，可一键切回该预设。',
                          )}
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={aiSaving || studioDefaultPreset.isActive}
                          onClick={() => void handleRestoreStudioDefaultModel()}
                        >
                          {studioDefaultPreset.isActive
                            ? t('settings.ai.studioDefault.current', '当前已使用内置默认模型')
                            : t('settings.ai.studioDefault.restore', '恢复内置默认模型')}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="settings-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveAiConfig} disabled={aiSaving}>{aiSaving ? '...' : (selectedAiModelId ? t('settings.ai.save', '保存') : t('settings.ai.addEnable', '新增并启用'))}</button>
                    {selectedAiModelId && <button type="button" className="btn btn-danger btn-sm" onClick={handleDeleteAiModel} disabled={aiSaving}>{t('settings.ai.delete', '删除')}</button>}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={handleExportAgentConfig} disabled={aiSaving}>{t('settings.ai.export', '导出')}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => importAgentConfigRef.current?.click()} disabled={aiSaving}>{t('settings.ai.import', '导入')}</button>
                    <input ref={importAgentConfigRef} type="file" className="sr-only" accept=".json" onChange={e => { const f = e.target.files?.[0]; if (f) void handleImportAgentConfig(f); }} title={t('settings.ai.import.title', '导入')} />
                  </div>
                  <span className="settings-hint">{t('settings.ai.hint', '支持多模型快速切换，配置保存在本地。')}</span>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══ 2. 人格与行为 ══ */}
              <section id="persona" className="settings-section" ref={registerSectionRef('persona')}>
                <H title={t('settings.persona.title', '人格与行为')} desc={t('settings.persona.desc', '核心人格由系统层托管（非用户可编辑文件），这里调整运行偏好和自治程度。')} />
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.persona.name', '名称')}</span>
                    <div className="settings-row-value"><input className="input" title={t('settings.persona.name', '名称')} aria-label={t('settings.persona.name', '名称')} value={persona.name} onChange={e => setPersona(p => ({ ...p, name: e.target.value }))} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.persona.extra', '额外指令')}</span>
                    <div className="settings-row-value"><textarea className="input" title={t('settings.persona.extra', '额外指令')} aria-label={t('settings.persona.extra', '额外指令')} rows={2} value={persona.extraInstructions} onChange={e => setPersona(p => ({ ...p, extraInstructions: e.target.value }))} placeholder={t('settings.persona.extra.ph', '如「本次优先用英文回复」')} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.persona.risk', '风险偏好')}</span>
                    <div className="settings-row-value"><select className="select" title={t('settings.persona.risk', '风险偏好')} aria-label={t('settings.persona.risk', '风险偏好')} value={persona.riskLevel} onChange={e => setPersona(p => ({ ...p, riskLevel: e.target.value as PersonaProfile['riskLevel'] }))}><option value="conservative">{t('settings.persona.risk.conservative', '保守')}</option><option value="balanced">{t('settings.persona.risk.balanced', '均衡')}</option><option value="aggressive">{t('settings.persona.risk.aggressive', '激进')}</option></select></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.persona.autonomy', '自治等级')}</span>
                    <div className="settings-row-value"><select className="select" title={t('settings.persona.autonomy', '自治等级')} aria-label={t('settings.persona.autonomy', '自治等级')} value={persona.autonomyLevel} onChange={e => setPersona(p => ({ ...p, autonomyLevel: e.target.value as PersonaProfile['autonomyLevel'] }))}><option value="manual">{t('settings.persona.autonomy.manual', '手动')}</option><option value="assisted">{t('settings.persona.autonomy.assisted', '辅助')}</option><option value="autonomous">{t('settings.persona.autonomy.autonomous', '自主')}</option></select></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.persona.delegation', '委派倾向')}</span>
                    <div className="settings-row-value"><select className="select" title={t('settings.persona.delegation', '委派倾向')} aria-label={t('settings.persona.delegation', '委派倾向')} value={persona.delegationBias} onChange={e => setPersona(p => ({ ...p, delegationBias: e.target.value as PersonaProfile['delegationBias'] }))}><option value="local-first">{t('settings.persona.delegation.studio', 'Studio 优先')}</option><option value="balanced">{t('settings.persona.delegation.balanced', '均衡')}</option><option value="board-first">{t('settings.persona.delegation.board', '板端优先')}</option></select></div>
                  </div>
                  <div className="settings-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={handleSavePersona} disabled={rdkclawSaving}>{rdkclawSaving ? '...' : t('settings.persona.save', '保存')}</button>
                  </div>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══ 3. 执行策略 ══ */}
              <section id="policy" className="settings-section" ref={registerSectionRef('policy')}>
                <H title={t('settings.policy.title', '执行策略')} desc={t('settings.policy.desc', '审批、记忆和联网行为。')} />
                <div className="settings-card">
                  <h4 className="settings-card-title">{t('settings.policy.approval', '审批')}</h4>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.policy.mode', '模式')}</span>
                    <div className="settings-row-value"><select className="select" title={t('settings.policy.mode', '模式')} aria-label={t('settings.policy.mode', '模式')} value={policy.approval.mode} onChange={e => setPolicy(p => ({ ...p, approval: { ...p.approval, mode: e.target.value as RDKClawPolicy['approval']['mode'] } }))}><option value="always">{t('settings.policy.mode.always', '始终审批')}</option><option value="risk-based">{t('settings.policy.mode.risk', '基于风险')}</option><option value="auto">{t('settings.policy.mode.auto', '全自动')}</option></select></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.policy.riskThreshold', '风险阈值')}</span>
                    <div className="settings-row-value"><select className="select" title={t('settings.policy.riskThreshold', '风险阈值')} aria-label={t('settings.policy.riskThreshold', '风险阈值')} value={policy.approval.riskThreshold} onChange={e => setPolicy(p => ({ ...p, approval: { ...p.approval, riskThreshold: e.target.value as RDKClawPolicy['approval']['riskThreshold'] } }))}><option value="low">{t('settings.policy.risk.low', '低')}</option><option value="medium">{t('settings.policy.risk.medium', '中')}</option><option value="high">{t('settings.policy.risk.high', '高')}</option></select></div>
                  </div>
                </div>
                <div className="settings-card">
                  <h4 className="settings-card-title">{t('settings.policy.permissionTitle', '权限边界（RDKClaw 自主掌控）')}</h4>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.policy.workspaceBoundary', '本机工作区边界')}</span>
                    <input type="checkbox" title={t('settings.policy.workspaceBoundary', '本机工作区边界')} aria-label={t('settings.policy.workspaceBoundary', '本机工作区边界')} checked={policy.permission.workspaceBoundaryEnabled} onChange={e => setPolicy(p => ({ ...p, permission: { ...p.permission, workspaceBoundaryEnabled: e.target.checked } }))} />
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.policy.devicePathAllow', '板端路径白名单')}</span>
                    <input type="checkbox" title={t('settings.policy.devicePathAllow', '板端路径白名单')} aria-label={t('settings.policy.devicePathAllow', '板端路径白名单')} checked={policy.permission.devicePathBoundaryEnabled} onChange={e => setPolicy(p => ({ ...p, permission: { ...p.permission, devicePathBoundaryEnabled: e.target.checked } }))} />
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.policy.hostGuard', '宿主机防污染')}</span>
                    <input type="checkbox" title={t('settings.policy.hostGuard', '宿主机防污染')} aria-label={t('settings.policy.hostGuard', '宿主机防污染')} checked={policy.permission.hostMutationGuardEnabled} onChange={e => setPolicy(p => ({ ...p, permission: { ...p.permission, hostMutationGuardEnabled: e.target.checked } }))} />
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.policy.cmdGuard', '危险命令拦截')}</span>
                    <input type="checkbox" title={t('settings.policy.cmdGuard', '危险命令拦截')} aria-label={t('settings.policy.cmdGuard', '危险命令拦截')} checked={policy.permission.commandDangerGuardEnabled} onChange={e => setPolicy(p => ({ ...p, permission: { ...p.permission, commandDangerGuardEnabled: e.target.checked } }))} />
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.policy.auditLog', '记录安全审计')}</span>
                    <input type="checkbox" title={t('settings.policy.auditLog', '记录安全审计')} aria-label={t('settings.policy.auditLog', '记录安全审计')} checked={policy.permission.auditLogEnabled} onChange={e => setPolicy(p => ({ ...p, permission: { ...p.permission, auditLogEnabled: e.target.checked } }))} />
                  </div>
                  <span className="settings-hint">{t('settings.policy.permissionHint', '范围内自动执行，范围外直接拦截；高风险按审批策略处理。')}</span>
                </div>
                <div className="settings-card">
                  <h4 className="settings-card-title">{t('settings.policy.auditTitle', '安全审计（最近 30 条）')}</h4>
                  <div className="settings-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={refreshSecurityAudit} disabled={securityAuditLoading}>{securityAuditLoading ? t('settings.policy.audit.refreshing', '刷新中...') : t('settings.policy.audit.refresh', '刷新')}</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={handleClearSecurityAudit} disabled={securityAuditLoading}>{t('settings.policy.audit.clear', '清空')}</button>
                  </div>
                  {securityAudit.length === 0 ? (
                    <span className="settings-hint">{t('settings.policy.audit.empty', '暂无审计记录')}</span>
                  ) : securityAudit.map((item) => (
                    <div className="settings-row" key={item.id}>
                      <span className="settings-row-label">{new Date(item.timestamp).toLocaleTimeString()}</span>
                      <span className="settings-hint">{`${item.action} · ${item.toolName} · ${item.risk}${item.reason ? ` · ${item.reason}` : ''}`}</span>
                    </div>
                  ))}
                </div>
                <div className="settings-card">
                  <h4 className="settings-card-title">{t('settings.policy.memoryTitle', '记忆')}</h4>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.policy.readMemory', '读取历史记忆')}</span>
                    <input type="checkbox" title={t('settings.policy.readMemory', '读取历史记忆')} aria-label={t('settings.policy.readMemory', '读取历史记忆')} checked={policy.memory.mainSessionReadsMemory} onChange={e => setPolicy(p => ({ ...p, memory: { ...p.memory, mainSessionReadsMemory: e.target.checked } }))} />
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.policy.retention', '保留天数')}</span>
                    <div className="settings-row-value"><input type="number" className="input" title={t('settings.policy.days', '天数')} aria-label={t('settings.policy.days', '天数')} value={policy.memory.dailyMemoryDays} onChange={e => setPolicy(p => ({ ...p, memory: { ...p.memory, dailyMemoryDays: Number(e.target.value) || 7 } }))} min={1} max={90} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.policy.contextBudget', '上下文预算')}</span>
                    <div className="settings-row-value"><input type="number" className="input" title={t('settings.policy.tokens', 'tokens')} aria-label={t('settings.policy.tokens', 'tokens')} value={policy.context.contextTokens} onChange={e => setPolicy(p => ({ ...p, context: { ...p.context, contextTokens: Math.max(16000, Number(e.target.value) || 128000) } }))} min={16000} max={256000} /></div>
                  </div>
                </div>
                <div className="settings-card">
                  <h4 className="settings-card-title">{t('settings.policy.networkTitle', '联网')}</h4>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.policy.networkAllow', '允许联网')}</span>
                    <input type="checkbox" title={t('settings.policy.networkAllow', '允许联网')} aria-label={t('settings.policy.networkAllow', '允许联网')} checked={policy.network.enabled} onChange={e => setPolicy(p => ({ ...p, network: { ...p.network, enabled: e.target.checked } }))} />
                  </div>
                  <div className="settings-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={handleSavePolicy} disabled={rdkclawSaving}>{rdkclawSaving ? '...' : t('settings.policy.savePolicy', '保存策略')}</button>
                  </div>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══ 4. 飞书 ══ */}
              <section id="feishu" className="settings-section" ref={registerSectionRef('feishu')}>
                <H title={t('settings.feishu.title', '消息渠道 · 飞书')} desc={t('settings.feishu.desc', '通过飞书机器人收发消息，让 RDKClaw 成为你的飞书助手。')} />
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.feishu.channelStatus', '通道状态')}</span>
                    <span className={`settings-status-badge ${feishuConnected ? 'ok' : feishuRunning ? 'ok' : 'off'}`}>
                      {feishuConnected ? t('settings.feishu.status.connected', '已连接') : feishuRunning ? t('settings.feishu.status.waiting', '等待事件') : t('settings.feishu.status.off', '未启动')}
                    </span>
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
                  <h4 className="settings-card-title">{t('settings.feishu.stepsTitle', '接入步骤')}</h4>
                  <ol className="settings-steps">
                    <li className="settings-step"><span className="settings-step-num">1</span>{t('settings.feishu.step1', '在飞书开放平台创建自建应用，获取 App ID / Secret')}</li>
                    <li className="settings-step"><span className="settings-step-num">2</span>{t('settings.feishu.step2', '开启事件订阅 im.message.receive_v1，选择 WebSocket 模式')}</li>
                    <li className="settings-step"><span className="settings-step-num">3</span>{t('settings.feishu.step3', '填入上方配置并保存，点击「启动」')}</li>
                    <li className="settings-step"><span className="settings-step-num">4</span>{t('settings.feishu.step4', '在飞书私信机器人，使用配对码完成绑定')}</li>
                  </ol>
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

              {/* ══ 5. 微信 ══ */}
              <section id="weixin" className="settings-section" ref={registerSectionRef('weixin')}>
                <H title={t('settings.weixin.title', '消息渠道 · 微信')} desc={t('settings.weixin.desc', '扫码绑定个人微信，随时随地与 RDKClaw 对话。')} />
                <div className="settings-card">
                  {weixinAccounts.length > 0 ? weixinAccounts.map(a => (
                    <div className="settings-row" key={a.accountId}>
                      <span className="settings-row-label">{a.nickname || a.accountId.slice(0, 10)}</span>
                      <div className="settings-actions">
                        <span className="settings-hint">{new Date(a.boundAt).toLocaleDateString()}</span>
                        <button type="button" className="btn btn-danger btn-sm" onClick={async () => { await removeWeixinAccount(a.accountId); loadWeixinData(); addToast(t('toast.weixinRemoved', '已移除'), 'info'); }}>{t('settings.weixin.remove', '移除')}</button>
                      </div>
                    </div>
                  )) : <span className="settings-hint">{t('settings.weixin.none', '暂未绑定微信账号')}</span>}

                  <div className="settings-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={startWeixinLogin} disabled={weixinLoginLoading}>
                      {t('settings.weixin.scan', '扫码连接')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { await restartWeixinChannel(); addToast(t('toast.weixinRestarted', '已重启'), 'info'); }}>{t('settings.weixin.restartCh', '重启渠道')}</button>
                  </div>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══ 6. 设备连接 ══ */}
              <section id="connection" className="settings-section" ref={registerSectionRef('connection')}>
                <H
                  title={t('settings.conn.title', '设备连接')}
                  desc={t('settings.conn.descWithDevices', 'SSH 连接参数；可从列表移除设备（仅剩一台也可删除）。界面语言请在左侧栏底部切换。')}
                />
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.conn.savedDevices', '已保存的设备')}</span>
                    <div className="settings-row-value" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
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
                              onClick={() => removeDevice(d.id)}
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
                    <div className="settings-row-value"><input type="number" className="input" title={t('settings.conn.timeout.title', '超时')} aria-label={t('settings.conn.timeout.title', '超时')} value={connectionTimeout} onChange={e => setConnectionTimeout(Number(e.target.value))} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.conn.auto', '启动时自动连接')}</span>
                    <input type="checkbox" title={t('settings.conn.auto', '启动时自动连接')} aria-label={t('settings.conn.auto', '启动时自动连接')} checked={autoReconnect} onChange={e => { setAutoReconnect(e.target.checked); addToast(t('settings.conn.updated', '已更新'), 'success'); }} />
                  </div>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══ 7. 社区论坛 ══ */}
              <section id="forum" className="settings-section" ref={registerSectionRef('forum')}>
                <H title={t('settings.forum.title', '社区论坛')} desc={t('settings.forum.desc', '与主应用登录为同一套 D-Robotics 账号：登录成功后论坛会话会自动同步，无需重复填写。若自动同步失败，可在此手动保存用户名与密码并完成验证；也可在对话中告诉 RDKClaw 账号密码。')} />
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.forum.user', '论坛用户')}</span>
                    <div className="settings-actions">
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
                    <div className="settings-row-value"><input type="text" className="input" title={t('settings.forum.username', '用户名')} aria-label={t('settings.forum.username', '用户名')} placeholder={t('settings.forum.username.ph', '论坛用户名')} value={forumUsernameInput} onChange={e => setForumUsernameInput(e.target.value)} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">{t('settings.forum.password', '密码')}</span>
                    <div className="settings-row-value"><input type="password" className="input" title={t('settings.forum.password', '密码')} aria-label={t('settings.forum.password', '密码')} placeholder={t('settings.forum.password.ph', '论坛密码')} value={forumPasswordInput} onChange={e => setForumPasswordInput(e.target.value)} /></div>
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
                  {forumAuth.hasAppSsoAccessTokenSaved && !forumAuth.hasCookie && (
                    <span className="settings-hint" style={{ display: 'block', marginBottom: '0.5rem' }}>
                      {t('settings.forum.tokenHeldNoCookie', '已保存主账号登录令牌；若助手仍无法发帖，可能是令牌与论坛桥接不兼容，请使用下方「保存并验证」提交论坛密码，或重新登录主账号后再试。')}
                    </span>
                  )}
                  <span className="settings-hint">{t('settings.forum.hint', '主账号退出登录时会清除由登录自动同步的论坛 Cookie；手动保存的用户名与密码仍保留在本地，直至你点击清空。手动保存后会通过 SSO 验证密码是否有效。')}</span>
                </div>
              </section>

            </div>
          </div>
      </div>
    </div>
    </>
  );
}
