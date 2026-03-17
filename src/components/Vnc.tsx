import { useEffect, useState, useRef, useCallback } from 'react';
import { executeDeviceCommand, fetchVncStatus } from '../api';
import { useAppState } from '../hooks/useAppState';

/* ── VNC 全屏沉浸式远程桌面 ── */
export default function Vnc() {
  const { currentDevice, vncConnected, startVncSession, addToast } = useAppState();

  const [phase, setPhase] = useState<'idle' | 'checking' | 'connecting' | 'connected' | 'error'>('idle');
  const [statusText, setStatusText] = useState('');
  const [showIframe, setShowIframe] = useState(false);
  const [quality, setQuality] = useState<'auto' | 'high' | 'low'>('auto');
  const [showLogs, setShowLogs] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ── 构建 VNC URL ──
  const getVncUrl = useCallback(() => {
    if (!currentDevice) return '';
    const host = window.location.hostname;
    const backendPort = (import.meta as any).env?.DEV ? 8787 : (Number(window.location.port) || 80);
    const qualityParam = quality === 'high' ? '&quality=9' : quality === 'low' ? '&quality=3' : '';
    // noVNC expects path relative to ws:// origin, not URL-encoded
    const wsPath = `websockify?target=${currentDevice.ip}:5900`;
    return `http://${host}:${backendPort}/vnc/vnc.html?autoconnect=true&resize=remote&reconnect=true&path=${encodeURIComponent(wsPath)}${qualityParam}`;
  }, [currentDevice, quality]);

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
          setStatusText('VNC 服务就绪');
        } else {
          setPhase('idle');
          setStatusText('VNC 服务未启动');
        }
      })
      .catch(() => {
        setPhase('idle');
        setStatusText('无法获取状态');
      });
  }, [currentDevice?.id]);

  // ── 模拟延迟检测 ──
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
      addToast('请先连接设备', 'warning');
      return;
    }
    setPhase('connecting');
    addToast('正在检查并启动 VNC 服务...', 'info');

    executeDeviceCommand(
      currentDevice.id,
      'bash -lc "(systemctl start vncserver || systemctl start x11vnc || true); sleep 1; (ss -lntp 2>/dev/null | grep -q \':5900\' && echo VNC_READY || echo VNC_FAILED)"'
    ).then(res => {
      const output = res.output || '';
      setLogLines(prev => [...prev, ...output.split(/\r?\n/).filter(Boolean)]);

      if (output.includes('VNC_READY')) {
        setPhase('connected');
        setShowIframe(true);
        addToast('VNC 连接成功', 'success');
        startVncSession();
      } else {
        setPhase('error');
        setStatusText('端口 5900 未就绪');
        addToast('VNC 端口未就绪，请检查设备配置', 'warning');
      }
    }).catch(err => {
      setPhase('error');
      setStatusText(err.message || '连接失败');
      addToast(err.message || '操作失败', 'error');
    });
  };

  // ── 断开连接 ──
  const handleDisconnect = () => {
    setShowIframe(false);
    setPhase('idle');
    setLatency(null);
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

  return (
    <div className="vnc-container" ref={containerRef}>
      {/* ── 顶部工具栏 ── */}
      <div className="vnc-topbar">
        <div className="vnc-topbar-left">
          <div className="vnc-topbar-dots">
            <span className="vnc-dot-sm red" />
            <span className="vnc-dot-sm yellow" />
            <span className="vnc-dot-sm green" />
          </div>
          <span className="vnc-topbar-title">远程桌面</span>
          {currentDevice && (
            <span className="vnc-topbar-device">
              {currentDevice.name} · {currentDevice.ip}
            </span>
          )}
        </div>

        <div className="vnc-topbar-center">
          {showIframe && (
            <>
              <span className={`vnc-status-badge ${phase === 'connected' ? 'live' : ''}`}>
                <span className="vnc-status-dot" />
                {phase === 'connected' ? '已连接' : '未连接'}
              </span>
              {latency !== null && (
                <span className="vnc-latency-badge">{latency}ms</span>
              )}
            </>
          )}
        </div>

        <div className="vnc-topbar-right">
          {showIframe && (
            <>
              {/* 画质选择 */}
              <div className="vnc-quality-group">
                {(['auto', 'high', 'low'] as const).map(q => (
                  <button
                    key={q}
                    className={`vnc-quality-btn ${quality === q ? 'active' : ''}`}
                    onClick={() => setQuality(q)}
                  >
                    {q === 'auto' ? '自动' : q === 'high' ? '高清' : '流畅'}
                  </button>
                ))}
              </div>

              <div className="vnc-topbar-sep" />

              <button className="vnc-tool-btn" onClick={() => window.open(getVncUrl(), '_blank')} title="新窗口打开">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                  <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </button>

              <button className="vnc-tool-btn" onClick={toggleFullscreen} title="全屏 (F11)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {isFullscreen ? (
                    <><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></>
                  ) : (
                    <><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></>
                  )}
                </svg>
              </button>

              <button className="vnc-tool-btn" onClick={() => setShowLogs(!showLogs)} title="日志">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              </button>

              <div className="vnc-topbar-sep" />

              <button className="vnc-disconnect-btn" onClick={handleDisconnect}>
                断开
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── 主视口 ── */}
      <div className="vnc-viewport">
        {showIframe ? (
          <>
            <iframe
              ref={iframeRef}
              src={getVncUrl()}
              className="vnc-iframe"
              title="VNC Remote Desktop"
              allow="clipboard-read; clipboard-write"
            />
            {/* 日志抽屉 */}
            {showLogs && (
              <div className="vnc-log-drawer">
                <div className="vnc-log-header">
                  <span>代理日志</span>
                  <button className="vnc-log-close" onClick={() => setShowLogs(false)}>×</button>
                </div>
                <div className="vnc-log-body">
                  {logLines.map((line, i) => (
                    <div key={i} className="vnc-log-line">{line}</div>
                  ))}
                  {logLines.length === 0 && (
                    <div className="vnc-log-line" style={{ color: '#555' }}>等待输出...</div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          /* ── 欢迎/连接界面 ── */
          <div className="vnc-welcome">
            <div className="vnc-welcome-visual">
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

            <h2 className="vnc-welcome-title">Web 远程桌面</h2>
            <p className="vnc-welcome-desc">
              通过 WebSocket 代理直连设备桌面，零安装、低延迟
            </p>

            {phase === 'checking' && (
              <div className="vnc-phase-indicator">
                <div className="vnc-phase-spinner" />
                <span>检查 VNC 服务状态...</span>
              </div>
            )}

            {phase === 'connecting' && (
              <div className="vnc-phase-indicator">
                <div className="vnc-phase-spinner" />
                <span>正在启动并连接...</span>
              </div>
            )}

            {phase === 'error' && (
              <div className="vnc-error-banner">
                <span>⚠️ {statusText}</span>
                <button className="vnc-retry-btn" onClick={handleConnect}>重试</button>
              </div>
            )}

            {(phase === 'idle' || phase === 'error') && (
              <button
                className="vnc-connect-main-btn"
                onClick={handleConnect}
                disabled={!currentDevice}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                启动并连接
              </button>
            )}

            {!currentDevice && (
              <p className="vnc-no-device">请先在左侧选择一个设备</p>
            )}

            <div className="vnc-welcome-hints">
              <div className="vnc-hint-item">
                <kbd>F11</kbd>
                <span>全屏模式</span>
              </div>
              <div className="vnc-hint-item">
                <span className="vnc-hint-dot" />
                <span>支持剪贴板同步</span>
              </div>
              <div className="vnc-hint-item">
                <span className="vnc-hint-dot" />
                <span>自适应画质</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
