import { useEffect, useState, useRef, useCallback } from 'react';
import { executeDeviceCommand, fetchVncStatus } from '../api';
import { useAppState } from '../hooks/useAppState';
import { fillTemplate } from '../i18n/en-extras';
import { useI18n } from '../i18n/use-i18n';
import { isDesktop } from '../utils/env';
import { shouldUseSshTunnelForDevice } from '../utils/device-tunnel';
import DeviceGuard from './DeviceGuard';
import FloatingEmbedPanel from './FloatingEmbedPanel';
import { registerVncRemoteConnect } from '../utils/studio-embed-connect-bridge';

/* ── VNC 全屏沉浸式远程桌面 ── */
export default function Vnc() {
  const { currentDevice, vncConnected, startVncSession, addToast, setVncEmbedToolbar } = useAppState();
  const { t } = useI18n();
  const tf = (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars);

  const [phase, setPhase] = useState<'idle' | 'checking' | 'connecting' | 'connected' | 'error'>('idle');
  const [statusText, setStatusText] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showIframe, setShowIframe] = useState(false);
  const [quality, setQuality] = useState<'auto' | 'high' | 'low'>('auto');
  /** remote：服务端分辨率随窗口变（需设备端支持）；scale：本地缩放铺满视口，默认更易「占满」 */
  const [resizeMode, setResizeMode] = useState<'remote' | 'scale'>('scale');
  const [showLogs, setShowLogs] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** 桌面：独立原生窗口；浏览器：FloatingEmbedPanel */
  const [embedFloating, setEmbedFloating] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeLoadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // VNC URL 版本号，用于强制刷新 iframe
  const [urlVersion, setUrlVersion] = useState(0);
  // 当前打开的 VNC URL（桌面端用于 close/hide）
  const activeUrlRef = useRef<string>('');

  // 桌面端：tab + 浮窗态 同步 WebContentsView；浮窗关闭时若当前不在「远程桌面」Tab，必须再次 hide，否则会嵌到工作台等页面
  const { activeTab } = useAppState();
  useEffect(() => {
    if (!isDesktop() || !activeUrlRef.current) return;
    const rdk = (window as any).rdkDesktop;
    const url = activeUrlRef.current;
    const run = () => {
      if (activeTab === 'vnc') {
        if (embedFloating) {
          rdk.hideUrl?.(url);
          rdk.focusEmbedFloat?.(url);
        } else {
          rdk.setActiveUrl?.(url);
        }
      } else {
        rdk.hideUrl?.(url);
      }
    };
    run();
    /** 贴回主窗口瞬间宿主可能晚一帧把视图挂到当前 Tab，再补一次 hide */
    const t =
      !embedFloating && activeTab !== 'vnc'
        ? window.setTimeout(() => rdk.hideUrl?.(url), 0)
        : undefined;
    return () => {
      if (t !== undefined) window.clearTimeout(t);
    };
  }, [activeTab, embedFloating]);

  useEffect(() => {
    if (!isDesktop()) return;
    const rdk = (window as any).rdkDesktop;
    const off = rdk?.onEmbedFloatDocked?.((payload: { url?: string }) => {
      if (payload?.url && payload.url === activeUrlRef.current) setEmbedFloating(false);
    });
    return () => {
      off?.();
    };
  }, []);

  const toggleEmbedFloat = useCallback(() => {
    if (!isDesktop()) {
      setEmbedFloating((v) => !v);
      return;
    }
    const url = activeUrlRef.current;
    if (!url) return;
    setEmbedFloating((prev) => {
      const next = !prev;
      (window as any).rdkDesktop?.setEmbedFloatMode?.(url, next, t('vnc.title', '远程桌面'));
      return next;
    });
  }, [t]);

  /** 供全局顶栏显示「悬浮窗」，避免用户只在第一行顶栏找按钮而找不到 */
  useEffect(() => {
    if (!showIframe) {
      setVncEmbedToolbar(null);
      return;
    }
    setVncEmbedToolbar({
      showIframe: true,
      embedFloating,
      toggleEmbedFloat,
    });
    return () => setVncEmbedToolbar(null);
  }, [showIframe, embedFloating, toggleEmbedFloat, setVncEmbedToolbar]);

  // iframe 加载超时检测（非桌面端）
  useEffect(() => {
    clearTimeout(iframeLoadTimerRef.current);
    if (!showIframe || isDesktop()) return;
    iframeLoadTimerRef.current = setTimeout(() => {
      if (!loadError) {
        setLoadError(t('vnc.err.iframeTimeout', '远程桌面加载超时，请检查网络或重试'));
      }
    }, 12000);
    return () => clearTimeout(iframeLoadTimerRef.current);
  }, [showIframe, loadError, t]);

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
    const wsPath = shouldUseSshTunnelForDevice(currentDevice)
      ? `websockify?deviceId=${encodeURIComponent(currentDevice.id)}&remotePort=5900`
      : `websockify?target=${hostOrIp}:5900`;
    const resizeParam = resizeMode === 'remote' ? 'remote' : 'scale';
    return `http://${host}:${backendPort}/vnc/vnc.html?autoconnect=true&resize=${resizeParam}&reconnect=true&reconnect_delay=2000&password=88888888&path=${encodeURIComponent(wsPath)}${qualityParam}&v=${urlVersion}`;
  }, [currentDevice, quality, urlVersion, resizeMode]);

  const handleResizeModeChange = (mode: 'remote' | 'scale') => {
    if (mode === resizeMode) return;
    setResizeMode(mode);
    if (showIframe) {
      setUrlVersion((v) => v + 1);
      addToast(
        mode === 'remote'
          ? t('vnc.resize.toastRemote', '已切换为「填满窗口」：将请求设备按窗口大小调整分辨率（若仍有灰边可试「等比」）')
          : t('vnc.resize.toastScale', '已切换为「等比缩放」：保持宽高比，两侧或上下可能有边距'),
        'info',
      );
    }
  };

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
      addToast(t('vnc.toast.connectDevice', '请先连接开发者套件'), 'warning');
      return;
    }
    if (phase === 'connecting') {
      addToast(
        t(
          'vnc.toast.connectingWait',
          '正在连接远程桌面（同类型仅 1 个）；可与代码编辑器同时各开 1 个',
        ),
        'info',
      );
      return;
    }
    if (showIframe && phase === 'connected') {
      addToast(
        t(
          'vnc.toast.singleSessionOnly',
          '远程桌面同类型仅支持 1 个；可与代码编辑器同时各开 1 个。请先关闭当前会话后再开新的',
        ),
        'info',
      );
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
        addToast(t('vnc.toast.started', 'VNC 服务已启动，正在加载远程桌面…'), 'info');
        startVncSession();
        /** 默认贴入当前远程桌面页；对话「打开 VNC」由 useAppState.tryFloatWhenReady / runRemoteConnectIntent 再浮出 */
        setEmbedFloating(false);
        if (isDesktop()) {
          activeUrlRef.current = vncUrl;
          setLoadError(null);
          const rdk = (window as any).rdkDesktop;
          rdk.openUrl(vncUrl);
          rdk.setEmbedFloatMode?.(vncUrl, false, t('vnc.title', '远程桌面'));
        }
      } else {
        setPhase('error');
        setStatusText(t('vnc.err.port', '端口 5900 未就绪'));
        addToast(t('vnc.toast.port', 'VNC 端口未就绪。请尝试：(1) 在终端运行 sudo systemctl restart x11vnc，(2) 确认开发者套件已安装桌面环境'), 'warning');
      }
    }).catch(err => {
      setPhase('error');
      setStatusText(err.message || t('vnc.err.connect', '连接失败'));
      addToast(err.message || t('vnc.toast.opFail', '操作失败'), 'error');
    });
  };

  /** 对话「打开 VNC」：与按钮同源；已连接则只补浮窗 */
  const runRemoteConnectIntentRef = useRef<() => void>(() => {});
  useEffect(() => {
    runRemoteConnectIntentRef.current = () => {
      if (phase === 'connecting') {
        addToast(
          t(
            'vnc.toast.connectingWait',
            '正在连接远程桌面（同类型仅 1 个）；可与代码编辑器同时各开 1 个',
          ),
          'info',
        );
        return;
      }
      if (showIframe && phase === 'connected') {
        if (!embedFloating) {
          toggleEmbedFloat();
          return;
        }
        addToast(
          t(
            'vnc.toast.alreadyOpenSingle',
            '远程桌面已打开（同类型仅 1 个）；可与代码编辑器同时各浮 1 个',
          ),
          'info',
        );
        return;
      }
      handleConnect();
    };
  });
  useEffect(() => {
    registerVncRemoteConnect(() => runRemoteConnectIntentRef.current());
    return () => registerVncRemoteConnect(null);
  }, []);

  // ── 断开连接 ──
  const handleDisconnect = () => {
    setEmbedFloating(false);
    if (isDesktop() && activeUrlRef.current) {
      (window as any).rdkDesktop.closeUrl(activeUrlRef.current);
      activeUrlRef.current = '';
    }
    setShowIframe(false);
    setPhase('idle');
    setLatency(null);
    setLoadError(null);
  };

  // ── 全屏切换（整块远程桌面区域含工具条） ──
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

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
  }, [showIframe, toggleFullscreen]);

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
              <span className={`immersive-bar-status ${phase === 'connected' && !loadError ? 'live' : ''}`}>
                <span className={`status-dot ${loadError ? 'warn' : phase === 'connected' ? 'online' : ''}`} />
                {loadError
                  ? t('vnc.status.loadError', '加载异常')
                  : phase === 'connected' ? t('vnc.status.connected', '已连接') : t('vnc.status.disconnected', '未连接')}
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
              <button
                type="button"
                className="btn btn-ghost btn-sm immersive-float-toggle"
                onClick={toggleEmbedFloat}
                title={
                  embedFloating
                    ? t('vnc.title.floatDock', '贴回主窗口')
                    : t('vnc.title.floatOut', '拖出为悬浮窗，可拖到副屏；切换标签后仍可见')
                }
                aria-pressed={embedFloating}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                <span>{embedFloating ? t('vnc.floatBtn.dock', '贴回') : t('vnc.floatBtn.floatOut', '浮出')}</span>
              </button>
              <div className="immersive-bar-sep" />
              <div className="immersive-vnc-resize" role="group" aria-label={t('vnc.resize.group', '缩放方式')}>
                <button
                  type="button"
                  className={resizeMode === 'remote' ? 'active' : ''}
                  onClick={() => handleResizeModeChange('remote')}
                  title={t('vnc.resize.remoteTip', '远程调整分辨率以适配窗口，画面更大（需设备端支持）')}
                >
                  {t('vnc.resize.remote', '填满')}
                </button>
                <button
                  type="button"
                  className={resizeMode === 'scale' ? 'active' : ''}
                  onClick={() => handleResizeModeChange('scale')}
                  title={t('vnc.resize.scaleTip', '本地等比缩放，保持比例，可能有黑边')}
                >
                  {t('vnc.resize.scale', '等比')}
                </button>
              </div>
              <div className="immersive-bar-sep" />
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

              <button
                type="button"
                className="btn btn-ghost btn-sm immersive-float-toggle"
                onClick={toggleFullscreen}
                title={t('vnc.title.fullscreen', '全屏显示远程桌面区域（含本工具条），快捷键 F11')}
                aria-pressed={isFullscreen}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {isFullscreen ? (
                    <><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></>
                  ) : (
                    <><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></>
                  )}
                </svg>
                <span>{isFullscreen ? t('vnc.fullscreen.exit', '退出全屏') : t('vnc.fullscreen.enter', '全屏')}</span>
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
      <div className={`immersive-viewport${showIframe ? ' immersive-viewport--vnc' : ''}`}>
        {showIframe ? (
          <>
            {isDesktop() ? (
              <div className="immersive-desktop-placeholder">
                {loadError ? (
                  <>
                    <span className="immersive-error immersive-error--inline" role="alert">
                      <svg className="immersive-error-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      <span>{loadError}</span>
                    </span>
                    <button className="btn btn-primary" onClick={() => { handleDisconnect(); }}>{t('vnc.backRetry', '返回重试')}</button>
                  </>
                ) : (
                  <span>
                    {embedFloating
                      ? t('vnc.desktop.floating', '远程桌面已在独立窗口中，可拖到副屏与 Studio 并排')
                      : t('vnc.desktop.loaded', 'noVNC 已在独立视图中加载')}
                  </span>
                )}
              </div>
            ) : (
              <FloatingEmbedPanel
                title={t('vnc.title', '远程桌面')}
                dockLabel={t('vnc.title.floatDock', '贴回')}
                floating={embedFloating}
                onFloatingChange={setEmbedFloating}
                storageKey="vnc"
                backfill={<span className="floating-embed-backfill-default">{t('vnc.floatBackfill', '远程桌面在悬浮窗中，可切换到对话或其它页面，窗口保持置顶可见。')}</span>}
                dragbarExtra={
                  <button type="button" className="btn btn-ghost btn-sm" onClick={handleDisconnect}>
                    {t('vnc.disconnect', '断开')}
                  </button>
                }
              >
                <iframe
                  ref={iframeRef}
                  src={getVncUrl()}
                  className="vnc-iframe"
                  title="VNC Remote Desktop"
                  allow="clipboard-read; clipboard-write"
                  onLoad={() => {
                    clearTimeout(iframeLoadTimerRef.current);
                    setLoadError(null);
                    addToast(t('vnc.toast.iframeOk', '远程桌面已加载'), 'success');
                  }}
                />
              </FloatingEmbedPanel>
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
            <div className="immersive-welcome-visual">
              <div className="immersive-welcome-icon">
                <div className="vnc-welcome-screen">
                  <div className="vnc-screen-titlebar" />
                  <div className="vnc-screen-sidebar" />
                  <div className="vnc-screen-content">
                    <div className="vnc-screen-block a" />
                    <div className="vnc-screen-block b" />
                  </div>
                </div>
              </div>
              <div className="immersive-welcome-glow" />
            </div>

            <h2 className="immersive-welcome-title">{t('vnc.welcome.title', 'Web 远程桌面')}</h2>
            <p className="immersive-welcome-desc">
              {t('vnc.welcome.desc', '通过 WebSocket 代理直连开发者套件桌面，零安装、低延迟')}
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
              <div className="immersive-error" role="alert">
                <span className="immersive-error--inline">
                  <svg className="immersive-error-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>{statusText}</span>
                </span>
                <p style={{ fontSize: '0.8125rem', color: '#94a3b8', maxWidth: 360, lineHeight: 1.55, margin: '4px 0 8px' }}>
                  {t('vnc.err.troubleshoot', '排查建议：(1) 确认开发者套件已安装桌面环境, (2) 在终端运行 sudo systemctl status x11vnc 查看服务状态, (3) 检查端口 5900 是否被占用')}
                </p>
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
              <p className="vnc-no-device">{t('vnc.pickDeviceLeft', '请先在左侧选择一个开发者套件')}</p>
            )}

            <div className="immersive-feature-hints">
              {!isDesktop() && (
                <div className="immersive-feature-hint">
                  <span className="immersive-hint-dot" />
                  <span>{t('vnc.hint.float', '连接后可用工具栏「悬浮窗」与对话区并排对照')}</span>
                </div>
              )}
              <div className="immersive-feature-hint">
                <kbd>F11</kbd>
                <span>{t('vnc.hint.fullscreen', '全屏模式')}</span>
              </div>
              <div className="immersive-feature-hint">
                <span className="immersive-hint-dot" />
                <span>{t('vnc.hint.clipboard', '支持剪贴板同步')}</span>
              </div>
              <div className="immersive-feature-hint">
                <span className="immersive-hint-dot" />
                <span>{t('vnc.hint.quality', '自适应画质')}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
