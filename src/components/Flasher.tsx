import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { isDesktop as checkIsDesktop } from '../utils/env';
import { useFlashCapabilities } from '../hooks/useFlashCapabilities';
import { fillTemplate } from '../i18n/en-extras';
import { useI18n } from '../i18n/use-i18n';

/* ═══════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════ */
type WizardStep = 0 | 1 | 2 | 3 | 4;
type FlashPhase =
  | 'idle'
  | 'preparing'
  | 'backup'
  | 'downloading'
  | 'decompressing'
  | 'flashing'
  | 'verifying'
  | 'done'
  | 'error';

/** 烧录进度条左侧列（与主流程 phase 对应的子步骤） */
type FlashProgressRowKey = 'preparing' | 'downloading' | 'decompressing' | 'flashing' | 'verifying';
type FlashPerformanceProfile = 'balanced' | 'turbo';

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
    toolDownloadUrl: 'https://archive.d-robotics.cc/downloads/software_tools/download_tools/xburn-gui_1.1.9/xburn-gui_1.1.9_amd64.deb',
    toolDmgUrl: 'https://archive.d-robotics.cc/downloads/software_tools/download_tools/xburn-gui_1.1.9/xburn-gui_1.1.9_universal.dmg',
    toolWinUrl: 'https://archive.d-robotics.cc/downloads/software_tools/download_tools/xburn-gui_1.1.9/xburn-gui_1.1.9_x64-setup.exe',
  },
  { key: 'x3-module', name: 'RDK X3 Module (TF Card)', infoUrl: 'https://developer.d-robotics.cc/rdkx3' },
  { key: 'x5-module', name: 'RDK X5 Module (TF Card)', infoUrl: 'https://developer.d-robotics.cc/rdkx5' },
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

/** 与 rdkstudio_frontend-master Imager.vue 一致：S100 手动烧录说明 */
const S100_MANUAL_FLASH_DOC =
  'https://developer.d-robotics.cc/rdk_doc/rdk_s/Quick_start/install_os/rdk_s100/instruction';

/** 完成页 WiFi 预配置暂无持久化/写镜像能力，关闭展示；接入后再改为 true */
const SHOW_FLASHER_WIFI_PRECONFIG = false;

function resolveXburnToolUrl(dev: DeviceItem, plat: string): string | undefined {
  if (plat === 'win32' && dev.toolWinUrl) return dev.toolWinUrl;
  if (plat === 'darwin' && dev.toolDmgUrl) return dev.toolDmgUrl;
  return dev.toolDownloadUrl;
}

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

function isSafeFlashTargetDrive(drive: FlashDrive): boolean {
  const removable = drive.removable === true;
  if (!removable) return false;
  const label = String(drive.label || '').toLowerCase();
  const bus = String(drive.bus || '').toLowerCase();
  const mediaType = String(drive.mediaType || '').toLowerCase();
  const path = String(drive.path || '').toLowerCase();
  const combined = `${label} ${mediaType} ${bus}`;
  const allowByBus = /\bsd\b|\bmmc\b/.test(bus);
  const allowByKeyword = /\bsd\b|microsd|sdxc|sdhc|tf\b|\bmmc\b|emmc|card\s*reader|cardreader|realtek|alcor|genesys|storage\s*device/.test(combined);
  const denyByKeyword = /\bnvme\b|\bssd\b|\bhdd\b|sata|hard\s*disk|portable\s*(ssd|hdd|drive)|expansion|backup\s*plus|external\s*hdd/.test(combined);
  const devicePathLikely = /\/dev\/disk|physicaldrive/.test(path);
  if (!devicePathLikely) return false;
  if (denyByKeyword && !allowByBus) return false;
  return allowByBus || allowByKeyword;
}

function flashImageTagLabel(tag: string, t: (key: string, zh: string) => string): string {
  if (tag === '图形界面') return t('flasher.tag.gui', '图形界面');
  if (tag === '无图形界面') return t('flasher.tag.headless', '无图形界面');
  return tag;
}

function isFlashUserCancelled(msg: string): boolean {
  const m = String(msg).trim();
  if (m === '用户取消' || m === '用户取消写盘') return true;
  if (/^cancel(led)?$/i.test(m)) return true;
  if (m.includes('USER_CANCELLED')) return true;
  return false;
}

/** 旧版曾写入 localStorage；仅用于「重新开始」时清理遗留数据 */
const LEGACY_FLASHER_STORAGE_KEY = 'rdk:flasher:ui-state:v1';

function normalizeStageToPhase(stage: string | undefined): FlashPhase {
  if (stage === 'prepare' || stage === 'preparing') return 'preparing';
  if (stage === 'backup') return 'backup';
  if (stage === 'downloading') return 'downloading';
  if (stage === 'decompressing') return 'decompressing';
  if (stage === 'flashing') return 'flashing';
  if (stage === 'verifying') return 'verifying';
  if (stage === 'done') return 'done';
  if (stage === 'error') return 'error';
  return 'idle';
}

/* ═══════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════ */
export default function Flasher() {
  const { setActiveTab, addToast } = useAppState();
  const { t, language } = useI18n();
  const tf = useCallback(
    (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars),
    [t],
  );
  const stepLabels = useMemo(
    () => [
      t('flasher.step.device', '选择设备'),
      t('flasher.step.image', '选择镜像'),
      t('flasher.step.flash', '烧录写盘'),
      t('flasher.step.done', '完成'),
    ],
    [t, language],
  );

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
  const [phase, setPhase] = useState<FlashPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [performanceProfile, setPerformanceProfile] = useState<FlashPerformanceProfile>('balanced');
  const [verifyDetail, setVerifyDetail] = useState('');
  const abortRef = useRef(false);
  const cancelToastCooldownRef = useRef(0);
  const stepRef = useRef(step);
  stepRef.current = step;

  /* ── wifi config state ── */
  const [showWifiConfig, setShowWifiConfig] = useState(false);
  const [wifiConfig, setWifiConfig] = useState<WifiConfig>({ mode: 'station', ssid: '', password: '' });
  /** Windows：跳过 adb reboot usb2（已手动进 fastboot 时使用） */
  const [s100SkipAdbReboot, setS100SkipAdbReboot] = useState(false);
  /** S100 一键：xburn-gui 程序路径（与固件 zip/文件夹不同；主进程亦有缓存） */
  const [s100XburnGuiPath, setS100XburnGuiPath] = useState('');
  const isDesktop = checkIsDesktop();
  const platform = window.rdkDesktop?.platform ?? 'unknown';
  const { caps, loading: capsLoading } = useFlashCapabilities();

  const imageListKey = resolveImageKey(selectedDeviceKey);
  const imageCandidates = IMAGE_LIST[imageListKey] ?? [];
  const selectedImage = useMemo(
    () => imageCandidates.find((i) => i.key === selectedImageKey) ?? imageCandidates[0],
    [imageCandidates, selectedImageKey],
  );
  const selectedDriveValid = useMemo(
    () => drives.some((d) => d.path === selectedDrive),
    [drives, selectedDrive],
  );
  const needsXburn = requiresXburn(selectedDeviceKey);
  const isS100Device = selectedDeviceKey === 's100';
  /** Windows + 支持 S100 CLI：存在「驱动 / adb」前置链，步骤条与文案单独展示 */
  const isWinS100OneClick =
    isS100Device && platform === 'win32' && Boolean(caps.supportsS100XburnCli);

  /** 桌面端 TF 直写需提升权限（与 electron/win 适配器 isAdmin 一致） */
  const showDirectWriteAdminHint = Boolean(
    isDesktop && !capsLoading && caps.supportsDirectWrite && !needsXburn,
  );

  const refreshS100XburnGuiPath = useCallback(async () => {
    const api = window.rdkDesktop?.flashGetS100XburnGui;
    if (!api) return;
    try {
      const r = await api();
      setS100XburnGuiPath(r?.ok && r.path ? r.path : '');
    } catch {
      setS100XburnGuiPath('');
    }
  }, []);

  useEffect(() => {
    if (step === 2 && isS100Device && caps.supportsS100XburnCli && isDesktop && platform !== 'darwin') {
      void refreshS100XburnGuiPath();
    }
  }, [step, isS100Device, caps.supportsS100XburnCli, isDesktop, platform, refreshS100XburnGuiPath]);

  const flashStepPhases = useMemo((): readonly FlashProgressRowKey[] => {
    if (isWinS100OneClick) {
      return ['preparing', 'downloading', 'decompressing', 'flashing', 'verifying'];
    }
    return ['downloading', 'decompressing', 'flashing', 'verifying'];
  }, [isWinS100OneClick]);

  const flashPhaseRowLabels = useMemo(
    (): Record<FlashProgressRowKey, string> => ({
      preparing: isWinS100OneClick
        ? t('flasher.phaseLabel.s100Preparing', '环境准备（驱动 / adb）')
        : t('flasher.phaseLabel.preparing', '环境准备'),
      downloading: isWinS100OneClick
        ? t('flasher.phaseLabel.s100Download', '下载资源（驱动 / 工具）')
        : t('flasher.phaseLabel.downloading', '下载镜像'),
      decompressing: isWinS100OneClick
        ? t('flasher.phaseLabel.s100Decompress', '解压')
        : t('flasher.phaseLabel.decompressing', '解压镜像'),
      flashing: needsXburn
        ? t('flasher.phaseLabel.flashingXburn', 'xburn 烧录')
        : t('flasher.phaseLabel.flashing', '写盘'),
      verifying: t('flasher.phaseLabel.verifying', '写后校验'),
    }),
    [needsXburn, t, language, isWinS100OneClick],
  );

  const flashPhaseTitle = useMemo(() => {
    switch (phase) {
      case 'preparing':
        return t('flasher.phase.preparing', '环境准备中（驱动 / adb / 路径）…');
      case 'downloading':
        return t('flasher.phase.downloading', '下载镜像中...');
      case 'backup':
        return t('flasher.phase.backup', '备份目标盘中...');
      case 'decompressing':
        return t('flasher.phase.decompressing', '解压镜像中...');
      case 'flashing':
        return needsXburn
          ? t('flasher.phase.flashingXburn', 'xburn 烧录中...')
          : t('flasher.phase.flashing', '写盘执行中...');
      case 'verifying':
        return t('flasher.phase.verifying', '写后校验中...');
      case 'done':
        return t('flasher.phase.done', '烧录完成');
      case 'error':
        return t('flasher.phase.error', '烧录失败');
      default:
        return t('flasher.phase.idle', '准备中...');
    }
  }, [phase, needsXburn, t, language]);

  const appendLog = useCallback(
    (text: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${text}`].slice(-300)),
    [],
  );

  const openExternal = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  /* ── flash progress listener ── */
  useEffect(() => {
    if (!window.rdkDesktop?.onFlashProgress) return;
    const handler = (payload: FlashProgressPayload) => {
      /* 已完成页 (step 4) 后仍可能收到迟到的进度，避免把步骤拉回写盘页或改写 phase */
      if (stepRef.current >= 4) {
        if (payload.message) appendLog(payload.message);
        return;
      }
      if (payload.percent >= 0) setProgress(payload.percent);
      if (payload.message) appendLog(payload.message);
      const mappedPhase = normalizeStageToPhase(payload.stage);
      if (mappedPhase !== 'idle') {
        setPhase(mappedPhase);
      }
      if (
        mappedPhase !== 'done'
        && mappedPhase !== 'error'
        && mappedPhase !== 'idle'
      ) {
        setStep((s) => (s <= 2 ? 3 : s));
      }
    };
    const unsub = window.rdkDesktop.onFlashProgress(handler);
    return () => {
      if (typeof unsub === 'function') unsub();
      else window.rdkDesktop?.offFlashProgress?.(handler);
    };
  }, [appendLog]);

  useEffect(() => {
    if (!window.rdkDesktop?.flashGetActiveOperation) return;
    let active = true;
    const restoreActive = async () => {
      try {
        const snapshot = await window.rdkDesktop!.flashGetActiveOperation!();
        if (!active || !snapshot?.ok) return;
        const payload = snapshot.lastPayload;
        const mappedPhase = normalizeStageToPhase(payload?.stage);
        const shouldShowProgress = snapshot.running || mappedPhase === 'done' || mappedPhase === 'error';
        if (!shouldShowProgress) return;
        setStep(3);
        if (mappedPhase !== 'idle') setPhase(mappedPhase);
        if (typeof payload?.percent === 'number') setProgress(payload.percent);
        if (Array.isArray(snapshot.logs) && snapshot.logs.length > 0) {
          setLogs(snapshot.logs.slice(-200));
        }
      } catch {
        // ignore
      }
    };
    void restoreActive();
    return () => { active = false; };
  }, []);

  /* 升级后清掉旧版 localStorage，避免与其它逻辑冲突 */
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_FLASHER_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  /* ── device selection ── */
  const chooseDevice = (key: string) => {
    const dev = DEVICE_LIST.find((d) => d.key === key);
    if (dev?.disabled) return;
    setSelectedDeviceKey(key);
    const list = IMAGE_LIST[resolveImageKey(key)] ?? [];
    /* S100：官方镜像行仅作版本目录（与 reference FlashSteps 一致），不作为「已选安装镜像」 */
    if (key === 's100') {
      setSelectedImageKey('');
    } else if (list[0]) {
      setSelectedImageKey(list[0].key);
    }
    setUseLocalImage(false);
    setLocalImagePath('');
    if (requiresXburn(key)) {
      addToast(t('flasher.toast.xburnRecommend', '该设备推荐使用 xburn 工具烧录'), 'info');
    }
  };

  /* ── scan drives ── */
  const scannedRef = useRef(false);

  useEffect(() => {
    if (step !== 2) scannedRef.current = false;
  }, [step]);

  const scanDrives = async () => {
    if (!window.rdkDesktop?.flashListDrives) {
      setError(
        isDesktop
          ? t('flasher.err.scanUnsupportedDesktop', '当前环境暂不支持磁盘扫描')
          : t('flasher.err.scanWebOnly', '磁盘扫描仅支持桌面客户端'),
      );
      return;
    }
    try {
      const result = await window.rdkDesktop.flashListDrives();
      if (!result.ok) {
        setError(result.error || t('flasher.err.scanFail', '磁盘扫描失败'));
        return;
      }
      const list = result.drives ?? [];
      const safeList = list.filter(isSafeFlashTargetDrive);
      setDrives(safeList);
      setSelectedDrive((prev) => {
        if (!safeList.length) return '';
        if (prev && safeList.some((drive) => drive.path === prev)) return prev;
        return safeList[0].path;
      });
      if (safeList[0]) {
        addToast(tf('flasher.toast.drivesFound', '检测到 {{n}} 个可用 SD/eMMC 目标盘', { n: safeList.length }), 'info');
      } else {
        addToast(t('flasher.toast.noDrives', '未检测到可用 SD/eMMC 目标盘'), 'warning');
      }
    } catch (e: any) {
      setError(e?.message || t('flasher.err.scanException', '磁盘扫描异常'));
    }
  };

  useEffect(() => {
    if (step !== 2 || !isDesktop || needsXburn || !caps.supportsDriveScan) return;
    if (scannedRef.current) return;
    scannedRef.current = true;
    scanDrives();
  }, [step, isDesktop, needsXburn, caps.supportsDriveScan]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── pick local image ── */
  const pickLocalImage = async () => {
    if (!window.rdkDesktop?.flashPickImage) {
      setError(t('flasher.err.pickUnsupported', '当前环境不支持文件选择'));
      return;
    }
    const ext = ['img', 'xz'];
    const result = await window.rdkDesktop.flashPickImage({
      extensions: ext,
      appendAllFilesFilter: true,
    });
    if (result.ok && result.path) {
      const p = result.path;
      const lower = p.toLowerCase();
      if (!lower.endsWith('.img') && !lower.endsWith('.xz')) {
        setError(t('flasher.err.unsupportedFileType', '不支持该文件类型，请选择 .img 或 .xz 镜像。'));
        addToast(t('flasher.err.unsupportedFileType', '不支持该文件类型，请选择 .img 或 .xz 镜像。'), 'error');
        return;
      }
      setLocalImagePath(p);
      setUseLocalImage(true);
      setSelectedImageKey('');
      addToast(t('flasher.toast.imagePicked', '已选择镜像文件'), 'success');
    }
  };

  /** S100：与参考 Studio 一致 — product.zip 或已解压目录 */
  const pickS100UnifiedImage = async () => {
    if (!window.rdkDesktop?.flashPickImage) {
      setError(t('flasher.err.pickUnsupported', '当前环境不支持文件选择'));
      return;
    }
    const result = await window.rdkDesktop.flashPickImage({
      mode: 's100-unified',
      title: t('flasher.s100.pickUnifiedDialogTitle', '选择 product.zip 或已解压固件文件夹'),
      titleDirectory: t('flasher.s100.pickFolderOnlyTitle', '选择已解压的固件文件夹'),
    });
    if (result.canceled) return;
    if (!result.ok) {
      if (result.error) {
        setError(result.error);
        addToast(result.error, 'error');
      }
      return;
    }
    if (result.path) {
      setLocalImagePath(result.path);
      setUseLocalImage(true);
      setSelectedImageKey('');
      addToast(t('flasher.toast.imagePicked', '已选择镜像'), 'success');
    }
  };

  /* ── download image (via Electron bridge or fallback to browser) ── */
  const downloadImage = async (url: string): Promise<string | null> => {
    if (window.rdkDesktop?.flashDownloadImage) {
      setPhase('downloading');
      setProgress(0);
      appendLog(tf('flasher.log.downloadStart', '开始下载: {{url}}', { url }));
      try {
        const result = await window.rdkDesktop.flashDownloadImage({ url, destDir: '' });
        if (!result.ok) {
          setError(result.error || t('flasher.err.downloadFail', '下载失败'));
          setPhase('error');
          return null;
        }
        const path = result.path?.trim();
        if (!path) {
          const msg = t(
            'flasher.err.downloadNoPath',
            '下载已完成，但未返回本地镜像路径。请使用「本机镜像文件」选择已下载的文件，或更新桌面客户端。',
          );
          setError(msg);
          setPhase('error');
          appendLog(msg);
          return null;
        }
        appendLog(t('flasher.log.downloadDone', '下载完成'));
        return path;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg || t('flasher.err.downloadFail', '下载失败'));
        setPhase('error');
        appendLog(tf('flasher.log.fail', '失败: {{msg}}', { msg: msg || t('flasher.err.downloadFail', '下载失败') }));
        return null;
      }
    }
    openExternal(url);
    const msg = t(
      'flasher.err.onlineImageNoInAppDownload',
      '当前客户端不支持应用内下载在线镜像。已在浏览器打开链接；下载完成后请返回「选择镜像」步骤，用「本机镜像文件」选择该文件后再开始写盘。',
    );
    addToast(msg, 'info');
    appendLog(msg);
    setError('');
    setPhase('idle');
    setProgress(0);
    setStep(1);
    return null;
  };

  /* ── decompress image ── */
  const decompressImage = async (filePath: string): Promise<string | null> => {
    if (!isCompressedFile(filePath)) return filePath;
    if (!window.rdkDesktop?.flashDecompressImage) {
      appendLog(t('flasher.log.decompressUnsupported', '当前环境暂不支持自动解压，请手动解压后选择 .img 文件'));
      setError(t('flasher.err.decompressManual', '请手动解压镜像文件为 .img 后重新选择'));
      return null;
    }
    setPhase('decompressing');
    setProgress(0);
    appendLog(t('flasher.log.decompressStart', '开始解压镜像...'));
    const result = await window.rdkDesktop.flashDecompressImage({ filePath });
    if (!result.ok) {
      setError(result.error || t('flasher.err.decompressFail', '解压失败'));
      setPhase('error');
      return null;
    }
    appendLog(t('flasher.log.decompressDone', '解压完成'));
    return result.outputPath ?? null;
  };

  /* ── execute flash (TF card via dd) ── */
  const executeFlash = async () => {
    if (needsXburn) return;
    if (!isDesktop || !window.rdkDesktop?.flashWriteLocal) {
      setError(
        isDesktop
          ? t('flasher.err.writeUnsupportedDesktop', '当前环境暂不支持直接写盘')
          : t('flasher.err.writeWebOnly', '写盘功能仅支持桌面客户端'),
      );
      return;
    }

    let imgPath = localImagePath;

    if (!useLocalImage && selectedImage) {
      const downloaded = await downloadImage(selectedImage.downloadUrl);
      if (!downloaded) return;
      imgPath = downloaded;
    }

    if (!imgPath.trim()) {
      setError(t('flasher.err.missingImagePath', '缺少镜像文件路径'));
      return;
    }

    if (isCompressedFile(imgPath)) {
      const decompressed = await decompressImage(imgPath);
      if (!decompressed) return;
      imgPath = decompressed;
    }

    if (!selectedDrive.trim()) {
      setError(t('flasher.err.selectDriveFirst', '请先选择目标磁盘'));
      return;
    }

    abortRef.current = false;
    setVerifyDetail('');
    setPhase('flashing');
    setProgress(0);
    appendLog(tf('flasher.log.target', '写盘目标: {{drive}}', { drive: selectedDrive }));
    appendLog(tf('flasher.log.imagePath', '镜像文件: {{path}}', { path: imgPath }));
    appendLog(
      performanceProfile === 'turbo'
        ? t('flasher.log.perfTurbo', '性能模式: 极速模式')
        : t('flasher.log.perfBalanced', '性能模式: 常规模式'),
    );

    try {
      const result = await window.rdkDesktop!.flashWriteLocal!({
        imagePath: imgPath,
        drivePath: selectedDrive,
        verifyMode: 'sample',
        performanceProfile,
      });
      if (abortRef.current) throw new Error(t('flasher.err.userCancel', '用户取消'));
      if (!result.ok) throw new Error(result.error || t('flasher.err.writeFail', '写盘失败'));
      appendLog(result.output || t('flasher.log.writeDone', '写盘完成'));
      if (result.verify) {
        setVerifyDetail(result.verify.detail);
        appendLog(tf('flasher.log.verify', '校验结果: {{detail}}', { detail: result.verify.detail }));
      }
      setProgress(100);
      setPhase('done');
      addToast(t('flasher.toast.writeDone', '镜像写盘完成'), 'success');
      /* 保留在步骤 3，由用户点「完成 →」再进入写盘完成页，避免成功瞬间自动跳转 */
    } catch (e: any) {
      const msg = e?.message || t('flasher.err.writeFail', '写盘失败');
      const userCancelled = isFlashUserCancelled(msg);
      setError(userCancelled ? '' : msg);
      setPhase('error');
      appendLog(userCancelled ? t('flasher.log.cancelledByUser', '操作已由用户取消') : tf('flasher.log.fail', '失败: {{msg}}', { msg }));
      addToast(userCancelled ? t('flasher.toast.writeCancelled', '写盘已取消') : msg, userCancelled ? 'info' : 'error');
    }
  };

  /* ── launch xburn for S100/eMMC ── */
  const launchXburn = async () => {
    if (!window.rdkDesktop?.launchXburn) {
      setError(t('flasher.err.xburnUnavailable', '当前环境未启用 xburn 工具启动，请手动安装并打开 xburn-gui'));
      return;
    }
    const result = await window.rdkDesktop.launchXburn({
      imagePath: localImagePath.trim() || undefined,
    });
    if (result.ok) {
      addToast(t('flasher.toast.xburnStarted', 'xburn 已启动'), 'success');
      appendLog(tf('flasher.log.xburnLaunched', '已启动 xburn: {{path}}', { path: result.path || '' }));
      setStep(3);
      setPhase('flashing');
      appendLog(t('flasher.log.xburnWait', '请在 xburn 工具中完成烧录操作...'));
    } else if (result.canceled) {
      addToast(t('flasher.toast.cancelled', '已取消'), 'info');
    } else {
      setError(result.error || t('flasher.err.xburnLaunchFail', '启动 xburn 失败'));
    }
  };

  /* ── S100：xburn 命令行一键烧写 ── */
  const runS100XburnCli = async () => {
    if (!window.rdkDesktop?.flashS100Xburn) {
      setError(t('flasher.err.s100CliUnsupported', '当前环境不支持 S100 命令行烧写，请使用「启动 xburn 工具」或升级桌面客户端'));
      return;
    }
    const p = localImagePath.trim();
    if (!p) {
      setError(t('flasher.s100.err.needImagePath', '一键烧写需要选择本机 product.zip 或固件文件夹'));
      return;
    }

    setLoading(true);
    setError('');
    setLogs([]);
    setProgress(0);
    setPhase('flashing');
    setStep(3);

    if (window.rdkDesktop.flashCheckS100XburnEnv) {
      appendLog(t('flasher.log.s100EnvCheck', '正在检查 xburn 环境…'));
      try {
        const env = await window.rdkDesktop.flashCheckS100XburnEnv({
          xburnGuiPath: s100XburnGuiPath.trim() || undefined,
        });
        if (!env.ok) {
          const fails = (env.checks || []).filter((c) => c && c.pass === false);
          const onlyMissingPath = fails.length === 1 && fails[0]?.id === 'xburn_path';
          if (onlyMissingPath) {
            const msg = fails[0]?.message || t('flasher.err.s100CliUnsupported', '未找到 xburn，请先安装或选择 xburn 程序路径');
            setError(msg);
            addToast(msg, 'error');
            setLoading(false);
            setPhase('error');
            setStep(2);
            return;
          }
          const lines = fails.map((c) => c.message || '').filter(Boolean);
          const detail = [lines.join('\n'), env.rawLog ? `\n---\n${env.rawLog}` : ''].join('').trim();
          const intro = t(
            'flasher.s100.envCheckWarn',
            'xburn 环境检查未完全通过。确定则仍继续一键烧写，取消则中止。',
          );
          if (!window.confirm(`${intro}\n\n${detail.slice(0, 1800)}`)) {
            appendLog(t('flasher.log.cancelledByUser', '操作已由用户取消'));
            setLoading(false);
            setPhase('idle');
            setStep(2);
            addToast(t('flasher.toast.cancelled', '已取消'), 'info');
            return;
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          !window.confirm(
            tf('flasher.s100.envCheckInvokeFail', '环境检查调用失败：{{msg}}\n\n仍要继续一键烧写？', { msg }),
          )
        ) {
          appendLog(t('flasher.log.cancelledByUser', '操作已由用户取消'));
          setLoading(false);
          setPhase('idle');
          setStep(2);
          addToast(t('flasher.toast.cancelled', '已取消'), 'info');
          return;
        }
      }
    }

    try {
      const result = await window.rdkDesktop.flashS100Xburn({
        imagePath: p,
        xburnGuiPath: s100XburnGuiPath.trim() || undefined,
        skipAdbReboot: platform === 'win32' && s100SkipAdbReboot,
      });
      if (result.canceled) {
        setPhase('error');
        setError('');
        appendLog(t('flasher.log.cancelledByUser', '操作已由用户取消'));
        addToast(t('flasher.toast.writeCancelled', '写盘已取消'), 'info');
      } else if (result.ok) {
        setProgress(100);
        setPhase('done');
        const uncertain = result.completedBurnEvidence === false;
        appendLog(
          uncertain
            ? t(
                'flasher.log.s100CliDoneUncertain',
                'xburn 命令行已退出（退出码 0），但未从日志识别到固定「写盘完成」依据。请勿视为已成功，请在板端自行验证；若未写入请先让设备稳定进入 fastboot 再重试。',
              )
            : t(
                'flasher.log.s100CliDone',
                'xburn 命令行已正常结束（退出码 0）；设备可能仍在重启，请稍候再在板端验证',
              ),
        );
        addToast(
          uncertain
            ? t('flasher.toast.s100FlashUncertain', 'xburn 已退出，请在板端确认是否刷写成功')
            : t('flasher.toast.s100FlashDone', 'S100 烧录已完成'),
          uncertain ? 'warning' : 'success',
        );
        /* 同上：不自动进入完成页，等待用户确认 */
      } else {
        const msg = result.error || t('flasher.err.xburnFlashFail', 'xburn 烧录失败');
        setError(msg);
        setPhase('error');
        if (result.logTail) appendLog(result.logTail);
        addToast(msg, 'error');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setPhase('error');
      addToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  /* ── start full flash workflow ── */
  const startFlashWorkflow = async () => {
    if (needsXburn) {
      if (selectedDeviceKey === 's100' && caps.supportsS100XburnCli && window.rdkDesktop?.flashS100Xburn) {
        await runS100XburnCli();
        return;
      }
      setLoading(true);
      setError('');
      setLogs([]);
      setProgress(0);
      setPhase('idle');
      setStep(3);
      await launchXburn();
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    setLogs([]);
    setProgress(0);
    setPhase('idle');
    setStep(3);
    await executeFlash();
    setLoading(false);
  };

  /* ── navigation helpers ── */
  const goToStep = (target: WizardStep) => {
    setError('');
    setStep(target);
  };

  const clearLegacyStoredState = () => {
    try {
      localStorage.removeItem(LEGACY_FLASHER_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const canProceedFromImage = useMemo(() => {
    /* S100：官方列表仅供下载指引，有效镜像须为下方本机路径（zip / 文件夹） */
    if (isS100Device) return !!localImagePath.trim();
    if (useLocalImage) return !!localImagePath.trim();
    return !!selectedImageKey;
  }, [useLocalImage, localImagePath, isS100Device, selectedImageKey]);
  const canProceedFromDrive = needsXburn || selectedDriveValid;

  const requestCancel = () => {
    const now = Date.now();
    if (now - cancelToastCooldownRef.current < 1800) return;
    cancelToastCooldownRef.current = now;
    abortRef.current = true;
    void window.rdkDesktop?.flashCancelLocal?.().then((r) => {
      if (r && r.ok === false && r.error) addToast(r.error, 'error');
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      addToast(msg || t('flasher.err.cancelSendFail', '取消指令发送失败'), 'error');
    });
    addToast(
      isWinS100OneClick
        ? t(
          'flasher.toast.cancelRequestedS100',
          '已请求取消：正在中断下载/安装与 xburn（若卡在 UAC 请先关闭系统提权窗口）…',
        )
        : t('flasher.toast.cancelRequested', '已请求取消，正在停止写盘…'),
      'info',
    );
  };

  /* ── xburn download url for current platform ── */
  const xburnUrl = XBURN_DOWNLOAD_URLS[platform] || XBURN_DOWNLOAD_URLS.linux;

  const renderStep2Summary = () => (
    <div className="flasher-summary-pane">
      <div className="section-label">{t('flasher.section.summary', '确认信息')}</div>
      <div className="config-section">
        <div className="config-row">
          <span className="config-label">{t('flasher.label.device', '设备')}</span>
          <span className="config-value">
            <strong>{DEVICE_LIST.find((d) => d.key === selectedDeviceKey)?.name}</strong>
          </span>
        </div>
        <div className="config-row">
          <span className="config-label">{t('flasher.label.image', '镜像')}</span>
          <span className="config-value">
            <strong>
              {useLocalImage
                ? t('flasher.summary.local', '本机路径')
                : isS100Device
                  ? t('flasher.s100.summaryOfficial', '官方目录（请在 xburn 中选镜像）')
                  : (selectedImage?.name ?? '--')}
            </strong>
          </span>
        </div>
        <div className="config-row">
          <span className="config-label">{t('flasher.label.localPath', '本机路径')}</span>
          <span className="config-value">
            <strong style={{ wordBreak: 'break-all' }}>
              {localImagePath
                || (needsXburn
                  ? t('flasher.path.xburnPick', 'xburn 内选择')
                  : (useLocalImage ? t('flasher.path.notChosen', '未选择') : t('flasher.path.onlineImage', '在线镜像')))}
            </strong>
          </span>
        </div>
        <div className="config-row">
          <span className="config-label">{t('flasher.label.targetDrive', '目标磁盘')}</span>
          <span className="config-value">
            <strong>
              {needsXburn
                ? t('flasher.drive.xburnManaged', 'xburn 管理')
                : (selectedDriveValid ? selectedDrive : t('flasher.drive.notChosen', '未选择'))}
            </strong>
          </span>
        </div>
        {!needsXburn && (
          <div className="config-row" style={{ alignItems: 'flex-start' }}>
            <span className="config-label">{t('flasher.label.flashMode', '烧录模式')}</span>
            <span className="config-value" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <select
                className="input"
                style={{ minWidth: 180 }}
                value={performanceProfile}
                onChange={(e) => setPerformanceProfile(e.target.value === 'turbo' ? 'turbo' : 'balanced')}
              >
                <option value="balanced">{t('flasher.mode.balanced', '常规烧录（更稳）')}</option>
                <option value="turbo">{t('flasher.mode.turbo', '极速烧录（更快）')}</option>
              </select>
              {performanceProfile === 'turbo' && (
                <span className="badge badge-danger">{t('flasher.warn.turbo', '极速模式会占用更多 CPU/磁盘资源，可能造成卡顿')}</span>
              )}
            </span>
          </div>
        )}
      </div>
      {!needsXburn && (
        <div className="card card-compact" style={{ marginTop: 8, borderColor: 'var(--warn)', background: 'var(--warn-subtle)' }}>
          <p className="config-card-desc" style={{ color: 'var(--warn)', margin: 0 }}>
            {t('flasher.confirm.erase', '写盘将清空目标磁盘所有数据，请仔细确认目标路径和容量。')}
          </p>
        </div>
      )}
    </div>
  );

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */
  return (
    <div className="tool-page flasher-page">
      <div className="tool-content">
        {/* ── Header ── */}
        <section className="card card-compact">
          <div className="section-label">{t('flasher.header.badge', 'RDK 镜像烧录')}</div>
          <h1>{t('flasher.title', '镜像烧录向导')}</h1>
          <p className="config-card-desc">{t('flasher.subtitle', '支持 RDK X3 / X5 / S100 全系列，TF 卡直写或 xburn 工具烧录。')}</p>
        </section>

        {showDirectWriteAdminHint && (
          <section
            className="card card-compact"
            style={{
              marginTop: 8,
              borderColor: 'var(--accent)',
              background: 'var(--accent-subtle)',
            }}
          >
            <p className="config-card-desc" style={{ margin: 0, fontWeight: 500 }}>
              {platform === 'win32'
                ? t(
                  'flasher.hint.adminWin',
                  'Windows：直接写盘需管理员权限。请右键桌面端快捷方式 →「以管理员身份运行」后，再执行烧录。',
                )
                : platform === 'darwin'
                  ? t(
                    'flasher.hint.adminMac',
                    'macOS：直接写盘需管理员权限。请使用管理员账户，或在系统提示时输入密码授权（sudo）后再烧录。',
                  )
                  : t(
                    'flasher.hint.adminGeneric',
                    '直接写盘需管理员权限：请以提升权限的方式启动桌面端后再烧录。',
                  )}
            </p>
          </section>
        )}

        {/* ── Step Indicator ── */}
        <section className="flash-steps">
          {stepLabels.map((label, idx) => (
            <div
              key={label}
              className={`flash-step ${step > idx ? 'done' : ''} ${step === idx ? 'active' : ''}`}
            >
              <span className="flash-step-num">{idx + 1}</span>
              <span className="flash-step-line" aria-hidden />
              {label}
            </div>
          ))}
        </section>

        {/* ═══════ Step 0: Select Device ═══════ */}
        {step === 0 && (
          <section className="card card-compact flasher-step-card">
            <div className="section-label">{t('flasher.section.pickDevice', '选择设备型号')}</div>
            <div className="config-grid flasher-device-grid flasher-device-grid-wrap">
              {DEVICE_LIST.map((dev) => (
                <div
                  key={dev.key}
                  className={`config-card ${selectedDeviceKey === dev.key ? 'selected' : ''}`}
                  onClick={() => chooseDevice(dev.key)}
                >
                  <div className="config-card-head">
                    <div className="config-card-name">{dev.name}</div>
                  </div>
                  {dev.disabled && dev.disabledNotice && (
                    <div className="config-card-desc">{t('flasher.disabledNotice.xburn', dev.disabledNotice)}</div>
                  )}
                  <div className="config-card-meta">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => { e.stopPropagation(); openExternal(dev.infoUrl); }}
                    >
                      {t('flasher.link.deviceInfo', '了解设备')}
                    </button>
                    {dev.imageDownloadUrl && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={(e) => { e.stopPropagation(); openExternal(dev.imageDownloadUrl!); }}
                      >
                        {t('flasher.link.imageDl', '镜像下载')}
                      </button>
                    )}
                    {resolveXburnToolUrl(dev, platform) && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={(e) => { e.stopPropagation(); openExternal(resolveXburnToolUrl(dev, platform)!); }}
                      >
                        {t('flasher.link.flashTool', '烧录工具')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {selectedDeviceKey === 's100' && (
              <div className="card card-compact" style={{ marginTop: 12, borderColor: 'var(--accent)', background: 'var(--accent-subtle)' }}>
                <p className="config-card-desc" style={{ margin: 0 }}>
                  {t('flasher.s100.typecHint', 'S100 烧录请使用 USB Type-C 连接开发板，并在 xburn 中按提示进入烧录模式。')}
                </p>
              </div>
            )}
            {error && (
              <div className="card card-compact" style={{ marginTop: 8, borderColor: 'var(--danger)', background: 'var(--danger-subtle)' }}>
                <p className="config-card-desc" style={{ color: 'var(--danger)', margin: 0, whiteSpace: 'pre-line' }}>{error}</p>
                {selectedDeviceKey === 's100' && (
                  <p className="config-card-desc" style={{ marginTop: 12, marginBottom: 0 }}>
                    <a href={S100_MANUAL_FLASH_DOC} target="_blank" rel="noreferrer noopener">
                      {t('flasher.s100.manualDocLink', '查看 S100 官方手动烧录说明')}
                    </a>
                  </p>
                )}
              </div>
            )}
            <div className="config-header flasher-nav-row" style={{ marginTop: 12 }}>
              <div className="tool-bar-left" />
              <div className="tool-bar-right">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!selectedDeviceKey}
                  onClick={() => goToStep(1)}
                >
                  {t('flasher.btn.nextPickImage', '下一步 → 选择镜像')}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ═══════ Step 1: Select Image ═══════ */}
        {step === 1 && (
          <section className="card card-compact flasher-step-card">
            {isS100Device && (
              <div className="card card-compact" style={{ marginBottom: 12, borderColor: 'var(--line-strong, var(--line))' }}>
                <p className="config-card-desc" style={{ margin: 0 }}>
                  {t(
                    'flasher.s100.officialCatalogHint',
                    '下列为官方固件版本目录，点击「手动下载」获取 product.zip。一键烧写可直接选择该 zip 或已解压文件夹（与参考 Studio 一致）；路径含中文时可能自动复制到临时英文目录。也可仅用下方图形工具手动烧录。',
                  )}
                </p>
              </div>
            )}
            <div className="config-grid flasher-step1-grid">
              {/* Official images */}
              <div>
                <div className="section-label">{t('flasher.section.officialImages', '官方镜像')}</div>
                <div className="config-grid flasher-image-list">
                  {imageCandidates.map((img) => (
                    <div
                      key={img.key}
                      className={`config-card ${!isS100Device && !useLocalImage && selectedImageKey === img.key ? 'selected' : ''}`}
                      onClick={() => {
                        if (isS100Device) return;
                        setSelectedImageKey(img.key);
                        setUseLocalImage(false);
                      }}
                    >
                      <div className="config-card-head">
                        <div className="config-card-name">{img.name}</div>
                      </div>
                      <div className="config-card-meta">
                        {img.tags.map((tag) => (
                          <span
                            key={`${img.key}-${tag}`}
                            className={`badge ${img.type === 'desktop' ? 'badge-ok' : 'badge-muted'}`}
                          >
                            {flashImageTagLabel(tag, t)}
                          </span>
                        ))}
                      </div>
                      <div className="config-card-meta">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); openExternal(img.infoUrl); }}>{t('flasher.btn.details', '详情')}</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); openExternal(img.downloadUrl); }}>{t('flasher.btn.manualDownload', '手动下载')}</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Local image */}
              <div>
                <div className="section-label">{t('flasher.section.localFile', '本机镜像文件')}</div>
                <div className="config-section">
                  <div
                    className={`config-card ${useLocalImage ? 'selected' : ''}`}
                    onClick={() => void (isS100Device ? pickS100UnifiedImage() : pickLocalImage())}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void (isS100Device ? pickS100UnifiedImage() : pickLocalImage());
                      }
                    }}
                  >
                    <div className="config-card-head">
                      <div className="config-card-name">
                        {isS100Device
                          ? (localImagePath
                            ? t('flasher.s100.pickedFirmware', '已选择固件（zip 或文件夹）')
                            : t('flasher.s100.pickFirmware', '选择 product.zip 或已解压文件夹…'))
                          : (localImagePath
                            ? t('flasher.localFile.picked', '已选择本机文件')
                            : t('flasher.localFile.pick', '选择本机镜像文件...'))}
                      </div>
                    </div>
                    {localImagePath && <div className="config-card-desc" style={{ wordBreak: 'break-all' }}>{localImagePath}</div>}
                  </div>
                  <div className="config-actions" style={{ width: '100%', alignItems: 'stretch' }}>
                    <input
                      className="input"
                      style={{ flex: 1, minWidth: 0 }}
                      placeholder={
                        isS100Device
                          ? t(
                            'flasher.s100.pathPlaceholder',
                            '请填写或浏览：product.zip 或已解压固件文件夹路径',
                          )
                          : t('flasher.localFile.placeholder', '或手动输入路径 (.img / .xz)')
                      }
                      value={localImagePath}
                      onChange={(e) => { setLocalImagePath(e.target.value); if (e.target.value) setUseLocalImage(true); }}
                    />
                    {isDesktop && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void (isS100Device ? pickS100UnifiedImage() : pickLocalImage())}
                      >
                        {t('flasher.localFile.browse', '浏览')}
                      </button>
                    )}
                  </div>
                  {needsXburn && (
                    <div className="card card-compact" style={{ borderColor: 'var(--warn)', background: 'var(--warn-subtle)' }}>
                      <p className="config-card-desc" style={{ color: 'var(--warn)', margin: 0 }}>
                        {isS100Device && caps.supportsS100XburnCli
                          ? platform === 'darwin'
                            ? t(
                              'flasher.hint.s100OneClickMac',
                              'Mac 上一键烧写会自动使用 /Applications 或 PATH 里的 xburn；若未安装会尝试下载官方 DMG 并装到用户「应用程序」。你只需在上方选好固件；烧录时会弹管理员密码（sudo），无需再选 xburn 程序。',
                            )
                            : t(
                              'flasher.hint.s100OneClick',
                              'Windows 一键烧写需要：① 本机固件（product.zip 或文件夹，在上方选择）；② xburn-gui 目录下的 xburn.exe（可在烧录页提前选择，避免与固件混淆）。',
                            )
                          : t('flasher.hint.xburnOptional', '该设备走 xburn 流程，本机镜像文件可选（也可在 xburn 内选择镜像）。')}
                      </p>
                    </div>
                  )}
                  {!capsLoading && !caps.supportsDirectWrite && (
                    <div className="card card-compact" style={{ borderColor: 'var(--warn)', background: 'var(--warn-subtle)' }}>
                      <p className="config-card-desc" style={{ color: 'var(--warn)', margin: 0 }}>
                        {isDesktop
                          ? t('flasher.hint.desktopWrite', '当前系统需要额外配置才能使用直接写盘功能，可使用第三方工具完成介质制作。')
                          : t('flasher.hint.browserOnly', '当前为浏览器环境，本机烧录功能需在桌面客户端中使用。')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {error && (
              <div className="card card-compact" style={{ marginTop: 8, borderColor: 'var(--danger)', background: 'var(--danger-subtle)' }}>
                <p className="config-card-desc" style={{ color: 'var(--danger)', margin: 0, whiteSpace: 'pre-line' }}>{error}</p>
                {isS100Device && (
                  <p className="config-card-desc" style={{ marginTop: 12, marginBottom: 0 }}>
                    <a href={S100_MANUAL_FLASH_DOC} target="_blank" rel="noreferrer noopener">
                      {t('flasher.s100.manualDocLink', '查看 S100 官方手动烧录说明')}
                    </a>
                  </p>
                )}
              </div>
            )}
            <div className="config-header flasher-nav-row" style={{ marginTop: 12 }}>
              <div className="tool-bar-left">
                <button type="button" className="btn btn-ghost" onClick={() => goToStep(0)}>{t('flasher.btn.back', '← 上一步')}</button>
              </div>
              <div className="tool-bar-right">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canProceedFromImage}
                  onClick={() => goToStep(2)}
                >
                  {tf('flasher.btn.nextDisk', '下一步 → {{target}}', {
                    target: needsXburn ? t('flasher.next.flash', '烧录') : t('flasher.next.pickDisk', '选择磁盘'),
                  })}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ═══════ Step 2: Select Drive / Confirm ═══════ */}
        {step === 2 && (
          <section className="card card-compact flasher-step-card">
            <div className={`config-grid flasher-step2-grid${needsXburn ? ' flasher-step2-xburn' : ''}`}>
              {needsXburn ? (
                <>
                  <div className="card card-compact flasher-manual-pane">
                    <div className="flasher-xburn-pane-title">
                      <span className="flasher-xburn-pane-num" aria-hidden>1</span>
                      <span>{t('flasher.section.manualFlash', '手动烧录')}</span>
                    </div>
                    <div className="flasher-manual-body">
                      <p className="config-card-desc">
                        {t('flasher.xburn.desc', 'S100 / eMMC 机型建议使用 xburn-gui 完成烧录。')}
                      </p>
                      <ol className="flasher-xburn-step-list">
                        <li>{t('flasher.xburn.step1', '确认已安装 xburn-gui')}</li>
                        <li>{t('flasher.xburn.step2', '通过 USB Type-C 连接开发板')}</li>
                        <li>{t('flasher.xburn.step3', '在左栏底部点击「启动 xburn 工具」，随后在 xburn 中选择镜像')}</li>
                      </ol>
                    </div>
                    <div className="flasher-manual-actions">
                      {caps.supportsLaunchThirdPartyTool && (
                        <button type="button" className="btn btn-ghost" onClick={launchXburn}>
                          {t('flasher.btn.launchXburn', '启动 xburn 工具')}
                        </button>
                      )}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openExternal(xburnUrl)}>
                        {t('flasher.btn.downloadXburn', '下载 xburn-gui')}
                      </button>
                    </div>
                  </div>
                  <div className="card card-compact flasher-auto-pane">
                    <div className="flasher-xburn-pane-title">
                      <span className="flasher-xburn-pane-num" aria-hidden>2</span>
                      <span>{t('flasher.section.autoFlash', '自动烧录')}</span>
                    </div>
                    <div className="flasher-auto-stack">
                      {selectedDeviceKey === 's100' && caps.supportsS100XburnCli ? (
                        <div className="card card-compact flasher-auto-reco-callout">
                          <p className="config-card-desc">
                            {platform === 'darwin'
                              ? t(
                                'flasher.s100.cliIntroMac',
                                '推荐：使用「一键命令行烧写」。Mac 会自动定位 xburn（/Applications 或 PATH），必要时自动下载安装；通过系统对话框输入密码以 sudo 运行 xburn。也可改用左侧「启动 xburn 工具」手动操作。',
                              )
                              : t(
                                'flasher.s100.cliIntro',
                                '推荐：使用「一键命令行烧写」自动调用 xburn（USB + fastboot）。Windows 下将先通过 adb 进入烧录模式；也可改用左侧图形工具手动操作。',
                              )}
                          </p>
                        </div>
                      ) : (
                        <p className="config-card-desc flasher-auto-fallback-hint">
                          {t(
                            'flasher.auto.descFallback',
                            '优先使用左侧图形工具；若桌面端支持，可在底部使用一键命令行烧写。',
                          )}
                        </p>
                      )}
                      {selectedDeviceKey === 's100' && platform === 'win32' && caps.supportsS100XburnCli && (
                        <label className="config-card-desc" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={s100SkipAdbReboot}
                            onChange={(e) => setS100SkipAdbReboot(e.target.checked)}
                          />
                          {t('flasher.s100.skipAdbReboot', '已手动进入下载模式，跳过 adb reboot usb2')}
                        </label>
                      )}
                      {selectedDeviceKey === 's100' && caps.supportsS100XburnCli && isDesktop && platform !== 'darwin' && window.rdkDesktop?.flashPickS100XburnGui && (
                        <div className="card card-compact" style={{ borderColor: 'var(--border-strong)' }}>
                          <div className="section-label" style={{ marginBottom: 6 }}>
                            {t('flasher.s100.xburnToolSection', '烧写程序（xburn-gui）')}
                          </div>
                          <p className="config-card-desc" style={{ marginTop: 0 }}>
                            {t(
                              'flasher.s100.xburnToolExplain',
                              '这与上一步的「固件 zip/文件夹」不是同一个文件：这里要选官方包里的 xburn-gui.app（Mac）或 xburn-gui.exe（Windows）。',
                            )}
                          </p>
                          <p className="config-card-desc" style={{ wordBreak: 'break-all', marginBottom: 8 }}>
                            {s100XburnGuiPath
                              ? s100XburnGuiPath
                              : t(
                                'flasher.s100.xburnToolNotSet',
                                '尚未在本页选择（点一键时仍会弹出系统文件框，请选 .app / .exe，不要选固件目录）。',
                              )}
                          </p>
                          <div className="config-actions" style={{ flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={loading}
                              onClick={async () => {
                                const pick = window.rdkDesktop?.flashPickS100XburnGui;
                                if (!pick) return;
                                const r = await pick();
                                if (r?.canceled) return;
                                if (r?.ok && r.path) {
                                  setS100XburnGuiPath(r.path);
                                  addToast(
                                    t('flasher.s100.toast.xburnToolSaved', '已保存 xburn 程序路径，一键烧写时不再问此项（除非文件被移动）'),
                                    'success',
                                  );
                                }
                              }}
                            >
                              {s100XburnGuiPath
                                ? t('flasher.s100.xburnToolChange', '更换 xburn 程序…')
                                : t('flasher.s100.xburnToolPick', '选择 xburn 程序…')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flasher-auto-summary-wrap">{renderStep2Summary()}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flasher-drive-pane">
                    <div className="config-header" style={{ alignItems: 'flex-start' }}>
                      <div className="section-label" style={{ marginBottom: 0 }}>{t('flasher.section.targetDisk', '选择目标磁盘')}</div>
                      <span className="badge badge-danger">{t('flasher.warn.eraseAll', '写盘将清空目标磁盘全部数据！')}</span>
                    </div>
                    <div className="config-grid">
                      {drives.length === 0 ? (
                        <div className="config-card-desc">
                          {caps.supportsDriveScan
                            ? t('flasher.drives.empty', '未检测到可用 SD/eMMC 目标盘，请插入 TF/SD 卡后刷新')
                            : t('flasher.drives.unsupported', '当前环境暂不支持磁盘检测')}
                        </div>
                      ) : (
                        drives.map((d) => (
                          <button
                            type="button"
                            key={d.path}
                            className={`config-card ${selectedDrive === d.path ? 'selected' : ''}`}
                            style={{ textAlign: 'left' }}
                            onClick={() => setSelectedDrive(d.path)}
                          >
                            <div className="config-card-head">
                              <div className="config-card-name">{d.label || d.path}</div>
                            </div>
                            <div className="config-card-desc">{d.bus} &middot; {d.size} &middot; {d.path}</div>
                          </button>
                        ))
                      )}
                    </div>
                    {caps.supportsDriveScan && (
                      <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={scanDrives}>
                        {t('flasher.btn.refreshDrives', '刷新磁盘列表')}
                      </button>
                    )}
                  </div>
                  {renderStep2Summary()}
                </>
              )}
            </div>
            {error && (
              <div className="card card-compact" style={{ marginTop: 8, borderColor: 'var(--danger)', background: 'var(--danger-subtle)' }}>
                <p className="config-card-desc" style={{ color: 'var(--danger)', margin: 0, whiteSpace: 'pre-line' }}>{error}</p>
                {selectedDeviceKey === 's100' && (
                  <p className="config-card-desc" style={{ marginTop: 12, marginBottom: 0 }}>
                    <a href={S100_MANUAL_FLASH_DOC} target="_blank" rel="noreferrer noopener">
                      {t('flasher.s100.manualDocLink', '查看 S100 官方手动烧录说明')}
                    </a>
                  </p>
                )}
              </div>
            )}
            <div className="config-header flasher-nav-row" style={{ marginTop: 12 }}>
              <div className="tool-bar-left">
                <button type="button" className="btn btn-ghost" onClick={() => goToStep(1)}>{t('flasher.btn.back', '← 上一步')}</button>
              </div>
              <div className="tool-bar-right">
                {needsXburn ? (
                  isS100Device && caps.supportsS100XburnCli && isDesktop && window.rdkDesktop?.flashS100Xburn ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={loading || !localImagePath.trim()}
                      title={
                        !localImagePath.trim()
                          ? t('flasher.s100.err.needImagePath', '一键烧写需要选择本机 product.zip 或固件文件夹')
                          : undefined
                      }
                      onClick={() => startFlashWorkflow()}
                    >
                      {loading ? t('flasher.btn.writing', '执行中...') : t('flasher.btn.s100OneClick', '一键命令行烧写')}
                    </button>
                  ) : caps.supportsLaunchThirdPartyTool ? (
                    <button type="button" className="btn btn-primary" onClick={() => startFlashWorkflow()}>
                      {t('flasher.btn.startXburnFlash', '启动 xburn 烧录')}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-primary" onClick={() => openExternal(xburnUrl)}>
                      {t('flasher.btn.getXburn', '前往下载 xburn')}
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!canProceedFromDrive || loading || (!capsLoading && !caps.supportsDirectWrite)}
                    title={showDirectWriteAdminHint ? t('flasher.hint.adminTitle', '需管理员权限运行桌面端') : undefined}
                    onClick={() => startFlashWorkflow()}
                  >
                    {loading ? t('flasher.btn.writing', '执行中...') : t('flasher.btn.startWrite', '开始写盘')}
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ═══════ Step 3: Flash Progress ═══════ */}
        {step === 3 && (
          <section className="card card-compact">
            <div className="config-header">
              <h3 style={{ margin: 0, fontSize: '1rem' }}>{flashPhaseTitle}</h3>
              {phase !== 'done' && phase !== 'error' && (
                <button type="button" className="btn btn-ghost" onClick={requestCancel}>{t('flasher.btn.requestCancel', '请求取消')}</button>
              )}
            </div>

            {/* Progress bar */}
            <div className="config-actions" style={{ width: '100%', alignItems: 'center', gap: 12 }}>
              <div className="flash-progress" style={{ flex: 1, minWidth: 0 }}>
                <div
                  className={`flash-progress-fill ${phase === 'error' ? 'error' : ''} ${phase === 'done' ? 'done' : ''}`}
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
              <span className="config-card-desc" style={{ fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{Math.round(progress)}%</span>
            </div>

            {/* Phase indicators */}
            <div className="config-section">
              {flashStepPhases.map((p) => {
                let state: 'wait' | 'run' | 'done' | 'error' | 'skip' = 'wait';
                const order: readonly string[] = [...flashStepPhases, 'done', 'error'];
                const ci = order.indexOf(phase);
                const pi = order.indexOf(p);
                if (ci === pi) state = 'run';
                else if (ci > pi && ci < order.length) state = 'done';
                else if (phase === 'done') state = 'done';
                else if (phase === 'error' && ci >= 0 && pi < ci) state = 'done';
                else if (phase === 'error' && ci >= 0 && pi === ci) state = 'error';

                if (p === 'downloading' && useLocalImage && !isWinS100OneClick) state = 'skip';
                if (p === 'decompressing' && localImagePath && !isCompressedFile(localImagePath) && !isWinS100OneClick) {
                  state = 'skip';
                }
                if (p === 'verifying' && needsXburn) state = 'skip';

                const badgeClass =
                  state === 'run' ? 'badge-accent'
                    : state === 'done' ? 'badge-ok'
                      : state === 'error' ? 'badge-danger'
                        : 'badge-muted';

                return (
                  <div key={p} className="config-row">
                    <span className="config-label">{flashPhaseRowLabels[p]}</span>
                    <span className="config-value">
                      <span className={`badge ${badgeClass}`}>
                        {state === 'wait' && t('flasher.state.wait', '等待')}
                        {state === 'run' && t('flasher.state.run', '执行中')}
                        {state === 'done' && t('flasher.state.done', '完成')}
                        {state === 'error' && t('flasher.state.error', '失败')}
                        {state === 'skip' && t('flasher.state.skip', '跳过')}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Log panel */}
            <div className="config-terminal">
              {logs.length === 0 ? (
                <div className="config-card-desc">{t('flasher.log.empty', '等待日志输出...')}</div>
              ) : (
                logs.map((line, idx) => <div key={idx}>{line}</div>)
              )}
            </div>

            {error && (
              <div className="card card-compact" style={{ marginTop: 8, borderColor: 'var(--danger)', background: 'var(--danger-subtle)' }}>
                <p className="config-card-desc" style={{ color: 'var(--danger)', margin: 0, whiteSpace: 'pre-line' }}>{error}</p>
                {selectedDeviceKey === 's100' && (
                  <p className="config-card-desc" style={{ marginTop: 12, marginBottom: 0 }}>
                    <a href={S100_MANUAL_FLASH_DOC} target="_blank" rel="noreferrer noopener">
                      {t('flasher.s100.manualDocLink', '查看 S100 官方手动烧录说明')}
                    </a>
                  </p>
                )}
              </div>
            )}
            {!error && verifyDetail && (
              <div className="card card-compact" style={{ marginTop: 8, borderColor: 'var(--ok)', background: 'var(--ok-subtle)' }}>
                <p className="config-card-desc" style={{ color: 'var(--ok)', margin: 0 }}>
                  {tf('flasher.verify.prefix', '校验: {{detail}}', { detail: verifyDetail })}
                </p>
              </div>
            )}

            {(phase === 'done' || phase === 'error') && (
              <div className="config-header flasher-nav-row" style={{ marginTop: 12 }}>
                <div className="tool-bar-left">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      clearLegacyStoredState();
                      setStep(0);
                      setPhase('idle');
                      setProgress(0);
                      setLogs([]);
                      setError('');
                      scannedRef.current = false;
                    }}
                  >
                    {t('flasher.btn.restart', '重新开始')}
                  </button>
                </div>
                <div className="tool-bar-right">
                  {phase === 'done' && (
                    <button type="button" className="btn btn-primary" onClick={() => setStep(4)}>
                      {t('flasher.btn.finish', '完成 →')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ═══════ Step 4: Done ═══════ */}
        {step === 4 && (
          <section className="card card-compact">
            <h2>{t('flasher.done.title', '写盘完成')}</h2>
            <p className="config-card-desc">{t('flasher.done.desc', '镜像已写入目标磁盘。请安全弹出介质并插入目标板卡进行启动验证。')}</p>

            {SHOW_FLASHER_WIFI_PRECONFIG && (
              <div className="card card-compact">
                <div className="config-header">
                  <span className="section-label" style={{ marginBottom: 0 }}>{t('flasher.wifi.section', 'WiFi 预配置（可选）')}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowWifiConfig(!showWifiConfig)}
                  >
                    {showWifiConfig ? t('flasher.wifi.collapse', '收起') : t('flasher.wifi.expand', '展开配置')}
                  </button>
                </div>
                {showWifiConfig && (
                  <div className="config-section">
                    <div className="config-actions" style={{ flexWrap: 'wrap' }}>
                      <label className="config-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="wifi-mode"
                          checked={wifiConfig.mode === 'station'}
                          onChange={() => setWifiConfig((c) => ({ ...c, mode: 'station' }))}
                        />
                        {t('flasher.wifi.station', 'Station 模式')}
                      </label>
                      <label className="config-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="wifi-mode"
                          checked={wifiConfig.mode === 'ap'}
                          onChange={() => setWifiConfig((c) => ({ ...c, mode: 'ap' }))}
                        />
                        {t('flasher.wifi.ap', 'AP 模式')}
                      </label>
                    </div>
                    <input
                      className="input"
                      placeholder={t('flasher.wifi.ssidPh', 'WiFi 名称 (SSID)')}
                      value={wifiConfig.ssid}
                      onChange={(e) => setWifiConfig((c) => ({ ...c, ssid: e.target.value }))}
                    />
                    <input
                      className="input"
                      type="password"
                      placeholder={t('flasher.wifi.pwPh', 'WiFi 密码（至少 8 位）')}
                      value={wifiConfig.password}
                      onChange={(e) => setWifiConfig((c) => ({ ...c, password: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!wifiConfig.ssid.trim() || wifiConfig.password.length < 8}
                      onClick={async () => {
                        addToast(t('flasher.wifi.toast', 'WiFi 配置将在设备首次启动时生效'), 'info');
                        setShowWifiConfig(false);
                      }}
                    >
                      {t('flasher.wifi.save', '保存 WiFi 配置')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Next actions */}
            <div className="config-actions" style={{ flexWrap: 'wrap', marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => { setActiveTab('terminal'); addToast(t('flasher.toast.tabTerminal', '已切换到终端'), 'info'); }}
              >
                {t('flasher.btn.terminal', '终端验证')}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { setActiveTab('hardware'); addToast(t('flasher.toast.tabHardware', '已切换到硬件监控'), 'info'); }}
              >
                {t('flasher.btn.hardware', '硬件状态')}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { setActiveTab('skills'); addToast(t('flasher.toast.tabSkills', '已切换到技能工坊'), 'info'); }}
              >
                {t('flasher.btn.skills', '技能工坊')}
              </button>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 8 }}
              onClick={() => {
                clearLegacyStoredState();
                setStep(0);
                setPhase('idle');
                setProgress(0);
                setLogs([]);
                setError('');
                setDrives([]);
                setSelectedDrive('');
                scannedRef.current = false;
              }}
            >
              {t('flasher.btn.flashAgain', '重新写盘')}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
