import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';
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
  fetchRDKClawForumAuth,
  saveRDKClawForumCredential,
  clearRDKClawForumAuth,
  type ForumAuthView,
  fetchWeixinAccounts,
  removeWeixinAccount,
  restartWeixinChannel,
} from '../api';
import { resolveApiUrl } from '../utils/apiBase';

/* ═══════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════ */

const AI_PROVIDER_DEFAULTS: Record<string, { label: string; model: string; baseUrl: string; protocol?: string }> = {
  qwen: { label: '通义千问 (Qwen)', model: 'qwen3.5-plus', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
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

type SectionId = 'ai-engine' | 'persona' | 'policy' | 'feishu' | 'weixin' | 'connection' | 'forum';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'ai-engine', label: 'AI 引擎' },
  { id: 'persona', label: '人格与行为' },
  { id: 'policy', label: '执行策略' },
  { id: 'feishu', label: '飞书' },
  { id: 'weixin', label: '微信' },
  { id: 'connection', label: '设备连接' },
  { id: 'forum', label: '社区论坛' },
];

/* ═══════════════════════════════════════════
   Component
   ═══════════════════════════════════════════ */

export default function SettingsPanel() {
  const {
    showSettings, setShowSettings, settingsTab, setSettingsTab,
    language, setLanguage, autoReconnect, setAutoReconnect,
    connectionTimeout, setConnectionTimeout, addToast,
  } = useAppState();

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
    if (!root || settingsTab !== 'rdkclaw') return;
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
  }, [settingsTab, showSettings]);

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
  const importAgentConfigRef = useRef<HTMLInputElement | null>(null);

  const applyAiModelToForm = (entry: typeof aiSavedModels[number]) => {
    setSelectedAiModelId(entry.id);
    setAiLabel(entry.label || '');
    setAiProvider(entry.provider || 'qwen');
    setAiModel(entry.model || '');
    setAiBaseUrl(entry.baseUrl || '');
    setAiApiKey('');
  };

  const refreshAiConfig = async () => {
    const cfg = await fetchAgentConfig();
    const models = cfg.models || [];
    setAiSavedModels(models);
    const active = models.find((item) => item.isActive) || models[0];
    if (active) {
      applyAiModelToForm(active);
      setAiConfigured(!!active.hasApiKey);
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
    memory: { mainSessionReadsMemory: true, sharedSessionBlocksMemory: false, dailyMemoryDays: 7 },
    network: { enabled: true, maxFetchChars: 30000, requireApproval: false },
    context: { contextTokens: 128000, maxHistoryShare: 0.5, softTrimRatio: 0.3, hardClearRatio: 0.5, keepLastAssistants: 3 },
  });
  const [rdkclawLoading, setRdkclawLoading] = useState(false);
  const [rdkclawSaving, setRdkclawSaving] = useState(false);

  /* ── Forum State ── */
  const [forumAuth, setForumAuth] = useState<ForumAuthView>({
    username: '', hasPassword: false, hasCookie: false,
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
  const [weixinLoginStatus, setWeixinLoginStatus] = useState<string>('');
  const [weixinLoginEventSource, setWeixinLoginEventSource] = useState<EventSource | null>(null);

  /* ═══════════════════════════════════════════
     Data Loading
     ═══════════════════════════════════════════ */

  const refreshRdkclawData = async () => {
    const [personaRes, policyRes, forumAuthRes] = await Promise.all([
      fetchRDKClawPersona(), fetchRDKClawPolicy(), fetchRDKClawForumAuth(),
    ]);
    setPersona(personaRes.persona);
    setPolicy(policyRes.policy);
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
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!showSettings || settingsTab !== 'rdkclaw') return;
    setRdkclawLoading(true);
    Promise.all([
      refreshAiConfig(),
      refreshRdkclawData(),
      refreshFeishuData().then(() => setFeishuLoading(false)),
      loadWeixinData(),
    ])
      .catch(() => addToast('读取配置失败', 'error'))
      .finally(() => setRdkclawLoading(false));
  }, [showSettings, settingsTab]);

  /* ═══════════════════════════════════════════
     Handlers
     ═══════════════════════════════════════════ */

  const handleSavePersona = async () => {
    setRdkclawSaving(true);
    try {
      const res = await saveRDKClawPersona(persona);
      setPersona(res.persona);
      addToast('人格设定已保存', 'success');
    } catch { addToast('保存人格设定失败', 'error'); }
    finally { setRdkclawSaving(false); }
  };

  const handleSavePolicy = async () => {
    setRdkclawSaving(true);
    try {
      const res = await saveRDKClawPolicy(policy);
      setPolicy(res.policy);
      addToast('执行策略已保存', 'success');
    } catch { addToast('保存执行策略失败', 'error'); }
    finally { setRdkclawSaving(false); }
  };

  const handleSaveForumCredential = async () => {
    const username = forumUsernameInput.trim();
    const password = forumPasswordInput.trim();
    if (!username || !password) { addToast('请填写论坛用户名和密码', 'warning'); return; }
    setForumSaving(true);
    setForumVerifyMsg(null);
    try {
      const res = await saveRDKClawForumCredential({ username, password });
      setForumPasswordInput('');
      setForumAuth(res.auth);
      setForumVerifyMsg({
        ok: res.verified,
        text: res.verified ? '凭据已保存，SSO 验证通过' : `凭据已保存，但验证未通过: ${res.verifyDetail}`,
      });
      addToast(res.verified ? '论坛凭据验证成功' : '凭据已保存，SSO 验证未通过', res.verified ? 'success' : 'warning');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally { setForumSaving(false); }
  };

  const handleClearForumAuth = async () => {
    setForumSaving(true);
    try {
      const res = await clearRDKClawForumAuth();
      setForumUsernameInput(''); setForumPasswordInput('');
      await refreshRdkclawData();
      addToast(res.message || '论坛认证已清空', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '清空论坛认证失败', 'error');
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
      addToast('飞书配置已保存', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '保存飞书配置失败', 'error');
    } finally { setFeishuSaving(false); }
  };

  const handleFeishuRuntime = async (action: 'start' | 'stop' | 'restart') => {
    try {
      if (action === 'start') await startFeishuRuntime();
      if (action === 'stop') await stopFeishuRuntime();
      if (action === 'restart') await restartFeishuRuntime();
      await refreshFeishuData();
      addToast(`飞书通道已${action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启'}`, 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '飞书运行态操作失败', 'error');
    }
  };

  const handlePairingDecision = async (code: string, decision: 'approve' | 'reject') => {
    try {
      if (decision === 'approve') { await approveFeishuPairing(code); addToast('配对审批已通过', 'success'); }
      else { await rejectFeishuPairing(code); addToast('配对请求已拒绝', 'success'); }
      await refreshFeishuData();
    } catch (error) {
      addToast(error instanceof Error ? error.message : '处理配对请求失败', 'error');
    }
  };

  const handleSaveAiConfig = async () => {
    const selectedEntry = aiSavedModels.find((item) => item.id === selectedAiModelId);
    if (!aiApiKey.trim() && !selectedEntry?.hasApiKey) { addToast('请填写 API Key', 'warning'); return; }
    const providerDefaults = AI_PROVIDER_DEFAULTS[aiProvider] || AI_PROVIDER_DEFAULTS['openai-compatible'];
    setAiSaving(true);
    try {
      await saveAgentConfig({
        action: 'upsert',
        id: selectedAiModelId || undefined,
        label: aiLabel.trim() || `${aiProvider}/${aiModel || providerDefaults.model}`,
        provider: aiProvider,
        model: aiModel || providerDefaults.model,
        apiKey: aiApiKey || undefined,
        baseUrl: aiBaseUrl || providerDefaults.baseUrl || undefined,
        setActive: true,
      });
      await refreshAiConfig();
      addToast(selectedAiModelId ? '模型配置已更新并切换' : '模型已新增并切换', 'success');
    } catch { addToast('保存失败', 'error'); }
    finally { setAiSaving(false); }
  };

  const handleSwitchAiModel = async () => {
    if (!selectedAiModelId) { addToast('请先选择一个模型', 'warning'); return; }
    setAiSaving(true);
    try {
      await saveAgentConfig({ action: 'switch', id: selectedAiModelId });
      await refreshAiConfig();
      addToast('模型切换成功', 'success');
    } catch { addToast('模型切换失败', 'error'); }
    finally { setAiSaving(false); }
  };

  const handleDeleteAiModel = async () => {
    if (!selectedAiModelId) { addToast('请先选择一个模型', 'warning'); return; }
    setAiSaving(true);
    try {
      await saveAgentConfig({ action: 'delete', id: selectedAiModelId });
      await refreshAiConfig();
      addToast('模型已删除', 'success');
    } catch { addToast('删除失败', 'error'); }
    finally { setAiSaving(false); }
  };

  const handleCreateNewAiModel = () => {
    setSelectedAiModelId(''); setAiLabel('');
    setAiProvider('qwen');
    setAiModel(AI_PROVIDER_DEFAULTS.qwen.model);
    setAiBaseUrl(AI_PROVIDER_DEFAULTS.qwen.baseUrl);
    setAiApiKey('');
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
      addToast('模型配置已导出', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '导出失败', 'error');
    }
  };

  const handleImportAgentConfig = async (file: File) => {
    setAiSaving(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as AgentConfigExportPayload;
      if (!Array.isArray(parsed?.entries) || parsed.entries.length === 0) throw new Error('导入文件无有效 entries');
      await importAgentConfig({ registry: parsed, setActiveId: parsed.activeId || undefined, merge: true });
      await refreshAiConfig();
      addToast('模型配置导入成功', 'success');
    } catch (error) {
      addToast(error instanceof Error ? `导入失败：${error.message}` : '导入失败', 'error');
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
    setAiProvider(nextProvider);
    if (shouldReplaceModel) setAiModel(nextDefaults.model);
    if (shouldReplaceBaseUrl) setAiBaseUrl(nextDefaults.baseUrl);
  };

  /* ── WeChat Handlers ── */

  const closeWeixinLogin = () => {
    weixinLoginEventSource?.close();
    setWeixinLoginEventSource(null);
    setWeixinLoginLoading(false);
    setWeixinQrCode(null);
    setWeixinLoginStatus('');
  };

  const startWeixinLogin = () => {
    closeWeixinLogin();
    setWeixinLoginLoading(true);
    setWeixinLoginStatus('正在获取二维码...');

    let settled = false;
    const es = new EventSource(resolveApiUrl('/api/rdkclaw/weixin/login'));
    setWeixinLoginEventSource(es);

    es.addEventListener('qrcode', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.qrcode) {
          setWeixinQrCode(data.qrcode);
          setWeixinLoginStatus('请用微信扫描下方二维码');
        }
      } catch { /* ignore */ }
    });
    es.addEventListener('scanned', () => {
      setWeixinLoginStatus('已扫码，请在微信中确认...');
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
        addToast(`微信已绑定: ${data.nickname || data.accountId}`, 'success');
        loadWeixinData();
      } catch { /* ignore */ }
      closeWeixinLogin();
    });
    es.addEventListener('error', (e) => {
      if (settled) return;
      settled = true;
      try {
        const data = JSON.parse((e as any).data || '{}');
        addToast(`登录失败: ${data.message || '未知错误'}`, 'error');
      } catch { /* ignore */ }
      closeWeixinLogin();
    });
    es.addEventListener('done', () => { if (!settled) closeWeixinLogin(); });
    es.onerror = () => {
      if (settled) return;
      settled = true;
      addToast('连接中断，请重试', 'error');
      closeWeixinLogin();
    };
  };

  /* ═══════════════════════════════════════════
     Render
     ═══════════════════════════════════════════ */

  if (!showSettings) return null;

  const H = ({ title, desc }: { title: string; desc: string }) => (
    <div className="settings-section-header">
      <h3 className="settings-section-title">{title}</h3>
      <p className="settings-section-desc">{desc}</p>
    </div>
  );

  const feishuRunning = feishuStatus?.runtime?.running;
  const feishuConnected = feishuRunning && feishuStatus?.runtime?.connected;

  return (
    <div className="settings-overlay" onClick={() => setShowSettings(false)}>
      <div className="settings-drawer" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <div className="settings-title">RDKClaw 设置</div>
          <button type="button" className="btn-icon" onClick={() => setShowSettings(false)}>×</button>
        </div>

        <div className="settings-nav">
          {([['rdkclaw', 'RDKClaw'], ['about', '关于']] as const).map(([key, label]) => (
            <button key={key} type="button"
              className={settingsTab === key ? 'settings-nav-btn active' : 'settings-nav-btn'}
              onClick={() => setSettingsTab(key)}
            >{label}</button>
          ))}
        </div>

        {/* ═══════ About ═══════ */}
        {settingsTab === 'about' && (
          <div className="settings-body">
            <div className="settings-card">
              <div className="settings-row"><span className="settings-row-label">RDK Studio</span><span className="settings-row-static">v0.2.0 (Preview)</span></div>
              <div className="settings-row"><span className="settings-row-label">目标固件</span><span className="settings-row-static">RDK OS 2.x</span></div>
              <div className="settings-row">
                <span className="settings-row-label">界面语言</span>
                <div className="settings-row-value">
                  <select className="select" title="界面语言" aria-label="界面语言" value={language} onChange={e => { setLanguage(e.target.value); addToast('语言偏好已保存', 'success'); }}>
                    <option value="zh-CN">简体中文</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════ RDKClaw ═══════ */}
        {settingsTab === 'rdkclaw' && (
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

              {/* ══ 1. AI 引擎 ══ */}
              <section id="ai-engine" className="settings-section" ref={registerSectionRef('ai-engine')}>
                <H title="AI 引擎" desc="RDKClaw 的思考核心。选择服务商、填入 API Key 即可启用。" />
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">当前模型</span>
                    <div className="settings-row-value">
                      <select className="select" title="已保存模型" aria-label="已保存模型" value={selectedAiModelId}
                        onChange={async (e) => {
                          const id = e.target.value;
                          if (!id) { handleCreateNewAiModel(); return; }
                          const entry = aiSavedModels.find(i => i.id === id);
                          if (!entry) return;
                          applyAiModelToForm(entry);
                          if (!entry.isActive) {
                            try {
                              await saveAgentConfig({ action: 'switch', id });
                              await refreshAiConfig();
                              addToast('模型已切换', 'success');
                            } catch { addToast('切换失败', 'error'); }
                          }
                        }}>
                        <option value="">+ 新建配置</option>
                        {aiSavedModels.map(i => <option key={i.id} value={i.id}>{i.label || `${i.provider}/${i.model}`}{i.isActive ? ' (当前)' : ''}</option>)}
                      </select>
                      {aiConfigured && <span className="settings-status-badge ok">已配置</span>}
                    </div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">服务商</span>
                    <div className="settings-row-value">
                      <select className="select" title="服务商" aria-label="服务商" value={aiProvider} onChange={e => applyAiProviderPreset(e.target.value)}>
                        {AI_PROVIDER_OPTIONS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">模型</span>
                    <div className="settings-row-value"><input type="text" className="input" title="模型" aria-label="模型" placeholder={AI_PROVIDER_DEFAULTS[aiProvider]?.model} value={aiModel} onChange={e => setAiModel(e.target.value)} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">API Key</span>
                    <div className="settings-row-value"><input type="password" className="input" title="API Key" aria-label="API Key" placeholder={aiConfigured ? '已保存，留空不更新' : '请输入 API Key'} value={aiApiKey} onChange={e => setAiApiKey(e.target.value)} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">Base URL</span>
                    <div className="settings-row-value"><input type="text" className="input" title="Base URL" aria-label="Base URL" placeholder={AI_PROVIDER_DEFAULTS[aiProvider]?.baseUrl || 'https://...'} value={aiBaseUrl} onChange={e => setAiBaseUrl(e.target.value)} /></div>
                  </div>
                  <div className="settings-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveAiConfig} disabled={aiSaving}>{aiSaving ? '...' : (selectedAiModelId ? '保存' : '新增并启用')}</button>
                    {selectedAiModelId && <button type="button" className="btn btn-danger btn-sm" onClick={handleDeleteAiModel} disabled={aiSaving}>删除</button>}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={handleExportAgentConfig} disabled={aiSaving}>导出</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => importAgentConfigRef.current?.click()} disabled={aiSaving}>导入</button>
                    <input ref={importAgentConfigRef} type="file" className="sr-only" accept=".json" onChange={e => { const f = e.target.files?.[0]; if (f) void handleImportAgentConfig(f); }} title="导入" />
                  </div>
                  <span className="settings-hint">支持多模型快速切换，配置保存在本地。</span>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══ 2. 人格与行为 ══ */}
              <section id="persona" className="settings-section" ref={registerSectionRef('persona')}>
                <H title="人格与行为" desc="核心性格由 SOUL.md 管理，这里调整风险偏好和自治程度。" />
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">名称</span>
                    <div className="settings-row-value"><input className="input" title="名称" aria-label="名称" value={persona.name} onChange={e => setPersona(p => ({ ...p, name: e.target.value }))} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">额外指令</span>
                    <div className="settings-row-value"><textarea className="input" title="额外指令" aria-label="额外指令" rows={2} value={persona.extraInstructions} onChange={e => setPersona(p => ({ ...p, extraInstructions: e.target.value }))} placeholder="如「本次优先用英文回复」" /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">风险偏好</span>
                    <div className="settings-row-value"><select className="select" title="风险偏好" aria-label="风险偏好" value={persona.riskLevel} onChange={e => setPersona(p => ({ ...p, riskLevel: e.target.value as PersonaProfile['riskLevel'] }))}><option value="conservative">保守</option><option value="balanced">均衡</option><option value="aggressive">激进</option></select></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">自治等级</span>
                    <div className="settings-row-value"><select className="select" title="自治等级" aria-label="自治等级" value={persona.autonomyLevel} onChange={e => setPersona(p => ({ ...p, autonomyLevel: e.target.value as PersonaProfile['autonomyLevel'] }))}><option value="manual">手动</option><option value="assisted">辅助</option><option value="autonomous">自主</option></select></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">委派倾向</span>
                    <div className="settings-row-value"><select className="select" title="委派倾向" aria-label="委派倾向" value={persona.delegationBias} onChange={e => setPersona(p => ({ ...p, delegationBias: e.target.value as PersonaProfile['delegationBias'] }))}><option value="local-first">Studio 优先</option><option value="balanced">均衡</option><option value="board-first">板端优先</option></select></div>
                  </div>
                  <div className="settings-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={handleSavePersona} disabled={rdkclawSaving}>{rdkclawSaving ? '...' : '保存'}</button>
                  </div>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══ 3. 执行策略 ══ */}
              <section id="policy" className="settings-section" ref={registerSectionRef('policy')}>
                <H title="执行策略" desc="审批、记忆和联网行为。" />
                <div className="settings-card">
                  <h4 className="settings-card-title">审批</h4>
                  <div className="settings-row">
                    <span className="settings-row-label">模式</span>
                    <div className="settings-row-value"><select className="select" title="审批模式" aria-label="审批模式" value={policy.approval.mode} onChange={e => setPolicy(p => ({ ...p, approval: { ...p.approval, mode: e.target.value as RDKClawPolicy['approval']['mode'] } }))}><option value="always">始终审批</option><option value="risk-based">基于风险</option><option value="auto">全自动</option></select></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">风险阈值</span>
                    <div className="settings-row-value"><select className="select" title="风险阈值" aria-label="风险阈值" value={policy.approval.riskThreshold} onChange={e => setPolicy(p => ({ ...p, approval: { ...p.approval, riskThreshold: e.target.value as RDKClawPolicy['approval']['riskThreshold'] } }))}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></div>
                  </div>
                </div>
                <div className="settings-card">
                  <h4 className="settings-card-title">记忆</h4>
                  <div className="settings-row">
                    <span className="settings-row-label">读取历史记忆</span>
                    <input type="checkbox" title="读取历史记忆" aria-label="读取历史记忆" checked={policy.memory.mainSessionReadsMemory} onChange={e => setPolicy(p => ({ ...p, memory: { ...p.memory, mainSessionReadsMemory: e.target.checked } }))} />
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">保留天数</span>
                    <div className="settings-row-value"><input type="number" className="input" title="天数" aria-label="天数" value={policy.memory.dailyMemoryDays} onChange={e => setPolicy(p => ({ ...p, memory: { ...p.memory, dailyMemoryDays: Number(e.target.value) || 7 } }))} min={1} max={90} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">上下文预算</span>
                    <div className="settings-row-value"><input type="number" className="input" title="tokens" aria-label="tokens" value={policy.context.contextTokens} onChange={e => setPolicy(p => ({ ...p, context: { ...p.context, contextTokens: Math.max(16000, Number(e.target.value) || 128000) } }))} min={16000} max={256000} /></div>
                  </div>
                </div>
                <div className="settings-card">
                  <h4 className="settings-card-title">联网</h4>
                  <div className="settings-row">
                    <span className="settings-row-label">允许联网</span>
                    <input type="checkbox" title="允许联网" aria-label="允许联网" checked={policy.network.enabled} onChange={e => setPolicy(p => ({ ...p, network: { ...p.network, enabled: e.target.checked } }))} />
                  </div>
                  <div className="settings-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={handleSavePolicy} disabled={rdkclawSaving}>{rdkclawSaving ? '...' : '保存策略'}</button>
                  </div>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══ 4. 飞书 ══ */}
              <section id="feishu" className="settings-section" ref={registerSectionRef('feishu')}>
                <H title="消息渠道 · 飞书" desc="通过飞书机器人收发消息，让 RDKClaw 成为你的飞书助手。" />
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">通道状态</span>
                    <span className={`settings-status-badge ${feishuConnected ? 'ok' : feishuRunning ? 'ok' : 'off'}`}>
                      {feishuConnected ? '已连接' : feishuRunning ? '等待事件' : '未启动'}
                    </span>
                  </div>
                  <div className="settings-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleFeishuRuntime('start')}>启动</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleFeishuRuntime('stop')}>停止</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleFeishuRuntime('restart')}>重启</button>
                  </div>
                </div>
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">App ID</span>
                    <div className="settings-row-value"><input type="text" className="input" title="App ID" aria-label="App ID" placeholder="cli_xxx" value={feishuAppId} onChange={e => setFeishuAppId(e.target.value)} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">App Secret</span>
                    <div className="settings-row-value"><input type="password" className="input" title="App Secret" aria-label="App Secret" placeholder={feishuMasks.appSecretMasked ? `${feishuMasks.appSecretMasked}（留空不改）` : '请输入'} value={feishuAppSecret} onChange={e => setFeishuAppSecret(e.target.value)} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">连接模式</span>
                    <div className="settings-row-value"><select className="select" title="连接模式" aria-label="连接模式" value={feishuConnectionMode} onChange={e => setFeishuConnectionMode(e.target.value as 'websocket' | 'webhook')}><option value="websocket">WebSocket</option><option value="webhook">Webhook</option></select></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">私信策略</span>
                    <div className="settings-row-value"><select className="select" title="私信策略" aria-label="私信策略" value={feishuDmPolicy} onChange={e => setFeishuDmPolicy(e.target.value as 'pairing' | 'allowlist' | 'open')}><option value="pairing">配对</option><option value="allowlist">白名单</option><option value="open">开放</option></select></div>
                  </div>
                  <div className="settings-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveFeishu} disabled={feishuSaving}>{feishuSaving ? '...' : '保存配置'}</button>
                  </div>
                </div>

                <div className="settings-card">
                  <h4 className="settings-card-title">接入步骤</h4>
                  <ol className="settings-steps">
                    <li className="settings-step"><span className="settings-step-num">1</span>在飞书开放平台创建自建应用，获取 App ID / Secret</li>
                    <li className="settings-step"><span className="settings-step-num">2</span>开启事件订阅 im.message.receive_v1，选择 WebSocket 模式</li>
                    <li className="settings-step"><span className="settings-step-num">3</span>填入上方配置并保存，点击「启动」</li>
                    <li className="settings-step"><span className="settings-step-num">4</span>在飞书私信机器人，使用配对码完成绑定</li>
                  </ol>
                </div>

                {(feishuPairings.length > 0 || feishuBoundUsers.length > 0) && (
                  <div className="settings-card">
                    {feishuPairings.length > 0 && <>
                      <h4 className="settings-card-title">待审批配对</h4>
                      {feishuPairings.map(item => (
                        <div className="settings-row" key={item.code}>
                          <span className="settings-row-label">{item.code}</span>
                          <div className="settings-actions">
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => handlePairingDecision(item.code, 'approve')}>批准</button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => handlePairingDecision(item.code, 'reject')}>拒绝</button>
                          </div>
                        </div>
                      ))}
                    </>}
                    {feishuBoundUsers.length > 0 && <>
                      <h4 className="settings-card-title">已绑定 ({feishuBoundUsers.length})</h4>
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
                <H title="消息渠道 · 微信" desc="扫码绑定个人微信，随时随地与 RDKClaw 对话。" />
                <div className="settings-card">
                  {weixinAccounts.length > 0 ? weixinAccounts.map(a => (
                    <div className="settings-row" key={a.accountId}>
                      <span className="settings-row-label">{a.nickname || a.accountId.slice(0, 10)}</span>
                      <div className="settings-actions">
                        <span className="settings-hint">{new Date(a.boundAt).toLocaleDateString()}</span>
                        <button type="button" className="btn btn-danger btn-sm" onClick={async () => { await removeWeixinAccount(a.accountId); loadWeixinData(); addToast('已移除', 'info'); }}>移除</button>
                      </div>
                    </div>
                  )) : <span className="settings-hint">暂未绑定微信账号</span>}

                  <div className="settings-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={startWeixinLogin} disabled={weixinLoginLoading}>
                      扫码连接
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { await restartWeixinChannel(); addToast('已重启', 'info'); }}>重启渠道</button>
                  </div>
                </div>
              </section>

              {/* 微信扫码弹窗 */}
              {weixinLoginLoading && (
                <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeWeixinLogin(); }}>
                  <div className="modal-card" style={{ maxWidth: 380 }}>
                    <div className="modal-header">
                      <span className="modal-title">微信扫码连接</span>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={closeWeixinLogin} aria-label="关闭">&times;</button>
                    </div>
                    <div className="modal-body" style={{ textAlign: 'center' }}>
                      {weixinQrCode ? (
                        <>
                          <div className="settings-qr-container">
                            <img src={weixinQrCode} alt="微信扫码" className="settings-qr-img" />
                          </div>
                          <p style={{ margin: '12px 0 4px', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                            {weixinLoginStatus || '请用微信扫一扫'}
                          </p>
                        </>
                      ) : (
                        <div style={{ padding: '40px 0' }}>
                          <div className="spinner" style={{ margin: '0 auto 12px' }} />
                          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                            {weixinLoginStatus || '正在获取二维码...'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <hr className="settings-section-divider" />

              {/* ══ 6. 设备连接 ══ */}
              <section id="connection" className="settings-section" ref={registerSectionRef('connection')}>
                <H title="设备连接" desc="SSH 连接参数。" />
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">连接超时 (秒)</span>
                    <div className="settings-row-value"><input type="number" className="input" title="超时" aria-label="超时" value={connectionTimeout} onChange={e => setConnectionTimeout(Number(e.target.value))} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">启动时自动连接</span>
                    <input type="checkbox" title="自动连接" aria-label="自动连接" checked={autoReconnect} onChange={e => { setAutoReconnect(e.target.checked); addToast('已更新', 'success'); }} />
                  </div>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══ 7. 社区论坛 ══ */}
              <section id="forum" className="settings-section" ref={registerSectionRef('forum')}>
                <H title="社区论坛" desc="授权后 RDKClaw 可帮你在 D-Robotics 社区发帖互动。也可在对话中直接告诉 RDKClaw 你的论坛账号密码，会自动保存。" />
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">论坛用户</span>
                    <div className="settings-actions">
                      <span className="settings-row-static">{forumAuth.username || '未配置'}</span>
                      {forumAuth.lastVerifyResult === 'ok' && <span className="settings-status-badge ok">SSO 验证通过</span>}
                      {forumAuth.lastVerifyResult === 'failed' && <span className="settings-status-badge error">验证失败</span>}
                    </div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">用户名</span>
                    <div className="settings-row-value"><input type="text" className="input" title="用户名" aria-label="用户名" placeholder="论坛用户名" value={forumUsernameInput} onChange={e => setForumUsernameInput(e.target.value)} /></div>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">密码</span>
                    <div className="settings-row-value"><input type="password" className="input" title="密码" aria-label="密码" placeholder="论坛密码" value={forumPasswordInput} onChange={e => setForumPasswordInput(e.target.value)} /></div>
                  </div>
                  {forumVerifyMsg && (
                    <div className={`settings-status-badge ${forumVerifyMsg.ok ? 'ok' : 'error'}`}>
                      {forumVerifyMsg.text}
                    </div>
                  )}
                  <div className="settings-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveForumCredential} disabled={forumSaving}>{forumSaving ? '验证中...' : '保存并验证'}</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={handleClearForumAuth} disabled={forumSaving}>清空</button>
                  </div>
                  <span className="settings-hint">保存后自动通过 SSO 验证密码是否有效，凭据持久化到本地。</span>
                </div>
              </section>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
