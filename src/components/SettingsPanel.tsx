import { useEffect, useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { fetchAgentConfig, saveAgentConfig } from '../api';

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
          {([['general', '通用'], ['ai', 'AI 模型'], ['connection', '连接'], ['about', '关于']] as const).map(([key, label]) => (
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
                <select className="clean-input" style={{ width: '140px', padding: '8px' }} value={language} onChange={e => { setLanguage(e.target.value); addToast('语言偏好已保存', 'success'); }}>
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
                <input type="checkbox" checked={autoReconnect} onChange={e => { setAutoReconnect(e.target.checked); addToast('自动连接设置已更新', 'success'); }} style={{ accentColor: '#ff6b00', width: '18px', height: '18px' }} />
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
                <select className="clean-input" style={{ width: '180px', padding: '8px' }} value={aiProvider} onChange={e => setAiProvider(e.target.value)}>
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
                <input type="number" className="clean-input" style={{ width: '80px', padding: '8px' }} value={connectionTimeout} onChange={e => setConnectionTimeout(Number(e.target.value))} />
              </div>
              <div className="settings-row">
                <span className="settings-label">断线自动重连</span>
                <input type="checkbox" checked={autoReconnect} onChange={e => setAutoReconnect(e.target.checked)} style={{ accentColor: '#ff6b00', width: '18px', height: '18px' }} />
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
                <input type="checkbox" checked={true} readOnly style={{ accentColor: '#ff6b00', width: '18px', height: '18px' }} />
              </div>
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
