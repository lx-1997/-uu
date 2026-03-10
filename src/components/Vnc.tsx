import { useAppState } from '../hooks/useAppState';

export default function Vnc() {
  const {
    currentDevice, vncQuality, setVncQuality, vncLayout, setVncLayout,
    vncOverlay, vncConnected, vncProgress, vncPhase, startVncSession, addToast,
  } = useAppState();

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🖥️ 远程桌面</div>
        <div className="desc-text">基于 noVNC 的 HTML5 远程桌面 — 零插件、低延迟、浏览器直连。</div>

        <div className="vnc-toolbar">
          <div className="vnc-toolbar-left">
            <span className={`card-status-badge ${vncConnected ? 'ok' : 'warn'}`} style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
              <span className="card-status-dot"></span>
              {vncConnected ? '已连接' : '未连接'}
            </span>
            <span className="vnc-info">{currentDevice?.ip}:5900</span>
            {vncConnected && <span className="vnc-info vnc-latency">延迟 12ms</span>}
            {vncConnected && vncProgress < 100 && <span className="vnc-info vnc-phase">⏳ {vncPhase}</span>}
          </div>
          <div className="vnc-toolbar-right">
            {vncConnected && (
              <>
                <button className={`segment-btn sm ${vncLayout === 'fit' ? 'active' : ''}`} onClick={() => setVncLayout('fit')}>适配</button>
                <button className={`segment-btn sm ${vncLayout === 'pixel' ? 'active' : ''}`} onClick={() => setVncLayout('pixel')}>1:1</button>
                <span className="vnc-toolbar-divider"></span>
              </>
            )}
            {(['smooth', 'balanced', 'sharp'] as const).map((mode) => (
              <button key={mode} className={`segment-btn sm ${vncQuality === mode ? 'active' : ''}`} onClick={() => setVncQuality(mode)}>
                {mode === 'smooth' ? '流畅' : mode === 'balanced' ? '平衡' : '清晰'}
              </button>
            ))}
            <span className="vnc-toolbar-divider"></span>
            <button className="clean-btn outline-btn sm-btn" onClick={() => addToast('截屏已保存', 'success')}>📸</button>
            <button className="clean-btn outline-btn sm-btn" onClick={() => addToast('剪贴板已同步', 'success')}>📋</button>
            <button className="clean-btn outline-btn sm-btn" onClick={() => addToast('已切换全屏', 'info')}>⛶</button>
          </div>
        </div>

        <div className="panel-card remote-desktop-card vnc-viewport-card">
          <div className={`remote-desktop ${vncConnected ? 'active' : ''}`}>
            <div className="desktop-window"></div>
            <div className="desktop-sidebar"></div>
            <div className="desktop-content">
              <div className="desktop-panel"></div>
              <div className="desktop-panel wide"></div>
            </div>
            {!vncConnected && (
              <div className="vnc-empty-overlay">
                <div className="vnc-empty-icon">🖥️</div>
                <div className="vnc-empty-text">点击下方按钮连接远程桌面</div>
                <div className="vnc-tech-badge">Powered by noVNC · WebSocket → RFB</div>
              </div>
            )}
            {vncConnected && vncOverlay && (
              <div className="remote-overlay">
                <span>Quality: {vncQuality}</span>
                <span>Layout: {vncLayout}</span>
                <span>Latency: 12ms</span>
              </div>
            )}
          </div>
        </div>

        {!vncConnected && (
          <button className="clean-btn vnc-connect-btn" onClick={startVncSession}>发起连接</button>
        )}

        <div className="vnc-tech-note">
          <strong>可选方案:</strong> noVNC（WebSocket → VNC，适合轻量直连）· Apache Guacamole（网关模式，支持 VNC/RDP/SSH 聚合）·
          XPRA（单应用无缝远程）· RustDesk（P2P 穿透，适合公网场景）
        </div>
      </div>
    </div>
  );
}
