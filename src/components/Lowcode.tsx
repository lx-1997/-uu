import { useEffect, useState } from 'react';
import { executeDeviceCommand, fetchNodeRedStatus } from '../api';
import { useAppState } from '../hooks/useAppState';

export default function Lowcode() {
  const { currentDevice, addToast } = useAppState();
  const [statusOutput, setStatusOutput] = useState('');
  const [active, setActive] = useState(false);
  const [running, setRunning] = useState(false);

  const nodeRedUrl = currentDevice ? `http://${currentDevice.ip}:1880` : 'http://localhost:1880';

  const checkStatus = () => {
    if (!currentDevice) {
      addToast('请先连接真实设备', 'warning');
      return;
    }
    fetchNodeRedStatus(currentDevice.id)
      .then((res) => {
        setActive(res.active);
        setStatusOutput(res.output);
      })
      .catch((error) => {
        addToast(error instanceof Error ? error.message : 'Node-RED 状态检查失败', 'error');
      });
  };

  const startNodeRed = () => {
    if (!currentDevice) {
      addToast('请先连接真实设备', 'warning');
      return;
    }
    setRunning(true);
    executeDeviceCommand(currentDevice.id, 'bash -lc "(node-red-start || systemctl start nodered || node-red)"')
      .then((res) => {
        setStatusOutput(res.output);
        addToast('已触发 Node-RED 启动命令', 'success');
        checkStatus();
      })
      .catch((error) => {
        addToast(error instanceof Error ? error.message : 'Node-RED 启动失败', 'error');
      })
      .finally(() => setRunning(false));
  };

  useEffect(() => {
    if (currentDevice) checkStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDevice?.id]);

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🧩 流程编排 · Node-RED（真实设备）</div>
        <div className="desc-text">通过板端服务状态检测与真实启动命令接入，不再使用模拟连接状态。</div>

        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">状态</span>
          <span className="ai-recommend-text">{active ? 'Node-RED 已运行' : 'Node-RED 未运行'}</span>
          <button className="clean-btn outline-btn sm-btn" onClick={checkStatus}>刷新状态</button>
        </div>

        <div className="panel-card" style={{ marginBottom: 12 }}>
          <div className="panel-title">服务控制</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="clean-btn" onClick={startNodeRed} disabled={running || !currentDevice}>
              {running ? '启动中...' : '启动 Node-RED'}
            </button>
            <button className="clean-btn outline-btn" onClick={() => window.open(nodeRedUrl, '_blank')} disabled={!active}>
              打开编辑器
            </button>
          </div>
          <div style={{ marginTop: 10, fontSize: '0.78rem', color: '#64748b' }}>编辑器地址: {nodeRedUrl}</div>
        </div>

        <div className="panel-card">
          <div className="panel-title">状态输出</div>
          <div className="terminal-screen" style={{ minHeight: 220 }}>
            {statusOutput.split(/\r?\n/).filter(Boolean).map((line, index) => (
              <div key={`${line}-${index}`} className="terminal-line">{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
