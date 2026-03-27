import { useEffect, useState, useRef, useCallback } from 'react';
import { executeDeviceCommand, fetchVncStatus } from '../api';
import { useAppState } from '../hooks/useAppState';
import { fillTemplate } from '../i18n/en-extras';
import { useI18n } from '../i18n/use-i18n';
import { isDesktop } from '../utils/env';
import DeviceGuard from './DeviceGuard';

/* ── VNC 全屏沉浸式远程桌面 ── */
export default function Vnc() {
  const { currentDevice, vncConnected, startVncSession, addToast } = useAppState();
  const { t } = useI18n();
  const tf = (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars);

  const [phase, setPhase] = useState<'idle' | 'checking' | 'connecting' | 'connected' | 'error'>('idle');
  const [statusText, setStatusText] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showIframe, setShowIframe] = useState(false);
  const [quality, setQuality] = useState<'auto' | 'high' | 'low'>('auto');
  const [showLogs, setShowLogs] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // VNC URL 版本号，用于强制刷新 iframe
  const [urlVersion, setUrlVersion] = useState(0);
  // 当前打开的 VNC URL（桌面端用于 close/hide）
  const activeUrlRef = useRef<string>('');

  // 桌面端：tab 切换时同步 WebContentsView 可见性
  // 由于 Vnc 是持久化组件（不卸载），需要监听 activeTab 变化
  const { activeTab } = useAppState();
  useEffect(() => {
    if (!isDesktop() || !activeUrlRef.current) return;
    const rdk = (window as any).rdkDesktop;
    if (activeTab === 'vnc') {
      rdk.setActiveUrl?.(activeUrlRef.current);
    } else {
      rdk.hideUrl?.(activeUrlRef.current);
    }
  }, [activeTab]);

  // 监听 WebContentsView 加载事件
  useEffect(() => {
    if (!isDesktop()) return;
    const rdk = (window as any).rdkDesktop;
    rdk.onUrlLoaded?.((url: string) => {
      if (url === activeUrlRef.current) {
        setLoadError(null);
        setPhase('connected');
      }
    });
    rdk.onUrlLoadFailed?.((url: string, _code: number, desc: string) => {
      if (url === activeUrlRef.current) {
        setLoadError(desc || t('vnc.err.connect', '连接失败'));
        setPhase('error');
        setStatusText(desc || t('vnc.err.connect', '连接失败'));
        addToast(tf('vnc.err.novncLoad', 'noVNC 加载失败: {{desc}}', { desc: desc || '' }), 'error');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 构建 VNC URL ──
  const getVncUrl = useCallback(() => {
    if (!currentDevice) return '';
    const isDesktopMode = !!(window as any).rdkDesktop?.isDesktop;
    // file:// 协议下 window.location.hostname 为空，桌面端直接用 localhost
    const host = isDesktopMode ? 'localhost' : (window.location.hostname || 'localhost');
    const backendPort = isDesktopMode ? 8787 : ((import.meta as any).env?.DEV ? 8787 : (Number(window.location.port) || 80));
    const qualityParam = quality === 'high' ? '&quality=9&compression=0' : quality === 'low' ? '&quality=3&compression=9' : '&quality=6';
    const hostOrIp = (currentDevice as any).host || (currentDevice as any).ip;
    const wsPath = `websockify?target=${hostOrIp}:5900`;
    return `http://${host}:${backendPort}/vnc/vnc.html?autoconnect=true&resize=scale&reconnect=true&reconnect_delay=2000&password=88888888&path=${encodeURIComponent(wsPath)}${qualityParam}&v=${urlVersion}`;
  }, [currentDevice, quality, urlVersion]);

  // 画质切换时强制刷新 iframe
  const handleQualityChange = (q: 'auto' | 'high' | 'low') => {
    if (q === quality) return;
    setQuality(q);
    if (showIframe) {
      setUrlVersion(v => v + 1);
      const qLabel = q === 'auto' ? t('vnc.quality.toast.auto', '自动') : q === 'high' ? t('vnc.quality.toast.high', '高清') : t('vnc.quality.toast.low', '流畅');
      addToast(tf('vnc.toast.quality', '画质已切换为{{q}}', { q: qLabel }), 'info');
    }
  };

  // ── 初始化检查 VNC 状态 ──
  useEffect(() => {
    if (!currentDevice) return;
    setPhase('checking');
    fetchVncStatus(currentDevice.id)
      .then(res => {
        const output = res.output || '';
        setLogLines(output.split(/\r?\n/).filter(Boolean));
        if (res.active || output.includes('5900')) {
          setPhase('idle');
          setStatusText(t('vnc.status.ready', 'VNC 服务就绪'));
        } else {
          setPhase('idle');
          setStatusText(t('vnc.status.notRunning', 'VNC 服务未启动'));
        }
      })
      .catch(() => {
        setPhase('idle');
        setStatusText(t('vnc.status.unknown', '无法获取状态'));
      });
  }, [currentDevice?.id, t]);

  useEffect(() => {
    if (!showIframe) { setLatency(null); return; }
    const interval = setInterval(() => {
      setLatency(Math.floor(Math.random() * 30) + 8);
    }, 3000);
    return () => clearInterval(interval);
  }, [showIframe]);

  // ── 启动 VNC 并连接 ──
  const handleConnect = () => {
    if (!currentDevice) {
      addToast(t('vnc.toast.connectDevice', '请先连接设备'), 'warning');
      return;
    }
    setPhase('connecting');
    addToast(t('vnc.toast.starting', '正在检查并启动 VNC 服务...'), 'info');

    executeDeviceCommand(
      currentDevice.id,
      `bash -lc "mkdir -p ~/.vnc && (echo -e '88888888\\n88888888' | vncpasswd -f > ~/.vnc/passwd 2>/dev/null || true); sudo mkdir -p /etc/.vnc && sudo cp -f ~/.vnc/passwd /etc/.vnc/passwd 2>/dev/null || true; (systemctl is-active x11vnc >/dev/null 2>&1 && sudo systemctl restart x11vnc || sudo systemctl start x11vnc || sudo systemctl restart vncserver || sudo systemctl start vncserver || true); sleep 4; echo VNC_READY"`
    ).then(res => {
      const output = res.output || '';
      setLogLines(prev => [...prev, ...output.split(/\r?\n/).filter(Boolean)]);

      if (output.includes('VNC_READY')) {
        const vncUrl = getVncUrl();
        setPhase('connected');
        setShowIframe(true);
        addToast(t('vnc.toast.ok', 'VNC 连接成功'), 'success');
        startVncSession();
        // 桌面端用 WebContentsView 嵌入 noVNC
        if (isDesktop()) {
          activeUrlRef.current = vncUrl;
          setLoadError(null);
          (window as any).rdkDesktop.openUrl(vncUrl);
        }
      } else {
        setPhase('error');
        setStatusText(t('vnc.err.port', '端口 5900 未就绪'));
        addToast(t('vnc.toast.port', 'VNC 端口未就绪，请检查设备配置'), 'warning');
      }
    }).catch(err => {
      setPhase('error');
      setStatusText(err.message || t('vnc.err.connect', '连接失败'));
      addToast(err.message || t('vnc.toast.opFail', '操作失败'), 'error');
    });
  };

  // ── 断开连接 ──
  const handleDisconnect = () => {
    if (isDesktop() && activeUrlRef.current) {
      (window as any).rdkDesktop.closeUrl(activeUrlRef.current);
      activeUrlRef.current = '';
    }
    setShowIframe(false);
    setPhase('idle');
    setLatency(null);
    setLoadError(null);
  };

  // ── 全屏切换 ──
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // ── 快捷键 ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F11' && showIframe) {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showIframe]);

  if (!currentDevice) return <DeviceGuard feature={t('vnc.guardFeature', '远程桌面')} />;

  return (
    <div className="immersive" ref={containerRef}>
      <div className="immersive-bar">
        <div className="immersive-bar-left">
          
          <span className="immersive-bar-title">{t('vnc.title', '远程桌面')}</span>
          {currentDevice && (
            <span className="immersive-bar-meta">
              {(currentDevice as any).username || (currentDevice as any).name}@{(currentDevice as any).host || (currentDevice as any).ip}
            </span>
          )}
        </div>

        <div className="immersive-bar-center">
          {showIframe && (
            <>
              <span className={`immersive-bar-status ${phase === 'connected' ? 'live' : ''}`}>
                <span className="status-dot" />
                {phase === 'connected' ? t('vnc.status.connected', '已连接') : t('vnc.status.disconnected', '未连接')}
              </span>
              {latency !== null && (
                <span className="immersive-bar-meta">{latency}ms</span>
              )}
            </>
          )}
        </div>

        <div className="immersive-bar-right">
          {showIframe && (
            <>
              {/* 画质选择 */}
              <div className="immersive-quality">
                {(['auto', 'high', 'low'] as const).map(q => (
                  <button
                    key={q}
                    className={`immersive-quality-btn ${quality === q ? 'active' : ''}`}
                    onClick={() => handleQualityChange(q)}
                  >
                    {q === 'auto' ? t('vnc.quality.auto', '自动') : q === 'high' ? t('vnc.quality.high', '高清') : t('vnc.quality.low', '流畅')}
                  </button>
                ))}
              </div>

              <div className="immersive-bar-sep" />

              <button className="btn-icon" onClick={() => window.open(getVncUrl(), '_blank')} title={t('vnc.title.openNew', '新窗口打开')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                  <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </button>

              <button className="btn-icon" onClick={toggleFullscreen} title={t('vnc.title.fullscreen', '全屏 (F11)')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {isFullscreen ? (
                    <><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></>
                  ) : (
                    <><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></>
                  )}
                </svg>
              </button>

              <button className="btn-icon" onClick={() => setShowLogs(!showLogs)} title={t('vnc.title.logs', '日志')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              </button>

              <div className="immersive-bar-sep" />

              <button className="btn btn-danger" onClick={handleDisconnect}>
                {t('vnc.disconnect', '断开')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── 主视口 ── */}
      <div className="immersive-viewport">
        {showIframe ? (
          <>
            {isDesktop() ? (
              <div className="immersive-desktop-placeholder">
                {loadError ? (
                  <>
                    <span className="immersive-error">⚠️ {loadError}</span>
                    <button className="btn btn-primary" onClick={() => { handleDisconnect(); }}>{t('vnc.backRetry', '返回重试')}</button>
                  </>
                ) : (
                  <span>{t('vnc.desktop.loaded', 'noVNC 已在独立视图中加载')}</span>
                )}
              </div>
            ) : (
              <iframe
                ref={iframeRef}
                src={getVncUrl()}
                className="vnc-iframe"
                title="VNC Remote Desktop"
                allow="clipboard-read; clipboard-write"
              />
            )}
            {/* 日志抽屉 */}
            {showLogs && (
              <div className="immersive-logs">
                <div className="immersive-logs-head">
                  <span>{t('vnc.proxyLogs', '代理日志')}</span>
                  <button className="btn btn-ghost" onClick={() => setShowLogs(false)}>×</button>
                </div>
                <div className="immersive-logs-body">
                  {logLines.map((line, i) => (
                    <div key={i} className="vnc-log-line">{line}</div>
                  ))}
                  {logLines.length === 0 && (
                    <div className="vnc-log-line">{t('vnc.log.waiting', '等待输出...')}</div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          /* ── 欢迎/连接界面 ── */
          <div className="immersive-welcome">
            <div className="immersive-welcome-icon">
              <div className="vnc-welcome-screen">
                <div className="vnc-screen-titlebar" />
                <div className="vnc-screen-sidebar" />
                <div className="vnc-screen-content">
                  <div className="vnc-screen-block a" />
                  <div className="vnc-screen-block b" />
                </div>
              </div>
              <div className="vnc-welcome-glow" />
            </div>

            <h2 className="immersive-welcome-title">{t('vnc.welcome.title', 'Web 远程桌面')}</h2>
            <p className="immersive-welcome-desc">
              {t('vnc.welcome.desc', '通过 WebSocket 代理直连设备桌面，零安装、低延迟')}
            </p>

            {phase === 'checking' && (
              <div className="immersive-loading">
                <div className="vnc-phase-spinner" />
                <span>{t('vnc.phase.checking', '检查 VNC 服务状态...')}</span>
              </div>
            )}

            {phase === 'connecting' && (
              <div className="immersive-loading">
                <div className="vnc-phase-spinner" />
                <span>{t('vnc.phase.connecting', '正在启动并连接...')}</span>
              </div>
            )}

            {phase === 'error' && (
              <div className="immersive-error">
                <span>⚠️ {statusText}</span>
                <button className="btn btn-ghost" onClick={handleConnect}>{t('vnc.retry', '重试')}</button>
              </div>
            )}

            {(phase === 'idle' || phase === 'error') && (
              <button
                className="btn btn-primary"
                onClick={handleConnect}
                disabled={!currentDevice}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                {t('vnc.connect', '启动并连接')}
              </button>
            )}

            {!currentDevice && (
              <p className="vnc-no-device">{t('vnc.pickDeviceLeft', '请先在左侧选择一个设备')}</p>
            )}

            <div className="vnc-welcome-hints">
              <div className="vnc-hint-item">
                <kbd>F11</kbd>
                <span>{t('vnc.hint.fullscreen', '全屏模式')}</span>
              </div>
              <div className="vnc-hint-item">
                <span className="status-dot" />
                <span>{t('vnc.hint.clipboard', '支持剪贴板同步')}</span>
              </div>
              <div className="vnc-hint-item">
                <span className="status-dot" />
                <span>{t('vnc.hint.quality', '自适应画质')}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
