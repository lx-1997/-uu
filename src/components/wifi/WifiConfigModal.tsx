import { useState, useEffect, useCallback } from 'react';
import { fetchDeviceWifiList } from '../../api';
import { fetchApi } from '../../utils/apiBase';
import { useAppState } from '../../hooks/useAppState';
import { useI18n } from '../../i18n/use-i18n';
import { fillTemplate } from '../../i18n/en-extras';

export default function WifiConfigModal({ onClose }: { onClose: () => void }) {
  const { currentDevice, addToast } = useAppState();
  const { t } = useI18n();
  const tf = useCallback(
    (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars),
    [t],
  );
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [wifiList, setWifiList] = useState<string[]>([]);
  const [showPassword, setShowPassword] = useState(false);

  const [connectLog, setConnectLog] = useState('');

  const scanWifi = useCallback(async () => {
    if (!currentDevice) return;
    setScanning(true);
    try {
      const res = await fetchDeviceWifiList(currentDevice.id);
      const names = res.wifiNames?.filter(Boolean) || [];
      setWifiList(names);
    } catch {
      addToast(t('wifiModal.toast.scanFail', '扫描 WiFi 失败'), 'warning');
    } finally {
      setScanning(false);
    }
  }, [currentDevice, addToast, t]);

  useEffect(() => { scanWifi(); }, [scanWifi]);

  const handleConnect = async () => {
    if (!currentDevice || !ssid) return;
    setConnecting(true);
    setConnectLog('');
    try {
      const res = await fetchApi(`/api/devices/${currentDevice.id}/openclaw/wifi-connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wifiName: ssid, wifiPassword: password }),
      });
      const data = await res.json() as { ok: boolean; output?: string; error?: string };
      if (data.output) setConnectLog(data.output);
      if (data.ok) {
        addToast(tf('wifiModal.toast.connected', '已连接到 {{ssid}}', { ssid }), 'success');
        onClose();
      } else {
        addToast(data.error || data.output || t('wifiModal.toast.connectFail', 'WiFi 连接失败，请检查密码是否正确'), 'error');
      }
    } catch (e) {
      addToast(e instanceof Error ? e.message : t('wifiModal.toast.requestFail', 'WiFi 配置请求失败'), 'error');
    } finally {
      setConnecting(false);
    }
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
              {t('wifiModal.title', 'WiFi 配置')}
            </div>
            <div className="modal-subtitle">
              {tf('wifiModal.subtitle', '为 {{name}} 连接无线网络', {
                name: currentDevice?.name || t('wifiModal.subtitleFallback', '设备'),
              })}
            </div>
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
                <span className="wifi-list-title">
                  {t('wifiModal.networks', '可用网络')}
                  {wifiList.length > 0 ? ` (${wifiList.length})` : ''}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={scanWifi} disabled={scanning}>{scanning ? t('wifiModal.scanning', '扫描中...') : t('wifiModal.refresh', '刷新')}</button>
              </div>
              {scanning && wifiList.length === 0 ? (
                <div className="wifi-list-loading"><div className="spinner" /><span>{t('wifiModal.scanningList', '正在扫描...')}</span></div>
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
              <span>{t('wifiModal.empty', '未扫描到可用网络')}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={scanWifi}>{t('wifiModal.retry', '重试')}</button>
            </div>
          )}

          <div className="wifi-form">
            <div className="add-device-field">
              <label>{t('wifiModal.ssid', 'WiFi 名称 (SSID)')}</label>
              <input className="input" value={ssid} onChange={e => setSsid(e.target.value)} placeholder={t('wifiModal.ssidPh', '输入或从上方选择')} />
            </div>
            <div className="add-device-field">
              <label>{t('wifiModal.password', '密码')}</label>
              <div className="add-device-pass-wrap">
                <input className="input" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder={t('wifiModal.passwordPh', '无密码可留空')} />
                <button type="button" className="btn-icon add-device-pass-toggle" onClick={() => setShowPassword(v => !v)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {showPassword ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><line x1="1" y1="1" x2="23" y2="23"/></> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>}
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {connectLog && (
            <pre className="wifi-connect-log">{connectLog}</pre>
          )}

          <div className="wifi-hint">{t('wifiModal.hint', '连接时可能短暂断开当前 SSH 连接，请耐心等待设备重连。')}</div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('wifiModal.cancel', '取消')}</button>
            <button type="button" className="btn btn-primary" onClick={handleConnect} disabled={!ssid || connecting}>
              {connecting ? t('wifiModal.connecting', '连接中...') : t('wifiModal.connect', '连接网络')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
