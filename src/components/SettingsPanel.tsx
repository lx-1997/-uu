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
  saveRDKClawForumCookie,
  clearRDKClawForumAuth,
  type ForumAuthView,
  fetchWeixinAccounts,
  fetchWeixinConfig,
  saveWeixinConfig,
  removeWeixinAccount,
  restartWeixinChannel,
  type WeixinConfigView,
} from '../api';
import { resolveApiUrl } from '../utils/apiBase';

/* ═══════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════ */

const AI_PROVIDER_DEFAULTS: Record<string, { label: string; model: string; baseUrl: string }> = {
  qwen: { label: '通义千问 (Qwen)', model: 'qwen3.5-plus', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  deepseek: { label: 'DeepSeek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' },
  openai: { label: 'OpenAI', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  moonshot: { label: 'Moonshot', model: 'moonshot-v1-8k', baseUrl: 'https://api.moonshot.cn/v1' },
  zhipu: { label: '智谱 AI', model: 'glm-4-flash', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  groq: { label: 'Groq', model: 'llama-3.3-70b-versatile', baseUrl: 'https://api.groq.com/openai/v1' },
  openrouter: { label: 'OpenRouter', model: 'openai/gpt-4o-mini', baseUrl: 'https://openrouter.ai/api/v1' },
  xai: { label: 'xAI', model: 'grok-2-latest', baseUrl: 'https://api.x.ai/v1' },
  ollama: { label: 'Ollama', model: 'qwen2.5:7b', baseUrl: 'http://127.0.0.1:11434/v1' },
  'openai-compatible': { label: 'OpenAI 兼容', model: 'gpt-4o-mini', baseUrl: '' },
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
    username: '', hasPassword: false, hasApiKey: false, hasApiUsername: false, hasCookie: false,
  });
  const [forumUsernameInput, setForumUsernameInput] = useState('');
  const [forumPasswordInput, setForumPasswordInput] = useState('');
  const [forumCookieInput, setForumCookieInput] = useState('');
  const [forumSaving, setForumSaving] = useState(false);

  /* ── WeChat State ── */
  const [weixinAccounts, setWeixinAccounts] = useState<Array<{ accountId: string; nickname: string; boundAt: number }>>([]);
  const [weixinEnabled, setWeixinEnabled] = useState(true);
  const [weixinAckStyle, setWeixinAckStyle] = useState<'text' | 'emoji' | 'off'>('text');
  const [weixinLoginLoading, setWeixinLoginLoading] = useState(false);
  const [weixinQrCode, setWeixinQrCode] = useState<string | null>(null);
  const [weixinLoading, setWeixinLoading] = useState(false);

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
      const [acctRes, cfgRes] = await Promise.all([fetchWeixinAccounts(), fetchWeixinConfig()]);
      if (acctRes.ok) setWeixinAccounts(acctRes.accounts);
      if (cfgRes.ok) {
        setWeixinEnabled(cfgRes.config.enabled);
        setWeixinAckStyle(cfgRes.config.ackStyle);
      }
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
    try {
      const res = await saveRDKClawForumCredential({ username, password });
      setForumPasswordInput('');
      await refreshRdkclawData();
      addToast(res.message || '论坛账号已保存', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '论坛账号保存失败', 'error');
    } finally { setForumSaving(false); }
  };

  const handleSaveForumCookie = async () => {
    const cookie = forumCookieInput.trim();
    if (!cookie) { addToast('请粘贴论坛 Cookie', 'warning'); return; }
    setForumSaving(true);
    try {
      const res = await saveRDKClawForumCookie(cookie);
      setForumCookieInput('');
      await refreshRdkclawData();
      addToast(res.message || '论坛 Cookie 已保存', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '论坛 Cookie 保存失败', 'error');
    } finally { setForumSaving(false); }
  };

  const handleClearForumAuth = async () => {
    setForumSaving(true);
    try {
      const res = await clearRDKClawForumAuth();
      setForumUsernameInput(''); setForumPasswordInput(''); setForumCookieInput('');
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

  const startWeixinLogin = async () => {
    setWeixinLoginLoading(true);
    setWeixinQrCode(null);
    try {
      const eventSource = new EventSource(resolveApiUrl('/api/rdkclaw/weixin/login'));
      eventSource.addEventListener('qrcode', (e) => {
        try { const data = JSON.parse(e.data); if (data.qrcode) setWeixinQrCode(data.qrcode); } catch { /* ignore */ }
      });
      eventSource.addEventListener('bound', (e) => {
        try { const data = JSON.parse(e.data); addToast(`微信已绑定: ${data.nickname || data.accountId}`, 'success'); loadWeixinData(); } catch { /* ignore */ }
        setWeixinQrCode(null); setWeixinLoginLoading(false); eventSource.close();
      });
      eventSource.addEventListener('error', (e) => {
        try { const data = JSON.parse((e as any).data || '{}'); addToast(`登录失败: ${data.message || '未知错误'}`, 'error'); } catch { /* ignore */ }
        setWeixinLoginLoading(false); eventSource.close();
      });
      eventSource.addEventListener('done', () => { setWeixinLoginLoading(false); setWeixinQrCode(null); eventSource.close(); });
      eventSource.onerror = () => { setWeixinLoginLoading(false); setWeixinQrCode(null); eventSource.close(); };
    } catch (err: any) {
      addToast(`启动登录失败: ${err.message || ''}`, 'error');
      setWeixinLoginLoading(false);
    }
  };

  const saveWeixinSettings = async () => {
    setWeixinLoading(true);
    try {
      const res = await saveWeixinConfig({ enabled: weixinEnabled, ackStyle: weixinAckStyle });
      if (res.ok) addToast('微信设置已保存', 'success');
    } catch (err: any) {
      addToast(`保存失败: ${err.message || ''}`, 'error');
    } finally { setWeixinLoading(false); }
  };

  /* ═══════════════════════════════════════════
     Render
     ═══════════════════════════════════════════ */

  if (!showSettings) return null;

  const SectionHeader = ({ title, desc }: { title: string; desc: string }) => (
    <div className="settings-section-header">
      <h3 className="settings-section-title">{title}</h3>
      <p className="settings-section-desc">{desc}</p>
    </div>
  );

  return (
    <div className="settings-overlay" onClick={() => setShowSettings(false)}>
      <div className="settings-drawer" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <div className="settings-title">RDKClaw 设置</div>
          <button type="button" className="btn-icon" onClick={() => setShowSettings(false)}>×</button>
        </div>

        {/* Tab bar: only RDKClaw and About */}
        <div className="settings-nav">
          {([['rdkclaw', 'RDKClaw'], ['about', '关于']] as const).map(([key, label]) => (
            <button key={key} type="button"
              className={settingsTab === key ? 'settings-nav-btn active' : 'settings-nav-btn'}
              onClick={() => setSettingsTab(key)}
            >{label}</button>
          ))}
        </div>

        {/* ═══════ About Tab ═══════ */}
        {settingsTab === 'about' && (
          <div className="settings-body">
            <div className="config-section">
              <div className="config-section-title">版本信息</div>
              <div className="config-row"><span className="config-label">RDK Studio</span><span className="config-value">v0.2.0 (Preview)</span></div>
              <div className="config-row"><span className="config-label">前端框架</span><span className="config-value">React 19 + Vite 6</span></div>
              <div className="config-row"><span className="config-label">目标固件</span><span className="config-value">RDK OS 2.x</span></div>
            </div>
            <div className="config-section">
              <div className="config-section-title">界面</div>
              <div className="config-row">
                <span className="config-label">界面语言</span>
                <div className="config-value">
                  <select className="select" title="界面语言" aria-label="界面语言" value={language} onChange={e => { setLanguage(e.target.value); addToast('语言偏好已保存', 'success'); }}>
                    <option value="zh-CN">简体中文</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="config-section">
              <div className="usage-item"><strong>开源地址</strong><span>github.com/RDKStudio — 欢迎反馈与贡献</span></div>
            </div>
          </div>
        )}

        {/* ═══════ RDKClaw Tab: single-page sections ═══════ */}
        {settingsTab === 'rdkclaw' && (
          <div className="settings-layout">
            {/* Left nav anchors */}
            <nav className="settings-section-nav">
              {SECTIONS.map((s) => (
                <button key={s.id} type="button"
                  className={`settings-section-nav-item ${activeSection === s.id ? 'active' : ''}`}
                  onClick={() => scrollToSection(s.id)}
                >{s.label}</button>
              ))}
            </nav>

            {/* Scrollable content */}
            <div className="settings-scroll-area" ref={scrollAreaRef}>
              {rdkclawLoading && <div className="config-value" style={{ textAlign: 'center', padding: 20 }}>加载中...</div>}

              {/* ══════ 1. AI 引擎 ══════ */}
              <section id="ai-engine" className="settings-section" ref={registerSectionRef('ai-engine')}>
                <SectionHeader title="AI 引擎" desc="RDKClaw 的思考核心。配置 AI 模型后，RDKClaw 才能理解你的意图并执行任务。" />
                <div className="config-section">
                  <div className="config-section-title">
                    模型配置
                    {aiConfigured && <span className="badge badge-ok">● 已配置</span>}
                  </div>
                  <div className="config-row">
                    <span className="config-label">已保存模型</span>
                    <div className="config-value">
                      <select className="select" title="已保存模型" aria-label="已保存模型" value={selectedAiModelId}
                        onChange={e => { const next = aiSavedModels.find((item) => item.id === e.target.value); if (next) applyAiModelToForm(next); else setSelectedAiModelId(e.target.value); }}>
                        <option value="">新建模型配置</option>
                        {aiSavedModels.map((item) => (
                          <option key={item.id} value={item.id}>{item.label || `${item.provider}/${item.model}`}{item.isActive ? ' (当前)' : ''}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="config-actions">
                    <button type="button" className="btn btn-ghost" onClick={handleCreateNewAiModel} disabled={aiSaving}>新建</button>
                    <button type="button" className="btn btn-ghost" onClick={handleSwitchAiModel} disabled={aiSaving || !selectedAiModelId}>切换</button>
                    <button type="button" className="btn btn-danger" onClick={handleDeleteAiModel} disabled={aiSaving || !selectedAiModelId}>删除</button>
                    <button type="button" className="btn btn-ghost" onClick={handleExportAgentConfig} disabled={aiSaving}>导出</button>
                    <button type="button" className="btn btn-ghost" onClick={() => importAgentConfigRef.current?.click()} disabled={aiSaving}>导入</button>
                    <input ref={importAgentConfigRef} type="file" className="sr-only" accept="application/json,.json"
                      onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleImportAgentConfig(file); }} title="导入模型配置" />
                  </div>
                  <div className="config-row">
                    <span className="config-label">配置名称</span>
                    <div className="config-value"><input type="text" className="input" title="配置名称" aria-label="配置名称" placeholder="例如：DeepSeek 主力 / OpenAI 备用" value={aiLabel} onChange={e => setAiLabel(e.target.value)} /></div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">服务商</span>
                    <div className="config-value">
                      <select className="select" title="模型服务商" aria-label="模型服务商" value={aiProvider} onChange={e => applyAiProviderPreset(e.target.value)}>
                        {AI_PROVIDER_OPTIONS.map((item) => (<option key={item.value} value={item.value}>{item.label}</option>))}
                      </select>
                    </div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">模型名称</span>
                    <div className="config-value"><input type="text" className="input" title="模型名称" aria-label="模型名称" placeholder={AI_PROVIDER_DEFAULTS[aiProvider]?.model || '请输入模型 ID'} value={aiModel} onChange={e => setAiModel(e.target.value)} /></div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">API Key</span>
                    <div className="config-value"><input type="password" className="input" title="API Key" aria-label="API Key" placeholder={aiConfigured ? '••••••••（已保存，留空则不更新）' : '请输入 API Key'} value={aiApiKey} onChange={e => setAiApiKey(e.target.value)} /></div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">Base URL</span>
                    <div className="config-value"><input type="text" className="input" title="Base URL" aria-label="Base URL" placeholder={AI_PROVIDER_DEFAULTS[aiProvider]?.baseUrl || 'https://your-api.example.com/v1'} value={aiBaseUrl} onChange={e => setAiBaseUrl(e.target.value)} /></div>
                  </div>
                  <div className="config-actions">
                    <button type="button" className="btn btn-primary" onClick={handleSaveAiConfig} disabled={aiSaving}>
                      {aiSaving ? '保存中...' : (selectedAiModelId ? '更新并切换' : '新增并切换')}
                    </button>
                    <span className="config-label-hint">支持多模型，配置保存在本地 ~/.rdkstudio/agent-config.json</span>
                  </div>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══════ 2. 人格与行为 ══════ */}
              <section id="persona" className="settings-section" ref={registerSectionRef('persona')}>
                <SectionHeader title="人格与行为" desc="核心性格由 SOUL.md 管理，这里控制 RDKClaw 的风险偏好和自治程度。" />
                <div className="config-section">
                  <div className="config-row">
                    <span className="config-label">名称</span>
                    <div className="config-value"><input className="input" title="名称" aria-label="名称" value={persona.name} onChange={e => setPersona(p => ({ ...p, name: e.target.value }))} placeholder="RDKClaw" /></div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">额外指令</span>
                    <div className="config-value">
                      <textarea className="input" title="额外指令" aria-label="额外指令" rows={3} value={persona.extraInstructions} onChange={e => setPersona(p => ({ ...p, extraInstructions: e.target.value }))} placeholder="补充 SOUL.md 未涵盖的临时指令，如「本次优先用英文回复」" style={{ resize: 'vertical', minHeight: 60 }} />
                    </div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">风险偏好</span>
                    <div className="config-value">
                      <select className="select" title="风险偏好" aria-label="风险偏好" value={persona.riskLevel} onChange={e => setPersona(p => ({ ...p, riskLevel: e.target.value as PersonaProfile['riskLevel'] }))}>
                        <option value="conservative">保守 — 优先安全，高危操作一律确认</option>
                        <option value="balanced">均衡 — 安全与效率兼顾</option>
                        <option value="aggressive">激进 — 效率优先，信任 Agent 判断</option>
                      </select>
                    </div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">自治等级</span>
                    <div className="config-value">
                      <select className="select" title="自治等级" aria-label="自治等级" value={persona.autonomyLevel} onChange={e => setPersona(p => ({ ...p, autonomyLevel: e.target.value as PersonaProfile['autonomyLevel'] }))}>
                        <option value="manual">手动 — 每步需确认</option>
                        <option value="assisted">辅助 — 低风险自动，高风险确认</option>
                        <option value="autonomous">自主 — 全自动执行</option>
                      </select>
                    </div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">委派倾向</span>
                    <div className="config-value">
                      <select className="select" title="委派倾向" aria-label="委派倾向" value={persona.delegationBias} onChange={e => setPersona(p => ({ ...p, delegationBias: e.target.value as PersonaProfile['delegationBias'] }))}>
                        <option value="local-first">Studio 优先 — 尽量本地执行</option>
                        <option value="balanced">均衡 — 根据任务自动判断</option>
                        <option value="board-first">板端优先 — 尽量委派给 OpenClaw</option>
                      </select>
                    </div>
                  </div>
                  <div className="config-actions">
                    <button type="button" className="btn btn-primary" onClick={handleSavePersona} disabled={rdkclawSaving}>
                      {rdkclawSaving ? '保存中...' : '保存人格设定'}
                    </button>
                  </div>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══════ 3. 执行策略 ══════ */}
              <section id="policy" className="settings-section" ref={registerSectionRef('policy')}>
                <SectionHeader title="执行策略" desc="控制 RDKClaw 的审批流程、记忆管理、上下文窗口和联网行为。" />
                <div className="config-section">
                  <div className="config-section-title">审批</div>
                  <div className="config-row">
                    <span className="config-label">审批模式</span>
                    <div className="config-value">
                      <select className="select" title="审批模式" aria-label="审批模式" value={policy.approval.mode} onChange={e => setPolicy(p => ({ ...p, approval: { ...p.approval, mode: e.target.value as RDKClawPolicy['approval']['mode'] } }))}>
                        <option value="always">始终审批</option>
                        <option value="risk-based">基于风险等级</option>
                        <option value="auto">全自动</option>
                      </select>
                    </div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">风险阈值</span>
                    <div className="config-value">
                      <select className="select" title="风险阈值" aria-label="风险阈值" value={policy.approval.riskThreshold} onChange={e => setPolicy(p => ({ ...p, approval: { ...p.approval, riskThreshold: e.target.value as RDKClawPolicy['approval']['riskThreshold'] } }))}>
                        <option value="low">低 — 几乎所有操作需审批</option>
                        <option value="medium">中 — 仅中高风险操作需审批</option>
                        <option value="high">高 — 仅高危操作需审批</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="config-section">
                  <div className="config-section-title">记忆与上下文</div>
                  <div className="config-row">
                    <span className="config-label">主会话读取历史记忆</span>
                    <input type="checkbox" title="主会话读取历史记忆" aria-label="主会话读取历史记忆" checked={policy.memory.mainSessionReadsMemory} onChange={e => setPolicy(p => ({ ...p, memory: { ...p.memory, mainSessionReadsMemory: e.target.checked } }))} />
                  </div>
                  <div className="config-row">
                    <span className="config-label">跨会话记忆隔离</span>
                    <input type="checkbox" title="跨会话记忆隔离" aria-label="跨会话记忆隔离" checked={policy.memory.sharedSessionBlocksMemory} onChange={e => setPolicy(p => ({ ...p, memory: { ...p.memory, sharedSessionBlocksMemory: e.target.checked } }))} />
                  </div>
                  <div className="config-row">
                    <span className="config-label">记忆保留天数</span>
                    <div className="config-value"><input type="number" className="input" title="记忆天数" aria-label="记忆天数" value={policy.memory.dailyMemoryDays} onChange={e => setPolicy(p => ({ ...p, memory: { ...p.memory, dailyMemoryDays: Number(e.target.value) || 7 } }))} min={1} max={90} style={{ maxWidth: 100 }} /></div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">上下文预算 (tokens)</span>
                    <div className="config-value"><input type="number" className="input" title="上下文预算" aria-label="上下文预算" value={policy.context.contextTokens} onChange={e => setPolicy(p => ({ ...p, context: { ...p.context, contextTokens: Math.max(16000, Number(e.target.value) || 128000) } }))} min={16000} max={256000} /></div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">历史占比上限</span>
                    <div className="config-value"><input type="number" className="input" title="历史占比上限" aria-label="历史占比上限" value={policy.context.maxHistoryShare} onChange={e => setPolicy(p => ({ ...p, context: { ...p.context, maxHistoryShare: Number(e.target.value) || 0.5 } }))} min={0.1} max={0.95} step={0.05} /></div>
                  </div>
                </div>
                <div className="config-section">
                  <div className="config-section-title">联网能力</div>
                  <div className="config-row">
                    <span className="config-label">启用 Agent 联网</span>
                    <input type="checkbox" title="启用联网" aria-label="启用联网" checked={policy.network.enabled} onChange={e => setPolicy(p => ({ ...p, network: { ...p.network, enabled: e.target.checked } }))} />
                  </div>
                  <div className="config-row">
                    <span className="config-label">单次抓取上限 (字符)</span>
                    <div className="config-value"><input type="number" className="input" title="抓取上限" aria-label="抓取上限" value={policy.network.maxFetchChars} onChange={e => setPolicy(p => ({ ...p, network: { ...p.network, maxFetchChars: Number(e.target.value) || 30000 } }))} min={1000} max={200000} style={{ maxWidth: 120 }} /></div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">联网需人工审批</span>
                    <input type="checkbox" title="联网需审批" aria-label="联网需审批" checked={policy.network.requireApproval} onChange={e => setPolicy(p => ({ ...p, network: { ...p.network, requireApproval: e.target.checked } }))} />
                  </div>
                  <div className="config-actions">
                    <button type="button" className="btn btn-primary" onClick={handleSavePolicy} disabled={rdkclawSaving}>
                      {rdkclawSaving ? '保存中...' : '保存执行策略'}
                    </button>
                    <span className="config-label-hint">保存在本地 ~/.rdkstudio/rdkclaw-policy.json</span>
                  </div>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══════ 4. 飞书 ══════ */}
              <section id="feishu" className="settings-section" ref={registerSectionRef('feishu')}>
                <SectionHeader title="消息渠道 · 飞书" desc="通过飞书机器人接收和回复消息。需先在飞书开放平台创建企业自建应用。" />

                <div className="config-section">
                  <div className="config-section-title">运行状态</div>
                  {feishuLoading ? <div className="config-value">加载中...</div> : (
                    <>
                      <div className="config-row">
                        <span className="config-label">通道状态</span>
                        <span className="config-value">
                          {feishuStatus?.runtime?.running ? (feishuStatus?.runtime?.connected ? '运行中（已连接）' : '运行中（等待事件）') : '已停止'}
                        </span>
                      </div>
                      <div className="config-row">
                        <span className="config-label">已绑定 / 待审批</span>
                        <span className="config-value">{feishuStatus?.boundUsers ?? 0} / {feishuStatus?.pendingPairings ?? 0}</span>
                      </div>
                      {feishuStatus?.runtime?.lastError && (
                        <div className="config-row">
                          <span className="config-label">最近错误</span>
                          <span className="config-value" style={{ color: 'var(--danger)' }}>{feishuStatus.runtime.lastError}</span>
                        </div>
                      )}
                      <div className="config-actions">
                        <button type="button" className="btn btn-ghost" onClick={() => handleFeishuRuntime('start')}>启动</button>
                        <button type="button" className="btn btn-ghost" onClick={() => handleFeishuRuntime('stop')}>停止</button>
                        <button type="button" className="btn btn-ghost" onClick={() => handleFeishuRuntime('restart')}>重启</button>
                      </div>
                    </>
                  )}
                </div>

                <div className="config-section">
                  <div className="config-section-title">通道配置</div>
                  <div className="config-row"><span className="config-label">启用飞书通道</span><input type="checkbox" title="启用飞书通道" aria-label="启用飞书通道" checked={feishuEnabled} onChange={(e) => setFeishuEnabled(e.target.checked)} /></div>
                  <div className="config-row">
                    <span className="config-label">连接模式</span>
                    <div className="config-value"><select className="select" title="连接模式" aria-label="连接模式" value={feishuConnectionMode} onChange={(e) => setFeishuConnectionMode(e.target.value as 'websocket' | 'webhook')}><option value="websocket">WebSocket（推荐）</option><option value="webhook">Webhook</option></select></div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">平台域名</span>
                    <div className="config-value"><select className="select" title="平台域名" aria-label="平台域名" value={feishuDomain} onChange={(e) => setFeishuDomain(e.target.value as 'feishu' | 'lark')}><option value="feishu">feishu</option><option value="lark">lark</option></select></div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">私信策略</span>
                    <div className="config-value"><select className="select" title="私信策略" aria-label="私信策略" value={feishuDmPolicy} onChange={(e) => setFeishuDmPolicy(e.target.value as 'pairing' | 'allowlist' | 'open')}><option value="pairing">配对模式（默认）</option><option value="allowlist">白名单</option><option value="open">开放</option></select></div>
                  </div>
                  <div className="config-row"><span className="config-label">统一会话上下文</span><input type="checkbox" title="统一会话上下文" aria-label="统一会话上下文" checked={feishuSyncWithStudio} onChange={(e) => setFeishuSyncWithStudio(e.target.checked)} /></div>
                  <div className="config-row"><span className="config-label">飞书消息镜像到聊天框</span><input type="checkbox" title="飞书消息镜像" aria-label="飞书消息镜像" checked={feishuMirrorToStudioChat} onChange={(e) => setFeishuMirrorToStudioChat(e.target.checked)} /></div>
                  <div className="config-row"><span className="config-label">收到即回执</span><input type="checkbox" title="收到即回执" aria-label="收到即回执" checked={feishuAckOnReceive} onChange={(e) => setFeishuAckOnReceive(e.target.checked)} /></div>
                  <div className="config-row"><span className="config-label">处理中回执</span><input type="checkbox" title="处理中回执" aria-label="处理中回执" checked={feishuAckOnRunning} onChange={(e) => setFeishuAckOnRunning(e.target.checked)} /></div>
                  <div className="config-row">
                    <span className="config-label">回执样式</span>
                    <div className="config-value"><select className="select" title="回执样式" aria-label="回执样式" value={feishuAckStyle} onChange={(e) => setFeishuAckStyle(e.target.value as 'text' | 'emoji' | 'off')}><option value="text">文本</option><option value="emoji">表情</option><option value="off">关闭</option></select></div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">App ID</span>
                    <div className="config-value"><input type="text" className="input" title="App ID" aria-label="App ID" placeholder="cli_xxx" value={feishuAppId} onChange={(e) => setFeishuAppId(e.target.value)} /></div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">App Secret</span>
                    <div className="config-value"><input type="password" className="input" title="App Secret" aria-label="App Secret" placeholder={feishuMasks.appSecretMasked ? `已配置：${feishuMasks.appSecretMasked}（留空不改）` : '请输入 App Secret'} value={feishuAppSecret} onChange={(e) => setFeishuAppSecret(e.target.value)} /></div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">Verification Token</span>
                    <div className="config-value"><input type="password" className="input" title="Verification Token" aria-label="Verification Token" placeholder={feishuMasks.verificationTokenMasked ? `已配置：${feishuMasks.verificationTokenMasked}（留空不改）` : '建议配置'} value={feishuVerificationToken} onChange={(e) => setFeishuVerificationToken(e.target.value)} /></div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">Encrypt Key</span>
                    <div className="config-value"><input type="password" className="input" title="Encrypt Key" aria-label="Encrypt Key" placeholder={feishuMasks.encryptKeyMasked ? `已配置：${feishuMasks.encryptKeyMasked}（留空不改）` : '建议配置'} value={feishuEncryptKey} onChange={(e) => setFeishuEncryptKey(e.target.value)} /></div>
                  </div>
                  <div className="config-actions">
                    <button type="button" className="btn btn-primary" onClick={handleSaveFeishu} disabled={feishuSaving}>{feishuSaving ? '保存中...' : '保存飞书配置'}</button>
                    <span className="config-label-hint">保存到本地 ~/.rdkstudio/feishu-config.json</span>
                  </div>
                </div>

                <div className="config-section">
                  <div className="config-section-title">接入步骤</div>
                  <div className="usage-item"><strong>1. 创建企业自建应用并启用机器人</strong><span>在飞书开放平台获取 App ID 与 App Secret。</span></div>
                  <div className="usage-item"><strong>2. 开启事件订阅并切换到长连接模式</strong><span>订阅 im.message.receive_v1，连接模式选择 WebSocket。</span></div>
                  <div className="usage-item"><strong>3. 保存配置并启动通道</strong><span>无需公网 webhook，仅需本机可访问飞书公网。</span></div>
                  <div className="usage-item"><strong>4. 用户私信机器人后审批配对</strong><span>收到配对码后在下方「配对审批」中处理。</span></div>
                </div>

                {/* Pairing */}
                <div className="config-section">
                  <div className="config-section-title">配对审批</div>
                  {feishuPairings.length === 0 ? (
                    <div className="config-value">暂无待审批配对请求</div>
                  ) : feishuPairings.map((item) => (
                    <div className="config-row" key={`${item.code}-${item.createdAt}`}>
                      <span className="config-label">{item.openId} / {item.code}</span>
                      <span className="config-value">{new Date(item.createdAt).toLocaleString()}</span>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => handlePairingDecision(item.code, 'approve')}>批准</button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => handlePairingDecision(item.code, 'reject')}>拒绝</button>
                    </div>
                  ))}
                </div>

                {feishuBoundUsers.length > 0 && (
                  <div className="config-section">
                    <div className="config-section-title">绑定账号（脱敏）</div>
                    {feishuBoundUsers.map((u) => (
                      <div className="config-row" key={`${u.openId}-${u.boundAt}`}>
                        <span className="config-label">{u.openId}</span>
                        <span className="config-value">{new Date(u.boundAt).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <hr className="settings-section-divider" />

              {/* ══════ 5. 微信 ══════ */}
              <section id="weixin" className="settings-section" ref={registerSectionRef('weixin')}>
                <SectionHeader title="消息渠道 · 微信" desc="通过微信与 RDKClaw 对话，随时随地管理 RDK 设备。扫码绑定个人微信即可使用。" />

                <div className="config-section">
                  {weixinAccounts.length > 0 && (
                    <>
                      <div className="config-section-title">已绑定账号</div>
                      {weixinAccounts.map((a) => (
                        <div className="config-row" key={a.accountId}>
                          <span className="config-label">{a.nickname || a.accountId.slice(0, 12) + '...'}</span>
                          <span className="config-value">{new Date(a.boundAt).toLocaleString()}</span>
                          <button type="button" className="btn btn-danger btn-sm"
                            onClick={async () => { await removeWeixinAccount(a.accountId); loadWeixinData(); addToast('已移除', 'info'); }}>移除</button>
                        </div>
                      ))}
                    </>
                  )}

                  <div className="config-actions" style={{ marginTop: 8 }}>
                    <button type="button" className="btn btn-primary" onClick={startWeixinLogin} disabled={weixinLoginLoading}>
                      {weixinLoginLoading ? '等待扫码...' : '扫码绑定微信'}
                    </button>
                  </div>

                  {weixinQrCode && (
                    <div style={{ textAlign: 'center', padding: 12, background: '#fff', borderRadius: 8, margin: '8px 0' }}>
                      <img src={weixinQrCode} alt="微信扫码" style={{ width: 200, height: 200, imageRendering: 'pixelated' }} />
                      <div style={{ fontSize: '0.625rem', color: '#666', marginTop: 4 }}>请用微信扫一扫</div>
                    </div>
                  )}
                </div>

                <div className="config-section">
                  <div className="config-section-title">渠道设置</div>
                  <div className="config-row">
                    <span className="config-label">启用微信渠道</span>
                    <input type="checkbox" title="启用微信" aria-label="启用微信" checked={weixinEnabled} onChange={(e) => setWeixinEnabled(e.target.checked)} />
                  </div>
                  <div className="config-row">
                    <span className="config-label">收到回执</span>
                    <div className="config-value">
                      <select className="select" title="回执风格" aria-label="回执风格" value={weixinAckStyle} onChange={(e) => setWeixinAckStyle(e.target.value as 'text' | 'emoji' | 'off')}>
                        <option value="text">文本回执</option>
                        <option value="emoji">表情回执</option>
                        <option value="off">关闭</option>
                      </select>
                    </div>
                  </div>
                  <div className="config-actions">
                    <button type="button" className="btn btn-primary" onClick={saveWeixinSettings} disabled={weixinLoading}>{weixinLoading ? '...' : '保存设置'}</button>
                    <button type="button" className="btn btn-ghost" onClick={async () => { await restartWeixinChannel(); addToast('已重启', 'info'); }}>重启渠道</button>
                  </div>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══════ 6. 设备连接 ══════ */}
              <section id="connection" className="settings-section" ref={registerSectionRef('connection')}>
                <SectionHeader title="设备连接" desc="SSH 连接参数，影响 RDKClaw 访问 RDK 设备的方式。" />
                <div className="config-section">
                  <div className="config-row">
                    <span className="config-label">连接超时 (秒)</span>
                    <div className="config-value"><input type="number" className="input" title="连接超时" aria-label="连接超时" value={connectionTimeout} onChange={e => setConnectionTimeout(Number(e.target.value))} /></div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">启动时自动连接上次设备</span>
                    <input type="checkbox" title="自动连接" aria-label="自动连接" checked={autoReconnect} onChange={e => { setAutoReconnect(e.target.checked); addToast('设置已更新', 'success'); }} />
                  </div>
                  <div className="config-row">
                    <span className="config-label">默认认证方式</span>
                    <span className="config-value">密码认证</span>
                  </div>
                </div>
              </section>

              <hr className="settings-section-divider" />

              {/* ══════ 7. 社区论坛 ══════ */}
              <section id="forum" className="settings-section" ref={registerSectionRef('forum')}>
                <SectionHeader title="社区论坛" desc="授权后 RDKClaw 可帮你在 D-Robotics 社区发帖、回帖和互动。" />
                <div className="config-section">
                  <div className="config-row"><span className="config-label">当前论坛用户</span><span className="config-value">{forumAuth.username || '未配置'}</span></div>
                  <div className="config-row"><span className="config-label">已保存密码</span><span className="config-value">{forumAuth.hasPassword ? '是' : '否'}</span></div>
                  <div className="config-row"><span className="config-label">已保存 Cookie</span><span className="config-value">{forumAuth.hasCookie ? '是' : '否'}</span></div>
                  <div className="config-row">
                    <span className="config-label">论坛用户名</span>
                    <div className="config-value"><input type="text" className="input" title="论坛用户名" aria-label="论坛用户名" placeholder="你的论坛用户名" value={forumUsernameInput} onChange={(e) => setForumUsernameInput(e.target.value)} /></div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">论坛密码</span>
                    <div className="config-value"><input type="password" className="input" title="论坛密码" aria-label="论坛密码" placeholder="请输入论坛密码" value={forumPasswordInput} onChange={(e) => setForumPasswordInput(e.target.value)} /></div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">Cookie（可选）</span>
                    <div className="config-value"><textarea className="input" title="Cookie" aria-label="Cookie" rows={2} value={forumCookieInput} onChange={(e) => setForumCookieInput(e.target.value)} placeholder="_forum_session=...; other_cookie=..." /></div>
                  </div>
                  <div className="config-actions">
                    <button type="button" className="btn btn-primary" onClick={handleSaveForumCredential} disabled={forumSaving}>{forumSaving ? '保存中...' : '保存账号密码'}</button>
                    <button type="button" className="btn btn-ghost" onClick={handleSaveForumCookie} disabled={forumSaving}>保存 Cookie</button>
                    <button type="button" className="btn btn-danger" onClick={handleClearForumAuth} disabled={forumSaving}>清空认证</button>
                  </div>
                  <span className="config-label-hint">保存后 RDKClaw 可通过 SSO 访问论坛并执行发帖流程。</span>
                </div>
              </section>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
