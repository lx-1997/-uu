import { useState, useEffect, useRef } from 'react';
import { useAppState } from '../hooks/useAppState';

/* ── ROS 话题分析 ── */

interface TopicInfo {
  name: string;
  type: string;
  hz: number;
  publishers: number;
  subscribers: number;
  active: boolean;
}

interface NodeInfo {
  name: string;
  type: 'publisher' | 'subscriber' | 'service';
  topics: string[];
}

const MOCK_TOPICS: TopicInfo[] = [
  { name: '/hobot_dnn/bbox', type: 'ai_msgs/PerceptionTargets', hz: 30, publishers: 1, subscribers: 2, active: true },
  { name: '/camera/color/image_raw', type: 'sensor_msgs/Image', hz: 30, publishers: 1, subscribers: 1, active: true },
  { name: '/tf', type: 'tf2_msgs/TFMessage', hz: 100, publishers: 3, subscribers: 5, active: true },
  { name: '/cmd_vel', type: 'geometry_msgs/Twist', hz: 10, publishers: 2, subscribers: 1, active: true },
  { name: '/odom', type: 'nav_msgs/Odometry', hz: 50, publishers: 1, subscribers: 2, active: true },
  { name: '/scan', type: 'sensor_msgs/LaserScan', hz: 10, publishers: 1, subscribers: 1, active: false },
  { name: '/imu/data', type: 'sensor_msgs/Imu', hz: 200, publishers: 1, subscribers: 1, active: true },
  { name: '/joint_states', type: 'sensor_msgs/JointState', hz: 50, publishers: 1, subscribers: 2, active: false },
];

const MOCK_NODES: NodeInfo[] = [
  { name: '/hobot_dnn', type: 'publisher', topics: ['/hobot_dnn/bbox'] },
  { name: '/mipi_cam', type: 'publisher', topics: ['/camera/color/image_raw'] },
  { name: '/robot_state_publisher', type: 'publisher', topics: ['/tf', '/joint_states'] },
  { name: '/nav2_controller', type: 'subscriber', topics: ['/cmd_vel', '/odom'] },
  { name: '/rviz2', type: 'subscriber', topics: ['/tf', '/scan'] },
];

const MSG_FIELDS: Record<string, Array<{ type: string; name: string }>> = {
  'ai_msgs/PerceptionTargets': [
    { type: 'std_msgs/Header', name: 'header' },
    { type: 'int32', name: 'fps' },
    { type: 'Target[]', name: 'targets' },
  ],
  'sensor_msgs/Image': [
    { type: 'std_msgs/Header', name: 'header' },
    { type: 'uint32', name: 'height' },
    { type: 'uint32', name: 'width' },
    { type: 'string', name: 'encoding' },
    { type: 'uint8[]', name: 'data' },
  ],
  'geometry_msgs/Twist': [
    { type: 'Vector3', name: 'linear' },
    { type: 'Vector3', name: 'angular' },
  ],
};

export default function Ros() {
  const { currentDevice, addToast, runTerminalCommand } = useAppState();
  const [topics, setTopics] = useState<TopicInfo[]>([]);
  const [nodes] = useState<NodeInfo[]>(MOCK_NODES);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'topics' | 'graph' | 'monitor' | 'tools'>('topics');
  const [search, setSearch] = useState('');
  const [scanning, setScanning] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [customCmd, setCustomCmd] = useState('');
  const [hzHistory, setHzHistory] = useState<Record<string, number[]>>({});
  const intervalRef = useRef<number | null>(null);

  const detail = topics.find(t => t.name === selectedTopic);
  const activeTopics = topics.filter(t => t.active);
  const totalHz = activeTopics.reduce((s, t) => s + t.hz, 0);

  // 扫描话题
  const scanTopics = () => {
    if (!currentDevice) { addToast('请先连接设备', 'warning'); return; }
    setScanning(true);
    setOutput(prev => [...prev, `$ ros2 topic list`]);
    setTimeout(() => {
      setTopics(MOCK_TOPICS);
      setScanning(false);
      addToast(`发现 ${MOCK_TOPICS.length} 个话题`, 'success');
      setOutput(prev => [...prev, ...MOCK_TOPICS.map(t => t.name), '']);
      // 初始化频率历史
      const hist: Record<string, number[]> = {};
      MOCK_TOPICS.forEach(t => { hist[t.name] = Array.from({ length: 20 }, () => t.hz * (0.8 + Math.random() * 0.4)); });
      setHzHistory(hist);
    }, 1500);
  };

  // 自动刷新
  useEffect(() => {
    if (autoRefresh && topics.length > 0) {
      intervalRef.current = window.setInterval(() => {
        setTopics(prev => prev.map(t => ({
          ...t,
          hz: Math.max(0, t.hz + Math.round((Math.random() - 0.5) * 4)),
        })));
        setHzHistory(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(k => {
            const t = topics.find(t => t.name === k);
            if (t) next[k] = [...(next[k] || []).slice(-19), t.hz * (0.8 + Math.random() * 0.4)];
          });
          return next;
        });
      }, 2000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, topics.length]);

  // 执行命令
  const runCmd = (cmd: string) => {
    if (!currentDevice) { addToast('请先连接设备', 'warning'); return; }
    setOutput(prev => [...prev, `$ ${cmd}`]);
    runTerminalCommand(cmd);
    addToast(`执行: ${cmd}`, 'info');
  };

  // 空状态
  if (!currentDevice) {
    return (
      <div className="center-stage">
        <div className="ros-empty">
          <span className="ros-empty-icon">🤖</span>
          <h2 className="ros-empty-title">ROS2 话题分析</h2>
          <p className="ros-empty-desc">话题监控、节点图谱、频率分析与 AI 辅助诊断。<br/>请先连接设备以开始扫描。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ros-page">
      {/* 顶栏 */}
      <div className="ros-header">
        <div className="ros-header-left">
          <div className="ros-header-icon">🤖</div>
          <div>
            <h2 className="ros-title">ROS2 话题分析</h2>
            <span className="ros-subtitle">{currentDevice.name} · {topics.length} 话题</span>
          </div>
        </div>
        <div className="ros-header-right">
          <label className="ros-auto-toggle">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            自动刷新
          </label>
          <button className={`ros-scan-btn ${scanning ? 'loading' : ''}`} onClick={scanTopics} disabled={scanning}>
            {scanning ? '扫描中...' : '🔍 扫描话题'}
          </button>
        </div>
      </div>

      {/* 统计 */}
      <div className="ros-stats">
        <div className="ros-stat-card">
          <div className="ros-stat-icon" style={{ background: '#eff6ff', color: '#3b82f6' }}>📡</div>
          <span className="ros-stat-value" style={{ color: '#3b82f6' }}>{topics.length}</span>
          <span className="ros-stat-label">话题总数</span>
        </div>
        <div className="ros-stat-card">
          <div className="ros-stat-icon" style={{ background: '#f0fdf4', color: '#22c55e' }}>✅</div>
          <span className="ros-stat-value" style={{ color: '#22c55e' }}>{activeTopics.length}</span>
          <span className="ros-stat-label">活跃话题</span>
        </div>
        <div className="ros-stat-card">
          <div className="ros-stat-icon" style={{ background: '#faf5ff', color: '#8b5cf6' }}>🔗</div>
          <span className="ros-stat-value" style={{ color: '#8b5cf6' }}>{nodes.length}</span>
          <span className="ros-stat-label">节点数</span>
        </div>
        <div className="ros-stat-card">
          <div className="ros-stat-icon" style={{ background: '#fff7ed', color: '#f97316' }}>⚡</div>
          <span className="ros-stat-value" style={{ color: '#f97316' }}>{totalHz}</span>
          <span className="ros-stat-label">总频率 Hz</span>
        </div>
      </div>

      {/* Tab */}
      <div className="ros-tabs">
        {([['topics', '📡 话题监控', topics.length], ['graph', '🔗 节点图谱', nodes.length], ['monitor', '📊 性能监控', activeTopics.length], ['tools', '🔧 诊断工具', 0]] as const).map(([id, label, count]) => (
          <button key={id} className={`ros-tab ${activeTab === id ? 'active' : ''}`} onClick={() => setActiveTab(id)}>
            {label}
            {count > 0 && <span className="ros-tab-badge">{count}</span>}
          </button>
        ))}
      </div>

      {/* 话题监控 */}
      {activeTab === 'topics' && (
        <div className="ros-topics-layout">
          <div className="ros-topics-left">
            <div className="ros-search-box">
              <span>🔍</span>
              <input className="ros-search-input" placeholder="搜索话题..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="ros-topic-list">
              {topics.filter(t => !search || t.name.includes(search)).map(t => (
                <div key={t.name} className={`ros-topic-item ${selectedTopic === t.name ? 'active' : ''}`}
                  onClick={() => setSelectedTopic(t.name)}>
                  <div className="ros-topic-name">{t.name}</div>
                  <div className="ros-topic-meta">
                    <span className="ros-topic-type">{t.type.split('/')[1]}</span>
                    <span className="ros-topic-hz" style={{
                      color: t.active ? '#22c55e' : '#94a3b8',
                      background: t.active ? '#f0fdf4' : '#f8fafc',
                    }}>{t.hz} Hz</span>
                  </div>
                </div>
              ))}
              {topics.length === 0 && <div className="ros-topic-empty">点击「扫描话题」开始</div>}
            </div>
          </div>

          <div className="ros-topics-right">
            {detail ? (
              <div className="ros-topic-detail">
                <div className="ros-detail-title">{detail.name}</div>
                <div className="ros-detail-grid">
                  <div className="ros-detail-cell"><div className="ros-detail-label">消息类型</div><div className="ros-detail-value">{detail.type}</div></div>
                  <div className="ros-detail-cell"><div className="ros-detail-label">频率</div><div className="ros-detail-value">{detail.hz} Hz</div></div>
                  <div className="ros-detail-cell"><div className="ros-detail-label">发布者</div><div className="ros-detail-value">{detail.publishers}</div></div>
                  <div className="ros-detail-cell"><div className="ros-detail-label">订阅者</div><div className="ros-detail-value">{detail.subscribers}</div></div>
                </div>

                {/* 频率趋势 */}
                {hzHistory[detail.name] && (
                  <div className="ros-hz-chart">
                    <div className="ros-section-title" style={{ marginBottom: 6 }}>频率趋势</div>
                    <div className="ros-hz-bars">
                      {hzHistory[detail.name].map((v, i) => (
                        <div key={i} className="ros-hz-bar" style={{
                          height: `${Math.min(100, (v / (detail.hz * 1.5)) * 100)}%`,
                          background: v > detail.hz * 0.7 ? '#22c55e' : '#f59e0b',
                        }} />
                      ))}
                    </div>
                  </div>
                )}

                {/* 消息结构 */}
                {MSG_FIELDS[detail.type] && (
                  <div className="ros-msg-structure">
                    <div className="ros-section-title" style={{ marginBottom: 6 }}>消息结构</div>
                    <div className="ros-msg-fields">
                      {MSG_FIELDS[detail.type].map((f, i) => (
                        <div key={i} className="ros-msg-field">
                          <span className="ros-field-type">{f.type}</span>
                          <span className="ros-field-name">{f.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="ros-detail-actions">
                  <button className="ros-btn-primary" onClick={() => runCmd(`ros2 topic echo ${detail.name} --once`)}>📡 Echo</button>
                  <button className="ros-btn-ghost" onClick={() => runCmd(`ros2 topic hz ${detail.name}`)}>Hz 测量</button>
                  <button className="ros-btn-ghost" onClick={() => runCmd(`ros2 topic info ${detail.name}`)}>详细信息</button>
                </div>
              </div>
            ) : (
              <div className="ros-detail-empty">
                <span className="ros-detail-empty-icon">📡</span>
                <p>选择左侧话题查看详情</p>
              </div>
            )}

            {/* 输出面板 */}
            {output.length > 0 && (
              <div className="ros-output">
                <div className="ros-output-header">
                  <span>终端输出</span>
                  <button className="ros-output-clear" onClick={() => setOutput([])}>清空</button>
                </div>
                <pre className="ros-output-content">{output.join('\n')}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 节点图谱 */}
      {activeTab === 'graph' && (
        <div className="ros-graph-section">
          <div className="ros-section-title">节点列表</div>
          <div className="ros-nodes-grid">
            {nodes.map(n => (
              <div key={n.name} className="ros-node-card">
                <span className="ros-node-icon">{n.type === 'publisher' ? '📤' : n.type === 'subscriber' ? '📥' : '⚙️'}</span>
                <div>
                  <div className="ros-node-name">{n.name}</div>
                  <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 2 }}>{n.topics.length} 话题</div>
                </div>
              </div>
            ))}
          </div>
          <div className="ros-output" style={{ marginTop: 12 }}>
            <div className="ros-output-header"><span>节点关系</span></div>
            <pre className="ros-output-content">{nodes.map(n => `${n.name} (${n.type})\n  └─ ${n.topics.join(', ')}`).join('\n\n')}</pre>
          </div>
        </div>
      )}

      {/* 性能监控 */}
      {activeTab === 'monitor' && (
        <div className="ros-monitor-section">
          <div className="ros-monitor-header">
            <span className="ros-section-title">实时频率监控</span>
            <span className="ros-monitor-hint">{autoRefresh ? '自动刷新中' : '开启自动刷新以实时监控'}</span>
          </div>
          <div className="ros-monitor-grid">
            {activeTopics.map(t => (
              <div key={t.name} className="ros-monitor-card">
                <div className="ros-monitor-name">{t.name.split('/').pop()}</div>
                <div className="ros-monitor-hz" style={{ color: t.hz > 0 ? '#22c55e' : '#ef4444' }}>{t.hz} Hz</div>
                <span className="ros-monitor-status" style={{
                  color: t.active ? '#22c55e' : '#f59e0b',
                  background: t.active ? '#f0fdf4' : '#fffbeb',
                }}>
                  {t.active ? 'Active' : 'Idle'}
                </span>
                {hzHistory[t.name] && (
                  <div className="ros-mini-chart">
                    {hzHistory[t.name].slice(-12).map((v, i) => (
                      <div key={i} className="ros-mini-bar" style={{
                        height: `${Math.min(100, (v / (t.hz * 1.5)) * 100)}%`,
                        background: v > t.hz * 0.7 ? '#22c55e' : '#f59e0b',
                      }} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 诊断工具 */}
      {activeTab === 'tools' && (
        <div className="ros-tools-section">
          <div className="ros-section-title" style={{ marginBottom: 12 }}>快捷命令</div>
          <div className="ros-quick-tools">
            {[
              { icon: '📡', name: '话题列表', cmd: 'ros2 topic list', color: '#3b82f6' },
              { icon: '🔗', name: '节点列表', cmd: 'ros2 node list', color: '#8b5cf6' },
              { icon: '⚙️', name: '服务列表', cmd: 'ros2 service list', color: '#f97316' },
              { icon: '📊', name: '参数列表', cmd: 'ros2 param list', color: '#22c55e' },
              { icon: '🌳', name: 'TF 树', cmd: 'ros2 run tf2_tools view_frames', color: '#ec4899' },
              { icon: '📦', name: '包列表', cmd: 'ros2 pkg list', color: '#6366f1' },
            ].map(tool => (
              <button key={tool.cmd} className="ros-quick-tool" style={{ '--tool-color': tool.color } as React.CSSProperties}
                onClick={() => runCmd(tool.cmd)}>
                <span className="ros-quick-icon">{tool.icon}</span>
                <span className="ros-quick-name">{tool.name}</span>
                <span className="ros-quick-cmd">{tool.cmd}</span>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="ros-section-title" style={{ marginBottom: 8 }}>自定义命令</div>
            <div className="ros-custom-cmd">
              <input className="ros-cmd-input" placeholder="输入 ROS2 命令..." value={customCmd}
                onChange={e => setCustomCmd(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && customCmd.trim()) { runCmd(customCmd.trim()); setCustomCmd(''); } }} />
              <button className="ros-btn-primary" onClick={() => { if (customCmd.trim()) { runCmd(customCmd.trim()); setCustomCmd(''); } }}>执行</button>
            </div>
          </div>

          {output.length > 0 && (
            <div className="ros-output" style={{ marginTop: 16 }}>
              <div className="ros-output-header">
                <span>命令输出</span>
                <button className="ros-output-clear" onClick={() => setOutput([])}>清空</button>
              </div>
              <pre className="ros-output-content">{output.join('\n')}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
