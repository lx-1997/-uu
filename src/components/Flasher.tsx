import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { flashCheck, getRememberedDevicePassword } from '../api';

type WizardStep = 0 | 1 | 2 | 3 | 4;
type StageKey = 'check' | 'write' | 'verify' | 'done';
type StageState = Record<StageKey, 'wait' | 'run' | 'done' | 'error' | 'skip'>;

interface DeviceItem {
  key: string;
  name: string;
  infoUrl: string;
  imageDownloadUrl?: string;
  toolDownloadUrl?: string;
}

interface ImageItem {
  key: string;
  name: string;
  infoUrl: string;
  downloadUrl: string;
  tags: string[];
}

const DEVICE_LIST: DeviceItem[] = [
  { key: 'x3', name: 'RDK X3', infoUrl: 'https://developer.d-robotics.cc/rdkx3' },
  { key: 'x5', name: 'RDK X5', infoUrl: 'https://developer.d-robotics.cc/rdkx5' },
  {
    key: 's100',
    name: 'RDK S100(P)',
    infoUrl: 'https://developer.d-robotics.cc/rdks100',
    imageDownloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_s100/',
    toolDownloadUrl: 'https://archive.d-robotics.cc/downloads/software_tools/download_tools/xburn-gui_1.1.8/',
  },
  { key: 'x3-module', name: 'RDK X3 Module(TF Card)', infoUrl: 'https://developer.d-robotics.cc/rdkx3' },
  {
    key: 'x3-module-emmc',
    name: 'RDK X3 Module(eMMC)',
    infoUrl: 'https://developer.d-robotics.cc/rdkx3',
    imageDownloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/',
    toolDownloadUrl: 'https://archive.d-robotics.cc/downloads/software_tools/download_tools/xburn-gui_1.1.8/',
  },
  { key: 'x5-module', name: 'RDK X5 Module(TF Card)', infoUrl: 'https://developer.d-robotics.cc/rdkx5' },
  {
    key: 'x5-module-emmc',
    name: 'RDK X5 Module(eMMC)',
    infoUrl: 'https://developer.d-robotics.cc/rdkx5',
    imageDownloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/',
    toolDownloadUrl: 'https://archive.d-robotics.cc/downloads/software_tools/download_tools/xburn-gui_1.1.8/',
  },
];

const IMAGE_LIST: Record<'x3' | 'x5', ImageItem[]> = {
  x3: [
    {
      key: 'x3-303-desktop',
      name: 'RDKOS 3.0.3 Desktop',
      infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download',
      downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/rdk_os_3.0.3-2025-09-08/rdk-x3-ubuntu22-preinstalled-desktop-3.0.3-arm64.img.xz',
      tags: ['图形界面', 'ubuntu22.04'],
    },
    {
      key: 'x3-303-server',
      name: 'RDKOS 3.0.3 Server',
      infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download',
      downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/rdk_os_3.0.3-2025-09-08/rdk-x3-ubuntu22-preinstalled-server-3.0.3-arm64.img.xz',
      tags: ['无图形界面', 'ubuntu22.04'],
    },
  ],
  x5: [
    {
      key: 'x5-341-desktop',
      name: 'RDKOS 3.4.1 Desktop',
      infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download',
      downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/rdk_os_3.4.1-2025-12-9/rdk-x5-ubuntu22-preinstalled-desktop-3.4.1-arm64.img.xz',
      tags: ['图形界面', 'ubuntu22.04'],
    },
    {
      key: 'x5-341-server',
      name: 'RDKOS 3.4.1 Server',
      infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download',
      downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/rdk_os_3.4.1-2025-12-9/rdk-x5-ubuntu22-preinstalled-server-3.4.1-arm64.img.xz',
      tags: ['无图形界面', 'ubuntu22.04'],
    },
  ],
};

const createStages = (): StageState => ({
  check: 'wait',
  write: 'wait',
  verify: 'wait',
  done: 'wait',
});

const stageLabel: Record<StageKey, string> = {
  check: '环境检查',
  write: '真实写盘',
  verify: '后续验证',
  done: '完成',
};

function getBaseDeviceKey(deviceKey: string): 'x3' | 'x5' {
  return deviceKey.startsWith('x3') ? 'x3' : 'x5';
}

export default function Flasher() {
  const { currentDevice, setActiveTab, addToast, startFlash } = useAppState();

  const [step, setStep] = useState<WizardStep>(0);
  const [selectedDeviceKey, setSelectedDeviceKey] = useState<string>('x5');
  const [selectedImageKey, setSelectedImageKey] = useState<string>('x5-341-desktop');
  const [customImagePath, setCustomImagePath] = useState('');
  const [localDrives, setLocalDrives] = useState<Array<{ path: string; label: string; size: string; bus: string }>>([]);
  const [localDrivePath, setLocalDrivePath] = useState('');

  const [stages, setStages] = useState<StageState>(createStages());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  const runningStageRef = useRef<StageKey | null>(null);
  const abortRef = useRef(false);

  const isDesktop = typeof window !== 'undefined' && !!window.rdkDesktop?.isDesktop;
  const deviceId = currentDevice?.id ?? '';
  const password = getRememberedDevicePassword(deviceId);

  const imageCandidates = IMAGE_LIST[getBaseDeviceKey(selectedDeviceKey)];
  const selectedImage = useMemo(() => imageCandidates.find((item) => item.key === selectedImageKey) ?? imageCandidates[0], [imageCandidates, selectedImageKey]);

  const appendLog = (text: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${text}`]);
  const setStage = (key: StageKey, value: StageState[StageKey]) => setStages((prev) => ({ ...prev, [key]: value }));
  const markRunning = (key: StageKey) => {
    runningStageRef.current = key;
    setStage(key, 'run');
  };

  const openExternal = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const chooseDevice = (key: string) => {
    setSelectedDeviceKey(key);
    const first = IMAGE_LIST[getBaseDeviceKey(key)][0];
    if (first) setSelectedImageKey(first.key);
  };

  const scanLocalDrives = useCallback(async () => {
    if (!window.rdkDesktop?.flashListDrives) {
      setError('当前环境不支持本机磁盘扫描，请在桌面客户端运行');
      return;
    }
    const result = await window.rdkDesktop.flashListDrives();
    if (!result.ok) {
      setError(result.error || '磁盘扫描失败');
      return;
    }
    const drives = result.drives || [];
    setLocalDrives(drives);
    if (!localDrivePath && drives[0]) setLocalDrivePath(drives[0].path);
    addToast(`已扫描 ${drives.length} 个可写盘设备`, 'info');
  }, [addToast, localDrivePath]);

  useEffect(() => {
    if (step !== 2) return;
    if (!isDesktop) return;
    if (localDrives.length > 0) return;
    scanLocalDrives();
  }, [step, isDesktop, localDrives.length, scanLocalDrives]);

  const checkEnvironment = async () => {
    if (!currentDevice) {
      setError('请先连接设备（用于读取板卡信息）');
      return;
    }
    setLoading(true);
    setError('');
    setLogs([]);
    setStages(createStages());
    setStage('check', 'run');
    appendLog('开始设备环境检查...');

    try {
      const response = await flashCheck(deviceId, password);
      if (!response.ok) throw new Error('设备环境检查失败');
      setStage('check', 'done');
      appendLog('环境检查通过');
      setStep(1);
    } catch (err: any) {
      const message = err?.message || '环境检查失败';
      setError(message);
      setStage('check', 'error');
      appendLog(`失败: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const goToDriveStep = () => {
    if (!customImagePath.trim()) {
      setError('请先选择本机镜像文件（真实写盘必须使用本机文件）');
      return;
    }
    setError('');
    setStep(2);
  };

  const pickLocalImage = async () => {
    if (!window.rdkDesktop?.flashPickImage) {
      setError('当前环境不支持本机镜像选择，请在桌面客户端运行');
      return;
    }
    const result = await window.rdkDesktop.flashPickImage();
    if (result.ok && result.path) {
      setCustomImagePath(result.path);
      addToast('已选择本机镜像文件', 'success');
    }
  };

  const runLocalFlashing = async () => {
    if (!isDesktop || !window.rdkDesktop?.flashWriteLocal) {
      setError('真实写盘仅支持桌面客户端');
      return;
    }
    if (!customImagePath.trim()) {
      setError('请先选择本机镜像文件');
      return;
    }
    if (!localDrivePath.trim()) {
      setError('请先选择真实物理磁盘');
      return;
    }

    abortRef.current = false;
    setLoading(true);
    setError('');
    setStep(3);
    setStages(createStages());
    setLogs([]);

    try {
      setStage('check', 'done');
      markRunning('write');
      appendLog(`写盘目标: ${localDrivePath}`);
      appendLog(`镜像文件: ${customImagePath}`);
      const result = await window.rdkDesktop.flashWriteLocal({ imagePath: customImagePath.trim(), drivePath: localDrivePath.trim() });
      if (!result.ok) throw new Error(result.error || '写盘失败');
      if (abortRef.current) throw new Error('用户取消执行');
      appendLog(result.output || '写盘完成');
      setStage('write', 'done');

      setStage('verify', 'skip');
      appendLog('后续验证请在目标板卡启动后进行');

      setStage('done', 'done');
      runningStageRef.current = null;
      appendLog('流程完成');
      startFlash();
      addToast('真实写盘完成', 'success');
      setStep(4);
    } catch (err: any) {
      const message = err?.message || '写盘失败';
      setError(message);
      appendLog(`失败: ${message}`);
      setStage(runningStageRef.current || 'write', 'error');
      addToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const requestCancel = () => {
    abortRef.current = true;
    addToast('已请求取消，当前步骤结束后停止', 'warning');
  };

  return (
    <div className="center-stage flasher-stage">
      <div className="ob-wizard flasher-wizard flx-shell">
        <section className="flx-header">
          <div>
            <div className="flx-kicker">真实写盘模式</div>
            <h1>镜像烧录向导</h1>
            <p>只保留真实本机写盘：选择镜像文件与物理磁盘后执行写入。</p>
          </div>
        </section>

        <section className="flx-steps">
          {['选择设备', '选择镜像文件', '选择物理磁盘并执行'].map((label, idx) => (
            <div key={label} className={`flx-step ${step >= idx + 1 ? 'done' : ''} ${step === idx || step === idx + 1 ? 'active' : ''}`}>
              <span>{idx + 1}</span>{label}
            </div>
          ))}
        </section>

        {step === 0 && (
          <section className="flx-body">
            <div className="flx-card">
              <div className="flx-card-title">设备列表（用于推荐镜像）</div>
              <div className="flx-list">
                {DEVICE_LIST.map((item) => (
                  <div key={item.key} className={`flx-list-item ${selectedDeviceKey === item.key ? 'active' : ''}`} onClick={() => chooseDevice(item.key)}>
                    <strong>{item.name}</strong>
                    <div className="flx-action-row">
                      <button className="clean-btn outline-btn sm-btn" onClick={(e) => { e.stopPropagation(); openExternal(item.infoUrl); }}>了解设备</button>
                      {item.imageDownloadUrl && <button className="clean-btn outline-btn sm-btn" onClick={(e) => { e.stopPropagation(); openExternal(item.imageDownloadUrl!); }}>镜像下载</button>}
                      {item.toolDownloadUrl && <button className="clean-btn outline-btn sm-btn" onClick={(e) => { e.stopPropagation(); openExternal(item.toolDownloadUrl!); }}>烧录工具</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {error && <div className="warning-banner">⚠ {error}</div>}
            <div className="ob-nav">
              <div />
              <button className="ob-btn primary" onClick={checkEnvironment} disabled={loading || !currentDevice}>{loading ? '检查中...' : '下一步 → 选择镜像'}</button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="flx-body">
            <div className="flx-card-grid">
              <div className="flx-card">
                <div className="flx-card-title">官方镜像参考</div>
                <div className="flx-list">
                  {imageCandidates.map((item) => (
                    <div key={item.key} className={`flx-list-item ${selectedImageKey === item.key ? 'active' : ''}`} onClick={() => setSelectedImageKey(item.key)}>
                      <strong>{item.name}</strong>
                      <div className="flx-tag-row">
                        {item.tags.map((tag) => <span key={`${item.key}-${tag}`} className="flx-tag">{tag}</span>)}
                      </div>
                      <div className="flx-action-row">
                        <button className="clean-btn outline-btn sm-btn" onClick={(e) => { e.stopPropagation(); openExternal(item.infoUrl); }}>详情</button>
                        <button className="clean-btn outline-btn sm-btn" onClick={(e) => { e.stopPropagation(); openExternal(item.downloadUrl); }}>手动下载</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flx-card">
                <div className="flx-card-title">本机镜像文件（必选）</div>
                <div className="flx-form">
                  <div className="flx-inline">
                    <input className="clean-input" placeholder="本机镜像文件路径（.img/.xz 解压后 .img）" value={customImagePath} onChange={(e) => setCustomImagePath(e.target.value)} />
                    <button className="clean-btn outline-btn sm-btn" onClick={pickLocalImage}>选择文件</button>
                  </div>
                  {!isDesktop && <div className="warning-banner">⚠ 当前不是桌面端，无法执行真实写盘</div>}
                </div>
              </div>
            </div>
            {error && <div className="warning-banner">⚠ {error}</div>}
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => setStep(0)}>← 上一步</button>
              <button className="ob-btn primary" onClick={goToDriveStep}>下一步 → 选择磁盘</button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="flx-body">
            <div className="flx-card-grid">
              <div className="flx-card">
                <div className="flx-card-title">真实物理磁盘</div>
                <div className="flx-list">
                  {localDrives.map((item) => (
                    <button key={item.path} className={`flx-list-item ${localDrivePath === item.path ? 'active' : ''}`} onClick={() => setLocalDrivePath(item.path)}>
                      <strong>{item.label} · {item.path}</strong>
                      <span>{item.bus} · {item.size}</span>
                    </button>
                  ))}
                </div>
                <button className="clean-btn outline-btn sm-btn" onClick={scanLocalDrives}>刷新磁盘列表</button>
              </div>

              <div className="flx-card">
                <div className="flx-card-title">执行确认</div>
                <div className="flx-confirm-grid">
                  <div><span>设备</span><strong>{DEVICE_LIST.find((d) => d.key === selectedDeviceKey)?.name}</strong></div>
                  <div><span>镜像</span><strong>{selectedImage?.name}</strong></div>
                  <div><span>本机镜像</span><strong>{customImagePath || '未选择'}</strong></div>
                  <div><span>目标磁盘</span><strong>{localDrivePath || '未选择'}</strong></div>
                </div>
                <div className="warning-banner" style={{ marginTop: 8 }}>
                  ⚠ 写盘将清空目标磁盘全部数据，请再次确认路径和容量。
                </div>
              </div>
            </div>
            {error && <div className="warning-banner">⚠ {error}</div>}
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => setStep(1)}>← 上一步</button>
              <button className="ob-btn primary" disabled={loading} onClick={runLocalFlashing}>{loading ? '执行中...' : '开始真实写盘'}</button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="flx-progress-wrap">
            <div className="flx-progress-header">
              <h3>真实写盘执行中</h3>
              <button className="ob-btn ghost" onClick={requestCancel}>请求取消</button>
            </div>
            <div className="flx-stage-list">
              {(Object.keys(stages) as StageKey[]).map((key) => (
                <div key={key} className={`flx-stage ${stages[key]}`}>
                  <span className="dot" />
                  <span className="label">{stageLabel[key]}</span>
                  <span className="status">
                    {stages[key] === 'wait' && '等待'}
                    {stages[key] === 'run' && '执行中'}
                    {stages[key] === 'done' && '完成'}
                    {stages[key] === 'error' && '失败'}
                    {stages[key] === 'skip' && '跳过'}
                  </span>
                </div>
              ))}
            </div>
            <div className="flx-log-panel">
              {logs.length === 0 ? <div className="flx-log-empty">等待日志输出...</div> : logs.map((line, idx) => <div key={idx}>{line}</div>)}
            </div>
            {error && <div className="warning-banner">⚠ {error}</div>}
          </section>
        )}

        {step === 4 && (
          <section className="flx-done">
            <h2>✅ 写盘完成</h2>
            <p>镜像已写入目标磁盘。请安全弹出介质并插入目标板卡进行启动验证。</p>
            <div className="flx-next-actions">
              <button className="clean-btn" onClick={() => { setActiveTab('terminal'); addToast('已切换终端', 'info'); }}>终端验证</button>
              <button className="clean-btn outline-btn" onClick={() => { setActiveTab('hardware'); addToast('已切换硬件状态', 'info'); }}>硬件状态</button>
              <button className="clean-btn outline-btn" onClick={() => { setActiveTab('examples'); addToast('已切换示例应用', 'info'); }}>示例应用</button>
            </div>
            <button className="ob-btn ghost" onClick={() => { setStep(0); setStages(createStages()); setLogs([]); setError(''); }}>重新写盘</button>
          </section>
        )}
      </div>
    </div>
  );
}
