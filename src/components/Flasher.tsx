import { useMemo, useState, useCallback, useEffect } from 'react';
import { useAppState } from '../hooks/useAppState';
import { FLASH_IMAGES, STORAGE_TARGETS } from '../constants';
import { flashCheck, flashExecute, flashVerify, getRememberedDevicePassword } from '../api';

/* ═══════════════════════════════════════════════════════
   RDK 镜像烧录 — 真实设备操作
   支持两种模式：
   1. 网络烧录：设备在线时，通过 SSH 在设备上下载镜像并写入
   2. 本地烧录：引导用户使用 balenaEtcher 等工具写入 SD 卡
   ═══════════════════════════════════════════════════════ */

// 官方镜像下载地址映射
const IMAGE_URLS: Record<string, string> = {
  'ubuntu-22.04': 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/desktop/rdk-x5-ubuntu22-desktop-v1.0.0.img.xz',
  'ros2-humble': 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/server/rdk-x5-ubuntu22-server-ros2-v1.0.0.img.xz',
  'tros-ai': 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/server/rdk-x5-ubuntu22-server-tros-v1.0.0.img.xz',
};

type FlashStep = 'check' | 'image' | 'target' | 'wifi' | 'flash' | 'progress' | 'verify' | 'done';
type FlashMode = 'network' | 'local';

interface DeviceInfo {
  version: string;
  board: string;
  hasHbupdate: boolean;
  storage: string;
}

interface FlashPlanItem {
  label: string;
  value: string;
  hint?: string;
}

interface LocalDriveInfo {
  id: string;
  path: string;
  label: string;
  size: string;
  bus: string;
}

interface BoardProfile {
  key: string;
  title: string;
  family: string;
  image: string;
  boot: string;
  storage: string;
  recommendation: string;
  summary: string;
}

interface FlashChecklistItem {
  title: string;
  desc: string;
  ok: boolean;
}

const BOARD_PROFILES: BoardProfile[] = [
  {
    key: 'x5',
    title: 'RDK X5 / X5 Module',
    family: 'RDK X 系列',
    image: 'ROS2 / Ubuntu 22.04 镜像',
    boot: '推荐网络直写 / 本地 SD 写盘',
    storage: 'eMMC / SD / USB',
    recommendation: '适合机器人主控、视觉推理、ROS2 开发链路',
    summary: '优先推荐预装 ROS2 Humble 镜像，适合快速恢复和批量交付。',
  },
  {
    key: 'x3',
    title: 'RDK X3 / X3 Module',
    family: 'RDK X 系列',
    image: 'Ubuntu 基础镜像',
    boot: '推荐 SD 卡恢复 + SSH 验证',
    storage: 'SD / eMMC',
    recommendation: '适合边缘 AI、基础恢复、教学实验',
    summary: '建议采用稳定版 Ubuntu 镜像，优先保障恢复效率和兼容性。',
  },
  {
    key: 's',
    title: 'RDK S 系列',
    family: 'RDK S 系列',
    image: 'S 系列专用系统镜像',
    boot: '推荐本地写盘 + WiFi 预配置',
    storage: 'eMMC / TF / USB',
    recommendation: '适合批量烧录、交付初始化、标准化部署',
    summary: '优先按系列匹配镜像版本，避免跨系列烧录导致启动异常。',
  },
];

const FLASHING_HIGHLIGHTS = [
  '支持 RDK X / S 系列镜像识别与推荐',
  '支持网络直写与桌面端本地真实烧录',
  '支持 WiFi 预配置、写盘校验与结果验证',
  '适配批量恢复、交付初始化与研发快速重装',
];

export default function Flasher() {
  const {
    currentDevice, flashImage, setFlashImage, flashTarget, setFlashTarget,
    flashPhase, startFlash,
    setActiveTab, addToast, devices
  } = useAppState();

  const deviceId = currentDevice?.id ?? '';
  const pw = getRememberedDevicePassword(deviceId);

  const [step, setStep] = useState<FlashStep>('check');
  const [flashMode, setFlashMode] = useState<FlashMode>('network');
  const [wifiName, setWifiName] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [customUrl, setCustomUrl] = useState('');
  const [error, setError] = useState('');
  const [skipVerify, setSkipVerify] = useState(false);
  const [localImagePath, setLocalImagePath] = useState('');
  const [localDrives, setLocalDrives] = useState<LocalDriveInfo[]>([]);
  const [localDrivePath, setLocalDrivePath] = useState('');

  const steps = ['环境检测', '选镜像', '选介质', 'WiFi 预配', '执行烧录', '验证'];
  const stepKeys: FlashStep[] = ['check', 'image', 'target', 'wifi', 'flash', 'verify'];
  const currentIdx = stepKeys.indexOf(step === 'done' ? 'verify' : step === 'progress' ? 'flash' : step);
  const isDesktop = typeof window !== 'undefined' && !!window.rdkDesktop?.isDesktop;

  const selectedImage = FLASH_IMAGES.find(i => i.id === flashImage);
  const selectedTarget = STORAGE_TARGETS.find(t => t.id === flashTarget);
  const resolvedImageUrl = flashImage === 'local' ? customUrl.trim() : IMAGE_URLS[flashImage] || '';
  const boardSeries = useMemo(() => {
    const raw = deviceInfo?.board || '';
    if (/x5/i.test(raw)) return 'RDK X5 / X5 Module';
    if (/x3/i.test(raw)) return 'RDK X3 / X3 Module';
    if (/s/i.test(raw)) return 'RDK S 系列';
    return raw || '待检测';
  }, [deviceInfo?.board]);
  const activeBoardProfile = useMemo(() => {
    const raw = deviceInfo?.board || '';
    if (/x5/i.test(raw)) return BOARD_PROFILES[0];
    if (/x3/i.test(raw)) return BOARD_PROFILES[1];
    if (/s/i.test(raw)) return BOARD_PROFILES[2];
    return BOARD_PROFILES[0];
  }, [deviceInfo?.board]);
  const checklist = useMemo<FlashChecklistItem[]>(() => [
    { title: '设备已连接', desc: currentDevice ? `${currentDevice.name} · ${currentDevice.ip}` : '请先连接真实设备', ok: !!currentDevice },
    { title: '镜像已选择', desc: selectedImage?.label || '待选择镜像', ok: !!selectedImage },
    { title: '目标介质已确认', desc: selectedTarget?.label || '待选择写入介质', ok: !!selectedTarget },
    { title: '烧录模式可执行', desc: flashMode === 'network' ? '通过 SSH 在设备侧执行下载与写盘' : isDesktop ? '桌面端可执行物理写盘' : '浏览器模式仅展示离线烧录引导', ok: flashMode === 'network' || isDesktop },
  ], [currentDevice, selectedImage, selectedTarget, flashMode, isDesktop]);
  const flashPlan: FlashPlanItem[] = [
    { label: '设备系列', value: boardSeries, hint: '自动根据检测结果匹配推荐镜像' },
    { label: '镜像来源', value: selectedImage?.label || '未选择', hint: resolvedImageUrl || '待选择' },
    { label: '写入介质', value: selectedTarget ? `${selectedTarget.label} (${selectedTarget.path})` : '未选择', hint: selectedTarget?.safe },
    { label: '烧录模式', value: flashMode === 'network' ? '网络直写（设备在线）' : '本地写盘（人工执行）', hint: flashMode === 'network' ? '通过 SSH 下载并 dd/hbupdate 写入' : '导出镜像信息并引导本地工具写盘' },
    { label: '启动网络', value: wifiName || '未预配置', hint: wifiName ? '首次启动自动尝试连接 WiFi' : '首次启动后手动联网' },
  ];

  const appendLog = (msg: string) => setLogs(ls => [...ls, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const loadLocalDrives = useCallback(async () => {
    if (!isDesktop || !window.rdkDesktop?.flashListDrives) return;
    const res = await window.rdkDesktop.flashListDrives();
    if (!res.ok) {
      setError(res.error || '读取本机磁盘失败');
      return;
    }
    const drives = res.drives || [];
    setLocalDrives(drives);
    if (!localDrivePath && drives[0]) setLocalDrivePath(drives[0].path);
  }, [isDesktop, localDrivePath]);

  useEffect(() => {
    if (!isDesktop || !window.rdkDesktop?.onFlashProgress) return;
    window.rdkDesktop.onFlashProgress((payload) => {
      if (!payload?.message) return;
      appendLog(payload.message);
    });
  }, [isDesktop]);

  // Step 1: 检测设备环境
  const runCheck = useCallback(async () => {
    if (!deviceId) { setError('请先连接设备'); return; }
    setLoading(true); setError(''); setLogs([]);
    appendLog('正在检测设备环境...');
    try {
      const res = await flashCheck(deviceId, pw);
      if (res.ok) {
        const output = res.output;
        const version = output.match(/===VERSION===([\s\S]*?)===STORAGE===/)?.[1]?.trim() || 'unknown';
        const board = output.match(/===BOARD===([\s\S]*?)===HBUPDATE===/)?.[1]?.trim() || 'unknown';
        const hasHbupdate = output.includes('hbupdate-available');
        const storage = output.match(/===STORAGE===([\s\S]*?)===EMMC===/)?.[1]?.trim() || '';
        setDeviceInfo({ version, board, hasHbupdate, storage });
        appendLog(`设备型号: ${board}`);
        appendLog(`当前系统: ${version}`);
        appendLog(`hbupdate: ${hasHbupdate ? '可用' : '不可用'}`);
        appendLog('环境检测完成');
        setStep('image');
      } else {
        setError('设备检测失败');
      }
    } catch (e: any) {
      setError(e.message || '检测失败');
      appendLog(`错误: ${e.message}`);
    }
    setLoading(false);
  }, [deviceId, pw]);

  // Step 5: 执行烧录
  const runFlash = useCallback(async () => {
    if (!deviceId) return;
    setStep('progress'); setLoading(true); setError('');

    if (flashMode === 'network' && !resolvedImageUrl) {
      setError('无效的镜像地址');
      setLoading(false);
      return;
    }

    appendLog(`已生成烧录计划：${boardSeries}`);
    appendLog(`镜像：${resolvedImageUrl}`);
    appendLog(`目标介质：${selectedTarget?.label || flashTarget}`);
    appendLog(`模式：${flashMode === 'network' ? '网络直写' : '本地写盘'}`);

    try {
      if (flashMode === 'local' && isDesktop && window.rdkDesktop?.flashWriteLocal) {
        if (!localImagePath.trim() || !localDrivePath.trim()) {
          throw new Error('请选择本机镜像文件和目标磁盘');
        }
        appendLog(`本机镜像：${localImagePath}`);
        appendLog(`目标磁盘：${localDrivePath}`);
        const result = await window.rdkDesktop.flashWriteLocal({ imagePath: localImagePath.trim(), drivePath: localDrivePath.trim() });
        if (!result.ok) throw new Error(result.error || '本机烧录失败');
        appendLog(result.output || '本机烧录完成');
        setStep('verify');
        setLoading(false);
        return;
      }

      const result = await flashExecute(deviceId, {
        imageUrl: resolvedImageUrl,
        target: flashTarget,
        board: deviceInfo?.board,
        mode: flashMode,
        wifiName: wifiName.trim() || undefined,
        wifiPass: wifiPass.trim() || undefined,
        skipVerify,
      }, pw);

      const lines = (result.output || '执行完成').split(/\r?\n/).filter(Boolean);
      lines.slice(0, 24).forEach((line) => appendLog(line));

      if (result.strategy === 'local-guide') {
        appendLog('请按上述引导在本机完成写盘后，再返回执行验证。');
      } else {
        appendLog(`设备侧烧录完成，目标设备：${result.targetDevice}`);
      }
      setStep('verify');
    } catch (e: any) {
      setError(e.message || '烧录失败');
      appendLog(`错误: ${e.message || '烧录失败'}`);
    }
    setLoading(false);
  }, [deviceId, pw, resolvedImageUrl, boardSeries, selectedTarget, flashTarget, flashMode, deviceInfo?.board, wifiName, wifiPass, skipVerify]);

  // Step 6: 验证
  const runVerify = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true); setError('');
    appendLog('正在验证烧录结果...');
    try {
      const res = await flashVerify(deviceId, pw);
      appendLog(res.output?.slice(0, 300) || '验证完成');
      if (res.ok) {
        appendLog('✅ 系统验证通过');
        startFlash();
        setStep('done');
        addToast('镜像烧录验证通过', 'success');
      }
    } catch (e: any) {
      appendLog(`验证失败: ${e.message}`);
      setError('验证失败，设备可能需要重启');
    }
    setLoading(false);
  }, [deviceId, pw, startFlash, addToast]);

  return (
    <div className="center-stage flasher-stage">
      {devices.length === 0 && (
        <div style={{ width: '100%', maxWidth: 640, marginBottom: 16 }}>
          <button className="ob-btn ghost" style={{ padding: '6px 12px', fontSize: '0.85rem' }}
            onClick={() => setActiveTab('dashboard')}>← 返回新手指引</button>
        </div>
      )}
      <div className="ob-wizard flasher-wizard" style={{ maxWidth: 1080 }}>
        <section className="flasher-hero-card">
          <div className="flasher-hero-main">
            <div className="flasher-badge">RDK 镜像烧录中心</div>
            <h1 className="flasher-title">高效烧录 RDK X / S 系列镜像</h1>
            <p className="flasher-subtitle">
              面向真实设备提供系列识别、镜像推荐、写盘路径规划、WiFi 预配置与结果验证，覆盖研发恢复、批量交付与系统重装场景。
            </p>
            <div className="flasher-chip-row">
              {FLASHING_HIGHLIGHTS.map((item) => (
                <span key={item} className="flasher-chip">{item}</span>
              ))}
            </div>
          </div>
          <div className="flasher-hero-side">
            <div className="flasher-side-panel">
              <div className="flasher-side-label">当前推荐系列</div>
              <div className="flasher-side-title">{activeBoardProfile.title}</div>
              <div className="flasher-side-meta">{activeBoardProfile.summary}</div>
              <div className="flasher-side-grid">
                <div><span>推荐镜像</span><strong>{activeBoardProfile.image}</strong></div>
                <div><span>写入方式</span><strong>{activeBoardProfile.boot}</strong></div>
                <div><span>目标存储</span><strong>{activeBoardProfile.storage}</strong></div>
                <div><span>适用场景</span><strong>{activeBoardProfile.recommendation}</strong></div>
              </div>
            </div>
          </div>
        </section>

        <section className="flasher-overview-grid">
          <div className="flasher-overview-card">
            <div className="flasher-card-head">
              <div>
                <div className="flasher-card-kicker">烧录前检查</div>
                <h3>执行条件一览</h3>
              </div>
              <span className="flasher-card-tag">实时状态</span>
            </div>
            <div className="flasher-checklist">
              {checklist.map((item) => (
                <div key={item.title} className={`flasher-check-item ${item.ok ? 'ok' : ''}`}>
                  <div className="flasher-check-icon">{item.ok ? '✓' : '•'}</div>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flasher-overview-card">
            <div className="flasher-card-head">
              <div>
                <div className="flasher-card-kicker">系列适配</div>
                <h3>RDK X / S 型号策略</h3>
              </div>
              <span className="flasher-card-tag soft">自动推荐</span>
            </div>
            <div className="flasher-profile-list">
              {BOARD_PROFILES.map((profile) => (
                <div key={profile.key} className={`flasher-profile-card ${profile.title === boardSeries ? 'active' : ''}`}>
                  <div className="flasher-profile-top">
                    <strong>{profile.title}</strong>
                    <span>{profile.family}</span>
                  </div>
                  <p>{profile.summary}</p>
                  <div className="flasher-profile-meta">
                    <span>{profile.image}</span>
                    <span>{profile.storage}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Progress */}
        <div className="ob-progress">
          {steps.map((s, i) => (
            <div key={s} className={`ob-prog-item ${currentIdx === i ? 'active' : ''} ${currentIdx > i || step === 'done' ? 'done' : ''}`}>
              <div className="ob-prog-dot">{currentIdx > i || step === 'done' ? '✓' : i + 1}</div>
              <span>{s}</span>
            </div>
          ))}
        </div>

        {/* Step 1: 环境检测 */}
        {step === 'check' && (
          <>
            <h2 className="ob-heading">设备环境检测</h2>
            <p className="ob-sub">检测当前设备的系统版本、存储空间和烧录工具可用性</p>
            {!currentDevice ? (
              <div className="warning-banner">⚠ 请先在左侧连接一台 RDK 设备</div>
            ) : (
              <>
                <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10, fontSize: '0.82rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8' }}>设备</span>
                    <strong>{currentDevice.name} ({currentDevice.ip})</strong>
                  </div>
                </div>
                {deviceInfo && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ padding: '8px 12px', background: '#f0fdf4', borderRadius: 8, fontSize: '0.78rem', color: '#16a34a' }}>
                      ✅ 设备型号: {deviceInfo.board} · 系统: {deviceInfo.version.slice(0, 40)}
                    </div>
                  </div>
                )}
                {error && <div className="warning-banner">⚠ {error}</div>}
                <div className="ai-recommend-strip" style={{ marginBottom: 0 }}>
                  <span className="ai-suggest-label">🤖 AI 建议</span>
                  <span className="ai-recommend-text">建议先检测设备环境，确认存储空间和工具链可用性</span>
                </div>
              </>
            )}
            <div className="ob-nav">
              <div />
              <button className="ob-btn primary" disabled={!currentDevice || loading}
                onClick={runCheck}>{loading ? '检测中...' : '开始检测 →'}</button>
            </div>
          </>
        )}

        {/* Step 2: 选镜像 */}
        {step === 'image' && (
          <>
            <h2 className="ob-heading">选择系统镜像</h2>
            <div className="ai-recommend-strip" style={{ marginBottom: 0 }}>
              <span className="ai-suggest-label">🤖 AI 推荐</span>
              <span className="ai-recommend-text">
                {deviceInfo?.board?.includes('X5') ? '推荐 ROS2 Humble 预装版，适合 X5 机器人开发链路' : deviceInfo?.board?.includes('X3') ? '推荐 Ubuntu 22.04 基础版，适合 X3 快速恢复' : '建议先选官方稳定镜像，再根据业务替换自定义镜像'}
              </span>
              <button className="clean-btn outline-btn sm-btn" onClick={() => {
                setFlashImage(deviceInfo?.board?.includes('X5') ? 'ros2-humble' : 'ubuntu-22.04');
                addToast('已选择 AI 推荐镜像', 'success');
              }}>采纳</button>
            </div>
            <div className="option-list" style={{ gap: 8 }}>
              {FLASH_IMAGES.map(img => (
                <button key={img.id} className={`select-card ${flashImage === img.id ? 'active' : ''}`}
                  onClick={() => setFlashImage(img.id)}>
                  <strong>{img.label}</strong>
                  <span>{img.detail}</span>
                </button>
              ))}
            </div>
            {flashImage === 'local' && (
              <div style={{ padding: '8px 12px' }}>
                <label style={{ fontSize: '0.78rem', color: '#475569', display: 'block', marginBottom: 4 }}>自定义镜像 URL</label>
                <input className="clean-input" style={{ width: '100%' }} placeholder="https://..." value={customUrl}
                  onChange={e => setCustomUrl(e.target.value)} />
              </div>
            )}
            {/* 烧录模式选择 */}
            <div style={{ padding: '8px 12px', background: '#f0f9ff', borderRadius: 8, fontSize: '0.78rem' }}>
              <div style={{ marginBottom: 6, color: '#1e40af', fontWeight: 600 }}>烧录模式</div>
              <label className="toggle-row" style={{ marginBottom: 4 }}>
                <input type="radio" name="flashMode" checked={flashMode === 'network'}
                  onChange={() => setFlashMode('network')} />
                <span>网络烧录 — 设备在线下载镜像并直写系统盘，适合批量高效烧录</span>
              </label>
              <label className="toggle-row">
                <input type="radio" name="flashMode" checked={flashMode === 'local'}
                  onChange={() => setFlashMode('local')} />
                <span>本地烧录 — 导出写盘指引，使用 balenaEtcher / dd 离线写盘</span>
              </label>
            </div>
            {flashMode === 'local' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 12px', background: '#f8fafc', borderRadius: 8 }}>
                <div style={{ fontSize: '0.78rem', color: '#334155', fontWeight: 600 }}>桌面端真实烧录</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input className="clean-input" style={{ flex: 1, minWidth: 240 }} placeholder="选择本机 .img 镜像文件" value={localImagePath} onChange={e => setLocalImagePath(e.target.value)} />
                  <button className="clean-btn outline-btn" onClick={async () => {
                    if (!window.rdkDesktop?.flashPickImage) return addToast('请在桌面端使用此功能', 'warning');
                    const picked = await window.rdkDesktop.flashPickImage();
                    if (picked.ok && picked.path) setLocalImagePath(picked.path);
                  }}>选择镜像</button>
                  <button className="clean-btn outline-btn" onClick={loadLocalDrives}>扫描磁盘</button>
                </div>
                <select className="clean-input" value={localDrivePath} onChange={e => setLocalDrivePath(e.target.value)}>
                  <option value="">选择目标可移动磁盘</option>
                  {localDrives.map((drive) => (
                    <option key={drive.path} value={drive.path}>{drive.label} · {drive.path} · {drive.bus} · {drive.size}</option>
                  ))}
                </select>
                {!isDesktop && <div className="warning-banner">⚠ 浏览器环境无法直接写入物理磁盘，请使用 Electron 桌面版执行真实烧录</div>}
              </div>
            )}
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => setStep('check')}>← 返回</button>
              <button className="ob-btn primary" disabled={!flashImage || (flashImage === 'local' && !customUrl.trim() && flashMode === 'network')}
                onClick={() => setStep('target')}>下一步 →</button>
            </div>
          </>
        )}

        {/* Step 3: 选介质 */}
        {step === 'target' && (
          <>
            <h2 className="ob-heading">选择写入介质</h2>
            <p className="ob-sub">镜像将写入到以下存储介质，原有数据会被覆盖</p>
            <div className="option-list" style={{ gap: 8 }}>
              {STORAGE_TARGETS.map(t => (
                <button key={t.id} className={`select-card ${flashTarget === t.id ? 'active' : ''}`}
                  onClick={() => setFlashTarget(t.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{t.label}</strong>
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{t.path}</span>
                  </div>
                  <span>{t.safe}</span>
                </button>
              ))}
            </div>
            {flashTarget === 'emmc' && (
              <div className="warning-banner">⚠ eMMC 写入不可逆，请确认已备份重要数据</div>
            )}
            {deviceInfo?.storage && (
              <div style={{ padding: '8px 12px', background: '#f8fafc', borderRadius: 8, fontSize: '0.75rem', color: '#475569' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>设备存储信息：</div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.72rem' }}>{deviceInfo.storage.slice(0, 200)}</pre>
              </div>
            )}
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => setStep('image')}>← 返回</button>
              <button className="ob-btn primary" disabled={!flashTarget} onClick={() => setStep('wifi')}>下一步 →</button>
            </div>
          </>
        )}

        {/* Step 4: WiFi 预配 */}
        {step === 'wifi' && (
          <>
            <h2 className="ob-heading">预配置 WiFi（可选）</h2>
            <p className="ob-sub">提前写入 WiFi 信息，开机后自动连接网络</p>
            <div className="ai-recommend-strip" style={{ marginBottom: 0 }}>
              <span className="ai-suggest-label">⚡ 高效建议</span>
              <span className="ai-recommend-text">批量烧录时建议预配测试 WiFi，可减少首次开机人工接线和串口介入</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#475569', display: 'block', marginBottom: 4 }}>WiFi 名称</label>
                <input className="clean-input" style={{ width: '100%' }} placeholder="例如: MyHome-5G"
                  value={wifiName} onChange={e => setWifiName(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#475569', display: 'block', marginBottom: 4 }}>WiFi 密码</label>
                <input className="clean-input" style={{ width: '100%' }} type="password" placeholder="留空则不预配置"
                  value={wifiPass} onChange={e => setWifiPass(e.target.value)} />
              </div>
            </div>
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => setStep('target')}>← 返回</button>
              <button className="ob-btn primary" onClick={() => setStep('flash')}>
                {wifiName ? '下一步 →' : '跳过，直接烧录 →'}
              </button>
            </div>
          </>
        )}

        {/* Step 5: 确认并执行 */}
        {step === 'flash' && (
          <>
            <h2 className="ob-heading">确认烧录配置</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              {flashPlan.map((item) => (
                <div key={item.label} style={{ padding: '12px 14px', background: '#f8fafc', borderRadius: 10, fontSize: '0.82rem', border: '1px solid rgba(148,163,184,0.14)' }}>
                  <div style={{ color: '#94a3b8', marginBottom: 6 }}>{item.label}</div>
                  <strong style={{ display: 'block', color: '#0f172a', lineHeight: 1.5 }}>{item.value}</strong>
                  {item.hint && <div style={{ marginTop: 6, color: '#64748b', fontSize: '0.74rem', lineHeight: 1.5 }}>{item.hint}</div>}
                </div>
              ))}
            </div>
            {flashMode === 'network' && (
              <div className="warning-banner">⚠ 网络烧录将在设备侧执行下载、解压和写盘，过程中设备可能重启，请确保供电稳定且目标盘选择正确</div>
            )}
            <label className="toggle-row" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={skipVerify} onChange={(e) => setSkipVerify(e.target.checked)} />
              <span>跳过设备侧介质校验，仅在我手动确认后执行系统验证</span>
            </label>
            <div className="flasher-summary-panel">
              <div className="flasher-summary-head">高效烧录建议</div>
              <ul>
                <li>研发场景优先选择“网络烧录”，可减少手工拷贝镜像与反复插拔存储介质。</li>
                <li>交付或量产准备场景建议预配置 WiFi，并优先选择稳定版官方镜像。</li>
                <li>烧录 eMMC 前请确认供电稳定，避免写入中断造成系统损坏。</li>
              </ul>
            </div>
            {error && <div className="warning-banner">⚠ {error}</div>}
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => setStep('wifi')}>← 返回</button>
              <button className="ob-btn primary" disabled={loading} onClick={runFlash}>
                {loading ? '执行中...' : '🔥 开始烧录'}
              </button>
            </div>
          </>
        )}

        {/* Progress */}
        {step === 'progress' && (
          <>
            <h2 className="ob-heading">烧录进行中...</h2>
            <div style={{ padding: '10px', background: '#1e1e1e', borderRadius: 8, maxHeight: 200, overflowY: 'auto' }}>
              {logs.map((l, i) => (
                <div key={i} style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#d4d4d4', lineHeight: 1.6 }}>{l}</div>
              ))}
            </div>
            {loading && <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.82rem' }}>⏳ 请耐心等待...</div>}
          </>
        )}

        {/* Step 6: 验证 */}
        {step === 'verify' && (
          <>
            <h2 className="ob-heading">验证烧录结果</h2>
            <div style={{ padding: '10px', background: '#1e1e1e', borderRadius: 8, maxHeight: 160, overflowY: 'auto' }}>
              {logs.map((l, i) => (
                <div key={i} style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#d4d4d4', lineHeight: 1.6 }}>{l}</div>
              ))}
            </div>
            {error && <div className="warning-banner">⚠ {error}</div>}
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => setStep('flash')}>← 返回</button>
              <button className="ob-btn primary" disabled={loading} onClick={runVerify}>
                {loading ? '验证中...' : '✅ 验证系统'}
              </button>
            </div>
          </>
        )}

        {/* Done */}
        {step === 'done' && (
          <>
            <h2 className="ob-heading">🎉 烧录完成</h2>
            <p className="ob-sub">系统已写入成功，设备已验证通过</p>
            <div style={{ padding: '10px 14px', background: '#f0fdf4', borderRadius: 10, fontSize: '0.78rem', color: '#16a34a', textAlign: 'center' }}>
              {flashPhase || '下一步: 打开终端进行首次配置 → 验证 BPU → 部署模型'}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="clean-btn" onClick={() => { setActiveTab('terminal'); addToast('已跳转到终端', 'info'); }}>💻 打开终端</button>
              <button className="clean-btn outline-btn" onClick={() => { setActiveTab('hardware'); addToast('已跳转到硬件检测', 'info'); }}>📊 硬件检测</button>
              <button className="clean-btn outline-btn" onClick={() => { setActiveTab('ros'); addToast('已跳转到 ROS', 'info'); }}>🤖 ROS 可视化</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
