import { useState } from 'react';
import { runOpenClawAgentAction } from '../api';
import { useAppState } from '../hooks/useAppState';

export default function OpenClaw() {
  const { currentDevice, addToast } = useAppState();
  const [modelName, setModelName] = useState('qwen3.5-plus');
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState('');

  const execAction = (action: 'start' | 'status' | 'switch' | 'install' | 'logs') => {
    if (!currentDevice) {
      addToast('请先连接真实设备', 'warning');
      return;
    }
    setRunning(true);
    runOpenClawAgentAction(action, { host: currentDevice.ip, username: 'root', modelName })
      .then((res) => {
        if (res.error) {
          addToast(res.error, 'error');
          return;
        }
        const nextOutput = 'output' in res ? (res.output ?? '') : '';
        setOutput(nextOutput || '无输出');
        addToast(`OpenClaw ${action} 执行完成`, 'success');
      })
      .finally(() => setRunning(false));
  };

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">⚙️ OpenClaw（真实设备）</div>
        <div className="desc-text">直接在板端执行 install/start/status/switch/logs，完全基于真实设备输出。</div>

        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">设备</span>
          <span className="ai-recommend-text">{currentDevice ? currentDevice.name : '未连接设备'}</span>
        </div>

        <div className="panel-card" style={{ marginBottom: 12 }}>
          <div className="panel-title">操作面板</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <button className="clean-btn" onClick={() => execAction('install')} disabled={running || !currentDevice}>安装依赖</button>
            <button className="clean-btn" onClick={() => execAction('start')} disabled={running || !currentDevice}>启动网关</button>
            <button className="clean-btn outline-btn" onClick={() => execAction('status')} disabled={running || !currentDevice}>查询状态</button>
            <button className="clean-btn outline-btn" onClick={() => execAction('switch')} disabled={running || !currentDevice}>切换模型</button>
            <button className="clean-btn outline-btn" onClick={() => execAction('logs')} disabled={running || !currentDevice}>查看日志</button>
          </div>
          <input
            className="clean-input"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="用于 switch 动作的模型名"
            style={{ width: '100%' }}
          />
        </div>

        <div className="panel-card">
          <div className="panel-title">板端输出</div>
          <div className="terminal-screen" style={{ minHeight: 260 }}>
            {output.split(/\r?\n/).filter(Boolean).map((line, index) => (
              <div key={`${line}-${index}`} className="terminal-line">{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
