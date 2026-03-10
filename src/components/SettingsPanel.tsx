import { useAppState } from '../hooks/useAppState';

export default function SettingsPanel() {
  const {
    showSettings, setShowSettings, settingsTab, setSettingsTab,
    language, setLanguage, autoReconnect, setAutoReconnect,
    connectionTimeout, setConnectionTimeout, addToast,
  } = useAppState();

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
          {([['general', '通用'], ['connection', '连接'], ['about', '关于']] as const).map(([key, label]) => (
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
