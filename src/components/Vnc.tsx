import { useAppState } from '../hooks/useAppState';

export default function Vnc() {
  const {
    currentDevice, vncConnected, startVncSession, addToast,
  } = useAppState();

  const tools = [
    { name: 'noVNC (内置)', desc: '基于 WebSocket 的浏览器直连方案，零安装、局域网低延迟', tag: '推荐局域网', action: () => startVncSession(), btnText: '启动连接' },
    { name: 'RustDesk', desc: '开源远程桌面，支持 P2P 穿透，适合公网场景', tag: '推荐公网', action: () => window.open('https://rustdesk.com/', '_blank'), btnText: '前往下载' },
    { name: 'Guacamole', desc: 'Apache 网关模式，浏览器中同时管理 VNC/RDP/SSH', tag: '多设备', action: () => window.open('https://guacamole.apache.org/', '_blank'), btnText: '了解更多' },
    { name: 'XPRA', desc: '单应用无缝远程，只转发指定窗口而非整个桌面', tag: '轻量', action: () => window.open('https://xpra.org/', '_blank'), btnText: '了解更多' },
  ];

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🖥️ 远程桌面</div>
        <div className="desc-text">选择合适的方式访问设备桌面环境。</div>

        {vncConnected && (
          <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
            <span className="ai-suggest-label">🧠 连接状态</span>
            <span className="ai-recommend-text">
              noVNC 已连接 · 延迟 <strong>12ms</strong> · 帧率 30fps · 连接稳定
            </span>
          </div>
        )}

        {vncConnected && (
          <div className="panel-card remote-desktop-card vnc-viewport-card">
            <div className="remote-desktop active">
              <div className="desktop-window"></div>
              <div className="desktop-sidebar"></div>
              <div className="desktop-content">
                <div className="desktop-panel"></div>
                <div className="desktop-panel wide"></div>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: vncConnected ? 14 : 0 }}>
          {tools.map(t => (
            <div key={t.name} className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '0.92rem' }}>{t.name}</strong>
                <span style={{ fontSize: '0.68rem', padding: '2px 8px', borderRadius: 6, background: '#f0f9ff', color: '#1e40af' }}>{t.tag}</span>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5, flex: 1 }}>{t.desc}</div>
              <button className="clean-btn outline-btn" style={{ width: '100%', fontSize: '0.82rem' }} onClick={t.action}>{t.btnText}</button>
            </div>
          ))}
        </div>

        <div className="ai-recommend-strip" style={{ marginTop: 14 }}>
          <span className="ai-suggest-label">💡 提示</span>
          <span className="ai-recommend-text">
            局域网环境推荐使用内置 noVNC 即可满足需求；如果设备在公网，推荐 RustDesk 的 P2P 穿透方案。
          </span>
        </div>
      </div>
    </div>
  );
}
