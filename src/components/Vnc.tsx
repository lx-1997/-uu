import { useEffect, useState } from 'react';
import { executeDeviceCommand, fetchVncStatus } from '../api';
import { useAppState } from '../hooks/useAppState';

export default function Vnc() {
  const {
    currentDevice, vncConnected, vncPhase, startVncSession, addToast,
  } = useAppState();
  const [statusOutput, setStatusOutput] = useState('');
  const [repairing, setRepairing] = useState(false);
  const [noVncReady, setNoVncReady] = useState(false);

  useEffect(() => {
    if (!currentDevice) return;
    fetchVncStatus(currentDevice.id)
      .then((res) => setStatusOutput(res.output))
      .catch(() => setStatusOutput('VNC 状态读取失败'));

    executeDeviceCommand(currentDevice.id, "bash -lc \"ss -lntp 2>/dev/null | grep ':6080' || pgrep -af 'websockify|novnc' || echo NOVNC_NOT_FOUND\"")
      .then((res) => {
        setNoVncReady(!/NOVNC_NOT_FOUND/.test(res.output));
      })
      .catch(() => setNoVncReady(false));
  }, [currentDevice]);

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🖥️ 远程桌面（真实设备）</div>
        <div className="desc-text">先检查板端 VNC 服务状态，再按真实地址连接，不再渲染模拟桌面。</div>

        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">状态</span>
          <span className="ai-recommend-text">{vncConnected ? 'VNC 服务在线' : 'VNC 服务未就绪'} · {vncPhase}</span>
          <button className="clean-btn outline-btn sm-btn" onClick={startVncSession}>检查服务</button>
        </div>

        <div className="panel-card" style={{ marginBottom: 12 }}>
          <div className="panel-title">连接步骤</div>
          <div className="usage-list">
            <div className="usage-item"><strong>1. 板端启用 VNC</strong><span>可通过 srpi-config → Interface Options → VNC 打开</span></div>
            <div className="usage-item"><strong>2. 本机连接</strong><span>优先使用 VNC Viewer 连接 {currentDevice?.ip || '设备IP'}:5900</span></div>
            <div className="usage-item"><strong>3. 密码说明</strong><span>若提示认证失败，请在板端重设 VNC 密码（需 8 位）</span></div>
          </div>
          <button
            className="clean-btn outline-btn"
            style={{ marginTop: 10, marginRight: 8 }}
            onClick={() => {
              if (!currentDevice) {
                addToast('请先连接设备', 'warning');
                return;
              }
              setRepairing(true);
              executeDeviceCommand(
                currentDevice.id,
                'bash -lc "(systemctl start vncserver || systemctl start x11vnc || true); (systemctl is-active vncserver || systemctl is-active x11vnc || pgrep -af \'x11vnc|Xtigervnc|vncserver\' || echo inactive)"',
              )
                .then((res) => {
                  setStatusOutput(res.output || '无输出');
                  addToast('已执行 VNC 服务启动/检测', 'info');
                  startVncSession();
                })
                .catch((error) => addToast(error instanceof Error ? error.message : 'VNC 修复执行失败', 'error'))
                .finally(() => setRepairing(false));
            }}
            disabled={repairing || !currentDevice}
          >
            {repairing ? '执行中...' : '一键启动并检测 VNC'}
          </button>
          <button
            className="clean-btn"
            style={{ marginTop: 10 }}
            onClick={() => {
              if (!currentDevice) {
                addToast('请先连接设备', 'warning');
                return;
              }
              window.open(`http://${currentDevice.ip}:6080/vnc.html`, '_blank');
            }}
            disabled={!noVncReady}
          >
            {noVncReady ? '打开 noVNC 地址' : 'noVNC 未部署'}
          </button>
          {!noVncReady && (
            <div style={{ marginTop: 8, fontSize: '0.76rem', color: '#64748b' }}>
              当前设备未检测到 noVNC（6080）。建议使用 VNC Viewer 连接 {currentDevice?.ip || '设备IP'}:5900。
            </div>
          )}
        </div>

        <div className="panel-card">
          <div className="panel-title">服务探测输出</div>
          <div className="terminal-screen" style={{ minHeight: 180 }}>
            {statusOutput.split(/\r?\n/).filter(Boolean).map((line, index) => (
              <div key={`${line}-${index}`} className="terminal-line">{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
