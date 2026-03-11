import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { EXAMPLE_PRESETS, EXAMPLE_DETAILS } from '../constants';

const NODEHUB_APPS = [
  { id: 'body-detect', name: '人体检测', cat: '视觉感知', stars: 328, author: 'D-Robotics', desc: 'BPU 加速人体/人脸/手部检测，30FPS 实时推理', difficulty: '入门', tags: ['MIPI', 'BPU'] },
  { id: 'hand-gesture', name: '手势控制', cat: '人机交互', stars: 215, author: 'D-Robotics', desc: '5 种手势映射运动指令，控制小车或机械臂', difficulty: '进阶', tags: ['BPU', 'Serial'] },
  { id: 'slam-nav', name: 'SLAM 导航', cat: '运动控制', stars: 186, author: 'community', desc: '基于激光雷达的 2D SLAM 和自主导航', difficulty: '高级', tags: ['Lidar', 'Nav2'] },
  { id: 'voice-ctrl', name: '语音交互', cat: '人机交互', stars: 142, author: 'community', desc: '本地端语音唤醒 + ASR + 设备控制', difficulty: '进阶', tags: ['Audio', 'AI'] },
  { id: 'visual-follow', name: '视觉跟随', cat: '视觉感知', stars: 402, author: 'D-Robotics', desc: '目标检测驱动小车跟随移动目标', difficulty: '入门', tags: ['MIPI', 'Motor'] },
  { id: 'depth-est', name: '深度估计', cat: '视觉感知', stars: 97, author: 'community', desc: '单目/双目深度估计与点云输出', difficulty: '高级', tags: ['Stereo', 'BPU'] },
];

const CATEGORIES = ['全部', '视觉感知', '人机交互', '运动控制'];

export default function Examples() {
  const { examplePreset, setExamplePreset, addToast, setActiveTab } = useAppState();
  const [activeCategory, setActiveCategory] = useState('全部');
  const [selectedApp, setSelectedApp] = useState<string | null>(null);

  const filtered = activeCategory === '全部' ? NODEHUB_APPS : NODEHUB_APPS.filter(a => a.cat === activeCategory);
  const detail = selectedApp ? NODEHUB_APPS.find(a => a.id === selectedApp) : null;
  const localDetail = detail ? EXAMPLE_DETAILS[detail.id] || EXAMPLE_DETAILS['visual-follow'] : null;

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">📦 应用示例 · NodeHub</div>
        <div className="desc-text">来自地瓜机器人 NodeHub 的应用示例，一键部署到你的 RDK 开发板。</div>

        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">🧠 AI 推荐</span>
          <span className="ai-recommend-text">
            检测到设备配有 MIPI 摄像头，推荐从 <strong>人体检测</strong> 或 <strong>视觉跟随</strong> 入手，环境依赖已满足。
          </span>
        </div>

        <div className="chip-cloud" style={{ marginBottom: 16 }}>
          {CATEGORIES.map(cat => (
            <button key={cat} className={`chip-btn ${activeCategory === cat ? 'active' : ''}`} onClick={() => setActiveCategory(cat)}>
              {cat}
            </button>
          ))}
          <button className="chip-btn" style={{ marginLeft: 'auto', color: '#64748b' }} onClick={() => window.open('https://developer.d-robotics.cc/nodehub', '_blank')}>
            NodeHub ↗
          </button>
        </div>

        {!detail ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {filtered.map(app => (
                <div key={app.id} className="panel-card" style={{ cursor: 'pointer', padding: 14, transition: 'all 0.2s' }}
                  onClick={() => setSelectedApp(app.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <strong style={{ fontSize: '0.9rem' }}>{app.name}</strong>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>⭐ {app.stars}</span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5, marginBottom: 8 }}>{app.desc}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                    {app.tags.map(t => (
                      <span key={t} style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: 6, background: '#f1f5f9', color: '#64748b' }}>{t}</span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', color: '#94a3b8' }}>
                    <span>{app.author === 'D-Robotics' ? '🏷️ 官方' : '👤 社区'}</span>
                    <span>难度: {app.difficulty}</span>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 14, padding: '10px 14px', background: '#f0f9ff', borderRadius: 10, border: '1px dashed #93c5fd' }}>
              <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.6 }}>
                💡 用底部聊天框描述你想实现的功能（如"用摄像头做人脸识别"），AI 会从 NodeHub 推荐最匹配的示例并检查依赖。
              </div>
            </div>
          </>
        ) : (
          <>
            <button className="clean-btn outline-btn sm-btn" style={{ alignSelf: 'flex-start', marginBottom: 12 }}
              onClick={() => setSelectedApp(null)}>← 返回列表</button>

            <div className="workspace-grid two-column">
              <div className="panel-card">
                <div className="panel-title">{detail.name}</div>
                <div className="desc-text" style={{ marginBottom: 10 }}>{detail.desc}</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <span className="card-status-badge ok" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
                    {detail.author === 'D-Robotics' ? '官方' : '社区'}
                  </span>
                  <span className="card-status-badge ok" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
                    难度: {detail.difficulty}
                  </span>
                  <span className="card-status-badge ok" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
                    ⭐ {detail.stars}
                  </span>
                </div>

                {localDetail && (
                  <>
                    <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: 8 }}>依赖检查</strong>
                    <div className="usage-list" style={{ marginBottom: 12 }}>
                      {localDetail.deps.map(dep => (
                        <div key={dep} className="usage-item" style={{ padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontFamily: 'Consolas, monospace', fontSize: '0.82rem' }}>{dep}</span>
                          {dep.includes('⚠️') && (
                            <button className="clean-btn outline-btn sm-btn" style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                              onClick={() => addToast(`安装中: ${dep.replace('⚠️', '').trim()}`, 'info')}>修复</button>
                          )}
                        </div>
                      ))}
                    </div>
                    <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: 8 }}>启动命令</strong>
                    <div className="terminal-screen" style={{ minHeight: 'auto', padding: '10px 14px', fontSize: '0.82rem', marginBottom: 0 }}>
                      <div className="terminal-line">$ {localDetail.cmd}</div>
                    </div>
                  </>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button className="clean-btn" onClick={() => addToast(`${detail.name} 部署中...`, 'info')}>🚀 一键部署</button>
                  <button className="clean-btn outline-btn" onClick={() => { setActiveTab('terminal'); addToast('已在终端中打开', 'info'); }}>终端运行</button>
                </div>
              </div>

              <div className="panel-card">
                <div className="panel-title">部署说明</div>
                <div className="usage-list">
                  <div className="usage-item"><strong>1. 检查依赖</strong><span>AI 自动检测设备是否满足运行条件</span></div>
                  <div className="usage-item"><strong>2. 拉取应用</strong><span>从 NodeHub 下载应用包到设备</span></div>
                  <div className="usage-item"><strong>3. 配置启动</strong><span>自动设置 ROS 节点与传感器参数</span></div>
                  <div className="usage-item"><strong>4. 验证运行</strong><span>启动后自动检查话题输出与性能指标</span></div>
                </div>

                <div style={{ marginTop: 14, padding: '10px 14px', background: '#f0f9ff', borderRadius: 10, border: '1px dashed #93c5fd' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 6 }}>🔗 相关页面</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="chip-btn" onClick={() => setActiveTab('models')}>🧠 相关模型</button>
                    <button className="chip-btn" onClick={() => setActiveTab('ros')}>📡 ROS 输出</button>
                    <button className="chip-btn" onClick={() => setActiveTab('ide')}>📝 代码编辑</button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
