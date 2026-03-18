import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';
import { executeDeviceCommand } from '../api';

/* ── ROS 可视化 — 内嵌 Webviz + 自动启动 rosbridge ── */
const WEBVIZ_BASE = 'https://webviz.io/app/';
const ROSBRIDGE_PORT = 9090;

type Phase = 'idle' | 'checking' | 'starting' | 'connecting' | 'connected' | 'error';

export default function Ros() {
  const { currentDevice, addToast } = useAppState();

  const [phase, setPhase] = useState<Phase>('idle');
  const [statusText, setStatusText] = useState('');
  const [showIframe, setShowIframe] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [rosbridgeUrl, setRosbridgeUrl] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const appendLog = (line: string) => {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogLines(prev => [...prev, `[${ts}] ${line}`]);
  };

  /* 构建带 rosbridge 连接的 Webviz URL */
  const buildWebvizUrl = useCallback((deviceIp: string) => {
    const wsUrl = `ws://${deviceIp}:${ROSBRIDGE_PORT}`;
    // Webviz 支持通过 URL 参数指定 rosbridge 数据源
    return `${WEBVIZ_BASE}?rosbridge-websocket-url=${encodeURIComponent(wsUrl)}`;
  }, []);

  /* 检查 rosbridge 是否在运行 */
  const checkRosbridge = useCallback(async (deviceId: string): Promise<boolean> => {
    try {
      const result = await executeDeviceCommand(
        deviceId,
        `bash -lc "ss -lntp 2>/dev/null | grep -q ':${ROSBRIDGE_PORT}' && echo ROSBRIDGE_ACTIVE || echo ROSBRIDGE_INACTIVE"`
      );
      const output = result.output || '';
      appendLog(output.trim());
      return output.includes('ROSBRIDGE_ACTIVE');
    } catch {
      return false;
    }
  }, []);

  /* 启动 rosbridge_websocket */
  const startRosbridge = useCallback(async (deviceId: string): Promise<boolean> => {
    try {
      // 尝试多种方式启动 rosbridge
      const result = await executeDeviceCommand(
        deviceId,
        `bash -lc "
          # 尝试 ROS2 方式启动
          if command -v ros2 &>/dev/null; then
            source /opt/ros/*/setup.bash 2>/dev/null || true
            source /opt/tros/*/setup.bash 2>/dev/null || true
            nohup ros2 launch rosbridge_server rosbridge_websocket_launch.xml port:=${ROSBRIDGE_PORT} &>/tmp/rosbridge.log &
            sleep 3
          # 尝试 ROS1 方式启动
          elif command -v roslaunch &>/dev/null; then
            source /opt/ros/*/setup.bash 2>/dev/null || true
            nohup roslaunch rosbridge_server rosbridge_websocket.launch port:=${ROSBRIDGE_PORT} &>/tmp/rosbridge.log &
            sleep 3
          fi
          # 检查是否启动成功
          ss -lntp 2>/dev/null | grep -q ':${ROSBRIDGE_PORT}' && echo ROSBRIDGE_STARTED || echo ROSBRIDGE_FAILED
        "`
      );
      const output = result.output || '';
      output.split(/\r?\n/).filter(Boolean).forEach(l => appendLog(l));
      return output.includes('ROSBRIDGE_STARTED');
    } catch (err) {
      appendLog(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }, []);

  /* 完整连接流程：检查 → 启动 → 连接 Webviz */
  const handleConnect = useCallback(async () => {
    if (!currentDevice) {
      addToast('请先连接设备', 'warning');
      return;
    }

    setLogLines([]);
    setPhase('checking');
    setStatusText('检查 rosbridge 服务状态...');
    appendLog('开始检查 rosbridge 服务...');
    addToast('正在检查 rosbridge 服务...', 'info');

    // 1. 检查 rosbridge 是否已运行
    let active = await checkRosbridge(currentDevice.id);

    if (!active) {
      // 2. 尝试启动 rosbridge
      setPhase('starting');
      setStatusText('正在启动 rosbridge_websocket...');
      appendLog('rosbridge 未运行，尝试启动...');
      addToast('正在启动 rosbridge_websocket...', 'info');

      active = await startRosbridge(currentDevice.id);

      if (!active) {
        setPhase('error');
        setStatusText('rosbridge 启动失败，请确认已安装 rosbridge_server');
        addToast('rosbridge 启动失败，请检查设备上是否安装了 rosbridge_server', 'warning');
        appendLog('rosbridge 启动失败');
        return;
      }
    }

    // 3. rosbridge 就绪，加载 Webviz
    setPhase('connecting');
    setStatusText('rosbridge 就绪，正在加载 Webviz...');
    appendLog(`rosbridge 运行中 (端口 ${ROSBRIDGE_PORT})`);
    addToast('rosbridge 已就绪，正在连接 Webviz', 'success');

    const url = buildWebvizUrl(currentDevice.ip);
    setRosbridgeUrl(url);
    setIframeLoading(true);
    setShowIframe(true);
  }, [currentDevice, addToast, checkRosbridge, startRosbridge, buildWebvizUrl]);

  /* 断开连接 */
  const handleDisconnect = () => {
    setShowIframe(false);
    setIframeLoading(false);
    setPhase('idle');
    setRosbridgeUrl('');
  };

  /* 停止 rosbridge */
  const handleStopRosbridge = async () => {
    if (!currentDevice) return;
    appendLog('正在停止 rosbridge...');
    try {
      await executeDeviceCommand(
        currentDevice.id,
        `bash -lc "pkill -f rosbridge_websocket || pkill -f rosbridge_server || true; sleep 1; ss -lntp 2>/dev/null | grep -q ':${ROSBRIDGE_PORT}' && echo STILL_RUNNING || echo STOPPED"`
      );
      appendLog('rosbridge 已停止');
      addToast('rosbridge 已停止', 'info');
    } catch {
      appendLog('停止 rosbridge 失败');
    }
    handleDisconnect();
  };

  const handleIframeLoad = () => {
    setIframeLoading(false);
    setPhase('connected');
    appendLog('Webviz 加载完成');
  };

  const handleReload = () => {
    if (iframeRef.current && rosbridgeUrl) {
      setIframeLoading(true);
      iframeRef.current.src = rosbridgeUrl;
      appendLog('刷新 Webviz...');
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
      if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /* 设备切换时断开 */
  useEffect(() => {
    handleDisconnect();
  }, [currentDevice?.id]);

  return (
    <div className="ros-container" ref={containerRef}>
      {/* ── 顶部工具栏 ── */}
      <div className="ros-topbar">
        <div className="ros-topbar-left">
          <div className="ros-topbar-dots">
            <span className="ros-dot red" />
            <span className="ros-dot yellow" />
            <span className="ros-dot green" />
          </div>
          <span className="ros-topbar-title">ROS 可视化</span>
          <span className="ros-topbar-badge">Webviz</span>
          {currentDevice && (
            <span className="ros-topbar-device">{currentDevice.name} · {currentDevice.ip}</span>
          )}
        </div>

        <div className="ros-topbar-center">
          {showIframe && (
            <span className={`ros-status-badge ${phase === 'connected' ? 'live' : ''}`}>
              <span className="ros-status-dot" />
              {phase === 'connected' ? '已连接' : phase === 'connecting' ? '连接中' : '未连接'}
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

              <button className="ros-tool-btn" onClick={() => window.open(rosbridgeUrl, '_blank')} title="新窗口打开">
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

              <button className="ros-tool-btn" onClick={() => setShowLogs(!showLogs)} title="日志">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </button>

              <div className="ros-topbar-sep" />

              <button className="ros-disconnect-btn" onClick={handleStopRosbridge}>
                停止并断开
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── 主视口 ── */}
      <div className="ros-viewport">
        {showIframe ? (
          <>
            {iframeLoading && (
              <div className="ros-loading-overlay">
                <div className="ros-loading-spinner" />
                <span className="ros-loading-text">正在加载 Webviz...</span>
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={rosbridgeUrl}
              className="ros-iframe"
              title="Webviz ROS Visualization"
              onLoad={handleIframeLoad}
              allow="clipboard-read; clipboard-write; fullscreen"
            />
            {/* 日志抽屉 */}
            {showLogs && (
              <div className="ros-log-drawer">
                <div className="ros-log-header">
                  <span>连接日志</span>
                  <button className="ros-log-close" onClick={() => setShowLogs(false)}>×</button>
                </div>
                <div className="ros-log-body">
                  {logLines.map((line, i) => (
                    <div key={i} className="ros-log-line">{line}</div>
                  ))}
                  {logLines.length === 0 && (
                    <div className="ros-log-line" style={{ color: '#555' }}>等待输出...</div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          /* ── 欢迎/连接界面 ── */
          <div className="ros-welcome">
            <div className="ros-welcome-visual">
              <div className="ros-welcome-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <circle cx="12" cy="4" r="1.5" /><circle cx="20" cy="12" r="1.5" />
                  <circle cx="12" cy="20" r="1.5" /><circle cx="4" cy="12" r="1.5" />
                  <line x1="12" y1="7" x2="12" y2="9" /><line x1="15" y1="12" x2="17" y2="12" />
                  <line x1="12" y1="15" x2="12" y2="17" /><line x1="7" y1="12" x2="9" y2="12" />
                </svg>
              </div>
              <div className="ros-welcome-glow" />
            </div>

            <h2 className="ros-welcome-title">ROS 可视化工作台</h2>
            <p className="ros-welcome-desc">
              自动启动 rosbridge_websocket 并通过 Webviz 实时可视化 ROS 话题、TF、点云等数据
            </p>

            {phase === 'checking' && (
              <div className="ros-phase-indicator">
                <div className="ros-phase-spinner" />
                <span>{statusText}</span>
              </div>
            )}

            {phase === 'starting' && (
              <div className="ros-phase-indicator">
                <div className="ros-phase-spinner" />
                <span>{statusText}</span>
              </div>
            )}

            {phase === 'error' && (
              <div className="ros-error-banner">
                <span>⚠️ {statusText}</span>
                <button className="ros-retry-btn" onClick={handleConnect}>重试</button>
              </div>
            )}

            {(phase === 'idle' || phase === 'error') && (
              <button
                className="ros-connect-main-btn"
                onClick={handleConnect}
                disabled={!currentDevice}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                启动 rosbridge 并连接
              </button>
            )}

            {!currentDevice && (
              <p className="ros-no-device">请先在左侧选择一个设备</p>
            )}

            <div className="ros-welcome-hints">
              <div className="ros-hint-item">
                <kbd>F11</kbd>
                <span>全屏模式</span>
              </div>
              <div className="ros-hint-item">
                <span className="ros-hint-dot" />
                <span>自动启动 rosbridge</span>
              </div>
              <div className="ros-hint-item">
                <span className="ros-hint-dot" />
                <span>支持 ROS1 / ROS2</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
