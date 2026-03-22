import { useEffect, useState } from 'react';
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
} from '../api';

const AI_PROVIDER_DEFAULTS: Record<string, { label: string; model: string; baseUrl: string }> = {
  qwen: {
    label: '通义千问 (Qwen)',
    model: 'qwen3.5-plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  deepseek: {
    label: 'DeepSeek',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
  },
  openai: {
    label: 'OpenAI',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
  },
  moonshot: {
    label: 'Moonshot',
    model: 'moonshot-v1-8k',
    baseUrl: 'https://api.moonshot.cn/v1',
  },
  zhipu: {
    label: '智谱 AI',
    model: 'glm-4-flash',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  },
  groq: {
    label: 'Groq',
    model: 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
  openrouter: {
    label: 'OpenRouter',
    model: 'openai/gpt-4o-mini',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  xai: {
    label: 'xAI',
    model: 'grok-2-latest',
    baseUrl: 'https://api.x.ai/v1',
  },
  ollama: {
    label: 'Ollama',
    model: 'qwen2.5:7b',
    baseUrl: 'http://127.0.0.1:11434/v1',
  },
  'openai-compatible': {
    label: 'OpenAI 兼容',
    model: 'gpt-4o-mini',
    baseUrl: '',
  },
};

const AI_PROVIDER_OPTIONS = Object.entries(AI_PROVIDER_DEFAULTS).map(([value, item]) => ({
  value,
  label: item.label,
}));

export default function SettingsPanel() {
  const {
    showSettings, setShowSettings, settingsTab, setSettingsTab,
    language, setLanguage, autoReconnect, setAutoReconnect,
    connectionTimeout, setConnectionTimeout, addToast,
  } = useAppState();

  const [aiProvider, setAiProvider] = useState('qwen');
  const [aiModel, setAiModel] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
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
  const [feishuMasks, setFeishuMasks] = useState({
    appSecretMasked: '',
    verificationTokenMasked: '',
    encryptKeyMasked: '',
  });
  const [feishuPairings, setFeishuPairings] = useState<Array<{
    openId: string;
    rawOpenId: string;
    chatId: string;
    code: string;
    expireAt: number;
    createdAt: number;
  }>>([]);

  // ── RDKClaw Persona & Policy ──
  const [persona, setPersona] = useState<PersonaProfile>({
    name: 'RDKClaw', tone: 'professional', stylePrompt: '', riskLevel: 'balanced',
    boardDelegationBias: 'medium', delegationBias: 'balanced', autonomyLevel: 'assisted',
    riskBoundary: 'moderate', notifyStyle: 'compact',
  });
  const [policy, setPolicy] = useState<RDKClawPolicy>({
    approval: { mode: 'risk-based', riskThreshold: 'medium' },
    delegation: { strategy: 'hybrid', allowBoardAuto: true },
    memory: { mainSessionReadsMemory: true, sharedSessionBlocksMemory: false, dailyMemoryDays: 7 },
    scheduler: { defaultChannel: 'chat', allowSecondInterval: false },
    network: { enabled: true, maxFetchChars: 30000, requireApproval: false },
  });
  const [rdkclawLoading, setRdkclawLoading] = useState(false);
  const [rdkclawSaving, setRdkclawSaving] = useState(false);
  const [forumAuth, setForumAuth] = useState<ForumAuthView>({
    username: '',
    hasPassword: false,
    hasApiKey: false,
    hasApiUsername: false,
    hasCookie: false,
  });
  const [forumUsernameInput, setForumUsernameInput] = useState('');
  const [forumPasswordInput, setForumPasswordInput] = useState('');
  const [forumCookieInput, setForumCookieInput] = useState('');
  const [forumSaving, setForumSaving] = useState(false);

  const refreshRdkclawData = async () => {
    const [personaRes, policyRes, forumAuthRes] = await Promise.all([
      fetchRDKClawPersona(),
      fetchRDKClawPolicy(),
      fetchRDKClawForumAuth(),
    ]);
    setPersona(personaRes.persona);
    setPolicy(policyRes.policy);
    setForumAuth(forumAuthRes.auth);
  };

  useEffect(() => {
    if (!showSettings || settingsTab !== 'rdkclaw') return;
    setRdkclawLoading(true);
    refreshRdkclawData()
      .catch(() => addToast('读取 RDKClaw 配置失败', 'error'))
      .finally(() => setRdkclawLoading(false));
  }, [showSettings, settingsTab]);

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
    if (!username || !password) {
      addToast('请填写论坛用户名和密码', 'warning');
      return;
    }
    setForumSaving(true);
    try {
      const res = await saveRDKClawForumCredential({ username, password });
      setForumPasswordInput('');
      await refreshRdkclawData();
      addToast(res.message || '论坛账号已保存', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '论坛账号保存失败', 'error');
    } finally {
      setForumSaving(false);
    }
  };

  const handleSaveForumCookie = async () => {
    const cookie = forumCookieInput.trim();
    if (!cookie) {
      addToast('请粘贴论坛 Cookie', 'warning');
      return;
    }
    setForumSaving(true);
    try {
      const res = await saveRDKClawForumCookie(cookie);
      setForumCookieInput('');
      await refreshRdkclawData();
      addToast(res.message || '论坛 Cookie 已保存', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '论坛 Cookie 保存失败', 'error');
    } finally {
      setForumSaving(false);
    }
  };

  const handleClearForumAuth = async () => {
    setForumSaving(true);
    try {
      const res = await clearRDKClawForumAuth();
      setForumUsernameInput('');
      setForumPasswordInput('');
      setForumCookieInput('');
      await refreshRdkclawData();
      addToast(res.message || '论坛认证已清空', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '清空论坛认证失败', 'error');
    } finally {
      setForumSaving(false);
    }
  };

  const refreshFeishuData = async () => {
    const [statusRes, boundRes, cfgRes, pairingRes] = await Promise.all([
      fetchFeishuRuntimeStatus(),
      fetchFeishuBoundUsers(),
      fetchFeishuConfig(),
      fetchFeishuPairingRequests(),
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

  useEffect(() => {
    if (showSettings && settingsTab === 'ai') {
      fetchAgentConfig().then(cfg => {
        if (cfg.configured) {
          setAiConfigured(true);
          setAiProvider(cfg.provider || 'qwen');
          setAiModel(cfg.model || '');
          setAiBaseUrl(cfg.baseUrl || '');
        }
      }).catch(() => {});
    }
  }, [showSettings, settingsTab]);

  useEffect(() => {
    if (!showSettings || settingsTab !== 'feishu') return;
    setFeishuLoading(true);
    refreshFeishuData().catch(() => {
      addToast('读取飞书状态失败，请检查后端服务', 'error');
    }).finally(() => setFeishuLoading(false));
  }, [showSettings, settingsTab, addToast]);

  const handleSaveFeishu = async () => {
    setFeishuSaving(true);
    try {
      await saveFeishuConfig({
        enabled: feishuEnabled,
        connectionMode: feishuConnectionMode,
        domain: feishuDomain,
        dmPolicy: feishuDmPolicy,
        syncWithStudio: feishuSyncWithStudio,
        mirrorToStudioChat: feishuMirrorToStudioChat,
        ackOnReceive: feishuAckOnReceive,
        ackOnRunning: feishuAckOnRunning,
        ackStyle: feishuAckStyle,
        appId: feishuAppId,
        appSecret: feishuAppSecret || undefined,
        verificationToken: feishuVerificationToken || undefined,
        encryptKey: feishuEncryptKey || undefined,
      });
      setFeishuAppSecret('');
      setFeishuVerificationToken('');
      setFeishuEncryptKey('');
      await refreshFeishuData();
      addToast('飞书配置已保存', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '保存飞书配置失败', 'error');
    } finally {
      setFeishuSaving(false);
    }
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
      if (decision === 'approve') {
        await approveFeishuPairing(code);
        addToast('配对审批已通过', 'success');
      } else {
        await rejectFeishuPairing(code);
        addToast('配对请求已拒绝', 'success');
      }
      await refreshFeishuData();
    } catch (error) {
      addToast(error instanceof Error ? error.message : '处理配对请求失败', 'error');
    }
  };

  const handleSaveAiConfig = async () => {
    if (!aiApiKey.trim() && !aiConfigured) {
      addToast('请填写 API Key', 'warning');
      return;
    }
    const providerDefaults = AI_PROVIDER_DEFAULTS[aiProvider] || AI_PROVIDER_DEFAULTS['openai-compatible'];
    setAiSaving(true);
    try {
      await saveAgentConfig({
        provider: aiProvider,
        model: aiModel || providerDefaults.model,
        apiKey: aiApiKey || undefined,
        baseUrl: aiBaseUrl || providerDefaults.baseUrl || undefined,
      });
      setAiConfigured(true);
      setAiApiKey('');
      addToast('AI 模型配置已保存', 'success');
    } catch {
      addToast('保存失败', 'error');
    } finally {
      setAiSaving(false);
    }
  };

  if (!showSettings) return null;

  const applyAiProviderPreset = (nextProvider: string) => {
    const prevDefaults = AI_PROVIDER_DEFAULTS[aiProvider];
    const nextDefaults = AI_PROVIDER_DEFAULTS[nextProvider] || AI_PROVIDER_DEFAULTS['openai-compatible'];
    const shouldReplaceModel = !aiModel || aiModel === prevDefaults?.model;
    const shouldReplaceBaseUrl = !aiBaseUrl || aiBaseUrl === prevDefaults?.baseUrl;

    setAiProvider(nextProvider);
    if (shouldReplaceModel) setAiModel(nextDefaults.model);
    if (shouldReplaceBaseUrl) setAiBaseUrl(nextDefaults.baseUrl);
  };

  return (
    <div className="settings-overlay" onClick={() => setShowSettings(false)}>
      <div className="settings-drawer" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <div className="settings-title">⚙️ 客户端设置</div>
          <button type="button" className="btn-icon" onClick={() => setShowSettings(false)}>×</button>
        </div>

        <div className="settings-nav">
          {([['general', '通用'], ['ai', 'AI 模型'], ['rdkclaw', 'RDKClaw'], ['connection', '连接'], ['feishu', '飞书'], ['about', '关于']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={settingsTab === key ? 'settings-nav-btn active' : 'settings-nav-btn'}
              onClick={() => setSettingsTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="settings-body">
        {settingsTab === 'general' && (
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
            <div className="config-row">
              <span className="config-label">主题配色</span>
              <span className="config-value">白色 + 橙色 (默认)</span>
            </div>
            <div className="config-row">
              <span className="config-label">启动时自动连接上次设备</span>
              <input type="checkbox" title="启动时自动连接上次设备" aria-label="启动时自动连接上次设备" checked={autoReconnect} onChange={e => { setAutoReconnect(e.target.checked); addToast('自动连接设置已更新', 'success'); }} />
            </div>
          </div>
        )}

        {settingsTab === 'ai' && (
          <>
            <div className="config-section">
              <div className="config-section-title">
                LLM Provider
                {aiConfigured && <span className="badge badge-ok">● 已配置</span>}
              </div>
              <div className="config-row">
                <span className="config-label">服务商</span>
                <div className="config-value">
                  <select className="select" title="模型服务商" aria-label="模型服务商" value={aiProvider} onChange={e => applyAiProviderPreset(e.target.value)}>
                    {AI_PROVIDER_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="config-row">
                <span className="config-label">模型名称</span>
                <div className="config-value">
                  <input
                    type="text"
                    className="input"
                    title="模型名称"
                    aria-label="模型名称"
                    placeholder={AI_PROVIDER_DEFAULTS[aiProvider]?.model || '请输入模型 ID'}
                    value={aiModel}
                    onChange={e => setAiModel(e.target.value)}
                  />
                </div>
              </div>
              <div className="config-row">
                <span className="config-label">API Key</span>
                <div className="config-value">
                  <input
                    type="password"
                    className="input"
                    title="API Key"
                    aria-label="API Key"
                    placeholder={aiConfigured ? '••••••••（已保存，留空则不更新）' : '请输入 API Key'}
                    value={aiApiKey}
                    onChange={e => setAiApiKey(e.target.value)}
                  />
                </div>
              </div>
              <div className="config-row">
                <span className="config-label">Base URL</span>
                <div className="config-value">
                  <input
                    type="text"
                    className="input"
                    title="Base URL"
                    aria-label="Base URL"
                    placeholder={AI_PROVIDER_DEFAULTS[aiProvider]?.baseUrl || 'https://your-api.example.com/v1'}
                    value={aiBaseUrl}
                    onChange={e => setAiBaseUrl(e.target.value)}
                  />
                </div>
              </div>
              <div className="config-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveAiConfig}
                  disabled={aiSaving}
                >
                  {aiSaving ? '保存中...' : '保存配置'}
                </button>
                <span className="config-label-hint">
                  配置保存在本地 ~/.rdkstudio/agent-config.json
                </span>
              </div>
            </div>
            <div className="config-section">
              <div className="config-section-title">提示</div>
              <div className="config-label-hint">
                <p>推荐通义千问或 DeepSeek，性价比高。</p>
              </div>
            </div>
          </>
        )}

        {settingsTab === 'connection' && (
          <>
            <div className="config-section">
              <div className="config-section-title">SSH / SFTP</div>
              <div className="config-row">
                <span className="config-label">连接超时 (秒)</span>
                <div className="config-value">
                  <input type="number" className="input" title="连接超时秒数" aria-label="连接超时秒数" value={connectionTimeout} onChange={e => setConnectionTimeout(Number(e.target.value))} />
                </div>
              </div>
              <div className="config-row">
                <span className="config-label">断线自动重连</span>
                <input type="checkbox" title="断线自动重连" aria-label="断线自动重连" checked={autoReconnect} onChange={e => setAutoReconnect(e.target.checked)} />
              </div>
              <div className="config-row">
                <span className="config-label">默认认证方式</span>
                <span className="config-value">密码认证</span>
              </div>
            </div>
            <div className="config-section">
              <div className="config-section-title">VNC</div>
              <div className="config-row">
                <span className="config-label">默认画质</span>
                <span className="config-value">平衡模式</span>
              </div>
              <div className="config-row">
                <span className="config-label">自动适配分辨率</span>
                <input type="checkbox" title="自动适配分辨率" aria-label="自动适配分辨率" checked={true} readOnly />
              </div>
            </div>
          </>
        )}

        {settingsTab === 'feishu' && (
          <>
            <div className="config-section">
              <div className="config-section-title">飞书运行状态（官方模式）</div>
              {feishuLoading ? (
                <div className="config-value">加载中...</div>
              ) : (
                <>
                  <div className="config-row">
                    <span className="config-label">配置状态</span>
                    <span className="config-value">
                      {feishuStatus?.configured ? '已配置 App ID / App Secret' : '未配置（需填写 App ID / App Secret）'}
                    </span>
                  </div>
                  <div className="config-row">
                    <span className="config-label">连接模式</span>
                    <span className="config-value">{feishuStatus?.connectionMode === 'websocket' ? 'websocket (official)' : 'webhook (compat)'}</span>
                  </div>
                  <div className="config-row">
                    <span className="config-label">通道运行状态</span>
                    <span className="config-value">
                      {feishuStatus?.runtime?.running ? (feishuStatus?.runtime?.connected ? '运行中（已连接）' : '运行中（等待事件）') : '已停止'}
                    </span>
                  </div>
                  <div className="config-row">
                    <span className="config-label">最近通道错误</span>
                    <span className="config-value">{feishuStatus?.runtime?.lastError || '无'}</span>
                  </div>
                  <div className="config-row">
                    <span className="config-label">已绑定账号数</span>
                    <span className="config-value">{feishuStatus?.boundUsers ?? 0}</span>
                  </div>
                  <div className="config-row">
                    <span className="config-label">待审批配对数</span>
                    <span className="config-value">{feishuStatus?.pendingPairings ?? 0}</span>
                  </div>
                  <div className="config-row">
                    <span className="config-label">最近接收事件</span>
                    <span className="config-value">
                      {feishuStatus?.lastEventAt ? new Date(feishuStatus.lastEventAt).toLocaleString() : '暂无'}
                    </span>
                  </div>
                  <div className="config-row">
                    <span className="config-label">最近活跃 Studio 会话</span>
                    <span className="config-value">{feishuStatus?.latestUiSessionId || '暂无（请先在聊天框发一条消息）'}</span>
                  </div>
                  <div className="config-row">
                    <span className="config-label">最近活跃设备</span>
                    <span className="config-value">{feishuStatus?.latestUiDeviceId || '暂无（请先在 Studio 连接设备）'}</span>
                  </div>
                  <div className="config-row">
                    <span className="config-label">会话上报时间</span>
                    <span className="config-value">
                      {feishuStatus?.latestUiSessionUpdatedAt ? new Date(feishuStatus.latestUiSessionUpdatedAt).toLocaleString() : '暂无'}
                    </span>
                  </div>
                  <div className="config-row">
                    <span className="config-label">设备上报时间</span>
                    <span className="config-value">
                      {feishuStatus?.latestUiDeviceUpdatedAt ? new Date(feishuStatus.latestUiDeviceUpdatedAt).toLocaleString() : '暂无'}
                    </span>
                  </div>
                  <div className="config-row">
                    <div className="config-value">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleFeishuRuntime('start')}>启动</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleFeishuRuntime('stop')}>停止</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleFeishuRuntime('restart')}>重启</button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="config-section">
              <div className="config-section-title">飞书通道配置</div>
              <div className="config-row">
                <span className="config-label">启用飞书通道</span>
                <input type="checkbox" title="启用飞书通道" aria-label="启用飞书通道" checked={feishuEnabled} onChange={(e) => setFeishuEnabled(e.target.checked)} />
              </div>
              <div className="config-row">
                <span className="config-label">连接模式</span>
                <div className="config-value">
                  <select className="select" title="飞书连接模式" aria-label="飞书连接模式" value={feishuConnectionMode} onChange={(e) => setFeishuConnectionMode(e.target.value as 'websocket' | 'webhook')}>
                    <option value="websocket">websocket (official)</option>
                    <option value="webhook">webhook (compat)</option>
                  </select>
                </div>
              </div>
              <div className="config-row">
                <span className="config-label">平台域名</span>
                <div className="config-value">
                  <select className="select" title="飞书平台域名" aria-label="飞书平台域名" value={feishuDomain} onChange={(e) => setFeishuDomain(e.target.value as 'feishu' | 'lark')}>
                    <option value="feishu">feishu</option>
                    <option value="lark">lark</option>
                  </select>
                </div>
              </div>
              <div className="config-row">
                <span className="config-label">私信策略</span>
                <div className="config-value">
                  <select className="select" title="私信策略" aria-label="私信策略" value={feishuDmPolicy} onChange={(e) => setFeishuDmPolicy(e.target.value as 'pairing' | 'allowlist' | 'open')}>
                    <option value="pairing">pairing（默认）</option>
                    <option value="allowlist">allowlist</option>
                    <option value="open">open</option>
                  </select>
                </div>
              </div>
              <div className="config-row">
                <span className="config-label">统一会话上下文</span>
                <input type="checkbox" title="统一会话上下文" aria-label="统一会话上下文" checked={feishuSyncWithStudio} onChange={(e) => setFeishuSyncWithStudio(e.target.checked)} />
              </div>
              <div className="config-row">
                <span className="config-label">飞书消息镜像到聊天框</span>
                <input type="checkbox" title="飞书消息镜像到聊天框" aria-label="飞书消息镜像到聊天框" checked={feishuMirrorToStudioChat} onChange={(e) => setFeishuMirrorToStudioChat(e.target.checked)} />
              </div>
              <div className="config-row">
                <span className="config-label">收到即回执</span>
                <input type="checkbox" title="收到即回执" aria-label="收到即回执" checked={feishuAckOnReceive} onChange={(e) => setFeishuAckOnReceive(e.target.checked)} />
              </div>
              <div className="config-row">
                <span className="config-label">处理中回执</span>
                <input type="checkbox" title="处理中回执" aria-label="处理中回执" checked={feishuAckOnRunning} onChange={(e) => setFeishuAckOnRunning(e.target.checked)} />
              </div>
              <div className="config-row">
                <span className="config-label">回执样式</span>
                <div className="config-value">
                  <select className="select" title="回执样式" aria-label="回执样式" value={feishuAckStyle} onChange={(e) => setFeishuAckStyle(e.target.value as 'text' | 'emoji' | 'off')}>
                    <option value="text">文本</option>
                    <option value="emoji">表情</option>
                    <option value="off">关闭</option>
                  </select>
                </div>
              </div>
              <div className="config-row">
                <span className="config-label">App ID</span>
                <div className="config-value">
                  <input
                    type="text"
                    className="input"
                    title="飞书 App ID"
                    aria-label="飞书 App ID"
                    placeholder="cli_xxx"
                    value={feishuAppId}
                    onChange={(e) => setFeishuAppId(e.target.value)}
                  />
                </div>
              </div>
              <div className="config-row">
                <span className="config-label">App Secret</span>
                <div className="config-value">
                  <input
                    type="password"
                    className="input"
                    title="飞书 App Secret"
                    aria-label="飞书 App Secret"
                    placeholder={feishuMasks.appSecretMasked ? `已配置：${feishuMasks.appSecretMasked}（留空不改）` : '请输入 App Secret'}
                    value={feishuAppSecret}
                    onChange={(e) => setFeishuAppSecret(e.target.value)}
                  />
                </div>
              </div>
              <div className="config-row">
                <span className="config-label">Verification Token</span>
                <div className="config-value">
                  <input
                    type="password"
                    className="input"
                    title="Verification Token"
                    aria-label="Verification Token"
                    placeholder={feishuMasks.verificationTokenMasked ? `已配置：${feishuMasks.verificationTokenMasked}（留空不改）` : '建议配置'}
                    value={feishuVerificationToken}
                    onChange={(e) => setFeishuVerificationToken(e.target.value)}
                  />
                </div>
              </div>
              <div className="config-row">
                <span className="config-label">Encrypt Key</span>
                <div className="config-value">
                  <input
                    type="password"
                    className="input"
                    title="Encrypt Key"
                    aria-label="Encrypt Key"
                    placeholder={feishuMasks.encryptKeyMasked ? `已配置：${feishuMasks.encryptKeyMasked}（留空不改）` : '建议配置（OpenClaw 推荐必填）'}
                    value={feishuEncryptKey}
                    onChange={(e) => setFeishuEncryptKey(e.target.value)}
                  />
                </div>
              </div>
              <div className="config-row">
                <button type="button" className="btn btn-primary" onClick={handleSaveFeishu} disabled={feishuSaving}>
                  {feishuSaving ? '保存中...' : '保存飞书配置'}
                </button>
                <span className="config-label-hint">保存到本地 ~/.rdkstudio/feishu-config.json</span>
              </div>
            </div>

            <div className="config-section">
              <div className="config-section-title">接入步骤（官方 WebSocket）</div>
              <div className="usage-item">
                <strong>1. 创建企业自建应用并启用机器人</strong>
                <span>在飞书开放平台获取 App ID 与 App Secret。</span>
              </div>
              <div className="usage-item">
                <strong>2. 开启事件订阅并切换到长连接模式</strong>
                <span>订阅 `im.message.receive_v1`，连接模式选择 `websocket (official)`。</span>
              </div>
              <div className="usage-item">
                <strong>3. 保存配置并点击“重启”通道</strong>
                <span>无需公网 webhook，服务需具备公网出网能力。</span>
              </div>
              <div className="usage-item">
                <strong>4. 用户私信机器人后进行 pairing 审批</strong>
                <span>收到配对码后可在本页“配对审批”中直接批准或拒绝。</span>
              </div>
            </div>

            <div className="config-section">
              <div className="config-section-title">配置检查清单</div>
              <div className="config-row">
                <span className="config-label">网络要求</span>
                <span className="config-value">websocket 模式仅要求本机可访问飞书公网</span>
              </div>
              <div className="config-row">
                <span className="config-label">消息订阅</span>
                <span className="config-value">需启用 `im.message.receive_v1` 事件</span>
              </div>
              <div className="config-row">
                <span className="config-label">兼容模式</span>
                <span className="config-value">仅当连接模式切到 webhook 才需要 URL：{feishuStatus?.webhookUrlTemplate || 'https://your-host/api/channels/feishu/webhook'}</span>
              </div>
              <div className="config-row">
                <span className="config-label">默认安全策略</span>
                <span className="config-value">私信默认 pairing，未审批前不会进入主执行链路</span>
              </div>
            </div>

            <div className="config-section">
              <div className="config-section-title">配对审批</div>
              {feishuPairings.length === 0 ? (
                <div className="config-value">暂无待审批配对请求</div>
              ) : (
                <div className="config-pairing-table">
                  {feishuPairings.map((item) => (
                    <div className="config-row" key={`${item.code}-${item.createdAt}`}>
                      <span className="config-label">{item.openId} / {item.code}</span>
                      <span className="config-value">{new Date(item.createdAt).toLocaleString()}</span>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => handlePairingDecision(item.code, 'approve')}>批准</button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => handlePairingDecision(item.code, 'reject')}>拒绝</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="config-section">
              <div className="config-section-title">绑定账号（脱敏）</div>
              {feishuBoundUsers.length === 0 ? (
                <div className="config-value">暂无已绑定账号</div>
              ) : (
                feishuBoundUsers.map((u) => (
                  <div className="config-row" key={`${u.openId}-${u.boundAt}`}>
                    <span className="config-label">{u.openId}</span>
                    <span className="config-value">{new Date(u.boundAt).toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {settingsTab === 'rdkclaw' && (
          <>
            {rdkclawLoading ? (
              <div className="config-section"><div className="config-value">加载中...</div></div>
            ) : (
              <>
                <div className="config-section">
                  <div className="config-section-title">人格设定 (Persona)</div>
                  <div className="config-row">
                    <span className="config-label">名称</span>
                    <div className="config-value">
                      <input className="input" title="Agent 名称" aria-label="Agent 名称" value={persona.name} onChange={e => setPersona(p => ({ ...p, name: e.target.value }))} placeholder="RDKClaw" />
                    </div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">语气风格</span>
                    <div className="config-value">
                      <select className="select" title="语气风格" aria-label="语气风格" value={persona.tone} onChange={e => setPersona(p => ({ ...p, tone: e.target.value as PersonaProfile['tone'] }))}>
                        <option value="professional">专业严谨</option>
                        <option value="friendly">友好亲切</option>
                        <option value="concise">精炼简洁</option>
                        <option value="mentor">导师指导</option>
                      </select>
                    </div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">自定义人格 Prompt</span>
                    <div className="config-value">
                      <textarea className="input" title="自定义 Prompt" aria-label="自定义 Prompt" rows={3} value={persona.stylePrompt} onChange={e => setPersona(p => ({ ...p, stylePrompt: e.target.value }))} placeholder="可选：给 Agent 添加额外人格指令，如「回答尽量使用中文，代码注释用英文」" style={{ resize: 'vertical', minHeight: 60 }} />
                    </div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">风险倾向</span>
                    <div className="config-value">
                      <select className="select" title="风险倾向" aria-label="风险倾向" value={persona.riskLevel} onChange={e => setPersona(p => ({ ...p, riskLevel: e.target.value as PersonaProfile['riskLevel'] }))}>
                        <option value="conservative">保守 — 优先安全</option>
                        <option value="balanced">均衡 — 安全与效率兼顾</option>
                        <option value="aggressive">激进 — 效率优先</option>
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
                        <option value="local-first">Studio 优先</option>
                        <option value="balanced">均衡</option>
                        <option value="board-first">板端优先</option>
                      </select>
                    </div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">板端委派偏好</span>
                    <div className="config-value">
                      <select className="select" title="板端委派偏好" aria-label="板端委派偏好" value={persona.boardDelegationBias} onChange={e => setPersona(p => ({ ...p, boardDelegationBias: e.target.value as PersonaProfile['boardDelegationBias'] }))}>
                        <option value="low">低 — 尽量本地</option>
                        <option value="medium">中 — 智能判断</option>
                        <option value="high">高 — 积极委派板端</option>
                      </select>
                    </div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">风险边界</span>
                    <div className="config-value">
                      <select className="select" title="风险边界" aria-label="风险边界" value={persona.riskBoundary} onChange={e => setPersona(p => ({ ...p, riskBoundary: e.target.value as PersonaProfile['riskBoundary'] }))}>
                        <option value="strict">严格 — 不执行破坏性操作</option>
                        <option value="moderate">适度 — 破坏性操作需确认</option>
                        <option value="relaxed">宽松 — 信任 Agent 判断</option>
                      </select>
                    </div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">通知风格</span>
                    <div className="config-value">
                      <select className="select" title="通知风格" aria-label="通知风格" value={persona.notifyStyle} onChange={e => setPersona(p => ({ ...p, notifyStyle: e.target.value as PersonaProfile['notifyStyle'] }))}>
                        <option value="compact">精简</option>
                        <option value="detailed">详细</option>
                      </select>
                    </div>
                  </div>
                  <div className="config-actions">
                    <button type="button" className="btn btn-primary" onClick={handleSavePersona} disabled={rdkclawSaving}>
                      {rdkclawSaving ? '保存中...' : '保存人格设定'}
                    </button>
                  </div>
                </div>

                <div className="config-section">
                  <div className="config-section-title">审批策略</div>
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
                  <div className="config-section-title">委派策略</div>
                  <div className="config-row">
                    <span className="config-label">执行策略</span>
                    <div className="config-value">
                      <select className="select" title="委派策略" aria-label="委派策略" value={policy.delegation.strategy} onChange={e => setPolicy(p => ({ ...p, delegation: { ...p.delegation, strategy: e.target.value as RDKClawPolicy['delegation']['strategy'] } }))}>
                        <option value="local-first">本地优先</option>
                        <option value="board-first">板端优先</option>
                        <option value="hybrid">智能混合</option>
                      </select>
                    </div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">允许板端自动执行</span>
                    <input type="checkbox" title="允许板端自动执行" aria-label="允许板端自动执行" checked={policy.delegation.allowBoardAuto} onChange={e => setPolicy(p => ({ ...p, delegation: { ...p.delegation, allowBoardAuto: e.target.checked } }))} />
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
                    <span className="config-label">每日记忆保留天数</span>
                    <div className="config-value">
                      <input type="number" className="input" title="记忆天数" aria-label="记忆天数" value={policy.memory.dailyMemoryDays} onChange={e => setPolicy(p => ({ ...p, memory: { ...p.memory, dailyMemoryDays: Number(e.target.value) || 7 } }))} min={1} max={90} style={{ maxWidth: 100 }} />
                    </div>
                  </div>
                </div>

                <div className="config-section">
                  <div className="config-section-title">调度配置</div>
                  <div className="config-row">
                    <span className="config-label">默认任务通道</span>
                    <div className="config-value">
                      <select className="select" title="默认通道" aria-label="默认通道" value={policy.scheduler.defaultChannel} onChange={e => setPolicy(p => ({ ...p, scheduler: { ...p.scheduler, defaultChannel: e.target.value as 'chat' | 'feishu' } }))}>
                        <option value="chat">Studio 聊天</option>
                        <option value="feishu">飞书</option>
                      </select>
                    </div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">允许秒级调度间隔</span>
                    <input type="checkbox" title="秒级调度" aria-label="秒级调度" checked={policy.scheduler.allowSecondInterval} onChange={e => setPolicy(p => ({ ...p, scheduler: { ...p.scheduler, allowSecondInterval: e.target.checked } }))} />
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
                    <div className="config-value">
                      <input type="number" className="input" title="抓取上限" aria-label="抓取上限" value={policy.network.maxFetchChars} onChange={e => setPolicy(p => ({ ...p, network: { ...p.network, maxFetchChars: Number(e.target.value) || 30000 } }))} min={1000} max={200000} style={{ maxWidth: 120 }} />
                    </div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">联网需人工审批</span>
                    <input type="checkbox" title="联网需审批" aria-label="联网需审批" checked={policy.network.requireApproval} onChange={e => setPolicy(p => ({ ...p, network: { ...p.network, requireApproval: e.target.checked } }))} />
                  </div>
                  <div className="config-actions">
                    <button type="button" className="btn btn-primary" onClick={handleSavePolicy} disabled={rdkclawSaving}>
                      {rdkclawSaving ? '保存中...' : '保存执行策略'}
                    </button>
                    <span className="config-label-hint">策略保存在本地 ~/.rdkstudio/rdkclaw-policy.json</span>
                  </div>
                </div>

                <div className="config-section">
                  <div className="config-section-title">论坛账号管理（SSO / 发帖）</div>
                  <div className="config-row">
                    <span className="config-label">当前论坛用户</span>
                    <span className="config-value">{forumAuth.username || '未配置'}</span>
                  </div>
                  <div className="config-row">
                    <span className="config-label">已保存密码</span>
                    <span className="config-value">{forumAuth.hasPassword ? '是' : '否'}</span>
                  </div>
                  <div className="config-row">
                    <span className="config-label">已保存 Cookie</span>
                    <span className="config-value">{forumAuth.hasCookie ? '是' : '否'}</span>
                  </div>
                  <div className="config-row">
                    <span className="config-label">API Key 模式</span>
                    <span className="config-value">
                      {forumAuth.hasApiKey && forumAuth.hasApiUsername ? '已配置' : '未配置'}
                    </span>
                  </div>
                  <div className="config-row">
                    <span className="config-label">论坛用户名</span>
                    <div className="config-value">
                      <input
                        type="text"
                        className="input"
                        title="论坛用户名"
                        aria-label="论坛用户名"
                        placeholder="qiaolongli"
                        value={forumUsernameInput}
                        onChange={(e) => setForumUsernameInput(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">论坛密码</span>
                    <div className="config-value">
                      <input
                        type="password"
                        className="input"
                        title="论坛密码"
                        aria-label="论坛密码"
                        placeholder="请输入论坛密码"
                        value={forumPasswordInput}
                        onChange={(e) => setForumPasswordInput(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="config-row">
                    <span className="config-label">论坛 Cookie（可选）</span>
                    <div className="config-value">
                      <textarea
                        className="input"
                        title="论坛 Cookie"
                        aria-label="论坛 Cookie"
                        rows={2}
                        value={forumCookieInput}
                        onChange={(e) => setForumCookieInput(e.target.value)}
                        placeholder="_forum_session=...; other_cookie=..."
                      />
                    </div>
                  </div>
                  <div className="config-actions">
                    <button type="button" className="btn btn-primary" onClick={handleSaveForumCredential} disabled={forumSaving}>
                      {forumSaving ? '保存中...' : '保存账号密码'}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={handleSaveForumCookie} disabled={forumSaving}>
                      保存 Cookie
                    </button>
                    <button type="button" className="btn btn-danger" onClick={handleClearForumAuth} disabled={forumSaving}>
                      清空论坛认证
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => refreshRdkclawData().catch(() => addToast('刷新论坛认证状态失败', 'error'))} disabled={forumSaving}>
                      刷新状态
                    </button>
                  </div>
                  <span className="config-label-hint">
                    保存后即可让 RDKClaw 尝试通过 SSO 访问论坛并执行发帖流程；重启服务后运行态凭据会失效。
                  </span>
                </div>
              </>
            )}
          </>
        )}

        {settingsTab === 'about' && (
          <>
            <div className="config-section">
              <div className="config-section-title">版本信息</div>
              <div className="config-row">
                <span className="config-label">RDK Studio</span>
                <span className="config-value">v0.2.0 (Preview)</span>
              </div>
              <div className="config-row">
                <span className="config-label">前端框架</span>
                <span className="config-value">React 19 + Vite 6</span>
              </div>
              <div className="config-row">
                <span className="config-label">目标固件</span>
                <span className="config-value">RDK OS 2.x</span>
              </div>
            </div>
            <div className="config-section">
              <div className="usage-item">
                <strong>开源地址</strong>
                <span>github.com/RDKStudio — 欢迎反馈与贡献</span>
              </div>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
