import { useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { executeDeviceCommand, getRememberedDevicePassword } from '../api';

/* ── NodeHub 应用示例（苹果风格 · 真实接入）── */

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
  const [selected, setSelected] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newApp, setNewApp] = useState({ name: '', desc: '', installCmd: '', runCmd: '', uninstallCmd: '' });

  const detail = apps.find(a => a.id === selected);
  const filtered = apps.filter(a => (filter === '全部' || a.category === filter) && (!search || a.name.includes(search) || a.desc.includes(search)));
  const installedCount = apps.filter(a => a.installed).length;

  const exec = async (id: string, cmd: string, label: string) => {
    if (!currentDevice) { addToast('请先连接设备', 'warning'); return; }
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

  if (!currentDevice) {
    return (
      <div className="center-stage">
        <div className="oc-install-hero">
          <span style={{ fontSize: '4rem' }}>📦</span>
          <div>
            <h1 className="oc-hero-title">NodeHub 应用示例</h1>
            <p className="oc-hero-sub">地瓜机器人 NodeHub 应用商店<br/>一键安装、运行、管理 RDK 应用</p>
          </div>
        </div>
        <div className="isolated-widget" style={{ marginTop: 24 }}>
          <div className="widget-header">快速开始</div>
          <p className="desc-text">NodeHub 提供丰富的 RDK 应用示例，涵盖视觉检测、SLAM 导航、语音交互等场景。</p>
          <div className="oc-steps">
            <div className="oc-step"><span className="oc-step-n">1</span>连接 RDK 开发板</div>
            <div className="oc-step"><span className="oc-step-n">2</span>浏览并安装感兴趣的应用</div>
            <div className="oc-step"><span className="oc-step-n">3</span>一键运行，实时查看效果</div>
          </div>
          <div style={{ marginTop: 16 }}>
            <a href="https://developer.d-robotics.cc/nodehub" target="_blank" rel="noopener noreferrer" className="oc-ext-link">🔗 访问 NodeHub</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="center-stage wide-stage">
      {/* 状态栏 */}
      <div className="oc-bar">
        <div className="oc-bar-left">
          <span style={{ fontSize: '1.4rem' }}>📦</span>
          <span className="oc-bar-name">NodeHub 应用</span>
          <a href="https://developer.d-robotics.cc/nodehub" target="_blank" rel="noopener noreferrer" className="oc-ext-link" style={{ marginLeft: 8, fontSize: '0.75rem' }}>NodeHub ↗</a>
        </div>
        <div className="oc-bar-right">
          <span className="oc-bar-stat"><b>{installedCount}</b> 已安装</span>
          <span className="oc-bar-stat"><b>{apps.filter(a => a.running).length}</b> 运行中</span>
          <button className="oc-bar-btn" onClick={handleCheckDeps} disabled={!!busyId}>依赖检查</button>
          <button className="oc-bar-btn" onClick={() => setShowAdd(true)}>+ 添加应用</button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {CATEGORIES.map(c => (
          <button key={c} className={`oc-bar-btn ${filter === c ? 'primary' : ''}`} onClick={() => setFilter(c)}>{c}</button>
        ))}
        <div style={{ marginLeft: 'auto' }}>
          <input className="oc-skill-add-input" placeholder="搜索应用..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 180 }} />
        </div>
      </div>

      {/* 应用卡片网格 */}
      <div className="workspace-grid three-column" style={{ marginTop: 16 }}>
        {filtered.map(app => (
          <div key={app.id} className={`panel-card ${selected === app.id ? '' : ''}`} style={{ cursor: 'pointer', borderColor: selected === app.id ? '#ff6b00' : undefined }} onClick={() => setSelected(app.id)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: '1.6rem' }}>{app.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b' }}>{app.name}</div>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{app.category}</div>
              </div>
              {app.running && <span className="oc-bar-badge on" style={{ fontSize: '0.68rem' }}><span className="oc-live-dot" />运行中</span>}
              {app.installed && !app.running && <span className="oc-bar-badge" style={{ fontSize: '0.68rem', background: '#f0fdf4', color: '#16a34a', borderColor: '#bbf7d0' }}>已安装</span>}
            </div>
            <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: '#64748b', lineHeight: 1.5 }}>{app.desc}</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {!app.installed && <button className="oc-bar-btn primary" style={{ fontSize: '0.78rem', padding: '5px 14px' }} disabled={busyId === app.id} onClick={e => { e.stopPropagation(); handleInstall(app); }}>{busyId === app.id ? '安装中...' : '安装'}</button>}
              {app.installed && !app.running && <button className="oc-bar-btn primary" style={{ fontSize: '0.78rem', padding: '5px 14px' }} disabled={busyId === app.id} onClick={e => { e.stopPropagation(); handleRun(app); }}>▶ 运行</button>}
              {app.running && <button className="oc-bar-btn" style={{ fontSize: '0.78rem', padding: '5px 14px', color: '#ef4444', borderColor: '#fca5a5' }} onClick={e => { e.stopPropagation(); handleStop(app); }}>⏹ 停止</button>}
              {app.installed && <button className="oc-bar-btn" style={{ fontSize: '0.78rem', padding: '5px 14px', color: '#ef4444', borderColor: '#fca5a5' }} onClick={e => { e.stopPropagation(); handleUninstall(app); }}>卸载</button>}
              {app.custom && <button className="oc-bar-btn" style={{ fontSize: '0.78rem', padding: '5px 14px' }} onClick={e => { e.stopPropagation(); handleRemoveCustom(app.id); }}>移除</button>}
              {app.repo && <a href={app.repo} target="_blank" rel="noopener noreferrer" className="oc-ext-link" style={{ fontSize: '0.72rem' }} onClick={e => e.stopPropagation()}>详情 ↗</a>}
            </div>
          </div>
        ))}
      </div>

      {/* 日志面板 */}
      {showLog && logs.length > 0 && (
        <div className="isolated-widget" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="widget-header" style={{ margin: 0 }}>📋 执行日志</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="oc-bar-btn" onClick={() => setLogs([])}>清空</button>
              <button className="oc-bar-btn" onClick={() => setShowLog(false)}>收起</button>
            </div>
          </div>
          <pre className="ros-output-content" style={{ maxHeight: 200, overflow: 'auto' }}>{logs.join('\n')}</pre>
        </div>
      )}

      {/* 添加应用弹窗 */}
      {showAdd && (
        <>
          <div className="oc-modal-mask" onClick={() => setShowAdd(false)} />
          <div className="oc-modal">
            <div className="oc-modal-head">
              <h3 className="oc-modal-title">📦 添加自定义应用</h3>
              <button className="oc-modal-close" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <div className="oc-input-group"><label>应用名称</label><input placeholder="我的应用" value={newApp.name} onChange={e => setNewApp(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="oc-input-group"><label>描述</label><input placeholder="应用描述..." value={newApp.desc} onChange={e => setNewApp(p => ({ ...p, desc: e.target.value }))} /></div>
            <div className="oc-input-group"><label>安装命令</label><input placeholder="sudo apt install -y ..." value={newApp.installCmd} onChange={e => setNewApp(p => ({ ...p, installCmd: e.target.value }))} /></div>
            <div className="oc-input-group"><label>运行命令</label><input placeholder="ros2 launch ..." value={newApp.runCmd} onChange={e => setNewApp(p => ({ ...p, runCmd: e.target.value }))} /></div>
            <div className="oc-input-group"><label>卸载命令</label><input placeholder="sudo apt remove -y ..." value={newApp.uninstallCmd} onChange={e => setNewApp(p => ({ ...p, uninstallCmd: e.target.value }))} /></div>
            <button className="oc-save-btn wide" onClick={handleAddApp}>添加应用</button>
          </div>
        </>
      )}
    </div>
  );
}
