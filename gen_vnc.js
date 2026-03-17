const fs = require('fs');

const vncCode = \import { useEffect, useState } from 'react';
import { executeDeviceCommand, fetchVncStatus } from '../api';
import { useAppState } from '../hooks/useAppState';

export default function Vnc() {
  const { currentDevice, vncConnected, startVncSession, addToast } = useAppState();
  const [statusOutput, setStatusOutput] = useState('');
  const [repairing, setRepairing] = useState(false);
  const [showIframe, setShowIframe] = useState(false);

  useEffect(() => {
    if (!currentDevice) return;
    fetchVncStatus(currentDevice.id)
      .then((res) => setStatusOutput(res.output))
      .catch(() => setStatusOutput('Failed to read VNC status'));
  }, [currentDevice]);

  const getVncUrl = () => {
    if (!currentDevice) return '';
    const host = window.location.hostname;
    const backendPort = process.env.NODE_ENV === 'development' ? 8787 : window.location.port || 80;
    const wsPath = encodeURIComponent('websockify?target=' + currentDevice.ip + ':5900');
    return 'http://' + host + ':' + backendPort + '/vnc/vnc.html?autoconnect=true&resize=remote&path=' + wsPath;
  };

  const handleStartVnc = () => {
    if (!currentDevice) {
      addToast('Please connect to a device first.', 'warning');
      return;
    }
    setRepairing(true);
    addToast('Checking and starting device VNC service (port 5900)...', 'info');
    executeDeviceCommand(
      currentDevice.id,
      'bash -lc \\"(systemctl start vncserver || systemctl start x11vnc || true); (ss -lntp 2>/dev/null | grep -q \\\':5900\\' && echo SUCCESS || echo FAILED)\\"'
    ).then((res) => {
      setStatusOutput(res.output || 'No output');
      if (res.output.includes('SUCCESS')) {
        addToast('VNC Service running, establishing Web proxy connection...', 'success');
        setShowIframe(true);
      } else {
        addToast('Port 5900 not ready on the target device.', 'warning');
      }
      startVncSession();
    }).catch((e) => {
      addToast(e.message || 'Operation failed', 'error');
    }).finally(() => setRepairing(false));
  };

  return (
    <div className="center-stage wide-stage" style={{ height: '100%', overflowY: 'auto' }}>
      <div className="isolated-widget workflow-widget">
        <div className="widget-header"> Native Web VNC (Zero Device Installation)</div>
        <div className="desc-text">Directly leverages local Node.js proxy for WebSocket proxying. No target device dependencies needed!</div>

        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">Service Status</span>
          <span className="ai-recommend-text">{vncConnected ? 'Port 5900 ready' : 'Port 5900 not ready'}</span>
          <button className="clean-btn outline-btn sm-btn" onClick={() => startVncSession()}>Check Port</button>
        </div>

        {!showIframe ? (
          <div className="panel-card" style={{ marginBottom: 12 }}>
            <div className="panel-title">One-Click VNC Access</div>
            <div className="usage-list">
              <div className="usage-item"><strong>Seamless Experience</strong><span>Click the button below to instantly pull up the embedded Web Desktop. Zero installations needed on the target board.</span></div>
            </div>
            <button
              className="clean-btn outline-btn"
              style={{ marginTop: 10, marginRight: 8, color: '#0ea5e9', borderColor: '#0ea5e9' }}
              onClick={handleStartVnc}
              disabled={repairing || !currentDevice}
            >
              {repairing ? 'Connecting...' : 'Start & Connect Web Desktop'}
            </button>
          </div>
        ) : (
          <div className="panel-card" style={{ marginBottom: 16, height: 650, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '8px 12px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>noVNC Embedded Viewer</strong>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="clean-btn sm-btn outline-btn" style={{ background: '#fff' }} onClick={() => window.open(getVncUrl(), '_blank')}>Open in New Tab</button>
                <button className="clean-btn sm-btn outline-btn" style={{ background: '#fff' }} onClick={() => setShowIframe(false)}>Close</button>
              </div>
            </div>
            <iframe src={getVncUrl()} style={{ flex: 1, border: 'none', background: '#000' }} title="vnc" />
          </div>
        )}

        <div className="panel-card">
          <div className="panel-title">Proxy Logs</div>
          <div className="terminal-screen" style={{ minHeight: 120 }}>
            {statusOutput.split(/\\r?\\n/).filter(Boolean).map((line, index) => (
              <div key={index} className="terminal-line">{line}</div>
            ))}
            {!statusOutput && <div className="terminal-line" style={{ color: '#64748b' }}>Waiting for output...</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
\;

fs.writeFileSync('src/components/Vnc.tsx', vncCode, 'utf8');
