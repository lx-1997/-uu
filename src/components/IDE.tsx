import { useState, useRef, useEffect } from 'react';
import { useAppState } from '../hooks/useAppState';
import { executeDeviceCommand } from '../api';

/* ── 运行时判断是否在 Electron 桌面端 ── */
const isDesktop = () => typeof window !== 'undefined' && !!(window as any).rdkDesktop?.isDesktop;

/* ── code-server 默认端口（设备侧） ── */
const CODE_SERVER_PORT = 9888;

/* ── 浏览器模式回退：vscode.dev ── */
const VSCODE_WEB_URL = 'https://vscode.dev/?vscode-lang=zh-cn';

/* ── 安装 code-server 的远程命令（与旧版 operate_vscode_server.json 一致） ── */
const INSTALL_CMD = [
  "echo 'Installing code-server...'",
  'mkdir -p ~/.cache/code-server',
  'curl -#fL -o ~/.cache/code-server/code-server_arm64.deb -C - https://rdkstudio.bj.bcebos.com/appspace/codeserver/code-server_4.96.2_arm64.deb',
  'sudo dpkg -i ~/.cache/code-server/code-server*.deb',
  'rm -f ~/.cache/code-server/code-server*.deb',
  'code-server --version',
].join(' && ');

/*
 * 单条 SSH 命令：检查安装 → kill 旧进程 → 启动 → 轮询端口就绪（最多 ~15s）。
 * 输出关键字：CS_NOT_FOUND / READY / NOT_READY
 */
const buildLaunchCmd = (port: number) =>
  `bash -lc '` +
  `command -v code-server >/dev/null 2>&1 || { echo CS_NOT_FOUND; exit 0; }; ` +
  `(sudo lsof -t -i :${port} 2>/dev/null | xargs sudo kill -9 2>/dev/null) || true; ` +
  `sleep 1; ` +
  `nohup code-server --auth none --bind-addr 0.0.0.0:${port} --ignore-last-opened > /tmp/code-server.log 2>&1 & ` +
  `for i in $(seq 1 30); do ` +
  `  if ss -lntp 2>/dev/null | grep -q ":${port}" || netstat -tlnp 2>/dev/null | grep -q ":${port}"; then ` +
  `    echo READY; exit 0; ` +
  `  fi; ` +
  `  sleep 0.5; ` +
  `done; ` +
  `echo NOT_READY` +
  `'`;

export default function IDE() {
  const { currentDevice, addToast } = useAppState();

  const [showIframe, setShowIframe] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const activeUrlRef = useRef<string>('');

  /* ── 构建 code-server URL ── */
  const getCodeServerUrl = () => {
    if (!currentDevice) return VSCODE_WEB_URL;
    return `http://${currentDevice.ip}:${CODE_SERVER_PORT}/?folder=/root`;
  };

  /* ── 监听 WebContentsView 加载事件（桌面端） ── */
  useEffect(() => {
    if (!isDesktop()) return;
    const rdk = (window as any).rdkDesktop;
    rdk.onUrlLoaded?.((url: string) => {
      if (url === activeUrlRef.current) {
        setIframeLoading(false);
        setLoadError(null);
      }
    });
    rdk.onUrlLoadFailed?.((url: string, _code: number, desc: string) => {
      if (url === activeUrlRef.current) {
        setIframeLoading(false);
        setLoadError(desc || '连接失败');
        addToast(`code-server 加载失败: ${desc}`, 'error');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── 一键安装 code-server ── */
  const handleInstall = async () => {
    if (!currentDevice) return;
    setInstalling(true);
    addToast('正在安装 code-server，可能需要几分钟...', 'info');
    try {
      const res = await executeDeviceCommand(currentDevice.id, INSTALL_CMD);
      if (res.output?.includes('code-server')) {
        addToast('code-server 安装成功！', 'success');
        setLoadError(null);
      } else {
        addToast('安装可能未完成，请检查设备网络后重试', 'warning');
      }
    } catch {
      addToast('安装失败，请检查设备连接和网络', 'error');
    } finally {
      setInstalling(false);
    }
  };

  /* ── 打开编辑器 ── */
  const handleConnect = async () => {
    if (!currentDevice) {
      addToast('请先连接设备', 'warning');
      return;
    }
    const url = getCodeServerUrl();
    setIframeLoading(true);
    setLoadError(null);
    setShowIframe(true);
    addToast('正在启动 code-server...', 'info');

    try {
      const res = await executeDeviceCommand(
        currentDevice.id,
        buildLaunchCmd(CODE_SERVER_PORT),
      );
      const output = res.output ?? '';

      if (output.includes('CS_NOT_FOUND')) {
        setIframeLoading(false);
        setLoadError('设备上未安装 code-server');
        addToast('设备上未检测到 code-server，请先安装', 'warning');
        setShowIframe(false);
        return;
      }
      if (output.includes('NOT_READY')) {
        setIframeLoading(false);
        setLoadError('code-server 启动超时，请检查设备日志 /tmp/code-server.log');
        addToast('code-server 未能在 15 秒内就绪', 'warning');
        setShowIframe(false);
        return;
      }
    } catch (err) {
      setIframeLoading(false);
      const msg = err instanceof Error ? err.message : '设备连接失败';
      setLoadError(msg);
      addToast(`连接设备失败: ${msg}`, 'error');
      setShowIframe(false);
      return;
    }

    if (isDesktop()) {
      activeUrlRef.current = url;
      (window as any).rdkDesktop.openUrl(url);
    }
    setTimeout(() => setIframeLoading(false), 10000);
  };

  /* ── 关闭编辑器 ── */
  const handleDisconnect = () => {
    if (isDesktop() && activeUrlRef.current) {
      (window as any).rdkDesktop.closeUrl(activeUrlRef.current);
      activeUrlRef.current = '';
    }
    setShowIframe(false);
    setIframeLoading(false);
  };

  /* ── 刷新（仅 iframe 模式） ── */
  const handleReload = () => {
    if (iframeRef.current) {
      setIframeLoading(true);
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  const handleIframeLoad = () => setIframeLoading(false);

  /* ── 全屏切换 ── */
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

  // 桌面端：tab 切换时同步 WebContentsView 可见性（IDE 是持久化组件，不会卸载）
  const { activeTab } = useAppState();
  useEffect(() => {
    if (!isDesktop() || !activeUrlRef.current) return;
    const rdk = (window as any).rdkDesktop;
    if (activeTab === 'ide') {
      rdk.setActiveUrl?.(activeUrlRef.current);
    } else {
      rdk.hideUrl?.(activeUrlRef.current);
    }
  }, [activeTab]);

  const desktop = isDesktop();
  const editorLabel = currentDevice ? `code-server · ${currentDevice.ip}:${CODE_SERVER_PORT}` : 'VS Code Web';

  return (
    <div className="ide-container" ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── 顶部工具栏 ── */}
      <div className="ros-topbar">
        <div className="ros-topbar-left">
          
          <span className="ros-topbar-title">代码编辑器</span>
          <span className="ros-topbar-badge">{currentDevice ? 'code-server' : 'VS Code'}</span>
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
              {/* 非桌面端才显示刷新按钮 */}
              {!desktop && (
                <button className="ros-tool-btn" onClick={handleReload} title="刷新">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                  </svg>
                </button>
              )}

              <button
                className="ros-tool-btn"
                onClick={() => window.open(getCodeServerUrl(), '_blank')}
                title="新窗口打开"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                  <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>

              {!desktop && (
                <button className="ros-tool-btn" onClick={toggleFullscreen} title="全屏 (F11)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {isFullscreen ? (
                      <><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></>
                    ) : (
                      <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>
                    )}
                  </svg>
                </button>
              )}

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
                <span className="ros-loading-text">正在加载 {editorLabel}...</span>
              </div>
            )}
            {/* 桌面端由 WebContentsView 渲染，此处只显示占位或错误 */}
            {desktop ? (
              <div style={{ width: '100%', height: '100%', background: '#1e1e1e', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                {loadError ? (
                  <>
                    <span style={{ color: '#f87171', fontSize: 13 }}>⚠️ {loadError}</span>
                    {loadError.includes('未安装') && currentDevice && (
                      <button className="ros-connect-main-btn" style={{ background: '#2563eb', marginTop: 8 }} disabled={installing} onClick={handleInstall}>
                        {installing ? '正在安装...' : '一键安装 code-server'}
                      </button>
                    )}
                    <button className="ros-connect-main-btn" style={{ background: '#ff6b00', marginTop: 8 }} onClick={() => { handleDisconnect(); }}>返回重试</button>
                  </>
                ) : (
                  <span style={{ color: '#555', fontSize: 13 }}>code-server 已在独立视图中加载</span>
                )}
              </div>
            ) : (
              <iframe
                ref={iframeRef}
                src={getCodeServerUrl()}
                className="ros-iframe"
                title="code-server"
                onLoad={handleIframeLoad}
                allow="clipboard-read; clipboard-write; fullscreen"
                style={{ width: '100%', height: '100%', border: 'none' }}
              />
            )}
          </>
        ) : (
          <div className="ros-welcome">
            <div className="ros-welcome-visual">
              <div className="ros-welcome-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                </svg>
              </div>
              <div className="ros-welcome-glow" />
            </div>

            <h2 className="ros-welcome-title">
              {currentDevice ? 'code-server 编辑器' : 'VS Code Web 编辑器'}
            </h2>
            <p className="ros-welcome-desc">
              {currentDevice
                ? `连接设备 ${currentDevice.ip} 上的 code-server，直接编辑 /root 目录代码`
                : '基于 vscode.dev 的在线代码编辑器，支持中文界面，可通过 Remote SSH 连接到设备'}
            </p>

            {!currentDevice && (
              <p className="ros-welcome-desc" style={{ color: '#f59e0b' }}>请先在左侧连接一个设备</p>
            )}

            {loadError?.includes('未安装') && currentDevice && (
              <button
                className="ros-connect-main-btn"
                onClick={handleInstall}
                disabled={installing}
                style={{ background: '#2563eb', marginBottom: 8 }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {installing ? '正在安装...' : '一键安装 code-server'}
              </button>
            )}

            <button
              className="ros-connect-main-btn"
              onClick={handleConnect}
              disabled={!currentDevice || installing}
              style={{ background: '#ff6b00' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
              </svg>
              {currentDevice ? '打开 code-server' : '打开 VS Code'}
            </button>

            <div className="ros-welcome-hints">
              {!desktop && (
                <div className="ros-hint-item">
                  <kbd>F11</kbd>
                  <span>全屏模式</span>
                </div>
              )}
              <div className="ros-hint-item">
                <span className="ros-hint-dot" />
                <span>{currentDevice ? `设备端口 ${CODE_SERVER_PORT}` : '支持 Remote SSH 连接设备'}</span>
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
