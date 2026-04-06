import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { fillTemplate } from '../i18n/en-extras';
import { useI18n } from '../i18n/use-i18n';
import { useDeviceStore } from '../hooks/useDeviceStore';
import { isDeviceShownOnline } from '../utils/device-connection';
import { useToastStore } from '../hooks/useToastStore';
import { useAuth } from '../hooks/useAuth';
import { executeDeviceCommand } from '../api';
import { fetchWifiLinkState } from '../utils/wifi-link-probe';
import WifiConfigModal from './wifi/WifiConfigModal';
import { DEVICE_POLL_PHASE_TOPBAR_WIFI_MS, TOPBAR_WIFI_LINK_POLL_MS } from '../constants';

function parseIpBrOutput(output: string): { iface: string; ip: string }[] {
  const out: { iface: string; ip: string }[] = [];
  for (const line of output.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;
    const iface = parts[0];
    if (iface === 'lo') continue;
    for (let i = 1; i < parts.length; i++) {
      const ip = parts[i].split('/')[0];
      if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        out.push({ iface, ip });
        break;
      }
    }
  }
  return out;
}

function parseHostnameI(output: string): { iface: string; ip: string }[] {
  const ips = output.trim().split(/\s+/).filter(Boolean);
  const out: { iface: string; ip: string }[] = [];
  for (const raw of ips) {
    const ip = raw.split('%')[0].split('/')[0];
    if (ip && /^[\d.]+$/.test(ip) && ip !== '127.0.0.1') {
      out.push({ iface: `addr${out.length + 1}`, ip });
    }
  }
  return out;
}

/**
 * 解析 net-tools / BusyBox 等 `ifconfig -a` 文本输出（套件端常见）。
 * 支持：「inet addr:」「inet 192.168.x.x」「inet 192.168.x.x/24」等 IPv4 行。
 */
function parseIfconfigOutput(output: string): { iface: string; ip: string }[] {
  const out: { iface: string; ip: string }[] = [];
  let iface: string | null = null;

  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;

    const mColon = trimmed.match(/^([a-zA-Z0-9._-]+):\s/);
    if (mColon) {
      iface = mColon[1] === 'lo' ? null : mColon[1];
      continue;
    }
    const mLink = trimmed.match(/^([a-zA-Z0-9._-]+)\s+Link encap:/i);
    if (mLink) {
      iface = mLink[1] === 'lo' ? null : mLink[1];
      continue;
    }

    if (!iface) continue;

    let ip: string | null = null;
    const mOld = trimmed.match(/inet\s+addr:\s*([0-9.]+)/);
    if (mOld) {
      ip = mOld[1];
    } else {
      const mNew = trimmed.match(/^inet\s+([0-9.]+)(?:\s|\/|$)/);
      if (mNew && !trimmed.startsWith('inet6')) ip = mNew[1];
    }
    if (ip && ip !== '127.0.0.1' && /^[\d.]+$/.test(ip)) {
      out.push({ iface, ip });
    }
  }

  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.iface}\0${r.ip}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

type BoardIpDevice = { id: string; ip?: string };

async function tryExec(deviceId: string, command: string): Promise<string | null> {
  try {
    const res = await executeDeviceCommand(deviceId, command);
    return res.output || '';
  } catch {
    return null;
  }
}

/** 纯拉取逻辑，供 effect / 刷新按钮复用；不在此处弹 Toast，避免依赖变化导致重复触发 */
export type BoardIpWarn = 'studio' | 'none' | null;

async function fetchBoardIpRows(device: BoardIpDevice): Promise<{
  rows: { iface: string; ip: string }[];
  warn: BoardIpWarn;
}> {
  let rows: { iface: string; ip: string }[] = [];

  const ipOut = await tryExec(device.id, 'ip -br -4 addr show scope global 2>/dev/null || true');
  if (ipOut !== null) rows = parseIpBrOutput(ipOut);

  if (rows.length === 0) {
    const ifOut = await tryExec(
      device.id,
      '(ifconfig -a 2>/dev/null || /sbin/ifconfig -a 2>/dev/null || busybox ifconfig -a 2>/dev/null || true)',
    );
    if (ifOut !== null) rows = parseIfconfigOutput(ifOut);
  }

  if (rows.length === 0) {
    const hnOut = await tryExec(device.id, 'hostname -I 2>/dev/null || true');
    if (hnOut !== null) rows = parseHostnameI(hnOut);
  }

  const hadBoardParse = rows.length > 0;
  const studioIp = device.ip?.trim();
  if (studioIp && !rows.some((r) => r.ip === studioIp)) {
    rows = [{ iface: 'studio', ip: studioIp }, ...rows];
  }

  const warn: BoardIpWarn =
    !hadBoardParse && !!studioIp
      ? 'studio'
      : !hadBoardParse && !studioIp
      ? 'none'
      : null;

  return { rows, warn };
}

/** 与 server/sso `formatConversationArchiveUserName` 展示策略一致：姓名 → 邮箱前缀 → 账户 id */
function getSsoDisplayLabel(user: { name?: string; email?: string; id?: string }): string {
  const name = String(user.name || '').trim();
  if (name) return name;
  const email = String(user.email || '').trim();
  if (email) {
    const at = email.indexOf('@');
    if (at > 0) return email.slice(0, at);
    return email;
  }
  const id = String(user.id || '').trim();
  if (id) return id.length > 36 ? `${id.slice(0, 14)}…${id.slice(-10)}` : id;
  return '';
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** 与 SsoLoginScreen 一致：无 OAuth 链接时的门户兜底 */
const SSO_FALLBACK_PORTAL = 'https://sso.d-robotics.cc/';

function openSsoLoginPortal(loginUrl: string | null): void {
  if (window.rdkDesktop?.openSsoLoginWindow) {
    void window.rdkDesktop.openSsoLoginWindow();
    return;
  }
  const url = (loginUrl && loginUrl.trim()) || SSO_FALLBACK_PORTAL;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export default function TopToolbar() {
  const { currentDevice } = useDeviceStore();
  const { addToast } = useToastStore();
  const { ssoEnabled, user, logout, loginUrl } = useAuth();
  const { t } = useI18n();
  const tf = (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars);
  const [copied, setCopied] = useState(false);
  const [showWifiModal, setShowWifiModal] = useState(false);
  /** WiFi 链路状态：仅作顶栏颜色提示；未知时不染色 */
  const [wifiLink, setWifiLink] = useState<'up' | 'down' | null>(null);
  const [wifiConnectedSsid, setWifiConnectedSsid] = useState<string | undefined>();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showIpMenu, setShowIpMenu] = useState(false);
  const [ipRows, setIpRows] = useState<{ iface: string; ip: string }[]>([]);
  const [ipLoading, setIpLoading] = useState(false);
  const [ipListWarn, setIpListWarn] = useState<BoardIpWarn>(null);
  const ipWrapRef = useRef<HTMLDivElement | null>(null);
  const ssoChipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showIpMenu || !currentDevice) return;
    let cancelled = false;
    const dev: BoardIpDevice = { id: currentDevice.id, ip: currentDevice.ip };
    setIpLoading(true);
    setIpListWarn(null);
    void fetchBoardIpRows(dev).then(({ rows, warn }) => {
      if (cancelled) return;
      setIpRows(rows);
      setIpListWarn(warn);
      setIpLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [showIpMenu, currentDevice?.id, currentDevice?.ip]);

  const refreshIpListManual = () => {
    if (!currentDevice) return;
    setIpLoading(true);
    setIpListWarn(null);
    void fetchBoardIpRows({ id: currentDevice.id, ip: currentDevice.ip }).then(({ rows, warn }) => {
      setIpRows(rows);
      setIpListWarn(warn);
      setIpLoading(false);
    });
  };

  useEffect(() => {
    if (!currentDevice || !isDeviceShownOnline(currentDevice)) {
      setWifiLink(null);
      setWifiConnectedSsid(undefined);
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const run = () => {
      if (inFlight) return;
      inFlight = true;
      void fetchWifiLinkState(currentDevice.id)
        .then((r) => {
          if (cancelled) return;
          // 顶栏只负责“是否在线”颜色：null 也按 down 处理，避免断网后长期灰色不变。
          setWifiLink(r.state === 'up' ? 'up' : 'down');
          setWifiConnectedSsid(r.state === 'up' ? r.connectedSsid : undefined);
        })
        .catch(() => {
          if (cancelled) return;
          setWifiLink('down');
          setWifiConnectedSsid(undefined);
        })
        .finally(() => {
          inFlight = false;
        });
    };
    // 顶栏网络状态需要高频刷新：优先 3s 级别，且首次立即探测。
    const pollMs = Math.min(TOPBAR_WIFI_LINK_POLL_MS, 3000);
    let id: number | null = null;
    run();
    id = window.setInterval(run, pollMs);
    return () => {
      cancelled = true;
      if (id) window.clearInterval(id);
    };
  }, [currentDevice?.id, currentDevice?.status, currentDevice?.sshSessionVerified]);

  useEffect(() => {
    if (!showIpMenu) return;
    const close = (e: MouseEvent) => {
      if (ipWrapRef.current && !ipWrapRef.current.contains(e.target as Node)) {
        setShowIpMenu(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showIpMenu]);

  useEffect(() => {
    if (!showUserMenu) return;
    const close = (e: MouseEvent) => {
      if (ssoChipRef.current && !ssoChipRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showUserMenu]);

  const handleCopyIp = async (ip: string) => {
    const ok = await copyToClipboard(ip);
    if (ok) {
      setCopied(true);
      addToast(tf('topbar.ip.copied', '已复制 {{ip}}', { ip }), 'success');
      setTimeout(() => setCopied(false), 2000);
    } else {
      addToast(t('topbar.ip.copyFail', '复制失败，请手动选择文本'), 'warning');
    }
  };

  const studioIp = currentDevice?.ip?.trim() ?? '';
  const wifiStatusUnknown =
    wifiLink === null &&
    !!currentDevice &&
    isDeviceShownOnline(currentDevice);

  return (
    <>
      <div className="topbar-ip-wrap" ref={ipWrapRef}>
        <button
          type="button"
          className="btn-icon"
          title={studioIp ? t('topbar.ip.titleOn', '网络地址：单击展开多网卡列表，快速复制见菜单内') : t('topbar.ip.titleOff', '未连接设备')}
          onClick={() => {
            if (!currentDevice) return;
            setShowIpMenu((v) => !v);
          }}
          disabled={!currentDevice}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {copied
              ? <path d="M20 6L9 17l-5-5" />
              : <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></>}
          </svg>
        </button>
        {showIpMenu && currentDevice && (
          <div className="topbar-ip-menu">
            <div className="topbar-ip-menu-hint">
              {t(
                'topbar.ip.hint',
                '列表由套件端 `ip -br` 与 `ifconfig -a` 解析 IPv4（wlan0 / eth0 等），必要时回退 `hostname -I`。点击「复制」写入剪贴板。',
              )}
            </div>
            {ipListWarn && (
              <div className="topbar-ip-warn" role="status">
                {ipListWarn === 'studio'
                  ? t('topbar.ip.warnStudio', '无法从套件端解析 IPv4 地址，已仅显示当前连接 IP（可点刷新重试）')
                  : t('topbar.ip.warnNone', '无法获取设备 IP 地址')}
              </div>
            )}
            {ipLoading && <div className="topbar-ip-row" style={{ color: 'var(--text-muted)' }}>{t('topbar.ip.loading', '正在读取网卡…')}</div>}
            {!ipLoading && ipRows.length === 0 && (
              <div className="topbar-ip-row" style={{ color: 'var(--text-muted)' }}>{t('topbar.ip.empty', '未获取到地址')}</div>
            )}
            {ipRows.map((row) => (
              <div
                key={`${row.iface}-${row.ip}`}
                className={`topbar-ip-row ${row.ip === studioIp ? 'is-current' : ''}`}
              >
                <span className="topbar-ip-iface" title={row.iface}>
                  {row.iface === 'studio' ? t('topbar.ip.studioIface', '已连接') : row.iface}
                </span>
                <span className="topbar-ip-val" title={row.ip}>{row.ip}</span>
                <button
                  type="button"
                  className="topbar-ip-copy"
                  onClick={() => { void handleCopyIp(row.ip); }}
                >
                  {t('topbar.ip.copy', '复制')}
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={refreshIpListManual}>
                {t('topbar.ip.refresh', '刷新列表')}
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        className={`btn-icon topbar-wifi-btn${wifiLink === 'up' ? ' topbar-wifi-btn--up' : ''}${wifiLink === 'down' ? ' topbar-wifi-btn--down topbar-wifi-btn--alert' : ''}${wifiStatusUnknown ? ' topbar-wifi-btn--unknown' : ''}`}
        title={
          wifiLink === 'up'
            ? (wifiConnectedSsid
                ? tf('topbar.wifi.titleConnectedSsid', 'WiFi 已连接：{{ssid}}（点击配置）', { ssid: wifiConnectedSsid })
                : t('topbar.wifi.titleConnected', 'WiFi 已连接（点击配置）'))
            : wifiLink === 'down'
              ? t('topbar.wifi.titleDisconnected', '⚠ 开发者套件未联网 — AI 对话等功能不可用，点击配置 WiFi')
              : wifiStatusUnknown
                ? t('topbar.wifi.titleUnknown', '无法判断 WiFi 是否已连接（点击配置或重试探测）')
                : t('topbar.wifi.title', '配置 WiFi')
        }
        onClick={() => setShowWifiModal(true)}
        disabled={!currentDevice}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12.55a11 11 0 0114.08 0" /><path d="M1.42 9a16 16 0 0121.16 0" /><path d="M8.53 16.11a6 6 0 016.95 0" /><circle cx="12" cy="20" r="1" />
        </svg>
      </button>

      <div className="sso-user-chip" ref={ssoChipRef} style={{ position: 'relative' }}>
        <button
          type="button"
          className="btn-icon sso-avatar-btn"
          title={
            user
              ? (getSsoDisplayLabel(user) || user.email || user.id)
              : ssoEnabled
                ? t('topbar.user.signInTitle', '点击登录')
                : t('topbar.user.accountTitle', '账户')
          }
          onClick={() => setShowUserMenu(v => !v)}
        >
          {user?.avatar ? (
            <img src={user.avatar} alt="" style={{ width: 22, height: 22, borderRadius: '50%' }} />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
          >
            {user ? (
              <>
                <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {getSsoDisplayLabel(user) || t('topbar.user.fallback', '用户')}
                  </div>
                  {user.email && <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>{user.email}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowUserMenu(false);
                    void logout();
                  }}
                  style={{
                    display: 'block', width: '100%', padding: '8px 16px', textAlign: 'left',
                    fontSize: '0.8125rem', color: 'var(--text-secondary)', cursor: 'pointer',
                    background: 'transparent', border: 'none',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-inset)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {t('topbar.user.logout', '退出登录')}
                </button>
              </>
            ) : (
              <>
                <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {t('topbar.user.guestHint', '未登录')}
                  </div>
                  {!ssoEnabled && (
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.35 }}>
                      {t('topbar.user.ssoDisabledHint', '当前环境未启用统一登录；仍可打开认证页。')}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowUserMenu(false);
                    openSsoLoginPortal(loginUrl);
                  }}
                  style={{
                    display: 'block', width: '100%', padding: '8px 16px', textAlign: 'left',
                    fontSize: '0.8125rem', color: 'var(--text-secondary)', cursor: 'pointer',
                    background: 'transparent', border: 'none',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-inset)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {t('topbar.user.signIn', '登录')}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {showWifiModal && createPortal(
        <WifiConfigModal
          onClose={() => setShowWifiModal(false)}
          onConnected={() => {
            if (currentDevice) {
              void fetchWifiLinkState(currentDevice.id).then((r) => {
                setWifiLink(r.state === 'up' ? 'up' : 'down');
                setWifiConnectedSsid(r.state === 'up' ? r.connectedSsid : undefined);
              });
            }
          }}
        />,
        document.body,
      )}
    </>
  );
}
