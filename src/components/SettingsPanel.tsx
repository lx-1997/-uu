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
} from '../api';

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
    setAiSaving(true);
    try {
      await saveAgentConfig({
        provider: aiProvider,
        model: aiModel,
        apiKey: aiApiKey || undefined,
        baseUrl: aiBaseUrl || undefined,
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

  return (
    <>
      <div className="settings-overlay" onClick={() => setShowSettings(false)}></div>
      <div className="settings-panel">
        <div className="settings-header">
          <div className="settings-title">⚙️ 客户端设置</div>
          <button className="settings-close" onClick={() => setShowSettings(false)}>×</button>
        </div>

        <div className="segmented-row" style={{ marginBottom: '24px' }}>
          {([['general', '通用'], ['ai', 'AI 模型'], ['connection', '连接'], ['feishu', '飞书'], ['about', '关于']] as const).map(([key, label]) => (
            <button key={key} className={`segment-btn ${settingsTab === key ? 'active' : ''}`} onClick={() => setSettingsTab(key)}>
              {label}
            </button>
          ))}
        </div>

        {settingsTab === 'general' && (
          <div>
            <div className="settings-section">
              <div className="settings-section-title">界面</div>
              <div className="settings-row">
                <span className="settings-label">界面语言</span>
                <select className="clean-input" title="界面语言" aria-label="界面语言" style={{ width: '140px', padding: '8px' }} value={language} onChange={e => { setLanguage(e.target.value); addToast('语言偏好已保存', 'success'); }}>
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="settings-row">
                <span className="settings-label">主题配色</span>
                <span className="settings-value">白色 + 橙色 (默认)</span>
              </div>
              <div className="settings-row">
                <span className="settings-label">启动时自动连接上次设备</span>
                <input type="checkbox" title="启动时自动连接上次设备" aria-label="启动时自动连接上次设备" checked={autoReconnect} onChange={e => { setAutoReconnect(e.target.checked); addToast('自动连接设置已更新', 'success'); }} style={{ accentColor: '#ff6b00', width: '18px', height: '18px' }} />
              </div>
            </div>
          </div>
        )}

        {settingsTab === 'ai' && (
          <div>
            <div className="settings-section">
              <div className="settings-section-title">
                LLM Provider
                {aiConfigured && <span style={{ marginLeft: 8, color: '#22c55e', fontSize: 12 }}>● 已配置</span>}
              </div>
              <div className="settings-row">
                <span className="settings-label">服务商</span>
                <select className="clean-input" title="模型服务商" aria-label="模型服务商" style={{ width: '180px', padding: '8px' }} value={aiProvider} onChange={e => setAiProvider(e.target.value)}>
                  <option value="qwen">通义千问 (Qwen)</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai">OpenAI</option>
                  <option value="openai-compatible">OpenAI 兼容</option>
                </select>
              </div>
              <div className="settings-row">
                <span className="settings-label">模型名称</span>
                <input
                  type="text"
                  className="clean-input"
                  style={{ width: '220px', padding: '8px' }}
                  title="模型名称"
                  aria-label="模型名称"
                  placeholder={aiProvider === 'qwen' ? 'qwen3.5-plus' : aiProvider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini'}
                  value={aiModel}
                  onChange={e => setAiModel(e.target.value)}
                />
              </div>
              <div className="settings-row">
                <span className="settings-label">API Key</span>
                <input
                  type="password"
                  className="clean-input"
                  style={{ width: '260px', padding: '8px' }}
                  title="API Key"
                  aria-label="API Key"
                  placeholder={aiConfigured ? '••••••••（已保存，留空则不更新）' : '请输入 API Key'}
                  value={aiApiKey}
                  onChange={e => setAiApiKey(e.target.value)}
                />
              </div>
              {(aiProvider === 'openai-compatible') && (
                <div className="settings-row">
                  <span className="settings-label">Base URL</span>
                  <input
                    type="text"
                    className="clean-input"
                    style={{ width: '260px', padding: '8px' }}
                    title="Base URL"
                    aria-label="Base URL"
                    placeholder="https://your-api.example.com/v1"
                    value={aiBaseUrl}
                    onChange={e => setAiBaseUrl(e.target.value)}
                  />
                </div>
              )}
              <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
                <button
                  className="segment-btn active"
                  style={{ padding: '8px 24px' }}
                  onClick={handleSaveAiConfig}
                  disabled={aiSaving}
                >
                  {aiSaving ? '保存中...' : '保存配置'}
                </button>
                <span style={{ fontSize: 12, color: '#888' }}>
                  配置保存在本地 ~/.rdkstudio/agent-config.json
                </span>
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-section-title">使用说明</div>
              <div style={{ fontSize: 13, color: '#666', lineHeight: 1.8 }}>
                <p>配置 API Key 后，聊天框将使用 Agent 模式，AI 可以直接操控设备执行命令、读写文件、管理 ROS 节点等。</p>
                <p style={{ marginTop: 8 }}>推荐使用通义千问（免费额度大）或 DeepSeek（性价比高）。</p>
              </div>
            </div>
          </div>
        )}

        {settingsTab === 'connection' && (
          <div>
            <div className="settings-section">
              <div className="settings-section-title">SSH / SFTP</div>
              <div className="settings-row">
                <span className="settings-label">连接超时 (秒)</span>
                <input type="number" className="clean-input" title="连接超时秒数" aria-label="连接超时秒数" style={{ width: '80px', padding: '8px' }} value={connectionTimeout} onChange={e => setConnectionTimeout(Number(e.target.value))} />
              </div>
              <div className="settings-row">
                <span className="settings-label">断线自动重连</span>
                <input type="checkbox" title="断线自动重连" aria-label="断线自动重连" checked={autoReconnect} onChange={e => setAutoReconnect(e.target.checked)} style={{ accentColor: '#ff6b00', width: '18px', height: '18px' }} />
              </div>
              <div className="settings-row">
                <span className="settings-label">默认认证方式</span>
                <span className="settings-value">密码认证</span>
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-section-title">VNC</div>
              <div className="settings-row">
                <span className="settings-label">默认画质</span>
                <span className="settings-value">平衡模式</span>
              </div>
              <div className="settings-row">
                <span className="settings-label">自动适配分辨率</span>
                <input type="checkbox" title="自动适配分辨率" aria-label="自动适配分辨率" checked={true} readOnly style={{ accentColor: '#ff6b00', width: '18px', height: '18px' }} />
              </div>
            </div>
          </div>
        )}

        {settingsTab === 'feishu' && (
          <div>
            <div className="settings-section">
              <div className="settings-section-title">飞书运行状态（官方模式）</div>
              {feishuLoading ? (
                <div className="settings-value">加载中...</div>
              ) : (
                <>
                  <div className="settings-row">
                    <span className="settings-label">配置状态</span>
                    <span className="settings-value">
                      {feishuStatus?.configured ? '已配置 App ID / App Secret' : '未配置（需填写 App ID / App Secret）'}
                    </span>
                  </div>
                  <div className="settings-row">
                    <span className="settings-label">连接模式</span>
                    <span className="settings-value">{feishuStatus?.connectionMode === 'websocket' ? 'websocket (official)' : 'webhook (compat)'}</span>
                  </div>
                  <div className="settings-row">
                    <span className="settings-label">通道运行状态</span>
                    <span className="settings-value">
                      {feishuStatus?.runtime?.running ? (feishuStatus?.runtime?.connected ? '运行中（已连接）' : '运行中（等待事件）') : '已停止'}
                    </span>
                  </div>
                  <div className="settings-row">
                    <span className="settings-label">最近通道错误</span>
                    <span className="settings-value">{feishuStatus?.runtime?.lastError || '无'}</span>
                  </div>
                  <div className="settings-row">
                    <span className="settings-label">已绑定账号数</span>
                    <span className="settings-value">{feishuStatus?.boundUsers ?? 0}</span>
                  </div>
                  <div className="settings-row">
                    <span className="settings-label">待审批配对数</span>
                    <span className="settings-value">{feishuStatus?.pendingPairings ?? 0}</span>
                  </div>
                  <div className="settings-row">
                    <span className="settings-label">最近接收事件</span>
                    <span className="settings-value">
                      {feishuStatus?.lastEventAt ? new Date(feishuStatus.lastEventAt).toLocaleString() : '暂无'}
                    </span>
                  </div>
                  <div className="settings-row">
                    <button className="segment-btn" onClick={() => handleFeishuRuntime('start')}>启动</button>
                    <button className="segment-btn" onClick={() => handleFeishuRuntime('stop')}>停止</button>
                    <button className="segment-btn" onClick={() => handleFeishuRuntime('restart')}>重启</button>
                  </div>
                </>
              )}
            </div>

            <div className="settings-section">
              <div className="settings-section-title">飞书通道配置</div>
              <div className="settings-row">
                <span className="settings-label">启用飞书通道</span>
                <input type="checkbox" title="启用飞书通道" aria-label="启用飞书通道" checked={feishuEnabled} onChange={(e) => setFeishuEnabled(e.target.checked)} style={{ accentColor: '#ff6b00', width: '18px', height: '18px' }} />
              </div>
              <div className="settings-row">
                <span className="settings-label">连接模式</span>
                <select className="clean-input" title="飞书连接模式" aria-label="飞书连接模式" value={feishuConnectionMode} onChange={(e) => setFeishuConnectionMode(e.target.value as 'websocket' | 'webhook')}>
                  <option value="websocket">websocket (official)</option>
                  <option value="webhook">webhook (compat)</option>
                </select>
              </div>
              <div className="settings-row">
                <span className="settings-label">平台域名</span>
                <select className="clean-input" title="飞书平台域名" aria-label="飞书平台域名" value={feishuDomain} onChange={(e) => setFeishuDomain(e.target.value as 'feishu' | 'lark')}>
                  <option value="feishu">feishu</option>
                  <option value="lark">lark</option>
                </select>
              </div>
              <div className="settings-row">
                <span className="settings-label">私信策略</span>
                <select className="clean-input" title="私信策略" aria-label="私信策略" value={feishuDmPolicy} onChange={(e) => setFeishuDmPolicy(e.target.value as 'pairing' | 'allowlist' | 'open')}>
                  <option value="pairing">pairing（默认）</option>
                  <option value="allowlist">allowlist</option>
                  <option value="open">open</option>
                </select>
              </div>
              <div className="settings-row">
                <span className="settings-label">App ID</span>
                <input
                  type="text"
                  className="clean-input"
                  title="飞书 App ID"
                  aria-label="飞书 App ID"
                  placeholder="cli_xxx"
                  value={feishuAppId}
                  onChange={(e) => setFeishuAppId(e.target.value)}
                />
              </div>
              <div className="settings-row">
                <span className="settings-label">App Secret</span>
                <input
                  type="password"
                  className="clean-input"
                  title="飞书 App Secret"
                  aria-label="飞书 App Secret"
                  placeholder={feishuMasks.appSecretMasked ? `已配置：${feishuMasks.appSecretMasked}（留空不改）` : '请输入 App Secret'}
                  value={feishuAppSecret}
                  onChange={(e) => setFeishuAppSecret(e.target.value)}
                />
              </div>
              <div className="settings-row">
                <span className="settings-label">Verification Token</span>
                <input
                  type="password"
                  className="clean-input"
                  title="Verification Token"
                  aria-label="Verification Token"
                  placeholder={feishuMasks.verificationTokenMasked ? `已配置：${feishuMasks.verificationTokenMasked}（留空不改）` : '建议配置'}
                  value={feishuVerificationToken}
                  onChange={(e) => setFeishuVerificationToken(e.target.value)}
                />
              </div>
              <div className="settings-row">
                <span className="settings-label">Encrypt Key</span>
                <input
                  type="password"
                  className="clean-input"
                  title="Encrypt Key"
                  aria-label="Encrypt Key"
                  placeholder={feishuMasks.encryptKeyMasked ? `已配置：${feishuMasks.encryptKeyMasked}（留空不改）` : '建议配置（OpenClaw 推荐必填）'}
                  value={feishuEncryptKey}
                  onChange={(e) => setFeishuEncryptKey(e.target.value)}
                />
              </div>
              <div className="settings-row">
                <button className="segment-btn active" onClick={handleSaveFeishu} disabled={feishuSaving}>
                  {feishuSaving ? '保存中...' : '保存飞书配置'}
                </button>
                <span className="settings-value">保存到本地 ~/.rdkstudio/feishu-config.json</span>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">接入步骤（官方 WebSocket）</div>
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

            <div className="settings-section">
              <div className="settings-section-title">配置检查清单</div>
              <div className="settings-row">
                <span className="settings-label">网络要求</span>
                <span className="settings-value">websocket 模式仅要求本机可访问飞书公网</span>
              </div>
              <div className="settings-row">
                <span className="settings-label">消息订阅</span>
                <span className="settings-value">需启用 `im.message.receive_v1` 事件</span>
              </div>
              <div className="settings-row">
                <span className="settings-label">兼容模式</span>
                <span className="settings-value">仅当连接模式切到 webhook 才需要 URL：{feishuStatus?.webhookUrlTemplate || 'https://your-host/api/channels/feishu/webhook'}</span>
              </div>
              <div className="settings-row">
                <span className="settings-label">默认安全策略</span>
                <span className="settings-value">私信默认 pairing，未审批前不会进入主执行链路</span>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">配对审批</div>
              {feishuPairings.length === 0 ? (
                <div className="settings-value">暂无待审批配对请求</div>
              ) : (
                feishuPairings.map((item) => (
                  <div className="settings-row" key={`${item.code}-${item.createdAt}`}>
                    <span className="settings-label">{item.openId} / {item.code}</span>
                    <span className="settings-value">{new Date(item.createdAt).toLocaleString()}</span>
                    <button className="segment-btn" onClick={() => handlePairingDecision(item.code, 'approve')}>批准</button>
                    <button className="segment-btn" onClick={() => handlePairingDecision(item.code, 'reject')}>拒绝</button>
                  </div>
                ))
              )}
            </div>

            <div className="settings-section">
              <div className="settings-section-title">绑定账号（脱敏）</div>
              {feishuBoundUsers.length === 0 ? (
                <div className="settings-value">暂无已绑定账号</div>
              ) : (
                feishuBoundUsers.map((u) => (
                  <div className="settings-row" key={`${u.openId}-${u.boundAt}`}>
                    <span className="settings-label">{u.openId}</span>
                    <span className="settings-value">{new Date(u.boundAt).toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {settingsTab === 'about' && (
          <div>
            <div className="settings-section">
              <div className="settings-section-title">版本信息</div>
              <div className="settings-row">
                <span className="settings-label">RDK Studio</span>
                <span className="settings-value">v0.2.0 (Preview)</span>
              </div>
              <div className="settings-row">
                <span className="settings-label">前端框架</span>
                <span className="settings-value">React 19 + Vite 6</span>
              </div>
              <div className="settings-row">
                <span className="settings-label">目标固件</span>
                <span className="settings-value">RDK OS 2.x</span>
              </div>
            </div>
            <div className="usage-item" style={{ marginTop: '16px' }}>
              <strong>开源地址</strong>
              <span>github.com/RDKStudio — 欢迎反馈与贡献</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
