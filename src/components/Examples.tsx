import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { executeDeviceCommand, getRememberedDevicePassword } from '../api';

/* ── NodeHub 应用示例 ── */

interface AppItem {
  id: string; name: string; icon: string; desc: string; category: string;
  repo: string; installCmd: string; runCmd: string; uninstallCmd: string;
  installed: boolean; running: boolean; custom?: boolean;
}

const BUILTIN_APPS: AppItem[] = [
  { id: 'yolo', name: 'YOLO 目标检测', icon: '🎯', desc: '基于 hobot_dnn 的实时目标检测', category: '视觉',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/168', installCmd: 'sudo apt install -y tros-hobot-dnn && sudo apt install -y tros-dnn-node-example',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch dnn_node_example dnn_node_example.launch.py',
    uninstallCmd: 'sudo apt remove -y tros-dnn-node-example', installed: false, running: false },
  { id: 'body', name: '人体骨骼点检测', icon: '🏃', desc: '人体关键点检测与姿态估计', category: '视觉',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/169', installCmd: 'sudo apt install -y tros-hobot-body-det',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hobot_body_det hobot_body_det.launch.py',
    uninstallCmd: 'sudo apt remove -y tros-hobot-body-det', installed: false, running: false },
  { id: 'slam', name: 'ORB-SLAM3', icon: '🗺️', desc: '视觉 SLAM 建图与定位', category: '导航',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/170', installCmd: 'sudo apt install -y tros-orb-slam3',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch orb_slam3 orb_slam3.launch.py',
    uninstallCmd: 'sudo apt remove -y tros-orb-slam3', installed: false, running: false },
  { id: 'nav2', name: 'Nav2 导航', icon: '🧭', desc: 'ROS2 自主导航框架', category: '导航',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/171', installCmd: 'sudo apt install -y tros-nav2-bringup',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch nav2_bringup navigation_launch.py',
    uninstallCmd: 'sudo apt remove -y tros-nav2-bringup', installed: false, running: false },
  { id: 'tts', name: '语音合成 TTS', icon: '🔊', desc: '文本转语音输出', category: '语音',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/172', installCmd: 'sudo apt install -y tros-hobot-tts',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hobot_tts hobot_tts.launch.py',
    uninstallCmd: 'sudo apt remove -y tros-hobot-tts', installed: false, running: false },
  { id: 'hand', name: '手势识别', icon: '✋', desc: '实时手势检测与分类', category: '视觉',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/173', installCmd: 'sudo apt install -y tros-hand-gesture-det',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hand_gesture_det hand_gesture_det.launch.py',
    uninstallCmd: 'sudo apt remove -y tros-hand-gesture-det', installed: false, running: false },
];

const CATEGORIES = ['全部', '视觉', '导航', '语音', '自定义'];

export default function Examples() {
  const { currentDevice, addToast } = useAppState();
  const [apps, setApps] = useState<AppItem[]>(BUILTIN_APPS);
  const [filter, setFilter] = useState('全部');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newApp, setNewApp] = useState({ name: '', desc: '', installCmd: '', runCmd: '', uninstallCmd: '' });

  const filtered = apps.filter(a =>
    (filter === '全部' || a.category === filter) &&
    (!search || a.name.includes(search) || a.desc.includes(search))
  );
  const installedCount = apps.filter(a => a.installed).length;
  const runningCount = apps.filter(a => a.running).length;

  const exec = async (id: string, cmd: string, label: string) => {
    if (!currentDevice) { addToast('请先连接设备', 'warning'); return null; }
    setBusyId(id);
    setLogs(p => [...p.slice(-40), `[${label}] ${new Date().toLocaleTimeString()}`, `$ ${cmd}`]);
    setShowLog(true);
    try {
      const pwd = getRememberedDevicePassword(currentDevice.id);
      const r = await executeDeviceCommand(currentDevice.id, `bash -lc "${cmd}"`, pwd);
      setLogs(p => [...p, r.output || '(无输出)', '']);
      return r.output || '';
    } catch {
      setLogs(p => [...p, 'ERROR: 执行失败', '']);
      addToast(`${label}失败`, 'error');
      return null;
    } finally { setBusyId(null); }
  };

  const handleInstall = async (app: AppItem) => {
    addToast(`正在安装 ${app.name}...`, 'info');
    const out = await exec(app.id, app.installCmd, `安装 ${app.name}`);
    if (out !== null) { setApps(p => p.map(a => a.id === app.id ? { ...a, installed: true } : a)); addToast(`${app.name} 安装完成`, 'success'); }
  };

  const handleRun = async (app: AppItem) => {
    addToast(`正在启动 ${app.name}...`, 'info');
    const out = await exec(app.id, app.runCmd, `运行 ${app.name}`);
    if (out !== null) { setApps(p => p.map(a => a.id === app.id ? { ...a, running: true } : a)); addToast(`${app.name} 已启动`, 'success'); }
  };

  const handleStop = async (app: AppItem) => {
    const cmd = `pkill -f "${app.runCmd.split('&&').pop()?.trim().split(' ')[2] || app.name}" || true`;
    await exec(app.id, cmd, `停止 ${app.name}`);
    setApps(p => p.map(a => a.id === app.id ? { ...a, running: false } : a));
    addToast(`${app.name} 已停止`, 'info');
  };

  const handleUninstall = async (app: AppItem) => {
    if (!confirm(`确定卸载 ${app.name}？`)) return;
    addToast(`正在卸载 ${app.name}...`, 'info');
    const out = await exec(app.id, app.uninstallCmd, `卸载 ${app.name}`);
    if (out !== null) { setApps(p => p.map(a => a.id === app.id ? { ...a, installed: false, running: false } : a)); addToast(`${app.name} 已卸载`, 'info'); }
  };

  const handleRemoveCustom = (id: string) => { setApps(p => p.filter(a => a.id !== id)); addToast('已移除', 'info'); };

  const handleAddApp = () => {
    if (!newApp.name || !newApp.installCmd) { addToast('请填写名称和安装命令', 'warning'); return; }
    setApps(p => [...p, { id: `custom-${Date.now()}`, icon: '📦', category: '自定义', repo: '', installed: false, running: false, custom: true, ...newApp, uninstallCmd: newApp.uninstallCmd || `echo "请手动卸载 ${newApp.name}"` }]);
    setNewApp({ name: '', desc: '', installCmd: '', runCmd: '', uninstallCmd: '' });
    setShowAdd(false);
    addToast('应用已添加', 'success');
  };

  const handleCheckDeps = async () => {
    await exec('deps', 'dpkg -l | grep tros | head -20 && echo "---" && ros2 pkg list 2>/dev/null | head -20 || echo "ROS2 未安装"', '依赖检查');
  };

  /* ── 未连接设备 ── */
  if (!currentDevice) {
    return (
      <div className="nh-page">
        <div className="nh-empty-state">
          <div className="nh-empty-icon-wrap">
            <span className="nh-empty-glow" />
            <span style={{ fontSize: '3rem' }}>📦</span>
          </div>
          <h2 className="nh-empty-title">NodeHub · 应用商店</h2>
          <p className="nh-empty-desc">地瓜机器人 NodeHub 应用商店，一键安装、运行、管理 RDK 应用</p>
          <div className="nh-empty-steps">
            <div className="nh-empty-step"><span className="nh-step-num">1</span>连接 RDK 开发板</div>
            <div className="nh-empty-step"><span className="nh-step-num">2</span>浏览并安装感兴趣的应用</div>
            <div className="nh-empty-step"><span className="nh-step-num">3</span>一键运行，实时查看效果</div>
          </div>
          <a href="https://developer.d-robotics.cc/nodehub" target="_blank" rel="noopener noreferrer" className="nh-ext-link">
            访问 NodeHub ↗
          </a>
        </div>
      </div>
    );
  }

  /* ── 主页面 ── */
  return (
    <div className="nh-page">
      {/* 顶部状态栏 */}
      <div className="nh-topbar">
        <div className="nh-topbar-left">
          <span className="nh-topbar-icon">📦</span>
          <span className="nh-topbar-name">NodeHub</span>
          <span className="nh-topbar-badge">{apps.length} 应用</span>
        </div>
        <div className="nh-topbar-right">
          <div className="nh-stat-chips">
            <span className="nh-stat-chip"><span className="nh-stat-num">{installedCount}</span>已安装</span>
            <span className="nh-stat-chip live"><span className="nh-stat-num">{runningCount}</span>运行中</span>
          </div>
          <button className="nh-btn ghost" onClick={handleCheckDeps} disabled={!!busyId}>依赖检查</button>
          <button className="nh-add-btn" onClick={() => setShowAdd(true)}>+ 添加应用</button>
        </div>
      </div>

      {/* 设备信息条 */}
      <div className="nh-device-bar">
        <div className="nh-device-item"><span className="nh-device-label">设备</span><span className="nh-device-val">{currentDevice.name}</span></div>
        <span className="nh-device-sep" />
        <div className="nh-device-item"><span className="nh-device-label">IP</span><span className="nh-device-val mono">{currentDevice.ip}</span></div>
        <span className="nh-device-sep" />
        <div className="nh-device-item"><span className="nh-device-label">已安装</span><span className="nh-device-val">{installedCount}</span></div>
        <span className="nh-device-sep" />
        <div className="nh-device-item"><span className="nh-device-label">运行中</span><span className={`nh-device-val ${runningCount > 0 ? 'ok' : ''}`}>{runningCount}</span></div>
      </div>

      {/* 筛选栏 */}
      <div className="nh-filter-bar">
        <div className="nh-filter-tabs">
          {CATEGORIES.map(c => (
            <button key={c} className={`nh-tab-btn ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>{c}</button>
          ))}
        </div>
        <div className="nh-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input className="nh-search" placeholder="搜索应用..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* 应用卡片网格 */}
      <div className="nh-grid">
        {filtered.length === 0 && <div className="nh-no-result">没有匹配的应用</div>}
        {filtered.map(app => (
          <div key={app.id} className={`nh-card ${app.running ? 'running' : app.installed ? 'installed' : ''}`}>
            <div className="nh-card-head">
              <span className="nh-card-icon">{app.icon}</span>
              <div className="nh-card-info">
                <span className="nh-card-name">{app.name}</span>
                <span className="nh-card-cat">{app.category}</span>
              </div>
              {app.running && <span className="nh-badge running"><span className="nh-badge-dot" />运行中</span>}
              {app.installed && !app.running && <span className="nh-badge installed">已安装</span>}
            </div>
            <p className="nh-card-desc">{app.desc}</p>
            <div className="nh-card-actions">
              {!app.installed && (
                <button className="nh-btn primary" disabled={busyId === app.id} onClick={() => handleInstall(app)}>
                  {busyId === app.id ? '安装中...' : '安装'}
                </button>
              )}
              {app.installed && !app.running && (
                <button className="nh-btn primary" disabled={busyId === app.id} onClick={() => handleRun(app)}>▶ 运行</button>
              )}
              {app.running && (
                <button className="nh-btn danger" onClick={() => handleStop(app)}>⏹ 停止</button>
              )}
              {app.installed && (
                <button className="nh-btn ghost" onClick={() => handleUninstall(app)}>卸载</button>
              )}
              {app.custom && (
                <button className="nh-btn ghost" onClick={() => handleRemoveCustom(app.id)}>移除</button>
              )}
              {app.repo && (
                <a href={app.repo} target="_blank" rel="noopener noreferrer" className="nh-btn link">详情 ↗</a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 日志面板 */}
      {showLog && logs.length > 0 && (
        <div className="nh-log-panel">
          <div className="nh-log-header">
            <span>📋 执行日志</span>
            <div className="nh-log-actions">
              <button className="nh-btn ghost sm" onClick={() => setLogs([])}>清空</button>
              <button className="nh-btn ghost sm" onClick={() => setShowLog(false)}>收起</button>
            </div>
          </div>
          <pre className="nh-log-body">{logs.join('\n')}</pre>
        </div>
      )}

      {/* 添加应用弹窗 */}
      {showAdd && (
        <>
          <div className="nh-overlay" onClick={() => setShowAdd(false)} />
          <div className="nh-modal">
            <div className="nh-modal-head">
              <h3 className="nh-modal-title">📦 添加自定义应用</h3>
              <button className="nh-modal-close" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <div className="nh-modal-body">
              <div className="nh-field"><label>应用名称</label><input placeholder="我的应用" value={newApp.name} onChange={e => setNewApp(p => ({ ...p, name: e.target.value }))} /></div>
              <div className="nh-field"><label>描述</label><input placeholder="应用描述..." value={newApp.desc} onChange={e => setNewApp(p => ({ ...p, desc: e.target.value }))} /></div>
              <div className="nh-field"><label>安装命令</label><input placeholder="sudo apt install -y ..." value={newApp.installCmd} onChange={e => setNewApp(p => ({ ...p, installCmd: e.target.value }))} /></div>
              <div className="nh-field"><label>运行命令</label><input placeholder="ros2 launch ..." value={newApp.runCmd} onChange={e => setNewApp(p => ({ ...p, runCmd: e.target.value }))} /></div>
              <div className="nh-field"><label>卸载命令</label><input placeholder="sudo apt remove -y ..." value={newApp.uninstallCmd} onChange={e => setNewApp(p => ({ ...p, uninstallCmd: e.target.value }))} /></div>
              <button className="nh-btn primary full" onClick={handleAddApp}>添加应用</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
