import { useEffect, useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { executeDeviceCommand, getRememberedDevicePassword } from '../api';

/* ── NodeHub 应用示例 ── */

interface AppItem {
  id: string; name: string; icon: string; desc: string; category: string;
  repo: string; installCmd: string; runCmd: string; uninstallCmd: string;
  installed: boolean; running: boolean; custom?: boolean;
  pkgName?: string; processKey?: string;
  scenario?: string;
}

const BUILTIN_APPS: AppItem[] = [
  { id: 'yolo', name: 'YOLO 目标检测', icon: '🎯', desc: '基于 hobot_dnn 的实时目标检测', category: '视觉',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/168', installCmd: 'sudo apt install -y tros-hobot-dnn && sudo apt install -y tros-dnn-node-example',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch dnn_node_example dnn_node_example.launch.py',
    uninstallCmd: 'sudo apt remove -y tros-dnn-node-example', installed: false, running: false, pkgName: 'tros-dnn-node-example', processKey: 'dnn_node_example', scenario: '适合巡检、安防、视觉触发控制场景' },
  { id: 'body', name: '人体骨骼点检测', icon: '🏃', desc: '人体关键点检测与姿态估计', category: '视觉',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/169', installCmd: 'sudo apt install -y tros-hobot-body-det',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hobot_body_det hobot_body_det.launch.py',
    uninstallCmd: 'sudo apt remove -y tros-hobot-body-det', installed: false, running: false, pkgName: 'tros-hobot-body-det', processKey: 'hobot_body_det', scenario: '适合人体跟随、互动识别与姿态分析' },
  { id: 'slam', name: 'ORB-SLAM3', icon: '🗺️', desc: '视觉 SLAM 建图与定位', category: '导航',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/170', installCmd: 'sudo apt install -y tros-orb-slam3',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch orb_slam3 orb_slam3.launch.py',
    uninstallCmd: 'sudo apt remove -y tros-orb-slam3', installed: false, running: false, pkgName: 'tros-orb-slam3', processKey: 'orb_slam3', scenario: '适合建图定位、路径规划前置能力' },
  { id: 'nav2', name: 'Nav2 导航', icon: '🧭', desc: 'ROS2 自主导航框架', category: '导航',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/171', installCmd: 'sudo apt install -y tros-nav2-bringup',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch nav2_bringup navigation_launch.py',
    uninstallCmd: 'sudo apt remove -y tros-nav2-bringup', installed: false, running: false, pkgName: 'tros-nav2-bringup', processKey: 'nav2_bringup|navigation_launch', scenario: '适合室内导航、巡线与自动回充场景' },
  { id: 'tts', name: '语音合成 TTS', icon: '🔊', desc: '文本转语音输出', category: '语音',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/172', installCmd: 'sudo apt install -y tros-hobot-tts',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hobot_tts hobot_tts.launch.py',
    uninstallCmd: 'sudo apt remove -y tros-hobot-tts', installed: false, running: false, pkgName: 'tros-hobot-tts', processKey: 'hobot_tts', scenario: '适合语音播报、对话反馈与提示音场景' },
  { id: 'hand', name: '手势识别', icon: '✋', desc: '实时手势检测与分类', category: '视觉',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/173', installCmd: 'sudo apt install -y tros-hand-gesture-det',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hand_gesture_det hand_gesture_det.launch.py',
    uninstallCmd: 'sudo apt remove -y tros-hand-gesture-det', installed: false, running: false, pkgName: 'tros-hand-gesture-det', processKey: 'hand_gesture_det', scenario: '适合非接触式交互与手势控制场景' },
];

const CATEGORIES = ['全部', '视觉', '导航', '语音', '自定义'];

export default function Examples() {
  const { currentDevice, addToast, setActiveTab, setChatExpanded, setCmd } = useAppState();
  const [apps, setApps] = useState<AppItem[]>(BUILTIN_APPS);
  const [filter, setFilter] = useState('全部');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newApp, setNewApp] = useState({ name: '', desc: '', installCmd: '', runCmd: '', uninstallCmd: '' });

  const pushToMainChat = (text: string) => {
    setActiveTab('dashboard');
    setChatExpanded(true);
    setCmd(text);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const form = document.querySelector('.input-box') as HTMLFormElement | null;
        form?.requestSubmit();
      });
    });
  };

  const writeEcosystemSnapshot = (nextApps: AppItem[]) => {
    const installed = nextApps.filter((a) => a.installed).map((a) => a.name);
    const running = nextApps.filter((a) => a.running).map((a) => a.name);
    const current = JSON.parse(localStorage.getItem('rdk-ecosystem-sync') || '{}') as Record<string, unknown>;
    const payload = {
      ...current,
      nodehub: {
        installed,
        running,
        deviceIp: currentDevice?.ip,
        updatedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem('rdk-ecosystem-sync', JSON.stringify(payload));
  };

  const syncFromBoard = async () => {
    if (!currentDevice) {
      addToast('请先连接设备', 'warning');
      return;
    }
    setBusyId('sync-board');
    try {
      const pwd = getRememberedDevicePassword(currentDevice.id);
      const command = 'bash -lc "dpkg -l 2>/dev/null | awk \'/^ii/{print $2}\' | grep \'^tros-\' || true; echo __PROC__; ps -ef | grep -E \'ros2 launch|hobot_|nav2|orb_slam3|gesture|tts|dnn_node\' | grep -v grep || true"';
      const result = await executeDeviceCommand(currentDevice.id, command, pwd);
      const output = result.output || '';
      setLogs((prev) => [...prev.slice(-60), `[板端同步] ${new Date().toLocaleTimeString()}`, output, '']);
      setShowLog(true);

      const [pkgPart, procPart = ''] = output.split('__PROC__');
      const installedSet = new Set(
        pkgPart
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      );

      const nextApps = apps.map((item) => {
        if (item.custom) return item;
        const installed = item.pkgName ? installedSet.has(item.pkgName) : item.installed;
        const running = item.processKey ? new RegExp(item.processKey, 'i').test(procPart) : false;
        return { ...item, installed, running };
      });

      setApps(nextApps);
      writeEcosystemSnapshot(nextApps);
      addToast('NodeHub 板端状态同步完成', 'success');
    } catch {
      addToast('NodeHub 板端同步失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

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
    if (out !== null) {
      setApps((prev) => {
        const next = prev.map((a) => a.id === app.id ? { ...a, installed: true } : a);
        writeEcosystemSnapshot(next);
        return next;
      });
      addToast(`${app.name} 安装完成`, 'success');
    }
  };

  const handleRun = async (app: AppItem) => {
    addToast(`正在启动 ${app.name}...`, 'info');
    const out = await exec(app.id, app.runCmd, `运行 ${app.name}`);
    if (out !== null) {
      setApps((prev) => {
        const next = prev.map((a) => a.id === app.id ? { ...a, running: true } : a);
        writeEcosystemSnapshot(next);
        return next;
      });
      addToast(`${app.name} 已启动`, 'success');
    }
  };

  const handleStop = async (app: AppItem) => {
    const cmd = `pkill -f "${app.runCmd.split('&&').pop()?.trim().split(' ')[2] || app.name}" || true`;
    await exec(app.id, cmd, `停止 ${app.name}`);
    setApps((prev) => {
      const next = prev.map((a) => a.id === app.id ? { ...a, running: false } : a);
      writeEcosystemSnapshot(next);
      return next;
    });
    addToast(`${app.name} 已停止`, 'info');
  };

  const handleUninstall = async (app: AppItem) => {
    if (!confirm(`确定卸载 ${app.name}？`)) return;
    addToast(`正在卸载 ${app.name}...`, 'info');
    const out = await exec(app.id, app.uninstallCmd, `卸载 ${app.name}`);
    if (out !== null) {
      setApps((prev) => {
        const next = prev.map((a) => a.id === app.id ? { ...a, installed: false, running: false } : a);
        writeEcosystemSnapshot(next);
        return next;
      });
      addToast(`${app.name} 已卸载`, 'info');
    }
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

  const handleOfficialReadyCheck = async () => {
    await exec(
      'rdk-ready',
      'cat /etc/os-release 2>/dev/null | head -6; echo "---"; python3 --version; echo "---"; command -v ros2 >/dev/null 2>&1 && ros2 --help >/dev/null && echo ROS2_READY || echo ROS2_MISSING; echo "---"; python3 -c "import importlib.util; print(\"BPU_LIB_READY\" if (importlib.util.find_spec(\"hobot_dnn\") or importlib.util.find_spec(\"hobot_dnn_rdkx5\") or importlib.util.find_spec(\"bpu_infer_lib_x5\")) else \"BPU_LIB_MISSING\")" 2>/dev/null || echo BPU_LIB_MISSING; echo "---"; dpkg -l 2>/dev/null | grep -E "tros-|hobot" | head -30 || true',
      '官方环境检查',
    );
  };

  useEffect(() => {
    if (currentDevice) {
      syncFromBoard();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDevice?.id]);

  /* ── 未连接设备 ── */
  if (!currentDevice) {
    return (
      <div className="tool-page">
        <div className="empty-state">
          <div className="empty-state-icon">
            <span>📦</span>
          </div>
          <h2 className="empty-state-title">NodeHub · 应用商店</h2>
          <p className="empty-state-desc">地瓜机器人 NodeHub 应用商店，一键安装、运行、管理 RDK 应用</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
            <span className="badge badge-muted">❶ 连接 RDK 开发板</span>
            <span className="badge badge-muted">❷ 浏览并安装感兴趣的应用</span>
            <span className="badge badge-muted">❸ 一键运行，实时查看效果</span>
          </div>
          <a href="https://developer.d-robotics.cc/nodehub" target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
            访问 NodeHub ↗
          </a>
        </div>
      </div>
    );
  }

  /* ── 主页面 ── */
  return (
    <div className="tool-page">
      {/* 顶部状态栏 */}
      <div className="tool-bar">
        <div className="tool-bar-left">
          <span className="tool-card-icon">📦</span>
          <span className="tool-bar-title">NodeHub</span>
          <span className="badge badge-muted">{apps.length} 应用</span>
        </div>
        <div className="tool-bar-right">
          <div className="tool-stats">
            <span className="tool-stat-chip"><span className="num">{installedCount}</span>已安装</span>
            <span className="tool-stat-chip live"><span className="num">{runningCount}</span>运行中</span>
          </div>
          <button className="btn btn-ghost" onClick={syncFromBoard} disabled={busyId === 'sync-board'}>
            {busyId === 'sync-board' ? '同步中...' : '板端同步'}
          </button>
          <button className="btn btn-ghost" onClick={handleOfficialReadyCheck} disabled={!!busyId}>官方环境检查</button>
          <button className="btn btn-ghost" onClick={handleCheckDeps} disabled={!!busyId}>依赖检查</button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ 添加应用</button>
        </div>
      </div>

      <div className="tool-content">
        {/* 设备信息条 */}
        <div className="tool-stats" style={{ flexWrap: 'wrap', paddingBottom: 8 }}>
          <span className="tool-stat-chip">设备 <span className="num">{currentDevice.name}</span></span>
          <span className="tool-stat-chip">IP <span className="num mono">{currentDevice.ip}</span></span>
          <span className="tool-stat-chip"><span className="num">{installedCount}</span> 已安装</span>
          <span className="tool-stat-chip live"><span className="num">{runningCount}</span> 运行中</span>
        </div>

        {/* 筛选栏 */}
        <div className="tool-filter">
          {CATEGORIES.map(c => (
            <button key={c} className={`tool-filter-btn ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>{c}</button>
          ))}
          <input className="input tool-bar-search" placeholder="搜索应用..." value={search} onChange={e => setSearch(e.target.value)} style={{ marginLeft: 'auto' }} />
        </div>

        {/* 应用卡片网格 */}
        <div className="tool-grid">
          {filtered.length === 0 && <p className="empty-state-desc">没有匹配的应用</p>}
          {filtered.map(app => (
            <div key={app.id} className={`tool-card ${app.running ? 'running' : app.installed ? 'installed' : ''} ${expandedId === app.id ? 'expanded' : ''}`}>
              <div className="tool-card-head" onClick={() => setExpandedId(expandedId === app.id ? null : app.id)} style={{ cursor: 'pointer' }}>
                <span className="tool-card-icon">{app.icon}</span>
                <div className="tool-card-info">
                  <span className="tool-card-name">{app.name}</span>
                  <span className="tool-card-meta"><span className="badge badge-muted">{app.category}</span></span>
                </div>
                {app.running && <span className="badge badge-ok"><span className="status-dot online" />运行中</span>}
                {app.installed && !app.running && <span className="badge badge-accent">已安装</span>}
                <span style={{ marginLeft: 'auto', fontSize: '0.7rem', transition: 'transform 0.2s', transform: expandedId === app.id ? 'rotate(180deg)' : 'rotate(0)' }} className="tool-card-meta">▼</span>
              </div>
              <p className="tool-card-desc">{app.desc}</p>
              {/* 内联详情面板 */}
              {expandedId === app.id && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="tool-card-desc"><span className="badge badge-muted">功能说明</span> {app.desc}</span>
                  <span className="tool-card-desc"><span className="badge badge-muted">适用场景</span> {app.scenario || '通用机器人开发场景'}</span>
                  <span className="tool-card-desc"><span className="badge badge-muted">执行结果</span> 安装后可在板端启动节点并输出实时结果，支持系统同步状态。</span>
                  <details>
                    <summary className="tool-card-meta" style={{ cursor: 'pointer' }}>查看执行命令</summary>
                    <pre className="config-terminal">{`安装: ${app.installCmd}\n运行: ${app.runCmd}\n卸载: ${app.uninstallCmd}`}</pre>
                  </details>
                  {app.repo && (
                    <span className="tool-card-desc">
                      <span className="badge badge-muted">NodeHub</span>{' '}
                      <a href={app.repo} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">查看详情 ↗</a>
                    </span>
                  )}
                </div>
              )}
              <div className="tool-card-actions">
                {!app.installed && (
                  <button className="btn btn-primary" disabled={busyId === app.id} onClick={() => handleInstall(app)}>
                    {busyId === app.id ? '安装中...' : '安装'}
                  </button>
                )}
                {app.installed && !app.running && (
                  <button className="btn btn-primary" disabled={busyId === app.id} onClick={() => handleRun(app)}>▶ 运行</button>
                )}
                {app.running && (
                  <button className="btn btn-danger" onClick={() => handleStop(app)}>⏹ 停止</button>
                )}
                {app.installed && (
                  <button className="btn btn-ghost" onClick={() => handleUninstall(app)}>卸载</button>
                )}
                {app.custom && (
                  <button className="btn btn-ghost" onClick={() => handleRemoveCustom(app.id)}>移除</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 日志面板 */}
      {showLog && logs.length > 0 && (
        <div className="tool-log">
          <div className="tool-log-head">
            <span>📋 执行日志</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setLogs([])}>清空</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowLog(false)}>收起</button>
            </div>
          </div>
          <pre className="tool-log-body">{logs.join('\n')}</pre>
        </div>
      )}

      {/* 添加应用弹窗 */}
      {showAdd && (
        <>
          <div className="modal-overlay" onClick={() => setShowAdd(false)} />
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">📦 添加自定义应用</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <div className="modal-body tool-add-modal">
              <div className="tool-add-field"><label>应用名称</label><input className="input" placeholder="我的应用" value={newApp.name} onChange={e => setNewApp(p => ({ ...p, name: e.target.value }))} /></div>
              <div className="tool-add-field"><label>描述</label><input className="input" placeholder="应用描述..." value={newApp.desc} onChange={e => setNewApp(p => ({ ...p, desc: e.target.value }))} /></div>
              <div className="tool-add-field"><label>安装命令</label><input className="input" placeholder="sudo apt install -y ..." value={newApp.installCmd} onChange={e => setNewApp(p => ({ ...p, installCmd: e.target.value }))} /></div>
              <div className="tool-add-field"><label>运行命令</label><input className="input" placeholder="ros2 launch ..." value={newApp.runCmd} onChange={e => setNewApp(p => ({ ...p, runCmd: e.target.value }))} /></div>
              <div className="tool-add-field"><label>卸载命令</label><input className="input" placeholder="sudo apt remove -y ..." value={newApp.uninstallCmd} onChange={e => setNewApp(p => ({ ...p, uninstallCmd: e.target.value }))} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowAdd(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleAddApp}>添加应用</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
