import { useState } from 'react';
import { executeDeviceCommand } from '../../api';
import { useAppState } from '../../hooks/useAppState';

export default function WifiConfigModal({ onClose }: { onClose: () => void }) {
  const { currentDevice, addToast } = useAppState();
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    if (!currentDevice) {
      addToast('请先连接设备', 'warning');
      return;
    }

    setConnecting(true);
    const escapedSsid = ssid.replace(/"/g, '\\"');
    const escapedPass = password.replace(/"/g, '\\"');
    const cmd = password.trim()
      ? `bash -lc "nmcli dev wifi connect \"${escapedSsid}\" password \"${escapedPass}\" || (wpa_passphrase \"${escapedSsid}\" \"${escapedPass}\" | sudo tee /etc/wpa_supplicant/wpa_supplicant.conf >/dev/null && sudo wpa_cli -i wlan0 reconfigure)"`
      : `bash -lc "nmcli dev wifi connect \"${escapedSsid}\" || sudo nmcli dev wifi connect \"${escapedSsid}\""`;

    executeDeviceCommand(currentDevice.id, cmd)
      .then(() => {
        addToast('WiFi 配置命令已执行', 'success');
        onClose();
      })
      .catch((error) => {
        addToast(error instanceof Error ? error.message : 'WiFi 配置失败', 'error');
      })
      .finally(() => setConnecting(false));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">配置 WiFi 连接</div>
            <div>为设备连接至外部无线网络</div>
          </div>
          <button className="btn-icon" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <label className="config-row">
            <span className="config-label">WiFi 名称 (SSID)</span>
            <div className="config-value">
              <input
                className="input"
                type="text"
                value={ssid}
                onChange={e => setSsid(e.target.value)}
                placeholder="例如：MyHomeRouter"
              />
            </div>
          </label>
          <label className="config-row">
            <span className="config-label">密码 (Password)</span>
            <div className="config-value">
              <input
                className="input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="暂不填或输入网络密码"
              />
            </div>
          </label>
          <div>
            连接时可能短暂断开当前网络，请耐心等待重连。
          </div>

          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
            <button className="btn btn-primary" onClick={handleConnect} disabled={!ssid || connecting}>
              {connecting ? '正在连接...' : '连接网络'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
