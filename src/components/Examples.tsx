import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';

/* ── NodeHub 应用示例 ── */

interface AppItem {
  id: string;
  name: string;
  icon: string;
  category: string;
  difficulty: string;
  source: string;
  desc: string;
  deps: string[];
  cmd: string;
  boards: string[];
  downloads: number;
  version: string;
  installed: boolean;
}

const APPS: AppItem[] = [
  {
    id: 'body-detect', name: '人体检测', icon: '👤', category: '视觉', difficulty: '⭐ 入门',
    source: '官方', desc: '基于 BPU 加速的实时人体检测，支持多目标跟踪与骨骼关键点输出。',
    deps: ['hobot_dnn ✅', 'mipi_cam ✅'], cmd: 'ros2 launch body_detect body_detect.launch.py',
    boards: ['RDK X3', 'RDK X5'], downloads: 2340, version: '1.2.0', installed: false,
  },
  {
    id: 'visual-follow', name: '视觉跟随', icon: '🏃', category: '视觉', difficulty: '⭐ 入门',
    source: '官方', desc: '使用 BPU 加速的目标检测驱动小车跟随目标移动，支持 PID 控制。',
    deps: ['hobot_dnn ✅', 'mipi_cam ✅', 'cv_bridge ✅'], cmd: 'ros2 launch visual_follow visual_follow.launch.py',
    boards: ['RDK X3', 'RDK X5'], downloads: 1856, version: '1.1.3', installed: true,
  },
  {
    id: 'gesture-ctrl', name: '手势控制', icon: '🖐️', category: '视觉', difficulty: '⭐⭐ 进阶',
    source: '官方', desc: '手势识别控制机械臂/小车方向，支持 5 种手势映射。',
    deps: ['hand_detection ✅', 'gesture_lib ✅', 'serial_driver ⚠️'], cmd: 'ros2 launch gesture_ctrl gesture.launch.py',
    boards: ['RDK X3', 'RDK X5'], downloads: 1203, version: '1.0.5', installed: false,
  },
  {
    id: 'stereo-depth', name: '双摄测距', icon: '📐', category: '视觉', difficulty: '⭐⭐⭐ 高级',
    source: '社区', desc: '双目摄像头深度估计与 RViz2 点云可视化。',
    deps: ['stereo_usb_cam ✅', 'depth_estimation ✅', 'rviz2 ✅'], cmd: 'ros2 launch stereo_depth depth_display.launch.py',
    boards: ['RDK X5'], downloads: 678, version: '0.9.1', installed: false,
  },
  {
    id: 'voice-assistant', name: '语音助手', icon: '🎙️', category: '语音', difficulty: '⭐⭐ 进阶',
    source: '官方', desc: '离线语音唤醒 + 在线 ASR + TTS，支持自定义唤醒词。',
    deps: ['audio_capture ✅', 'asr_engine ✅', 'tts_engine ✅'], cmd: 'ros2 launch voice_assistant voice.launch.py',
    boards: ['RDK X3', 'RDK X5'], downloads: 945, version: '1.0.2', installed: false,
  },
  {
    id: 'slam-nav', name: 'SLAM 导航', icon: '🗺️', category: '导航', difficulty: '⭐⭐⭐ 高级',
    source: '社区', desc: '基于 Cartographer 的 2D SLAM 建图与自主导航。',
    deps: ['lidar_driver ✅', 'cartographer ✅', 'nav2 ✅'], cmd: 'ros2 launch slam_nav slam_nav.launch.py',
    boards: ['RDK X5'], downloads: 512, version: '0.8.0', installed: false,
  },
];

const CATEGORIES = ['全部', '视觉', '语音', '导航'];

export default function Examples() {
  const { currentDevice, addToast, runTerminalCommand } = useAppState();
  const [category, setCategory] = useState('全部');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'downloads' | 'name'>('downloads');
  const [selected, setSelected] = useState<string | null>(null);
  const [apps, setApps] = useState(APPS);
  const [deploying, setDeploying] = useState<string | null>(null);

  const filtered = apps
    .filter(a => category === '全部' || a.category === category)
    .filter(a => !search || a.name.includes(search) || a.desc.includes(search))
    .sort((a, b) => sortBy === 'downloads' ? b.downloads - a.downloads : a.name.localeCompare(b.name));

  const detail = apps.find(a => a.id === selected);

  const handleDeploy = (app: AppItem) => {
    if (!currentDevice) { addToast('请先连接设备', 'warning'); return; }
    setDeploying(app.id);
    setTimeout(() => {
      setDeploying(null);
      setApps(prev => prev.map(a => a.id === app.id ? { ...a, installed: true } : a));
      addToast(`${app.name} 部署成功`, 'success');
    }, 2000);
  };

  const handleRun = (app: AppItem) => {
    if (!currentDevice) { addToast('请先连接设备', 'warning'); return; }
    runTerminalCommand(app.cmd);
    addToast(`正在运行 ${app.name}`, 'info');
  };

  if (!currentDevice) {
    return (
      <div className="center-stage">
        <div className="mdl-empty">
          <div className="mdl-empty-icon">📦</div>
          <h2 className="mdl-empty-title">NodeHub 应用示例</h2>
          <p className="mdl-empty-desc">来自地瓜机器人 NodeHub 的示例应用，一键部署到开发板。<br/>请先连接设备以浏览和部署应用。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mdl-page">
      {/* 顶栏 */}
      <div className="mdl-header">
        <div className="mdl-header-left">
          <div className="mdl-header-icon">📦</div>
          <div>
            <h2 className="mdl-title">NodeHub 应用示例</h2>
            <span className="mdl-subtitle">{filtered.length} 个应用 · {apps.filter(a => a.installed).length} 已安装</span>
          </div>
        </div>
        <div className="mdl-header-right">
          <div className="mdl-search-box">
            <span>🔍</span>
            <input className="mdl-search-input" placeholder="搜索应用..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="mdl-sort-select" value={sortBy} onChange={e => setSortBy(e.target.value as 'downloads' | 'name')}>
            <option value="downloads">按热度</option>
            <option value="name">按名称</option>
          </select>
        </div>
      </div>

      {/* 分类 */}
      <div className="mdl-filters">
        {CATEGORIES.map(c => (
          <button key={c} className={`mdl-filter-btn ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>{c}</button>
        ))}
      </div>

      {/* 主体 */}
      <div className="mdl-body" style={{ gridTemplateColumns: detail ? '1fr 340px' : '1fr' }}>
        <div className="mdl-grid">
          {filtered.map(app => (
            <div key={app.id} className={`mdl-card ${selected === app.id ? 'selected' : ''}`} onClick={() => setSelected(app.id)}>
              <div className="mdl-card-top">
                <div>
                  <div className="mdl-card-name">{app.icon} {app.name}</div>
                  <div className="mdl-card-tags">
                    {app.installed && <span className="mdl-tag deployed">已安装</span>}
                    <span className="mdl-tag format">{app.category}</span>
                  </div>
                </div>
              </div>
              <p className="mdl-card-desc">{app.desc}</p>
              <div className="mdl-card-meta">
                <span>{app.difficulty}</span>
                <span>v{app.version}</span>
                <span>📥 {app.downloads}</span>
                <span>{app.source}</span>
              </div>
              <div className="mdl-card-boards">
                {app.boards.map(b => <span key={b} className="mdl-board-tag">{b}</span>)}
              </div>
              <div className="mdl-card-actions">
                <div className="mdl-action-main">
                  {app.installed ? (
                    <button className="mdl-btn-primary" onClick={e => { e.stopPropagation(); handleRun(app); }}>▶ 运行</button>
                  ) : (
                    <button className="mdl-btn-primary" disabled={deploying === app.id}
                      onClick={e => { e.stopPropagation(); handleDeploy(app); }}>
                      {deploying === app.id ? '部署中...' : '🚀 部署'}
                    </button>
                  )}
                </div>
                <button className="mdl-btn-ghost" onClick={e => { e.stopPropagation(); setSelected(app.id); }}>详情</button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="mdl-empty-list">没有匹配的应用</div>}
        </div>

        {/* 详情面板 */}
        {detail && (
          <div className="mdl-detail">
            <div className="mdl-detail-header">
              <h3 className="mdl-detail-name">{detail.icon} {detail.name}</h3>
              <button className="mdl-detail-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="mdl-detail-body">
              <p className="mdl-detail-desc">{detail.desc}</p>
              <div className="mdl-detail-grid">
                <div className="mdl-detail-cell">
                  <div className="mdl-detail-label">难度</div>
                  <div className="mdl-detail-value">{detail.difficulty}</div>
                </div>
                <div className="mdl-detail-cell">
                  <div className="mdl-detail-label">来源</div>
                  <div className="mdl-detail-value">{detail.source}</div>
                </div>
                <div className="mdl-detail-cell">
                  <div className="mdl-detail-label">版本</div>
                  <div className="mdl-detail-value">v{detail.version}</div>
                </div>
                <div className="mdl-detail-cell">
                  <div className="mdl-detail-label">下载量</div>
                  <div className="mdl-detail-value">{detail.downloads}</div>
                </div>
              </div>

              <div>
                <div className="mdl-detail-label" style={{ marginBottom: 6 }}>支持板卡</div>
                <div className="mdl-detail-boards">
                  {detail.boards.map(b => <span key={b} className="mdl-board-chip">{b}</span>)}
                </div>
              </div>

              <div>
                <div className="mdl-detail-label" style={{ marginBottom: 6 }}>依赖检查</div>
                <div className="mdl-device-models">
                  {detail.deps.map((d, i) => <span key={i} className="mdl-device-model-item">{d}</span>)}
                </div>
              </div>

              <div>
                <div className="mdl-detail-label" style={{ marginBottom: 6 }}>启动命令</div>
                <div className="mdl-terminal">{detail.cmd}</div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {detail.installed ? (
                  <button className="mdl-btn-primary" style={{ flex: 1 }} onClick={() => handleRun(detail)}>▶ 运行应用</button>
                ) : (
                  <button className="mdl-btn-primary" style={{ flex: 1 }} disabled={deploying === detail.id}
                    onClick={() => handleDeploy(detail)}>
                    {deploying === detail.id ? '部署中...' : '🚀 一键部署'}
                  </button>
                )}
                <button className="mdl-btn-ghost" onClick={() => addToast('源码查看功能开发中', 'info')}>查看源码</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
