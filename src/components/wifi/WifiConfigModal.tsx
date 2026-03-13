import { useState } from 'react';

export default function WifiConfigModal({ onClose }: { onClose: () => void }) {
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    // TODO: 调用后端接口进行真实的 WiFi 连接
    await new Promise(res => setTimeout(res, 2000));
    setConnecting(false);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="add-device-modal" onClick={e => e.stopPropagation()}>
        <div className="adm-header">
          <div className="adm-header-left">
            <div className="adm-title">配置 WiFi 连接</div>
            <div className="adm-subtitle">为设备连接至外部无线网络</div>
          </div>
          <button className="adm-close" onClick={onClose}>×</button>
        </div>

        <div className="adm-body">
          <label className="adm-field">
            <span className="adm-field-label">WiFi 名称 (SSID)</span>
            <input 
              className="adm-input" 
              type="text" 
              value={ssid} 
              onChange={e => setSsid(e.target.value)} 
              placeholder="例如：MyHomeRouter"
            />
          </label>
          <label className="adm-field">
            <span className="adm-field-label">密码 (Password)</span>
            <input 
              className="adm-input" 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              placeholder="暂不填或输入网络密码"
            />
          </label>
          <div className="adm-field-hint">
            连接时可能短暂断开当前网络，请耐心等待重连。
          </div>

          <div className="adm-nav">
            <button className="adm-nav-btn secondary" onClick={onClose}>
              取消
            </button>
            <button className="adm-nav-btn primary" onClick={handleConnect} disabled={!ssid || connecting}>
              {connecting ? '正在连接...' : '连接网络'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}