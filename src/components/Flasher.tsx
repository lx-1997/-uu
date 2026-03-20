import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '../hooks/useAppState';

/* ═══════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════ */
type WizardStep = 0 | 1 | 2 | 3 | 4;

interface DeviceItem {
  key: string;
  name: string;
  infoUrl: string;
  imageDownloadUrl?: string;
  toolDownloadUrl?: string;
  toolDmgUrl?: string;
  toolWinUrl?: string;
  disabled?: boolean;
  disabledNotice?: string;
}

interface ImageItem {
  key: string;
  name: string;
  type: 'desktop' | 'server';
  infoUrl: string;
  downloadUrl: string;
  tags: string[];
}

interface WifiConfig {
  mode: 'station' | 'ap';
  ssid: string;
  password: string;
}

/* ═══════════════════════════════════════════════════════════
   Device & Image Data  (aligned with rdkstudio-front-main)
   ═══════════════════════════════════════════════════════════ */
const DEVICE_LIST: DeviceItem[] = [
  { key: 'x3', name: 'RDK X3', infoUrl: 'https://developer.d-robotics.cc/rdkx3' },
  { key: 'x5', name: 'RDK X5', infoUrl: 'https://developer.d-robotics.cc/rdkx5' },
  {
    key: 's100',
    name: 'RDK S100(P)',
    infoUrl: 'https://developer.d-robotics.cc/rdks100',
    imageDownloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_s100/',
  },
  { key: 'x3-module', name: 'RDK X3 Module (TF Card)', infoUrl: 'https://developer.d-robotics.cc/rdkx3' },
  {
    key: 'x3-module-emmc',
    name: 'RDK X3 Module (eMMC)',
    infoUrl: 'https://developer.d-robotics.cc/rdkx3',
    imageDownloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/',
    disabled: true,
    disabledNotice: '该设备需要使用第三方工具 (xburn) 烧写系统',
  },
  { key: 'x5-module', name: 'RDK X5 Module (TF Card)', infoUrl: 'https://developer.d-robotics.cc/rdkx5' },
  {
    key: 'x5-module-emmc',
    name: 'RDK X5 Module (eMMC)',
    infoUrl: 'https://developer.d-robotics.cc/rdkx5',
    imageDownloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/',
    toolDownloadUrl: 'https://archive.d-robotics.cc/downloads/software_tools/download_tools/xburn-gui_1.1.9/xburn-gui_1.1.9_amd64.deb',
    toolDmgUrl: 'https://archive.d-robotics.cc/downloads/software_tools/download_tools/xburn-gui_1.1.9/xburn-gui_1.1.9_universal.dmg',
    toolWinUrl: 'https://archive.d-robotics.cc/downloads/software_tools/download_tools/xburn-gui_1.1.9/xburn-gui_1.1.9_x64-setup.exe',
    disabled: true,
    disabledNotice: '该设备需要使用第三方工具 (xburn) 烧写系统',
  },
];

const IMAGE_LIST: Record<string, ImageItem[]> = {
  x3: [
    { key: 'x3-303-desktop', name: 'RDKOS 3.0.3 Desktop', type: 'desktop', infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download', downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/rdk_os_3.0.3-2025-09-08/rdk-x3-ubuntu22-preinstalled-desktop-3.0.3-arm64.img.xz', tags: ['图形界面', 'ubuntu22.04'] },
    { key: 'x3-303-server', name: 'RDKOS 3.0.3 Server', type: 'server', infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download', downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/rdk_os_3.0.3-2025-09-08/rdk-x3-ubuntu22-preinstalled-server-3.0.3-arm64.img.xz', tags: ['无图形界面', 'ubuntu22.04'] },
    { key: 'x3-301-desktop', name: 'RDKOS 3.0.1 Desktop', type: 'desktop', infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download', downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/rdk_os_3.0.1-2025-07-04/release/ubuntu-preinstalled-desktop-arm64.img.xz', tags: ['图形界面', 'ubuntu22.04'] },
    { key: 'x3-301-server', name: 'RDKOS 3.0.1 Server', type: 'server', infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download', downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/rdk_os_3.0.1-2025-07-04/release/ubuntu-preinstalled-server-arm64.img.xz', tags: ['无图形界面', 'ubuntu22.04'] },
  ],
  x5: [
    { key: 'x5-341-desktop', name: 'RDKOS 3.4.1 Desktop', type: 'desktop', infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download', downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/rdk_os_3.4.1-2025-12-9/rdk-x5-ubuntu22-preinstalled-desktop-3.4.1-arm64.img.xz', tags: ['图形界面', 'ubuntu22.04'] },
    { key: 'x5-341-server', name: 'RDKOS 3.4.1 Server', type: 'server', infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download', downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/rdk_os_3.4.1-2025-12-9/rdk-x5-ubuntu22-preinstalled-server-3.4.1-arm64.img.xz', tags: ['无图形界面', 'ubuntu22.04'] },
    { key: 'x5-333-desktop', name: 'RDKOS 3.3.3 Desktop', type: 'desktop', infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download', downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/rdk_os_3.3.3-2025-9-28/rdk-x5-ubuntu22-preinstalled-desktop-3.3.3-arm64.img.xz', tags: ['图形界面', 'ubuntu22.04'] },
    { key: 'x5-333-server', name: 'RDKOS 3.3.3 Server', type: 'server', infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download', downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/rdk_os_3.3.3-2025-9-28/rdk-x5-ubuntu22-preinstalled-server-3.3.3-arm64.img.xz', tags: ['无图形界面', 'ubuntu22.04'] },
    { key: 'x5-323-desktop', name: 'RDKOS 3.2.3 Desktop', type: 'desktop', infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download', downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/rdk_os_3.2.3-2025-7-9/rdk-x5-ubuntu22-preinstalled-desktop-3.2.3-arm64.img.xz', tags: ['图形界面', 'ubuntu22.04'] },
    { key: 'x5-323-server', name: 'RDKOS 3.2.3 Server', type: 'server', infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download', downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/rdk_os_3.2.3-2025-7-9/rdk-x5-ubuntu22-preinstalled-server-3.2.3-arm64.img.xz', tags: ['无图形界面', 'ubuntu22.04'] },
  ],
  s100: [
    { key: 's100-404-desktop', name: 'RDKS100-V4.0.4-Beta Desktop', type: 'desktop', infoUrl: 'https://developer.d-robotics.cc/rdks100', downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_s100/RDKS100-V4.0.4-Beta/RDK_LNX_SDK/firmwares/product.zip', tags: ['图形界面'] },
    { key: 's100-403-desktop', name: 'RDKS100-V4.0.3-Beta Desktop', type: 'desktop', infoUrl: 'https://developer.d-robotics.cc/rdks100', downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_s100/RDKS100-V4.0.3-Beta/RDK_LNX_SDK/firmwares/product.zip', tags: ['图形界面'] },
    { key: 's100-402-desktop', name: 'RDKS100-V4.0.2-Beta Desktop', type: 'desktop', infoUrl: 'https://developer.d-robotics.cc/rdks100', downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_s100/RDKS100-V4.0.2-Beta/RDK_LNX_SDK/firmwares/product.zip', tags: ['图形界面'] },
  ],
};

const XBURN_DOWNLOAD_URLS: Record<string, string> = {
  win32: 'https://archive.d-robotics.cc/downloads/software_tools/download_tools/xburn-gui_1.1.9/xburn-gui_1.1.9_x64-setup.exe',
  darwin: 'https://archive.d-robotics.cc/downloads/software_tools/download_tools/xburn-gui_1.1.9/xburn-gui_1.1.9_universal.dmg',
  linux: 'https://archive.d-robotics.cc/downloads/software_tools/download_tools/xburn-gui_1.1.9/xburn-gui_1.1.9_amd64.deb',
};

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */
function resolveImageKey(deviceKey: string): string {
  if (deviceKey === 'x3-module') return 'x3';
  if (deviceKey === 'x5-module') return 'x5';
  if (deviceKey.startsWith('x3')) return 'x3';
  if (deviceKey.startsWith('x5')) return 'x5';
  if (deviceKey === 's100') return 's100';
  return 'x5';
}

function requiresXburn(deviceKey: string): boolean {
  return deviceKey === 's100' || deviceKey.endsWith('-emmc');
}

function isCompressedFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.xz') || lower.endsWith('.zip');
}

const STEP_LABELS = ['选择设备', '选择镜像', '烧录写盘', '完成'];

/* ═══════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════ */
export default function Flasher() {
  const { setActiveTab, addToast, startFlash } = useAppState();

  /* ── wizard state ── */
  const [step, setStep] = useState<WizardStep>(0);
  const [selectedDeviceKey, setSelectedDeviceKey] = useState('x5');
  const [selectedImageKey, setSelectedImageKey] = useState('x5-341-desktop');
  const [useLocalImage, setUseLocalImage] = useState(false);
  const [localImagePath, setLocalImagePath] = useState('');

  /* ── drive state ── */
  const [drives, setDrives] = useState<FlashDrive[]>([]);
  const [selectedDrive, setSelectedDrive] = useState('');

  /* ── flash execution state ── */
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'decompressing' | 'flashing' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const abortRef = useRef(false);

  /* ── wifi config state ── */
  const [showWifiConfig, setShowWifiConfig] = useState(false);
  const [wifiConfig, setWifiConfig] = useState<WifiConfig>({ mode: 'station', ssid: '', password: '' });

  const isDesktop = typeof window !== 'undefined' && !!window.rdkDesktop?.isDesktop;
  const platform = window.rdkDesktop?.platform ?? 'unknown';

  const imageListKey = resolveImageKey(selectedDeviceKey);
  const imageCandidates = IMAGE_LIST[imageListKey] ?? [];
  const selectedImage = useMemo(
    () => imageCandidates.find((i) => i.key === selectedImageKey) ?? imageCandidates[0],
    [imageCandidates, selectedImageKey],
  );
  const needsXburn = requiresXburn(selectedDeviceKey);

  const appendLog = useCallback(
    (text: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${text}`]),
    [],
  );

  const openExternal = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  /* ── flash progress listener ── */
  useEffect(() => {
    if (!window.rdkDesktop?.onFlashProgress) return;
    const handler = (payload: FlashProgressPayload) => {
      if (payload.percent >= 0) setProgress(payload.percent);
      if (payload.message) appendLog(payload.message);
      if (payload.stage) {
        if (payload.stage === 'downloading') setPhase('downloading');
        else if (payload.stage === 'decompressing') setPhase('decompressing');
        else if (payload.stage === 'flashing') setPhase('flashing');
      }
    };
    const unsub = window.rdkDesktop.onFlashProgress(handler);
    return () => {
      if (typeof unsub === 'function') unsub();
      else window.rdkDesktop?.offFlashProgress?.(handler);
    };
  }, [appendLog]);

  /* ── device selection ── */
  const chooseDevice = (key: string) => {
    const dev = DEVICE_LIST.find((d) => d.key === key);
    if (dev?.disabled) return;
    setSelectedDeviceKey(key);
    const list = IMAGE_LIST[resolveImageKey(key)] ?? [];
    if (list[0]) setSelectedImageKey(list[0].key);
    setUseLocalImage(false);
    setLocalImagePath('');
    if (requiresXburn(key)) {
      addToast('该设备推荐使用 xburn 工具烧录', 'info');
    }
  };

  /* ── scan drives ── */
  const scanDrives = useCallback(async () => {
    if (!window.rdkDesktop?.flashListDrives) {
      setError('当前环境不支持磁盘扫描，请在桌面客户端运行');
      return;
    }
    try {
      const result = await window.rdkDesktop.flashListDrives();
      if (!result.ok) {
        setError(result.error || '磁盘扫描失败');
        return;
      }
      const list = result.drives ?? [];
      setDrives(list);
      if (!selectedDrive && list[0]) setSelectedDrive(list[0].path);
      addToast(`检测到 ${list.length} 个可写盘设备`, 'info');
    } catch (e: any) {
      setError(e?.message || '磁盘扫描异常');
    }
  }, [addToast, selectedDrive]);

  useEffect(() => {
    if (step !== 2 || !isDesktop || needsXburn || drives.length > 0) return;
    scanDrives();
  }, [step, isDesktop, needsXburn, drives.length, scanDrives]);

  /* ── pick local image ── */
  const pickLocalImage = async () => {
    if (!window.rdkDesktop?.flashPickImage) {
      setError('当前环境不支持文件选择');
      return;
    }
    const ext = selectedDeviceKey === 's100' ? ['zip'] : ['img', 'xz'];
    const result = await window.rdkDesktop.flashPickImage({ extensions: ext });
    if (result.ok && result.path) {
      setLocalImagePath(result.path);
      setUseLocalImage(true);
      setSelectedImageKey('');
      addToast('已选择镜像文件', 'success');
    }
  };

  /* ── download image (via Electron bridge or fallback to browser) ── */
  const downloadImage = async (url: string): Promise<string | null> => {
    if (window.rdkDesktop?.flashDownloadImage) {
      setPhase('downloading');
      setProgress(0);
      appendLog(`开始下载: ${url}`);
      const result = await window.rdkDesktop.flashDownloadImage({ url, destDir: '' });
      if (!result.ok) {
        setError(result.error || '下载失败');
        setPhase('error');
        return null;
      }
      appendLog('下载完成');
      return result.path ?? null;
    }
    openExternal(url);
    addToast('已在浏览器中打开下载链接，下载完成后请使用"选择本机文件"选取镜像', 'info');
    return null;
  };

  /* ── decompress image ── */
  const decompressImage = async (filePath: string): Promise<string | null> => {
    if (!isCompressedFile(filePath)) return filePath;
    if (!window.rdkDesktop?.flashDecompressImage) {
      appendLog('当前环境不支持自动解压，请手动解压后选择 .img 文件');
      setError('请手动解压镜像文件为 .img 后重新选择');
      return null;
    }
    setPhase('decompressing');
    setProgress(0);
    appendLog('开始解压镜像...');
    const result = await window.rdkDesktop.flashDecompressImage({ filePath });
    if (!result.ok) {
      setError(result.error || '解压失败');
      setPhase('error');
      return null;
    }
    appendLog('解压完成');
    return result.outputPath ?? null;
  };

  /* ── execute flash (TF card via dd) ── */
  const executeFlash = async () => {
    if (needsXburn) return;
    if (!isDesktop || !window.rdkDesktop?.flashWriteLocal) {
      setError('写盘仅支持桌面客户端');
      return;
    }

    let imgPath = localImagePath;

    if (!useLocalImage && selectedImage) {
      const downloaded = await downloadImage(selectedImage.downloadUrl);
      if (!downloaded) return;
      imgPath = downloaded;
    }

    if (!imgPath.trim()) {
      setError('缺少镜像文件路径');
      return;
    }

    if (isCompressedFile(imgPath)) {
      const decompressed = await decompressImage(imgPath);
      if (!decompressed) return;
      imgPath = decompressed;
    }

    if (!selectedDrive.trim()) {
      setError('请先选择目标磁盘');
      return;
    }

    abortRef.current = false;
    setPhase('flashing');
    setProgress(0);
    appendLog(`写盘目标: ${selectedDrive}`);
    appendLog(`镜像文件: ${imgPath}`);

    try {
      const result = await window.rdkDesktop!.flashWriteLocal!({
        imagePath: imgPath,
        drivePath: selectedDrive,
      });
      if (abortRef.current) throw new Error('用户取消');
      if (!result.ok) throw new Error(result.error || '写盘失败');
      appendLog(result.output || '写盘完成');
      setProgress(100);
      setPhase('done');
      startFlash();
      addToast('镜像写盘完成', 'success');
      setStep(4);
    } catch (e: any) {
      const msg = e?.message || '写盘失败';
      setError(msg);
      setPhase('error');
      appendLog(`失败: ${msg}`);
      addToast(msg, 'error');
    }
  };

  /* ── launch xburn for S100/eMMC ── */
  const launchXburn = async () => {
    if (!window.rdkDesktop?.launchXburn) {
      setError('当前客户端未启用 xburn，请升级桌面端或手动安装 xburn-gui');
      return;
    }
    const result = await window.rdkDesktop.launchXburn({
      imagePath: localImagePath.trim() || undefined,
    });
    if (result.ok) {
      addToast('xburn 已启动', 'success');
      appendLog(`已启动 xburn: ${result.path || ''}`);
      setStep(3);
      setPhase('flashing');
      appendLog('请在 xburn 工具中完成烧录操作...');
    } else if (result.canceled) {
      addToast('已取消', 'info');
    } else {
      setError(result.error || '启动 xburn 失败');
    }
  };

  /* ── start full flash workflow ── */
  const startFlashWorkflow = async () => {
    setLoading(true);
    setError('');
    setLogs([]);
    setProgress(0);
    setPhase('idle');
    setStep(3);

    if (needsXburn) {
      await launchXburn();
      setLoading(false);
      return;
    }

    await executeFlash();
    setLoading(false);
  };

  /* ── navigation helpers ── */
  const goToStep = (target: WizardStep) => {
    setError('');
    setStep(target);
  };

  const canProceedFromImage = useLocalImage ? !!localImagePath.trim() : !!selectedImageKey;
  const canProceedFromDrive = needsXburn || !!selectedDrive;

  const requestCancel = () => {
    abortRef.current = true;
    addToast('已请求取消', 'warning');
  };

  /* ── xburn download url for current platform ── */
  const xburnUrl = XBURN_DOWNLOAD_URLS[platform] || XBURN_DOWNLOAD_URLS.linux;

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */
  return (
    <div className="center-stage flasher-stage">
      <div className="ob-wizard flasher-wizard flx-shell">
        {/* ── Header ── */}
        <section className="flx-header">
          <div>
            <div className="flx-kicker">RDK 镜像烧录</div>
            <h1>镜像烧录向导</h1>
            <p>支持 RDK X3 / X5 / S100 全系列，TF 卡直写或 xburn 工具烧录。</p>
          </div>
        </section>

        {/* ── Step Indicator ── */}
        <section className="flx-steps">
          {STEP_LABELS.map((label, idx) => (
            <div
              key={label}
              className={`flx-step ${step > idx ? 'done' : ''} ${step === idx ? 'active' : ''}`}
            >
              <span>{idx + 1}</span>
              {label}
            </div>
          ))}
        </section>

        {/* ═══════ Step 0: Select Device ═══════ */}
        {step === 0 && (
          <section className="flx-body">
            <div className="flx-card">
              <div className="flx-card-title">选择设备型号</div>
              <div className="flx-list">
                {DEVICE_LIST.map((dev) => (
                  <div
                    key={dev.key}
                    className={`flx-list-item ${selectedDeviceKey === dev.key ? 'active' : ''} ${dev.disabled ? 'disabled' : ''}`}
                    onClick={() => chooseDevice(dev.key)}
                  >
                    <strong>{dev.name}</strong>
                    {dev.disabled && dev.disabledNotice && (
                      <span className="flx-disabled-notice">{dev.disabledNotice}</span>
                    )}
                    <div className="flx-action-row">
                      <button
                        className="clean-btn outline-btn sm-btn"
                        onClick={(e) => { e.stopPropagation(); openExternal(dev.infoUrl); }}
                      >
                        了解设备
                      </button>
                      {dev.imageDownloadUrl && (
                        <button
                          className="clean-btn outline-btn sm-btn"
                          onClick={(e) => { e.stopPropagation(); openExternal(dev.imageDownloadUrl!); }}
                        >
                          镜像下载
                        </button>
                      )}
                      {dev.toolDownloadUrl && (
                        <button
                          className="clean-btn outline-btn sm-btn"
                          onClick={(e) => { e.stopPropagation(); openExternal(dev.toolDownloadUrl!); }}
                        >
                          烧录工具
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {error && <div className="warning-banner">{error}</div>}
            <div className="ob-nav">
              <div />
              <button
                className="ob-btn primary"
                disabled={!selectedDeviceKey}
                onClick={() => goToStep(1)}
              >
                下一步 &rarr; 选择镜像
              </button>
            </div>
          </section>
        )}

        {/* ═══════ Step 1: Select Image ═══════ */}
        {step === 1 && (
          <section className="flx-body">
            <div className="flx-card-grid">
              {/* Official images */}
              <div className="flx-card">
                <div className="flx-card-title">官方镜像</div>
                <div className="flx-list">
                  {imageCandidates.map((img) => (
                    <div
                      key={img.key}
                      className={`flx-list-item ${!useLocalImage && selectedImageKey === img.key ? 'active' : ''}`}
                      onClick={() => { setSelectedImageKey(img.key); setUseLocalImage(false); }}
                    >
                      <strong>{img.name}</strong>
                      <div className="flx-tag-row">
                        {img.tags.map((tag) => (
                          <span
                            key={`${img.key}-${tag}`}
                            className={`flx-tag ${tag.includes('图形') ? 'flx-tag-green' : ''}`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="flx-action-row">
                        <button className="clean-btn outline-btn sm-btn" onClick={(e) => { e.stopPropagation(); openExternal(img.infoUrl); }}>详情</button>
                        <button className="clean-btn outline-btn sm-btn" onClick={(e) => { e.stopPropagation(); openExternal(img.downloadUrl); }}>手动下载</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Local image */}
              <div className="flx-card">
                <div className="flx-card-title">本机镜像文件</div>
                <div className="flx-form">
                  <div
                    className={`flx-list-item flx-clickable ${useLocalImage ? 'active' : ''}`}
                    onClick={pickLocalImage}
                  >
                    <strong>{localImagePath ? '已选择本机文件' : '选择本机镜像文件...'}</strong>
                    {localImagePath && <span className="flx-break-all">{localImagePath}</span>}
                  </div>
                  <div className="flx-inline">
                    <input
                      className="clean-input"
                      placeholder="或手动输入路径 (.img / .xz / .zip)"
                      value={localImagePath}
                      onChange={(e) => { setLocalImagePath(e.target.value); if (e.target.value) setUseLocalImage(true); }}
                    />
                    {isDesktop && (
                      <button className="clean-btn outline-btn sm-btn" onClick={pickLocalImage}>
                        浏览
                      </button>
                    )}
                  </div>
                  {needsXburn && (
                    <div className="warning-banner">
                      该设备走 xburn 流程，本机镜像文件可选（也可在 xburn 内选择镜像）。
                    </div>
                  )}
                  {!isDesktop && (
                    <div className="warning-banner">
                      当前为浏览器环境，本机烧录功能需在桌面客户端中使用。
                    </div>
                  )}
                </div>
              </div>
            </div>
            {error && <div className="warning-banner">{error}</div>}
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => goToStep(0)}>&larr; 上一步</button>
              <button
                className="ob-btn primary"
                disabled={!canProceedFromImage && !needsXburn}
                onClick={() => goToStep(2)}
              >
                下一步 &rarr; {needsXburn ? '烧录' : '选择磁盘'}
              </button>
            </div>
          </section>
        )}

        {/* ═══════ Step 2: Select Drive / Confirm ═══════ */}
        {step === 2 && (
          <section className="flx-body">
            <div className="flx-card-grid">
              {needsXburn ? (
                /* xburn guidance */
                <div className="flx-card flx-card-xburn">
                  <div className="flx-card-title">推荐流程：使用 xburn</div>
                  <div className="warning-banner">
                    S100 / eMMC 机型建议使用 xburn-gui 完成烧录。
                  </div>
                  <p className="flx-xburn-desc">
                    1. 确认已安装 xburn-gui<br />
                    2. 通过 USB Type-C 连接开发板<br />
                    3. 点击下方按钮启动 xburn 并在工具中选择镜像
                  </p>
                  <div className="flx-action-row">
                    {isDesktop && (
                      <button className="clean-btn" onClick={launchXburn}>
                        启动 xburn 工具
                      </button>
                    )}
                    <button
                      className="clean-btn outline-btn sm-btn"
                      onClick={() => openExternal(xburnUrl)}
                    >
                      下载 xburn-gui
                    </button>
                  </div>
                </div>
              ) : (
                /* drive selection */
                <div className="flx-card">
                  <div className="flx-card-title">
                    选择目标磁盘
                    <span className="flx-danger-hint">写盘将清空目标磁盘全部数据！</span>
                  </div>
                  <div className="flx-list">
                    {drives.length === 0 ? (
                      <div className="flx-empty-hint">
                        {isDesktop ? '未检测到可写盘设备，请插入 TF 卡后刷新' : '当前环境不支持磁盘检测'}
                      </div>
                    ) : (
                      drives.map((d) => (
                        <button
                          key={d.path}
                          className={`flx-list-item ${selectedDrive === d.path ? 'active' : ''}`}
                          onClick={() => setSelectedDrive(d.path)}
                        >
                          <strong>{d.label || d.path}</strong>
                          <span>{d.bus} &middot; {d.size} &middot; {d.path}</span>
                        </button>
                      ))
                    )}
                  </div>
                  {isDesktop && (
                    <button className="clean-btn outline-btn sm-btn" onClick={scanDrives}>
                      刷新磁盘列表
                    </button>
                  )}
                </div>
              )}

              {/* Confirm summary */}
              <div className="flx-card">
                <div className="flx-card-title">确认信息</div>
                <div className="flx-confirm-grid">
                  <div>
                    <span>设备</span>
                    <strong>{DEVICE_LIST.find((d) => d.key === selectedDeviceKey)?.name}</strong>
                  </div>
                  <div>
                    <span>镜像</span>
                    <strong>{useLocalImage ? '本机文件' : (selectedImage?.name ?? '--')}</strong>
                  </div>
                  <div>
                    <span>本机路径</span>
                    <strong className="flx-break-all">
                      {localImagePath || (needsXburn ? 'xburn 内选择' : (useLocalImage ? '未选择' : '在线镜像'))}
                    </strong>
                  </div>
                  <div>
                    <span>目标磁盘</span>
                    <strong>{needsXburn ? 'xburn 管理' : (selectedDrive || '未选择')}</strong>
                  </div>
                </div>
                {!needsXburn && (
                  <div className="warning-banner flx-mt-8">
                    写盘将清空目标磁盘所有数据，请仔细确认目标路径和容量。
                  </div>
                )}
              </div>
            </div>
            {error && <div className="warning-banner">{error}</div>}
            <div className="ob-nav">
              <button className="ob-btn ghost" onClick={() => goToStep(1)}>&larr; 上一步</button>
              {needsXburn ? (
                isDesktop ? (
                  <button className="ob-btn primary" onClick={() => startFlashWorkflow()}>
                    启动 xburn 烧录
                  </button>
                ) : (
                  <button className="ob-btn primary" onClick={() => openExternal(xburnUrl)}>
                    前往下载 xburn
                  </button>
                )
              ) : (
                <button
                  className="ob-btn primary"
                  disabled={!canProceedFromDrive || loading || !isDesktop}
                  onClick={() => startFlashWorkflow()}
                >
                  {loading ? '执行中...' : '开始写盘'}
                </button>
              )}
            </div>
          </section>
        )}

        {/* ═══════ Step 3: Flash Progress ═══════ */}
        {step === 3 && (
          <section className="flx-progress-wrap">
            <div className="flx-progress-header">
              <h3>
                {phase === 'downloading' && '下载镜像中...'}
                {phase === 'decompressing' && '解压镜像中...'}
                {phase === 'flashing' && (needsXburn ? 'xburn 烧录中...' : '写盘执行中...')}
                {phase === 'done' && '烧录完成'}
                {phase === 'error' && '烧录失败'}
                {phase === 'idle' && '准备中...'}
              </h3>
              {phase !== 'done' && phase !== 'error' && (
                <button className="ob-btn ghost" onClick={requestCancel}>请求取消</button>
              )}
            </div>

            {/* Progress bar */}
            <div className="flx-progress-bar-wrap">
              <div className="flx-progress-bar">
                <div
                  className={`flx-progress-fill ${phase === 'error' ? 'error' : ''} ${phase === 'done' ? 'done' : ''}`}
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
              <span className="flx-progress-percent">{Math.round(progress)}%</span>
            </div>

            {/* Phase indicators */}
            <div className="flx-stage-list">
              {(['downloading', 'decompressing', 'flashing'] as const).map((p) => {
                const labels = { downloading: '下载镜像', decompressing: '解压镜像', flashing: needsXburn ? 'xburn 烧录' : '写盘' };
                let state: 'wait' | 'run' | 'done' | 'error' | 'skip' = 'wait';
                const order: readonly string[] = ['downloading', 'decompressing', 'flashing', 'done', 'error'];
                const ci = order.indexOf(phase);
                const pi = order.indexOf(p);
                if (ci === pi) state = 'run';
                else if (ci > pi && ci < 4) state = 'done';
                else if (phase === 'done') state = 'done';
                else if (phase === 'error' && pi < ci) state = 'done';
                else if (phase === 'error' && pi === ci) state = 'error';

                if (!useLocalImage && p === 'downloading' && useLocalImage) state = 'skip';
                if (p === 'decompressing' && localImagePath && !isCompressedFile(localImagePath)) state = 'skip';
                if (p === 'downloading' && useLocalImage) state = 'skip';

                return (
                  <div key={p} className={`flx-stage ${state}`}>
                    <span className="dot" />
                    <span className="label">{labels[p]}</span>
                    <span className="status">
                      {state === 'wait' && '等待'}
                      {state === 'run' && '执行中'}
                      {state === 'done' && '完成'}
                      {state === 'error' && '失败'}
                      {state === 'skip' && '跳过'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Log panel */}
            <div className="flx-log-panel">
              {logs.length === 0 ? (
                <div className="flx-log-empty">等待日志输出...</div>
              ) : (
                logs.map((line, idx) => <div key={idx}>{line}</div>)
              )}
            </div>

            {error && <div className="warning-banner flx-mt-8">{error}</div>}

            {(phase === 'done' || phase === 'error') && (
              <div className="ob-nav flx-mt-12">
                <button
                  className="ob-btn ghost"
                  onClick={() => {
                    setStep(0);
                    setPhase('idle');
                    setProgress(0);
                    setLogs([]);
                    setError('');
                  }}
                >
                  重新开始
                </button>
                {phase === 'done' && (
                  <button className="ob-btn primary" onClick={() => setStep(4)}>
                    完成 &rarr;
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {/* ═══════ Step 4: Done ═══════ */}
        {step === 4 && (
          <section className="flx-done">
            <h2>写盘完成</h2>
            <p>镜像已写入目标磁盘。请安全弹出介质并插入目标板卡进行启动验证。</p>

            {/* WiFi configuration */}
            <div className="flx-card flx-wifi-card">
              <div className="flx-card-title flx-wifi-header">
                <span>WiFi 预配置（可选）</span>
                <button
                  className="clean-btn outline-btn sm-btn"
                  onClick={() => setShowWifiConfig(!showWifiConfig)}
                >
                  {showWifiConfig ? '收起' : '展开配置'}
                </button>
              </div>
              {showWifiConfig && (
                <div className="flx-form">
                  <div className="flx-inline">
                    <label className="flx-radio-label">
                      <input
                        type="radio"
                        name="wifi-mode"
                        checked={wifiConfig.mode === 'station'}
                        onChange={() => setWifiConfig((c) => ({ ...c, mode: 'station' }))}
                      />
                      Station 模式
                    </label>
                    <label className="flx-radio-label">
                      <input
                        type="radio"
                        name="wifi-mode"
                        checked={wifiConfig.mode === 'ap'}
                        onChange={() => setWifiConfig((c) => ({ ...c, mode: 'ap' }))}
                      />
                      AP 模式
                    </label>
                  </div>
                  <input
                    className="clean-input"
                    placeholder="WiFi 名称 (SSID)"
                    value={wifiConfig.ssid}
                    onChange={(e) => setWifiConfig((c) => ({ ...c, ssid: e.target.value }))}
                  />
                  <input
                    className="clean-input"
                    type="password"
                    placeholder="WiFi 密码（至少 8 位）"
                    value={wifiConfig.password}
                    onChange={(e) => setWifiConfig((c) => ({ ...c, password: e.target.value }))}
                  />
                  <button
                    className="clean-btn sm-btn"
                    disabled={!wifiConfig.ssid.trim() || wifiConfig.password.length < 8}
                    onClick={async () => {
                      addToast('WiFi 配置将在设备首次启动时生效', 'info');
                      setShowWifiConfig(false);
                    }}
                  >
                    保存 WiFi 配置
                  </button>
                </div>
              )}
            </div>

            {/* Next actions */}
            <div className="flx-next-actions">
              <button
                className="clean-btn"
                onClick={() => { setActiveTab('terminal'); addToast('已切换到终端', 'info'); }}
              >
                终端验证
              </button>
              <button
                className="clean-btn outline-btn"
                onClick={() => { setActiveTab('hardware'); addToast('已切换到硬件监控', 'info'); }}
              >
                硬件状态
              </button>
              <button
                className="clean-btn outline-btn"
                onClick={() => { setActiveTab('examples'); addToast('已切换到示例应用', 'info'); }}
              >
                示例应用
              </button>
            </div>
            <button
              className="ob-btn ghost"
              onClick={() => {
                setStep(0);
                setPhase('idle');
                setProgress(0);
                setLogs([]);
                setError('');
                setDrives([]);
                setSelectedDrive('');
              }}
            >
              重新写盘
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
