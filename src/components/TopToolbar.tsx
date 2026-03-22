import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import WifiConfigModal from './wifi/WifiConfigModal';

export default function TopToolbar() {
  const { currentDevice } = useAppState();
  const [copied, setCopied] = useState(false);
  const [showWifiModal, setShowWifiModal] = useState(false);

  const handleCopyIp = () => {
    if (currentDevice?.ip) {
      navigator.clipboard.writeText(currentDevice.ip);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <button
        className="btn-icon"
        title={currentDevice?.ip ? `复制 IP: ${currentDevice.ip}` : '未连接设备'}
        onClick={handleCopyIp}
        disabled={!currentDevice?.ip}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {copied
            ? <path d="M20 6L9 17l-5-5" />
            : <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></>
          }
        </svg>
      </button>

      <button
        className="btn-icon"
        title="配置 WiFi"
        onClick={() => setShowWifiModal(true)}
        disabled={!currentDevice}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.55a11 11 0 0114.08 0" /><path d="M1.42 9a16 16 0 0121.16 0" /><path d="M8.53 16.11a6 6 0 016.95 0" /><circle cx="12" cy="20" r="1" />
        </svg>
      </button>

      {showWifiModal && <WifiConfigModal onClose={() => setShowWifiModal(false)} />}
    </>
  );
}
