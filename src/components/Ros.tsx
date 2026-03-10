import { useAppState } from '../hooks/useAppState';
import { ROS_TOPICS, ROS_TOPIC_DETAILS } from '../constants';

export default function Ros() {
  const { rosTopic, setRosTopic, rosRecording, setRosRecording, addToast } = useAppState();

  const detail = ROS_TOPIC_DETAILS[rosTopic] || Object.values(ROS_TOPIC_DETAILS)[0];

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🕸️ ROS 话题可视化</div>
        <div className="desc-text">ROS2 话题订阅与数据流可视化。</div>
        <div className="workspace-grid" style={{ gridTemplateColumns: '1fr 1.6fr' }}>
          <div className="panel-card">
            <div className="panel-title">话题订阅</div>
            <div className="option-list">
              {ROS_TOPICS.map((topic) => (
                <button key={topic} className={`select-card ${rosTopic === topic ? 'active' : ''}`} onClick={() => setRosTopic(topic)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontFamily: 'Consolas, monospace', fontSize: '0.85rem' }}>{topic}</strong>
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8', background: '#f1f5f9', padding: '2px 8px', borderRadius: 8 }}>{ROS_TOPIC_DETAILS[topic]?.hz}</span>
                  </div>
                  <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{ROS_TOPIC_DETAILS[topic]?.msgType}</span>
                </button>
              ))}
            </div>
            <label className="toggle-row" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={rosRecording} onChange={(e) => setRosRecording(e.target.checked)} />
              <span>录制当前 Topic 数据流</span>
            </label>
          </div>
          <div className="panel-card">
            <div className="panel-title">话题详情 — {rosTopic}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              {[
                { label: '消息类型', value: detail.msgType },
                { label: '频率', value: detail.hz },
                { label: '发布者', value: `${detail.publishers} 个节点` },
                { label: '可视化', value: detail.vizType },
              ].map(f => (
                <div key={f.label} style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 14px' }}>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: 2 }}>{f.label}</div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>{f.value}</div>
                </div>
              ))}
            </div>
            <div className="scene-preview ros-preview">
              <div className="topic-card">{rosTopic}</div>
              <div className="bbox one"></div>
              <div className="preview-caption">{detail.vizType} 预览</div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button className="clean-btn outline-btn" onClick={() => addToast('已刷新话题列表', 'info')}>🔄 刷新话题</button>
              <button className="clean-btn outline-btn" onClick={() => addToast(`${rosTopic} 已转发到流编排`, 'info')}>📡 转发到流编排</button>
              <button className="clean-btn outline-btn" onClick={() => addToast('已在终端中打开 ros2 topic echo', 'info')}>🖥️ 终端查看</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
