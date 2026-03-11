import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { ROS_TOPICS, ROS_TOPIC_DETAILS } from '../constants';

export default function Ros() {
  const { rosTopic, setRosTopic, rosRecording, setRosRecording, addToast, setActiveTab } = useAppState();
  const [topicSearch, setTopicSearch] = useState('');

  const detail = ROS_TOPIC_DETAILS[rosTopic] || Object.values(ROS_TOPIC_DETAILS)[0];

  const topicHealth: Record<string, { score: number; status: string; tip: string }> = {
    '/hobot_dnn/bbox': { score: 95, status: '优秀', tip: '推理输出稳定，帧率满足实时需求' },
    '/camera/color/image_raw': { score: 90, status: '良好', tip: '图像流正常，建议监控带宽占用' },
    '/tf': { score: 98, status: '优秀', tip: '坐标变换频率高，多节点协同正常' },
    '/cmd_vel': { score: 72, status: '注意', tip: '发布频率偏低 (10Hz)，运动控制可能不够平滑' },
  };

  const currentHealth = topicHealth[rosTopic] || { score: 85, status: '正常', tip: '' };

  const filteredTopics = topicSearch.trim()
    ? ROS_TOPICS.filter(t => t.toLowerCase().includes(topicSearch.toLowerCase()) || ROS_TOPIC_DETAILS[t]?.msgType.toLowerCase().includes(topicSearch.toLowerCase()))
    : ROS_TOPICS;

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">🕸️ ROS 话题可视化</div>
        <div className="desc-text">ROS2 话题订阅与数据流可视化 · AI 健康度分析。</div>

        {/* AI 全局话题健康总览 - 新增 */}
        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">🧠 AI 分析</span>
          <span className="ai-recommend-text">
            {ROS_TOPICS.length} 个活跃话题 ·
            <strong style={{ color: '#22c55e' }}> {Object.values(topicHealth).filter(h => h.score >= 90).length} 个状态优秀</strong> ·
            <span style={{ color: '#f59e0b' }}> /cmd_vel 频率偏低，建议优化发布节点</span>
          </span>
        </div>

        <div className="workspace-grid" style={{ gridTemplateColumns: '1fr 1.6fr' }}>
          <div className="panel-card">
            <div className="panel-title">话题订阅</div>

            {/* NL 话题搜索 - 新增 */}
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
                const health = topicHealth[topic];
                return (
                  <button key={topic} className={`select-card ${rosTopic === topic ? 'active' : ''}`} onClick={() => setRosTopic(topic)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontFamily: 'Consolas, monospace', fontSize: '0.85rem' }}>{topic}</strong>
                      <span style={{ fontSize: '0.72rem', color: '#94a3b8', background: '#f1f5f9', padding: '2px 8px', borderRadius: 8 }}>{ROS_TOPIC_DETAILS[topic]?.hz}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{ROS_TOPIC_DETAILS[topic]?.msgType}</span>
                      {/* AI 健康度指示器 - 新增 */}
                      {health && (
                        <span style={{
                          fontSize: '0.68rem',
                          padding: '1px 6px',
                          borderRadius: 6,
                          background: health.score >= 90 ? '#f0fdf4' : health.score >= 75 ? '#fffbeb' : '#fef2f2',
                          color: health.score >= 90 ? '#16a34a' : health.score >= 75 ? '#d97706' : '#dc2626',
                        }}>
                          {health.score}分
                        </span>
                      )}
                    </div>
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
            <div className="panel-title">话题详情 — {rosTopic}</div>

            {/* AI 话题健康度卡片 - 新增 */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, padding: '10px 14px', background: currentHealth.score >= 90 ? '#f0fdf4' : currentHealth.score >= 75 ? '#fffbeb' : '#fef2f2', borderRadius: 10 }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: currentHealth.score >= 90 ? '#16a34a' : currentHealth.score >= 75 ? '#d97706' : '#dc2626' }}>
                {currentHealth.score}
              </div>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>AI 健康评分: {currentHealth.status}</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{currentHealth.tip}</div>
              </div>
            </div>

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
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button className="clean-btn outline-btn" onClick={() => addToast('已刷新话题列表', 'info')}>🔄 刷新话题</button>
              <button className="clean-btn outline-btn" onClick={() => { setActiveTab('lowcode'); addToast(`${rosTopic} 已转发到流编排`, 'info'); }}>📡 转发到流编排</button>
              <button className="clean-btn outline-btn" onClick={() => { setActiveTab('terminal'); addToast('已在终端中打开 ros2 topic echo', 'info'); }}>🖥️ 终端查看</button>
            </div>

            {/* AI 智能建议区 - 新增 */}
            <div style={{ marginTop: 14, padding: '10px 14px', background: '#f0f9ff', borderRadius: 10, border: '1px dashed #93c5fd' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>💡 AI 推荐操作</div>
              <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.6 }}>
                {rosTopic === '/hobot_dnn/bbox' && '当前推理话题输出稳定 (30Hz)，建议配合 /camera/color/image_raw 做可视化叠加，或转发到流编排构建告警逻辑。'}
                {rosTopic === '/camera/color/image_raw' && '图像流 30FPS，带宽约 12MB/s。建议在低带宽场景下启用 compressed_image_transport 减少 70% 带宽。'}
                {rosTopic === '/tf' && '3 个 TF 发布者协同正常。建议使用 tf2_tools view_frames 生成坐标树，排查关节链路。'}
                {rosTopic === '/cmd_vel' && '速度指令频率 10Hz 偏低，标准控制回路建议 ≥50Hz。检查发布节点是否存在阻塞。'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
