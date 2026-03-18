import { useState, useRef, useEffect } from 'react';
import { useAppState } from '../hooks/useAppState';

/* ── 代码编辑器 — 内嵌 vscode.dev ── */
const VSCODE_BASE = 'https://vscode.dev/?vscode-lang=zh-cn';

export default function IDE() {
  const { currentDevice, addToast } = useAppState();

  const [showIframe, setShowIframe] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleConnect = () => {
    setIframeLoading(true);
    setShowIframe(true);
    addToast('正在加载 VS Code 编辑器...', 'info');
  };

  const handleDisconnect = () => {
    setShowIframe(false);
    setIframeLoading(false);
  };

  const handleIframeLoad = () => {
    setIframeLoading(false);
  };

  const handleReload = () => {
    if (iframeRef.current) {
      setIframeLoading(true);
      iframeRef.current.src = VSCODE_BASE;
    }
  };

  /* 全屏切换 */
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F11' && showIframe) { e.preventDefault(); toggleFullscreen(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showIframe]);

  return (
    <div className="ide-container" ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── 顶部工具栏 ── */}
      <div className="ros-topbar">
        <div className="ros-topbar-left">
          <div className="ros-topbar-dots">
            <span className="ros-dot red" />
            <span className="ros-dot yellow" />
            <span className="ros-dot green" />
          </div>
          <span className="ros-topbar-title">代码编辑器</span>
          <span className="ros-topbar-badge">VS Code</span>
          {currentDevice && (
            <span className="ros-topbar-device">{currentDevice.name} · {currentDevice.ip}</span>
          )}
        </div>

        <div className="ros-topbar-center">
          {showIframe && (
            <span className={`ros-status-badge ${!iframeLoading ? 'live' : ''}`}>
              <span className="ros-status-dot" />
              {iframeLoading ? '加载中' : '已就绪'}
            </span>
          )}
        </div>

        <div className="ros-topbar-right">
          {showIframe && (
            <>
              <button className="ros-tool-btn" onClick={handleReload} title="刷新">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
              </button>

              <button className="ros-tool-btn" onClick={() => window.open(VSCODE_BASE, '_blank')} title="新窗口打开">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                  <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>

              <button className="ros-tool-btn" onClick={toggleFullscreen} title="全屏 (F11)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {isFullscreen ? (
                    <><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></>
                  ) : (
                    <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>
                  )}
                </svg>
              </button>

              <div className="ros-topbar-sep" />

              <button className="ros-disconnect-btn" onClick={handleDisconnect}>
                关闭
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── 主视口 ── */}
      <div className="ros-viewport" style={{ flex: 1 }}>
        {showIframe ? (
          <>
            {iframeLoading && (
              <div className="ros-loading-overlay">
                <div className="ros-loading-spinner" />
                <span className="ros-loading-text">正在加载 VS Code...</span>
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={VSCODE_BASE}
              className="ros-iframe"
              title="VS Code Web Editor"
              onLoad={handleIframeLoad}
              allow="clipboard-read; clipboard-write; fullscreen"
              style={{ width: '100%', height: '100%', border: 'none' }}
            />
          </>
        ) : (
          <div className="ros-welcome">
            <div className="ros-welcome-visual">
              <div className="ros-welcome-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#007acc" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                </svg>
              </div>
              <div className="ros-welcome-glow" />
            </div>

            <h2 className="ros-welcome-title">VS Code Web 编辑器</h2>
            <p className="ros-welcome-desc">
              基于 vscode.dev 的在线代码编辑器，支持中文界面，可通过 Remote SSH 连接到设备 /root 目录进行开发
            </p>

            <button
              className="ros-connect-main-btn"
              onClick={handleConnect}
              style={{ background: '#007acc' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
              </svg>
              打开 VS Code
            </button>

            <div className="ros-welcome-hints">
              <div className="ros-hint-item">
                <kbd>F11</kbd>
                <span>全屏模式</span>
              </div>
              <div className="ros-hint-item">
                <span className="ros-hint-dot" />
                <span>支持 Remote SSH 连接设备</span>
              </div>
              <div className="ros-hint-item">
                <span className="ros-hint-dot" />
                <span>中文界面 · 插件生态</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
