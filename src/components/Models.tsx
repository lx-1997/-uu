import { useState } from 'react';
import { deployModel } from '../api';
import { useAppState } from '../hooks/useAppState';

export default function Models() {
  const { currentDevice, addToast } = useAppState();
  const [command, setCommand] = useState('bash -lc "hb_mapper makertbin --config config.yaml"');
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState('');

  const runDeploy = () => {
    if (!currentDevice) {
      addToast('请先连接真实设备', 'warning');
      return;
    }
    if (!command.trim()) {
      addToast('请输入部署命令', 'warning');
      return;
    }
    setRunning(true);
    deployModel(currentDevice.id, command)
      .then((res) => {
        setOutput(res.output || '无输出');
        addToast('模型部署命令执行完成', 'success');
      })
      .catch((error) => {
        addToast(error instanceof Error ? error.message : '模型部署失败', 'error');
      })
      .finally(() => setRunning(false));
  };

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🧠 模型部署（真实设备）</div>
        <div className="desc-text">输入板端真实部署命令并执行，结果直接返回，不再显示模拟模型状态。</div>

        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">设备</span>
          <span className="ai-recommend-text">
            {currentDevice ? currentDevice.name : '未连接设备'}
          </span>
        </div>

        <div className="panel-card">
          <div className="panel-title">部署命令</div>
          <textarea
            className="clean-input"
            style={{ width: '100%', minHeight: 100, resize: 'vertical' }}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="clean-btn" onClick={runDeploy} disabled={running || !currentDevice}>
              {running ? '执行中...' : '执行部署'}
            </button>
            <button className="clean-btn outline-btn" onClick={() => setCommand('bash -lc "hb_mapper makertbin --config config.yaml"')}>
              载入示例命令
            </button>
          </div>
        </div>

        <div className="panel-card" style={{ marginTop: 14 }}>
          <div className="panel-title">执行输出</div>
          <div className="terminal-screen" style={{ minHeight: 280 }}>
            {output.split(/\r?\n/).filter(Boolean).map((line, index) => (
              <div key={`${line}-${index}`} className="terminal-line">{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
