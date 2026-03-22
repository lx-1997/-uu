import { useState, useEffect, useCallback } from 'react';
import { executeDeviceCommand, fetchDeviceWifiList } from '../../api';
import { useAppState } from '../../hooks/useAppState';

export default function WifiConfigModal({ onClose }: { onClose: () => void }) {
  const { currentDevice, addToast } = useAppState();
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [wifiList, setWifiList] = useState<string[]>([]);
  const [showPassword, setShowPassword] = useState(false);

  const scanWifi = useCallback(async () => {
    if (!currentDevice) return;
    setScanning(true);
    try {
      const res = await fetchDeviceWifiList(currentDevice.id);
      const names = res.wifiNames?.filter(Boolean) || [];
      if (names.length > 0) { setWifiList(names); setScanning(false); return; }
      const fallback = await executeDeviceCommand(
        currentDevice.id,
        'bash -lc "nmcli dev wifi list --rescan yes 2>/dev/null | tail -n +2 | awk \'{print $2}\' | sort -u | head -20"',
      );
      setWifiList(fallback.output.split('\n').map(l => l.trim()).filter(Boolean));
    } catch {
      addToast('扫描 WiFi 失败', 'warning');
    } finally {
      setScanning(false);
    }
  }, [currentDevice, addToast]);

  useEffect(() => { scanWifi(); }, [scanWifi]);

  const handleConnect = async () => {
    if (!currentDevice || !ssid) return;
    setConnecting(true);
    const esc = (s: string) => s.replace(/"/g, '\\"');
    const cmd = password.trim()
      ? `bash -lc "nmcli dev wifi connect \\"${esc(ssid)}\\" password \\"${esc(password)}\\" || (wpa_passphrase \\"${esc(ssid)}\\" \\"${esc(password)}\\" | sudo tee /etc/wpa_supplicant/wpa_supplicant.conf >/dev/null && sudo wpa_cli -i wlan0 reconfigure)"`
      : `bash -lc "nmcli dev wifi connect \\"${esc(ssid)}\\" || sudo nmcli dev wifi connect \\"${esc(ssid)}\\""`;
    executeDeviceCommand(currentDevice.id, cmd)
      .then(() => { addToast(`已连接到 ${ssid}`, 'success'); onClose(); })
      .catch(e => addToast(e instanceof Error ? e.message : 'WiFi 配置失败', 'error'))
      .finally(() => setConnecting(false));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content wifi-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.55a11 11 0 0114.08 0"/><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1"/>
              </svg>
              WiFi 配置
            </div>
            <div className="modal-subtitle">为 {currentDevice?.name || '设备'} 连接无线网络</div>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="modal-body">
          {/* Network list */}
          {(wifiList.length > 0 || scanning) && (
            <div className="wifi-list-section">
              <div className="wifi-list-header">
                <span className="wifi-list-title">可用网络 {wifiList.length > 0 && `(${wifiList.length})`}</span>
                <button className="btn btn-ghost btn-sm" onClick={scanWifi} disabled={scanning}>{scanning ? '扫描中...' : '刷新'}</button>
              </div>
              {scanning && wifiList.length === 0 ? (
                <div className="wifi-list-loading"><div className="spinner" /><span>正在扫描...</span></div>
              ) : (
                <div className="wifi-list-items">
                  {wifiList.map(name => (
                    <button
                      key={name}
                      className={`wifi-list-item ${ssid === name ? 'selected' : ''}`}
                      onClick={() => setSsid(name)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={ssid === name ? 'var(--accent)' : 'var(--text-muted)'} strokeWidth="2">
                        <path d="M5 12.55a11 11 0 0114.08 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1"/>
                      </svg>
                      <span>{name}</span>
                      {ssid === name && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {wifiList.length === 0 && !scanning && (
            <div className="wifi-list-empty">
              <span>未扫描到可用网络</span>
              <button className="btn btn-ghost btn-sm" onClick={scanWifi}>重试</button>
            </div>
          )}

          <div className="wifi-form">
            <div className="add-device-field">
              <label>WiFi 名称 (SSID)</label>
              <input className="input" value={ssid} onChange={e => setSsid(e.target.value)} placeholder="输入或从上方选择" />
            </div>
            <div className="add-device-field">
              <label>密码</label>
              <div className="add-device-pass-wrap">
                <input className="input" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="无密码可留空" />
                <button type="button" className="btn-icon add-device-pass-toggle" onClick={() => setShowPassword(v => !v)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {showPassword ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><line x1="1" y1="1" x2="23" y2="23"/></> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>}
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div className="wifi-hint">连接时可能短暂断开当前网络，请耐心等待重连。</div>

          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={onClose}>取消</button>
            <button className="btn btn-primary" onClick={handleConnect} disabled={!ssid || connecting}>
              {connecting ? '连接中...' : '连接网络'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
