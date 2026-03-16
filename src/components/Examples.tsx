import { useState } from 'react';
import { runExample } from '../api';
import { useAppState } from '../hooks/useAppState';

const EXAMPLES = [
  { id: 'visual-follow', name: '视觉跟随', command: 'ros2 launch visual_follow visual_follow.launch.py' },
  { id: 'body-detect', name: '人体检测', command: 'ros2 launch hobot_dnn_detection body_detection.launch.py' },
  { id: 'gesture-ctrl', name: '手势控制', command: 'ros2 launch gesture_ctrl gesture.launch.py' },
  { id: 'topic-demo', name: 'ROS 话题示例', command: 'ros2 topic list' },
];

export default function Examples() {
  const { addToast, currentDevice } = useAppState();
  const [selectedExample, setSelectedExample] = useState(EXAMPLES[0].id);
  const [command, setCommand] = useState(EXAMPLES[0].command);
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);

  const onSelectExample = (id: string) => {
    setSelectedExample(id);
    const found = EXAMPLES.find((item) => item.id === id);
    if (found) setCommand(found.command);
  };

  const runExampleCommand = () => {
    if (!currentDevice) {
      addToast('请先连接真实设备', 'warning');
      return;
    }
    setRunning(true);
    runExample(currentDevice.id, command)
      .then((res) => {
        setOutput(res.output || '无输出');
      })
      .catch((error) => {
        addToast(error instanceof Error ? error.message : '示例执行失败', 'error');
      })
      .finally(() => setRunning(false));
  };

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">📦 示例运行（真实设备）</div>
        <div className="desc-text">选择示例并执行真实板端命令，不再使用本地预览或假依赖状态。</div>

        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">设备</span>
          <span className="ai-recommend-text">{currentDevice ? currentDevice.name : '未连接设备'}</span>
        </div>

        <div className="chip-cloud" style={{ marginBottom: 12 }}>
          {EXAMPLES.map((item) => (
            <button key={item.id} className={`chip-btn ${selectedExample === item.id ? 'active' : ''}`} onClick={() => onSelectExample(item.id)}>
              {item.name}
            </button>
          ))}
        </div>

        <div className="panel-card">
          <div className="panel-title">启动命令</div>
          <textarea
            className="clean-input"
            style={{ width: '100%', minHeight: 90, resize: 'vertical' }}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
          <button className="clean-btn" style={{ marginTop: 10 }} onClick={runExampleCommand} disabled={running || !currentDevice}>
            {running ? '执行中...' : '运行示例'}
          </button>
        </div>

        <div className="panel-card" style={{ marginTop: 14 }}>
          <div className="panel-title">执行输出</div>
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
