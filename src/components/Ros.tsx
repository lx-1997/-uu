import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { ROS_TOPICS, ROS_TOPIC_DETAILS } from '../constants';

const ANALYSIS_TOOLS = [
  { id: 'topic-echo', name: '话题监听', icon: '📡', desc: '实时查看话题消息内容与频率', cmd: 'ros2 topic echo' },
  { id: 'node-graph', name: '节点关系图', icon: '🕸️', desc: '可视化节点间的订阅/发布关系', cmd: 'ros2 run rqt_graph rqt_graph' },
  { id: 'tf-tree', name: 'TF 坐标树', icon: '🌳', desc: '查看坐标变换链路与帧率', cmd: 'ros2 run tf2_tools view_frames' },
  { id: 'topic-hz', name: '频率检测', icon: '⏱️', desc: '检测话题实际发布频率与延迟', cmd: 'ros2 topic hz' },
  { id: 'param-dump', name: '参数导出', icon: '📋', desc: '导出节点参数用于分析或备份', cmd: 'ros2 param dump' },
  { id: 'bag-record', name: '录包回放', icon: '⏺️', desc: '录制话题数据用于离线分析', cmd: 'ros2 bag record' },
];

export default function Ros() {
  const { rosTopic, setRosTopic, rosRecording, setRosRecording, addToast, setActiveTab } = useAppState();
  const [activeView, setActiveView] = useState<'topics' | 'tools'>('topics');
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
        <div className="widget-header">📡 ROS 话题分析</div>
        <div className="desc-text">话题监听、节点图谱、TF 树分析，AI 辅助诊断与优化。</div>

        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">🧠 AI 分析</span>
          <span className="ai-recommend-text">
            {ROS_TOPICS.length} 个活跃话题 ·
            <strong style={{ color: '#22c55e' }}> {Object.values(topicHealth).filter(h => h.score >= 90).length} 个状态优秀</strong> ·
            <span style={{ color: '#f59e0b' }}> /cmd_vel 频率偏低，建议检查发布节点</span>
          </span>
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
                    <span style={{ fontSize: '1.2rem' }}>{tool.icon}</span>
                    <strong style={{ fontSize: '0.9rem' }}>{tool.name}</strong>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5, marginBottom: 8 }}>{tool.desc}</div>
                  <div className="terminal-screen" style={{ minHeight: 'auto', padding: '6px 10px', fontSize: '0.75rem', marginBottom: 8 }}>
                    <div className="terminal-line">$ {tool.cmd}</div>
                  </div>
                  <button className="clean-btn outline-btn sm-btn" style={{ width: '100%' }}
                    onClick={() => { setActiveTab('terminal'); addToast(`已在终端执行: ${tool.cmd}`, 'info'); }}>
                    在终端中运行
                  </button>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, padding: '10px 14px', background: '#f0f9ff', borderRadius: 10, border: '1px dashed #93c5fd' }}>
              <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.6 }}>
                💡 用底部聊天框描述你的分析需求（如"帮我分析为什么 /cmd_vel 频率低"），AI 会组合多个工具自动诊断并给出解决方案。
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
                  const health = topicHealth[topic];
                  return (
                    <button key={topic} className={`select-card ${rosTopic === topic ? 'active' : ''}`} onClick={() => setRosTopic(topic)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontFamily: 'Consolas, monospace', fontSize: '0.85rem' }}>{topic}</strong>
                        <span style={{ fontSize: '0.72rem', color: '#94a3b8', background: '#f1f5f9', padding: '2px 8px', borderRadius: 8 }}>{ROS_TOPIC_DETAILS[topic]?.hz}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{ROS_TOPIC_DETAILS[topic]?.msgType}</span>
                        {health && (
                          <span style={{
                            fontSize: '0.68rem', padding: '1px 6px', borderRadius: 6,
                            background: health.score >= 90 ? '#f0fdf4' : health.score >= 75 ? '#fffbeb' : '#fef2f2',
                            color: health.score >= 90 ? '#16a34a' : health.score >= 75 ? '#d97706' : '#dc2626',
                          }}>{health.score}分</span>
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
              <div className="panel-title">{rosTopic}</div>

              <div style={{ display: 'flex', gap: 10, marginBottom: 14, padding: '10px 14px', background: currentHealth.score >= 90 ? '#f0fdf4' : currentHealth.score >= 75 ? '#fffbeb' : '#fef2f2', borderRadius: 10 }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: currentHealth.score >= 90 ? '#16a34a' : currentHealth.score >= 75 ? '#d97706' : '#dc2626' }}>
                  {currentHealth.score}
                </div>
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>AI 健康评分: {currentHealth.status}</div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{currentHealth.tip}</div>
                </div>
              </div>

              {/* Image preview for visual topics */}
              {(detail.vizType === '图像' || detail.vizType === 'BBox 检测框') && (
                <div style={{ marginBottom: 14, borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0', background: '#0f172a' }}>
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {/* Mock camera feed / detection overlay */}
                    <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <span style={{ fontSize: '2rem' }}>{detail.vizType === '图像' ? '📷' : '🎯'}</span>
                      <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
                        {detail.vizType === '图像' ? '摄像头实时画面' : '检测框叠加画面'}
                      </span>
                      <span style={{ color: '#475569', fontSize: '0.68rem' }}>{rosTopic} · {detail.hz}</span>
                    </div>
                    {/* Mock detection boxes for bbox topic */}
                    {detail.vizType === 'BBox 检测框' && (
                      <>
                        <div style={{ position: 'absolute', top: '20%', left: '15%', width: '25%', height: '45%', border: '2px solid #22c55e', borderRadius: 4 }}>
                          <span style={{ position: 'absolute', top: -18, left: 0, background: '#22c55e', color: '#fff', fontSize: '0.6rem', padding: '1px 6px', borderRadius: 3 }}>person 0.95</span>
                        </div>
                        <div style={{ position: 'absolute', top: '30%', left: '55%', width: '20%', height: '35%', border: '2px solid #3b82f6', borderRadius: 4 }}>
                          <span style={{ position: 'absolute', top: -18, left: 0, background: '#3b82f6', color: '#fff', fontSize: '0.6rem', padding: '1px 6px', borderRadius: 3 }}>dog 0.87</span>
                        </div>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#1e293b' }}>
                    <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>⏱ {detail.hz} · {detail.msgType}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="clean-btn outline-btn sm-btn" style={{ fontSize: '0.68rem', padding: '2px 8px', color: '#94a3b8', borderColor: '#334155' }}
                        onClick={() => addToast('截图已保存到 /root/snapshot.jpg', 'info')}>📸 截图</button>
                      <button className="clean-btn outline-btn sm-btn" style={{ fontSize: '0.68rem', padding: '2px 8px', color: '#94a3b8', borderColor: '#334155' }}
                        onClick={() => addToast('录制已开始', 'info')}>⏺ 录制</button>
                    </div>
                  </div>
                </div>
              )}

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

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="clean-btn outline-btn sm-btn" onClick={() => { setActiveTab('terminal'); addToast(`已在终端执行 ros2 topic echo ${rosTopic}`, 'info'); }}>
                  📡 终端查看
                </button>
                <button className="clean-btn outline-btn sm-btn" onClick={() => { setActiveTab('vnc'); addToast('正在启动 rviz2 可视化...', 'info'); }}>
                  🖵 rviz2 可视化
                </button>
                <button className="clean-btn outline-btn sm-btn" onClick={() => addToast('已刷新话题列表', 'info')}>
                  🔄 刷新
                </button>
              </div>

              <div style={{ marginTop: 10, padding: '8px 12px', background: '#fefce8', borderRadius: 8, border: '1px dashed #fde68a' }}>
                <div style={{ fontSize: '0.75rem', color: '#92400e', lineHeight: 1.5 }}>
                  💡 需要更完整的 3D 可视化？点击「rviz2 可视化」在远程桌面中打开 rviz2，支持点云、TF 树、激光雷达等多话题同时显示。
                </div>
              </div>

              <div style={{ marginTop: 14, padding: '10px 14px', background: '#f0f9ff', borderRadius: 10, border: '1px dashed #93c5fd' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 6 }}>💡 AI 诊断建议</div>
                <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.6 }}>
                  {rosTopic === '/hobot_dnn/bbox' && '推理话题 30Hz 稳定输出。建议配合图像话题做可视化叠加，或转发到流编排构建告警逻辑。'}
                  {rosTopic === '/camera/color/image_raw' && '图像流带宽约 12MB/s。低带宽场景建议启用 compressed_image_transport 减少 70% 占用。'}
                  {rosTopic === '/tf' && '3 个 TF 发布者协同正常。建议用 tf2_tools view_frames 生成坐标树排查关节链路。'}
                  {rosTopic === '/cmd_vel' && '速度指令 10Hz 偏低，标准控制回路建议 ≥50Hz。检查发布节点是否有阻塞或 sleep 过长。'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
