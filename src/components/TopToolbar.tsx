import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppState } from '../hooks/useAppState';
import { useAuth } from '../hooks/useAuth';
import WifiConfigModal from './wifi/WifiConfigModal';

export default function TopToolbar() {
  const { currentDevice } = useAppState();
  const { ssoEnabled, user, logout } = useAuth();
  const [copied, setCopied] = useState(false);
  const [showWifiModal, setShowWifiModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

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

      {ssoEnabled && user && (
        <div className="sso-user-chip" style={{ position: 'relative' }}>
          <button
            className="btn-icon sso-avatar-btn"
            title={`${user.name || user.email}`}
            onClick={() => setShowUserMenu(v => !v)}
          >
            {user.avatar ? (
              <img src={user.avatar} alt="" style={{ width: 22, height: 22, borderRadius: '50%' }} />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
            )}
          </button>
          {showUserMenu && (
            <div
              className="sso-user-menu"
              style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 6,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                padding: '8px 0', minWidth: 180, zIndex: 100,
              }}
              onMouseLeave={() => setShowUserMenu(false)}
            >
              <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>{user.name || 'User'}</div>
                {user.email && <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>{user.email}</div>}
              </div>
              <button
                onClick={logout}
                style={{
                  display: 'block', width: '100%', padding: '8px 16px', textAlign: 'left',
                  fontSize: '0.8125rem', color: 'var(--text-secondary)', cursor: 'pointer',
                  background: 'transparent', border: 'none',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-inset)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                退出登录
              </button>
            </div>
          )}
        </div>
      )}

      {showWifiModal && createPortal(
        <WifiConfigModal onClose={() => setShowWifiModal(false)} />,
        document.body,
      )}
    </>
  );
}
