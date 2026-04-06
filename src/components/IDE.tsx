import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';
import { executeDeviceCommand } from '../api';
import { fillTemplate } from '../i18n/en-extras';
import { useI18n } from '../i18n/use-i18n';
import { isDesktop } from '../utils/env';
import { resolveApiUrlForEmbed } from '../utils/apiBase';
import { shouldUseSshTunnelForDevice } from '../utils/device-tunnel';
import DeviceGuard from './DeviceGuard';
import FloatingEmbedPanel from './FloatingEmbedPanel';
import {
  consumeIdeConnectPreferFloat,
  registerIdeRemoteConnect,
} from '../utils/studio-embed-connect-bridge';

/* ── code-server 默认端口（设备侧） ── */
const CODE_SERVER_PORT = 9888;

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
  const { currentDevice, addToast, activeTab, setIdeEmbedToolbar } = useAppState();
  const { t, isEn } = useI18n();
  const tf = (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars);
  const vscodeWebUrl = isEn ? 'https://vscode.dev/?vscode-lang=en' : 'https://vscode.dev/?vscode-lang=zh-cn';

  const [showIframe, setShowIframe] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** 桌面：独立原生窗口；浏览器：FloatingEmbedPanel */
  const [embedFloating, setEmbedFloating] = useState(false);
  const [installing, setInstalling] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const activeUrlRef = useRef<string>('');
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => { clearTimeout(loadingTimerRef.current); };
  }, []);

  /* ── 构建 code-server URL ── */
  const getCodeServerUrl = () => {
    if (!currentDevice) return vscodeWebUrl;
    if (shouldUseSshTunnelForDevice(currentDevice)) {
      const base = resolveApiUrlForEmbed(`/api/devices/${currentDevice.id}/code-server-proxy/`);
      return `${base}?folder=/root`;
    }
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
        setLoadError(desc || t('ide.err.connectFail', '连接失败'));
        addToast(tf('ide.err.loadFail', 'code-server 加载失败: {{desc}}', { desc: desc || '' }), 'error');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, tf, addToast]);

  /* ── 一键安装 code-server ── */
  const handleInstall = async () => {
    if (!currentDevice) return;
    setInstalling(true);
    addToast(t('ide.toast.installing', '正在安装 code-server，可能需要几分钟...'), 'info');
    try {
      const res = await executeDeviceCommand(currentDevice.id, INSTALL_CMD);
      if (res.output?.includes('code-server')) {
        addToast(t('ide.toast.installOk', 'code-server 安装成功！'), 'success');
        setLoadError(null);
      } else {
        addToast(t('ide.toast.installMaybe', '安装可能未完成，请检查设备网络后重试'), 'warning');
      }
    } catch {
      addToast(t('ide.toast.installFail', '安装失败，请检查设备连接和网络'), 'error');
    } finally {
      setInstalling(false);
    }
  };

  /* ── 打开编辑器 ── */
  const handleConnect = async () => {
    if (!currentDevice) {
      consumeIdeConnectPreferFloat();
      addToast(t('ide.toast.connectDevice', '请先连接开发者套件'), 'warning');
      return;
    }
    if (showIframe) {
      if (iframeLoading) {
        addToast(
          t(
            'ide.toast.connectingWait',
            '正在连接代码编辑器（同类型仅 1 个）；可与远程桌面同时各开 1 个',
          ),
          'info',
        );
        return;
      }
      if (!loadError) {
        consumeIdeConnectPreferFloat();
        addToast(
          t(
            'ide.toast.singleSessionOnly',
            '代码编辑器同类型仅支持 1 个；可与远程桌面同时各开 1 个。请先关闭当前会话后再开新的',
          ),
          'info',
        );
        return;
      }
    }
    const url = getCodeServerUrl();
    setIframeLoading(true);
    setLoadError(null);
    setShowIframe(true);
    addToast(t('ide.toast.starting', '正在启动 code-server...'), 'info');

    try {
      const res = await executeDeviceCommand(
        currentDevice.id,
        buildLaunchCmd(CODE_SERVER_PORT),
      );
      const output = res.output ?? '';

      if (output.includes('CS_NOT_FOUND')) {
        consumeIdeConnectPreferFloat();
        setIframeLoading(false);
        setLoadError(t('ide.err.notInstalled', '开发者套件上未安装 code-server'));
        addToast(t('ide.toast.notDetected', '开发者套件上未检测到 code-server。请点击下方「安装」按钮自动安装，或手动在终端运行安装命令'), 'warning');
        setShowIframe(false);
        return;
      }
      if (output.includes('NOT_READY')) {
        consumeIdeConnectPreferFloat();
        setIframeLoading(false);
        setLoadError(t('ide.err.timeout', 'code-server 启动超时，请检查设备日志 /tmp/code-server.log'));
        addToast(t('ide.toast.notReady', 'code-server 启动超时。请尝试：(1) 重新点击「连接」重试，(2) 在终端查看日志 cat /tmp/code-server.log'), 'warning');
        setShowIframe(false);
        return;
      }
    } catch (err) {
      consumeIdeConnectPreferFloat();
      setIframeLoading(false);
      const msg = err instanceof Error ? err.message : t('ide.err.deviceConn', '开发者套件连接失败');
      setLoadError(msg);
      addToast(tf('ide.toast.connFail', '连接开发者套件失败: {{msg}}', { msg }), 'error');
      setShowIframe(false);
      return;
    }

    /** 对话「打开 IDE」：consumeIdeConnectPreferFloat 为 true 时直接浮出；页面内点「连接」默认贴入 */
    const preferFloatFromIntent = consumeIdeConnectPreferFloat();
    setEmbedFloating(preferFloatFromIntent);
    if (isDesktop()) {
      activeUrlRef.current = url;
      const rdk = (window as any).rdkDesktop;
      rdk.openUrl(url);
      rdk.setEmbedFloatMode?.(url, preferFloatFromIntent, t('ide.title', '代码编辑器'));
    }
    loadingTimerRef.current = setTimeout(() => {
      setIframeLoading(false);
      setLoadError(t('ide.err.loadTimeout', '编辑器加载超时，可能需要刷新'));
    }, 10000);
  };

  /* ── 关闭编辑器 ── */
  const handleDisconnect = () => {
    setEmbedFloating(false);
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

  const handleIframeLoad = () => {
    clearTimeout(loadingTimerRef.current);
    setIframeLoading(false);
    setLoadError(null);
  };

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

  useEffect(() => {
    if (!isDesktop() || !activeUrlRef.current) return;
    const rdk = (window as any).rdkDesktop;
    const url = activeUrlRef.current;
    const run = () => {
      if (activeTab === 'ide') {
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
    const t =
      !embedFloating && activeTab !== 'ide'
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
      (window as any).rdkDesktop?.setEmbedFloatMode?.(url, next, t('ide.title', '代码编辑器'));
      return next;
    });
  }, [t]);

  /** 对话「打开 IDE」：与「打开 code-server」同源；已就绪则只补浮窗 */
  const runRemoteConnectIntentRef = useRef<() => void>(() => {});
  useEffect(() => {
    runRemoteConnectIntentRef.current = () => {
      if (iframeLoading) {
        addToast(
          t(
            'ide.toast.connectingWait',
            '正在连接代码编辑器（同类型仅 1 个）；可与远程桌面同时各开 1 个',
          ),
          'info',
        );
        return;
      }
      if (showIframe && !loadError) {
        if (!embedFloating) {
          consumeIdeConnectPreferFloat();
          toggleEmbedFloat();
          return;
        }
        consumeIdeConnectPreferFloat();
        addToast(
          t(
            'ide.toast.alreadyOpenSingle',
            '代码编辑器已打开（同类型仅 1 个）；可与远程桌面同时各浮 1 个',
          ),
          'info',
        );
        return;
      }
      void handleConnect();
    };
  });
  useEffect(() => {
    registerIdeRemoteConnect(() => runRemoteConnectIntentRef.current());
    return () => registerIdeRemoteConnect(null);
  }, []);

  /** 与 VNC 分离：顶栏「IDE 悬浮窗」只控制 code-server 嵌入 */
  useEffect(() => {
    if (!showIframe) {
      setIdeEmbedToolbar(null);
      return;
    }
    setIdeEmbedToolbar({
      showIframe: true,
      embedFloating,
      toggleEmbedFloat,
    });
    return () => setIdeEmbedToolbar(null);
  }, [showIframe, embedFloating, toggleEmbedFloat, setIdeEmbedToolbar]);

  if (!currentDevice) return <DeviceGuard feature={t('ide.guardFeature', '代码编辑器')} />;

  const desktop = isDesktop();
  const editorLabel = `code-server · ${currentDevice.ip}:${CODE_SERVER_PORT}`;

  return (
    <div className="immersive" ref={containerRef}>
      {/* ── 顶部工具栏 ── */}
      <div className="immersive-bar">
        <div className="immersive-bar-left">
          
          <span className="immersive-bar-title">{t('ide.title', '代码编辑器')}</span>
          <span className="badge badge-muted">{currentDevice ? t('ide.badge.cs', 'code-server') : t('ide.badge.vscode', 'VS Code')}</span>
          {currentDevice && (
            <span className="immersive-bar-meta">{currentDevice.name} · {currentDevice.ip}</span>
          )}
        </div>

        <div className="immersive-bar-center">
          {showIframe && (
            <span className="immersive-bar-status" title={loadError || ''}>
              <span className={`status-dot ${iframeLoading ? '' : loadError ? 'warn' : 'online'}`} />
              {iframeLoading
                ? t('ide.status.loading', '加载中')
                : loadError
                  ? t('ide.status.loadFail', '加载异常')
                  : t('ide.status.ready', '已就绪')}
            </span>
          )}
        </div>

        {showIframe ? (
          <div className="immersive-bar-right">
            <button
              type="button"
              className="btn btn-ghost btn-sm immersive-float-toggle"
              onClick={toggleEmbedFloat}
              title={
                embedFloating
                  ? t('ide.title.floatDock', '贴回主窗口')
                  : t('ide.title.floatOut', '拖出为悬浮窗，可拖到副屏；切换标签后仍可见')
              }
              aria-pressed={embedFloating}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
              <span>{embedFloating ? t('ide.floatBtn.dock', '贴回') : t('ide.floatBtn.floatOut', '浮出')}</span>
            </button>
            {/* 非桌面端才显示刷新按钮 */}
            {!desktop && (
              <button className="btn-icon" onClick={handleReload} title={t('ide.title.refresh', '刷新')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
              </button>
            )}

            <button
              className="btn-icon"
              onClick={() => window.open(getCodeServerUrl(), '_blank')}
              title={t('ide.title.openNew', '新窗口打开')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>

            {!desktop && (
              <button className="btn-icon" onClick={toggleFullscreen} title={t('ide.title.fullscreen', '全屏 (F11)')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {isFullscreen ? (
                    <><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></>
                  ) : (
                    <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>
                  )}
                </svg>
              </button>
            )}

            <div className="immersive-bar-sep" />

            <button className="btn btn-ghost" onClick={handleDisconnect}>
              {t('ide.close', '关闭')}
            </button>
          </div>
        ) : null}
      </div>

      {/* ── 主视口 ── */}
      <div className="immersive-viewport">
        {showIframe ? (
          <>
            {iframeLoading && (
              <div className="immersive-loading">
                <div className="spinner" />
                <span className="immersive-loading-text">{tf('ide.loading', '正在加载 {{label}}...', { label: editorLabel })}</span>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: 4 }}>{t('ide.loading.hint', '首次加载可能需要 5-10 秒')}</span>
              </div>
            )}
            {/* 桌面端由 WebContentsView 渲染，此处只显示占位或错误 */}
            {desktop ? (
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
                    {loadError.includes(t('ide.marker.notInstalled', '未安装')) && currentDevice && (
                      <button className="btn btn-primary" disabled={installing} onClick={handleInstall}>
                        {installing ? t('ide.installing', '正在安装...') : t('ide.installBtn', '一键安装 code-server')}
                      </button>
                    )}
                    <button className="btn btn-ghost" onClick={() => { handleDisconnect(); }}>{t('ide.backRetry', '返回重试')}</button>
                  </>
                ) : (
                  <span>
                    {embedFloating
                      ? t('ide.desktop.floating', '编辑器已在独立窗口中，可拖到副屏与 Studio 并排')
                      : t('ide.desktop.loaded', 'code-server 已在独立视图中加载')}
                  </span>
                )}
              </div>
            ) : (
              <FloatingEmbedPanel
                title={editorLabel}
                dockLabel={t('ide.title.floatDock', '贴回')}
                floating={embedFloating}
                onFloatingChange={setEmbedFloating}
                storageKey="ide"
                backfill={<span className="floating-embed-backfill-default">{t('ide.floatBackfill', '编辑器在悬浮窗中，可切换到 AI 对话或其它页面，窗口保持置顶可见。')}</span>}
                dragbarExtra={
                  <button type="button" className="btn btn-ghost btn-sm" onClick={handleDisconnect}>
                    {t('ide.close', '关闭')}
                  </button>
                }
              >
                <iframe
                  ref={iframeRef}
                  src={getCodeServerUrl()}
                  title="code-server"
                  onLoad={handleIframeLoad}
                  allow="clipboard-read; clipboard-write; fullscreen"
                />
              </FloatingEmbedPanel>
            )}
          </>
        ) : (
          <div className="immersive-welcome">
            <div className="immersive-welcome-visual">
              <div className="immersive-welcome-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                </svg>
              </div>
              <div className="immersive-welcome-glow" />
            </div>

            <h2 className="immersive-welcome-title">
              {currentDevice ? t('ide.welcome.titleCs', 'code-server 编辑器') : t('ide.welcome.titleWeb', 'VS Code Web 编辑器')}
            </h2>
            <p className="immersive-welcome-desc">
              {currentDevice
                ? tf('ide.welcome.descCs', '连接开发者套件 {{ip}} 上的 code-server，直接编辑 /root 目录代码', { ip: currentDevice.ip })
                : t('ide.welcome.descWeb', '基于 vscode.dev 的在线代码编辑器，支持中文界面，可通过 Remote SSH 连接到开发者套件')}
            </p>

            {loadError?.includes(t('ide.marker.notInstalled', '未安装')) && currentDevice && (
              <button className="btn btn-primary" onClick={handleInstall} disabled={installing}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {installing ? t('ide.installing', '正在安装...') : t('ide.installBtn', '一键安装 code-server')}
              </button>
            )}

            <button className="btn btn-primary" onClick={handleConnect} disabled={!currentDevice || installing}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
              </svg>
              {currentDevice ? t('ide.openCs', '打开 code-server') : t('ide.openVscode', '打开 VS Code')}
            </button>

            <div className="immersive-feature-hints">
              {!desktop && (
                <div className="immersive-feature-hint">
                  <kbd>F11</kbd>
                  <span>{t('ide.hint.fullscreen', '全屏模式')}</span>
                </div>
              )}
              {!desktop && (
                <div className="immersive-feature-hint">
                  <span className="immersive-hint-dot" />
                  <span>{t('ide.hint.float', '连接后可用工具栏「悬浮窗」与 AI 对话并排对照')}</span>
                </div>
              )}
              <div className="immersive-feature-hint">
                <span className="immersive-hint-dot" />
                <span>{currentDevice ? tf('ide.hint.port', '设备端口 {{port}}', { port: CODE_SERVER_PORT }) : t('ide.hint.ssh', '支持 Remote SSH 连接设备')}</span>
              </div>
              <div className="immersive-feature-hint">
                <span className="immersive-hint-dot" />
                <span>{t('ide.hint.ui', '中文界面 · 插件生态')}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
