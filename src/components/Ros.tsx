import { useEffect, useMemo, useState } from 'react';
import { executeDeviceCommand, fetchRosTopics } from '../api';
import { useAppState } from '../hooks/useAppState';

const ANALYSIS_TOOLS = [
  { id: 'list', name: '列出话题', cmd: 'ros2 topic list' },
  { id: 'hz', name: '频率检测', cmd: 'ros2 topic hz' },
  { id: 'echo', name: '消息监听', cmd: 'ros2 topic echo' },
  { id: 'nodes', name: '节点列表', cmd: 'ros2 node list' },
  { id: 'graph', name: '节点关系图', cmd: 'ros2 run rqt_graph rqt_graph' },
  { id: 'record', name: '录包', cmd: 'ros2 bag record -a' },
];

export default function Ros() {
  const { rosTopic, setRosTopic, rosRecording, setRosRecording, addToast, currentDevice } = useAppState();
  const [activeView, setActiveView] = useState<'topics' | 'tools'>('topics');
  const [topicSearch, setTopicSearch] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [lastOutput, setLastOutput] = useState('');
  const [loading, setLoading] = useState(false);

  const loadTopics = () => {
    if (!currentDevice) {
      addToast('请先连接真实设备', 'warning');
      return;
    }
    setLoading(true);
    fetchRosTopics(currentDevice.id)
      .then((res) => {
        if (res.output.includes('ROS2_NOT_INSTALLED')) {
          setTopics([]);
          setLastOutput('检测到设备未安装 ROS2 环境。\n可先执行：sudo apt update && sudo apt install ros-humble-ros-base\n安装后重新刷新话题列表。');
          addToast('设备未安装 ROS2，请先安装后再使用话题分析', 'warning');
          return;
        }
        setTopics(res.topics);
        setLastOutput(res.output);
        if (res.topics.length > 0 && !res.topics.includes(rosTopic)) {
          setRosTopic(res.topics[0]);
        }
      })
      .catch((error) => {
        addToast(error instanceof Error ? error.message : '读取 ROS 话题失败', 'error');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (currentDevice) {
      loadTopics();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDevice?.id]);

  const filteredTopics = useMemo(() => {
    if (!topicSearch.trim()) return topics;
    return topics.filter((topic) => topic.toLowerCase().includes(topicSearch.toLowerCase()));
  }, [topicSearch, topics]);

  const runRosTool = (baseCmd: string) => {
    if (!currentDevice) {
      addToast('请先连接真实设备', 'warning');
      return;
    }
    const cmd = (baseCmd === 'ros2 topic hz' || baseCmd === 'ros2 topic echo') && rosTopic
      ? `${baseCmd} ${rosTopic}`
      : baseCmd;
    executeDeviceCommand(currentDevice.id, cmd)
      .then((res) => {
        if (res.output.includes('ROS2_NOT_INSTALLED') || /ros2:\s*command not found/i.test(res.output)) {
          setLastOutput('命令执行失败：设备未安装 ROS2。\n建议先安装 ros-humble-ros-base 后重试。');
          addToast('ROS2 未安装', 'warning');
          return;
        }
        setLastOutput(res.output);
      })
      .catch((error) => {
        addToast(error instanceof Error ? error.message : '命令执行失败', 'error');
      });
  };

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">📡 ROS 话题分析</div>
        <div className="desc-text">所有信息来自设备实时命令输出，不再使用静态示例话题。</div>

        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">🔄 实时状态</span>
          <span className="ai-recommend-text">
            已发现 <strong>{topics.length}</strong> 个话题
          </span>
          <button className="clean-btn outline-btn sm-btn" onClick={loadTopics} disabled={loading}>刷新</button>
        </div>

        {/* View toggle */}
        <div className="chip-cloud" style={{ marginBottom: 16 }}>
          <button className={`chip-btn ${activeView === 'topics' ? 'active' : ''}`} onClick={() => setActiveView('topics')}>
            📡 话题监控
          </button>
          <button className={`chip-btn ${activeView === 'tools' ? 'active' : ''}`} onClick={() => setActiveView('tools')}>
            🔧 分析工具
          </button>
        </div>

        {activeView === 'tools' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {ANALYSIS_TOOLS.map(tool => (
                <div key={tool.id} className="panel-card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <strong style={{ fontSize: '0.9rem' }}>{tool.name}</strong>
                  </div>
                  <div className="terminal-screen" style={{ minHeight: 'auto', padding: '6px 10px', fontSize: '0.75rem', marginBottom: 8 }}>
                    <div className="terminal-line">$ {tool.cmd}</div>
                  </div>
                  <button className="clean-btn outline-btn sm-btn" style={{ width: '100%' }}
                    onClick={() => runRosTool(tool.cmd)}>
                    立即执行
                  </button>
                </div>
              ))}
            </div>
            <div className="panel-card" style={{ marginTop: 12 }}>
              <div className="panel-title">命令输出</div>
              <div className="terminal-screen" style={{ minHeight: 220 }}>
                {lastOutput.split(/\r?\n/).filter(Boolean).map((line, i) => <div key={`${line}-${i}`} className="terminal-line">{line}</div>)}
              </div>
            </div>
          </>
        ) : (
          <div className="workspace-grid" style={{ gridTemplateColumns: '1fr 1.6fr' }}>
            <div className="panel-card">
              <div className="panel-title">话题列表</div>
              <div style={{ marginBottom: 10 }}>
                <input
                  className="clean-input"
                  style={{ width: '100%', fontSize: '0.82rem' }}
                  placeholder="🔍 搜索话题名或消息类型..."
                  value={topicSearch}
                  onChange={e => setTopicSearch(e.target.value)}
                />
              </div>
              <div className="option-list">
                {filteredTopics.map((topic) => {
                  return (
                    <button key={topic} className={`select-card ${rosTopic === topic ? 'active' : ''}`} onClick={() => setRosTopic(topic)}>
                      <strong style={{ fontFamily: 'Consolas, monospace', fontSize: '0.85rem' }}>{topic}</strong>
                    </button>
                  );
                })}
              </div>
              <label className="toggle-row" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={rosRecording} onChange={(e) => setRosRecording(e.target.checked)} />
                <span>录制当前 Topic 数据流</span>
              </label>
            </div>

            <div className="panel-card">
              <div className="panel-title">{rosTopic || '未选中话题'}</div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="clean-btn outline-btn sm-btn" onClick={() => runRosTool('ros2 topic echo')}>
                  监听当前话题
                </button>
                <button className="clean-btn outline-btn sm-btn" onClick={() => runRosTool('ros2 topic hz')}>
                  检测频率
                </button>
                <button className="clean-btn outline-btn sm-btn" onClick={loadTopics}>
                  🔄 刷新
                </button>
              </div>

              <div className="terminal-screen" style={{ minHeight: 300, marginTop: 12 }}>
                {lastOutput.split(/\r?\n/).filter(Boolean).map((line, i) => <div key={`${line}-${i}`} className="terminal-line">{line}</div>)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
