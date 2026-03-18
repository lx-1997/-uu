import { useEffect, useState, useRef } from 'react';
import { executeDeviceCommand, fetchNodeRedStatus } from '../api';
import { useAppState } from '../hooks/useAppState';

/* ── 流程编排 · Node-RED ── */

type Phase = 'idle' | 'checking' | 'starting' | 'ready' | 'error';

export default function Lowcode() {
  const { currentDevice, addToast } = useAppState();
  const [phase, setPhase] = useState<Phase>('idle');
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showEmbed, setShowEmbed] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const nodeRedUrl = currentDevice ? `http://${currentDevice.ip}:1880` : '';

  const appendLog = (line: string) => {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [...prev.slice(-60), `[${ts}] ${line}`]);
  };

  /* 检查 Node-RED 状态 */
  const checkStatus = async () => {
    if (!currentDevice) { addToast('请先连接设备', 'warning'); return; }
    setPhase('checking');
    appendLog('检查 Node-RED 服务状态...');
    try {
      const res = await fetchNodeRedStatus(currentDevice.id);
      setActive(res.active);
      appendLog(res.active ? 'Node-RED 服务运行中' : 'Node-RED 未运行');
      if (res.output) appendLog(res.output.trim());
      setPhase(res.active ? 'ready' : 'idle');
    } catch (err) {
      appendLog(`状态检查失败: ${err instanceof Error ? err.message : String(err)}`);
      setPhase('error');
      addToast('Node-RED 状态检查失败', 'error');
    }
  };

  /* 启动 Node-RED */
  const startNodeRed = async () => {
    if (!currentDevice) return;
    setStarting(true);
    setPhase('starting');
    appendLog('正在启动 Node-RED...');
    addToast('正在启动 Node-RED...', 'info');
    try {
      const res = await executeDeviceCommand(
        currentDevice.id,
        'bash -lc "(node-red-start || systemctl start nodered || node-red) 2>&1"'
      );
      appendLog(res.output || '启动命令已执行');
      addToast('Node-RED 启动命令已执行', 'success');
      // 等待一下再检查状态
      setTimeout(() => checkStatus(), 2000);
    } catch (err) {
      appendLog(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
      setPhase('error');
      addToast('Node-RED 启动失败', 'error');
    } finally {
      setStarting(false);
    }
  };

  /* 打开内嵌编辑器 */
  const openEditor = () => {
    setShowEmbed(true);
    setIframeLoading(true);
    appendLog(`加载 Node-RED 编辑器: ${nodeRedUrl}`);
  };

  /* 设备切换时重置 */
  useEffect(() => {
    setPhase('idle');
    setActive(false);
    setShowEmbed(false);
    setLogs([]);
    if (currentDevice) checkStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDevice?.id]);

  /* ── 未连接设备 ── */
  if (!currentDevice) {
    return (
      <div className="lc-page">
        <div className="lc-empty-state">
          <div className="lc-empty-icon-wrap">
            <span className="lc-empty-glow" />
            <span style={{ fontSize: '3rem' }}>🧩</span>
          </div>
          <h2 className="lc-empty-title">流程编排 · Node-RED</h2>
          <p className="lc-empty-desc">可视化流程编排工具，通过拖拽节点构建 IoT 和 AI 工作流</p>
          <div className="lc-empty-steps">
            <div className="lc-empty-step"><span className="lc-step-num">1</span>连接 RDK 开发板</div>
            <div className="lc-empty-step"><span className="lc-step-num">2</span>启动 Node-RED 服务</div>
            <div className="lc-empty-step"><span className="lc-step-num">3</span>打开编辑器，拖拽构建流程</div>
          </div>
          <a href="https://nodered.org/" target="_blank" rel="noopener noreferrer" className="lc-ext-link">
            了解 Node-RED ↗
          </a>
        </div>
      </div>
    );
  }

  /* ── 内嵌编辑器模式 ── */
  if (showEmbed) {
    return (
      <div className="lc-page lc-embed-mode">
        {/* 顶部工具栏 */}
        <div className="lc-embed-topbar">
          <div className="lc-embed-topbar-left">
            <div className="lc-embed-dots">
              <span className="lc-dot red" /><span className="lc-dot yellow" /><span className="lc-dot green" />
            </div>
            <span className="lc-embed-title">Node-RED 编辑器</span>
            <span className="lc-embed-badge">
              {currentDevice.name} · {currentDevice.ip}:1880
            </span>
          </div>
          <div className="lc-embed-topbar-right">
            <button className="lc-tool-btn" onClick={() => { setIframeLoading(true); if (iframeRef.current) iframeRef.current.src = nodeRedUrl; }} title="刷新">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
            </button>
            <button className="lc-tool-btn" onClick={() => window.open(nodeRedUrl, '_blank')} title="新窗口打开">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
            <button className="lc-tool-btn" onClick={() => setShowLogs(!showLogs)} title="日志">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </button>
            <div className="lc-topbar-sep" />
            <button className="lc-back-btn" onClick={() => setShowEmbed(false)}>← 返回</button>
          </div>
        </div>

        {/* iframe 视口 */}
        <div className="lc-embed-viewport">
          {iframeLoading && (
            <div className="lc-loading-overlay">
              <div className="lc-loading-spinner" />
              <span className="lc-loading-text">正在加载 Node-RED...</span>
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={nodeRedUrl}
            className="lc-iframe"
            title="Node-RED Editor"
            onLoad={() => setIframeLoading(false)}
          />
          {showLogs && (
            <div className="lc-log-drawer">
              <div className="lc-log-header">
                <span>连接日志</span>
                <button className="lc-log-close" onClick={() => setShowLogs(false)}>×</button>
              </div>
              <div className="lc-log-body">
                {logs.map((line, i) => <div key={i} className="lc-log-line">{line}</div>)}
                {logs.length === 0 && <div className="lc-log-line" style={{ color: '#94a3b8' }}>等待输出...</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── 主页面 ── */
  return (
    <div className="lc-page">
      {/* 顶部状态栏 */}
      <div className="lc-topbar">
        <div className="lc-topbar-left">
          <span className="lc-topbar-icon">🧩</span>
          <span className="lc-topbar-name">流程编排</span>
          <span className="lc-topbar-badge">Node-RED</span>
        </div>
        <div className="lc-topbar-right">
          <span className={`lc-status-badge ${active ? 'live' : ''}`}>
            <span className="lc-status-dot" />
            {phase === 'checking' ? '检查中...' : phase === 'starting' ? '启动中...' : active ? '运行中' : '未运行'}
          </span>
        </div>
      </div>

      {/* 设备信息 */}
      <div className="lc-device-bar">
        <div className="lc-device-item"><span className="lc-device-label">设备</span><span className="lc-device-val">{currentDevice.name}</span></div>
        <span className="lc-device-sep" />
        <div className="lc-device-item"><span className="lc-device-label">IP</span><span className="lc-device-val mono">{currentDevice.ip}</span></div>
        <span className="lc-device-sep" />
        <div className="lc-device-item"><span className="lc-device-label">编辑器</span><span className="lc-device-val mono">{nodeRedUrl}</span></div>
        <span className="lc-device-sep" />
        <div className="lc-device-item"><span className="lc-device-label">状态</span><span className={`lc-device-val ${active ? 'ok' : ''}`}>{active ? '运行中' : '未运行'}</span></div>
      </div>

      {/* 操作区 */}
      <div className="lc-actions-grid">
        {/* 服务控制卡片 */}
        <div className="lc-action-card">
          <div className="lc-action-icon">🚀</div>
          <div className="lc-action-info">
            <span className="lc-action-title">服务控制</span>
            <span className="lc-action-desc">启动或检查 Node-RED 服务状态</span>
          </div>
          <div className="lc-action-btns">
            <button className="lc-btn primary" onClick={startNodeRed} disabled={starting || active}>
              {starting ? '启动中...' : active ? '已运行' : '启动服务'}
            </button>
            <button className="lc-btn ghost" onClick={checkStatus}>刷新状态</button>
          </div>
        </div>

        {/* 打开编辑器卡片 */}
        <div className="lc-action-card">
          <div className="lc-action-icon">✏️</div>
          <div className="lc-action-info">
            <span className="lc-action-title">打开编辑器</span>
            <span className="lc-action-desc">在当前页面内嵌打开 Node-RED 可视化编辑器</span>
          </div>
          <div className="lc-action-btns">
            <button className="lc-btn primary" onClick={openEditor} disabled={!active}>
              内嵌打开
            </button>
            <button className="lc-btn ghost" onClick={() => window.open(nodeRedUrl, '_blank')} disabled={!active}>
              新窗口 ↗
            </button>
          </div>
        </div>
      </div>

      {/* 功能介绍 */}
      <div className="lc-features">
        <div className="lc-feature">
          <span className="lc-feature-icon">📡</span>
          <span className="lc-feature-title">MQTT / HTTP</span>
          <span className="lc-feature-desc">连接各种 IoT 协议和 API</span>
        </div>
        <div className="lc-feature">
          <span className="lc-feature-icon">🤖</span>
          <span className="lc-feature-title">AI 推理</span>
          <span className="lc-feature-desc">集成 BPU 模型推理节点</span>
        </div>
        <div className="lc-feature">
          <span className="lc-feature-icon">📊</span>
          <span className="lc-feature-title">Dashboard</span>
          <span className="lc-feature-desc">内置仪表盘可视化数据</span>
        </div>
        <div className="lc-feature">
          <span className="lc-feature-icon">🔗</span>
          <span className="lc-feature-title">ROS 桥接</span>
          <span className="lc-feature-desc">与 ROS 话题和服务交互</span>
        </div>
      </div>

      {/* 日志 */}
      {logs.length > 0 && (
        <div className="lc-log-panel">
          <div className="lc-log-panel-header">
            <span>📋 操作日志</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="lc-btn ghost sm" onClick={() => setLogs([])}>清空</button>
            </div>
          </div>
          <pre className="lc-log-panel-body">{logs.join('\n')}</pre>
        </div>
      )}
    </div>
  );
}
