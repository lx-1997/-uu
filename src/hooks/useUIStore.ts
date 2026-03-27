import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import type { Tab, ConfirmDialogState, TransferItem } from '../app-types';
import { FLASH_IMAGES } from '../constants';
import { useToastStore } from './useToastStore';
import { useDeviceStore } from './useDeviceStore';
import { fetchNodeRedStatus, fetchRosTopics, fetchVncStatus, executeDeviceCommand } from '../api';

const UI_LOCALE_KEY = 'rdk-ui-locale';

function readStoredLocale(): 'zh-CN' | 'en' {
  if (typeof window === 'undefined') return 'zh-CN';
  return localStorage.getItem(UI_LOCALE_KEY) === 'en' ? 'en' : 'zh-CN';
}

export type ThemeMode = 'aurora' | 'cyber' | 'cozy';

export interface UIStoreState {
  // Theme
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;

  // Navigation
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;

  // Onboarding
  obStep: 'board' | 'flash' | 'connect' | 'model' | 'openclaw' | 'rdkclaw' | 'done';
  setObStep: (v: 'board' | 'flash' | 'connect' | 'model' | 'openclaw' | 'rdkclaw' | 'done') => void;
  selectedBoard: string | null;
  setSelectedBoard: (v: string | null) => void;
  obReturnStep: 'board' | 'flash' | 'connect' | 'model' | 'openclaw' | 'rdkclaw' | null;
  setObReturnStep: (v: 'board' | 'flash' | 'connect' | 'model' | 'openclaw' | 'rdkclaw' | null) => void;

  // Loading
  isLoading: boolean;
  loadingMsg: string;
  openWorkspace: (tab: Tab, message: string) => void;

  // Flash
  flashImage: string;
  setFlashImage: (v: string) => void;
  flashTarget: string;
  setFlashTarget: (v: string) => void;
  flashMode: 'safe' | 'fast' | 'recover';
  setFlashMode: (v: 'safe' | 'fast' | 'recover') => void;
  flashVerify: boolean;
  setFlashVerify: (v: boolean) => void;
  flashBackup: boolean;
  setFlashBackup: (v: boolean) => void;
  flashProgress: number;
  flashPhase: string;
  isFlashing: boolean;
  flashStep: number;
  setFlashStep: (v: number) => void;
  startFlash: () => void;

  // File Transfer
  transferProtocol: string;
  fileAction: 'upload' | 'download' | 'sync';
  setFileAction: (v: 'upload' | 'download' | 'sync') => void;
  transferQueue: TransferItem[];
  appendTransferTask: () => void;

  // VNC
  vncQuality: 'smooth' | 'balanced' | 'sharp';
  setVncQuality: (v: 'smooth' | 'balanced' | 'sharp') => void;
  vncLayout: 'fit' | 'pixel' | 'dual';
  setVncLayout: (v: 'fit' | 'pixel' | 'dual') => void;
  vncOverlay: boolean;
  vncConnected: boolean;
  vncProgress: number;
  vncPhase: string;
  startVncSession: () => void;

  // Lowcode
  flowTemplate: string;
  setFlowTemplate: (v: string) => void;
  flowMode: 'draft' | 'review' | 'staging';
  setFlowMode: (v: 'draft' | 'review' | 'staging') => void;
  flowCheckProgress: number;
  isFlowChecking: boolean;
  runFlowValidation: () => void;

  // OpenClaw
  openclawMode: string;
  setOpenclawMode: (v: string) => void;
  openclawThreshold: number;
  openclawChatMode: boolean;
  setOpenclawChatMode: (v: boolean) => void;
  openclawConnected: boolean;
  setOpenclawConnected: (v: boolean) => void;
  openclawSendMessage: ((text: string) => void) | null;
  registerOpenclawSend: (fn: ((text: string) => void) | null) => void;

  // Rail
  railExpanded: boolean;
  setRailExpanded: (v: boolean) => void;

  // Hardware
  hardwareRange: 'realtime' | '10m' | '1h';
  setHardwareRange: (v: 'realtime' | '10m' | '1h') => void;

  // Examples
  examplePreset: string;
  setExamplePreset: (v: string) => void;

  // ROS
  rosTopic: string;
  setRosTopic: (v: string) => void;
  rosRecording: boolean;
  setRosRecording: (v: boolean) => void;

  // Diagnostics
  diagnosticOpen: boolean;
  setDiagnosticOpen: (v: boolean) => void;
  diagnosticStep: number;
  setDiagnosticStep: (v: number) => void;

  // Settings
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  autoReconnect: boolean;
  setAutoReconnect: (v: boolean) => void;
  connectionTimeout: number;
  setConnectionTimeout: (v: number) => void;
  language: string;
  setLanguage: (v: string) => void;

  // Confirm dialog
  confirmDialog: ConfirmDialogState | null;
  setConfirmDialog: (v: ConfirmDialogState | null) => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

const UIContext = createContext<UIStoreState | null>(null);

export function useUIStore(): UIStoreState {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUIStore must be used within UIProvider');
  return ctx;
}

export function UIProvider({ children }: { children: React.ReactNode }) {
  const { addToast, addActivity } = useToastStore();
  const { currentDevice } = useDeviceStore();

  // ── Theme ──
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('rdk-theme') as ThemeMode | null;
      if (saved && ['aurora', 'cyber', 'cozy'].includes(saved)) return saved;
    }
    return 'cyber';
  });
  const setTheme = (t: ThemeMode) => {
    setThemeState(t);
    localStorage.setItem('rdk-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  };
  const THEME_ORDER: ThemeMode[] = ['aurora', 'cozy', 'cyber'];
  const toggleTheme = () => {
    const idx = THEME_ORDER.indexOf(theme);
    setTheme(THEME_ORDER[(idx + 1) % THEME_ORDER.length]);
  };

  // ── Navigation ──
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');

  // ── Onboarding (persisted) ──
  const [obStep, setObStepRaw] = useState<'board' | 'flash' | 'connect' | 'model' | 'openclaw' | 'rdkclaw' | 'done'>(() => {
    const saved = localStorage.getItem('rdk-onboarding-step');
    if (saved && ['board', 'flash', 'connect', 'model', 'openclaw', 'rdkclaw', 'done'].includes(saved)) return saved as any;
    return 'board';
  });
  const setObStep = (v: typeof obStep) => { setObStepRaw(v); localStorage.setItem('rdk-onboarding-step', v); };
  const [selectedBoard, setSelectedBoardRaw] = useState<string | null>(() => localStorage.getItem('rdk-onboarding-board'));
  const setSelectedBoard = (v: string | null) => { setSelectedBoardRaw(v); if (v) localStorage.setItem('rdk-onboarding-board', v); else localStorage.removeItem('rdk-onboarding-board'); };
  const [obReturnStep, setObReturnStep] = useState<'board' | 'flash' | 'connect' | 'model' | 'openclaw' | 'rdkclaw' | null>(null);

  // ── Loading ──
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const openWorkspace = (nextTab: Tab, message: string) => {
    setIsLoading(true);
    setLoadingMsg(message);
    window.setTimeout(() => { setActiveTab(nextTab); setIsLoading(false); }, 400);
  };

  // ── Flash ──
  const [flashImage, setFlashImage] = useState('ubuntu-22.04');
  const [flashTarget, setFlashTarget] = useState('sd');
  const [flashMode, setFlashMode] = useState<'safe' | 'fast' | 'recover'>('safe');
  const [flashVerify, setFlashVerify] = useState(true);
  const [flashBackup, setFlashBackup] = useState(false);
  const [flashProgress, setFlashProgress] = useState(0);
  const [flashPhase, setFlashPhase] = useState('等待开始');
  const [isFlashing, setIsFlashing] = useState(false);
  const [flashStep, setFlashStep] = useState(1);

  const startFlash = () => {
    const doFlash = () => {
      setFlashProgress(0);
      setFlashPhase('请在本机执行烧录工具（balenaEtcher / dd / rpi-imager）后回到此页确认');
      setFlashStep(1);
      setIsFlashing(false);
      addToast('已进入真实烧录流程引导', 'info');
      addActivity(`烧录准备: ${FLASH_IMAGES.find((i) => i.id === flashImage)?.label || flashImage}`);
    };
    if (flashTarget === 'emmc') {
      showConfirm('⚠️ eMMC 烧录确认', '当前目标为 eMMC 内置存储，写入后将覆盖原有系统。此操作不可撤销，建议先备份重要数据。确认继续？', doFlash);
    } else {
      doFlash();
    }
  };

  // ── File Transfer ──
  const [transferProtocol] = useState('sftp');
  const [fileAction, setFileAction] = useState<'upload' | 'download' | 'sync'>('upload');
  const [transferQueue, setTransferQueue] = useState<TransferItem[]>([]);

  const appendTransferTask = () => {
    const direction = fileAction === 'upload' ? '上传' : fileAction === 'download' ? '下载' : '同步';
    const name = fileAction === 'upload' ? '用户选择文件' : fileAction === 'download' ? '用户选择远程文件' : '用户选择同步目录';
    setTransferQueue((prev) => [{ id: `queue-${prev.length + 1}`, name, direction, progress: 0, status: 'running' }, ...prev]);
    addToast(`${direction}任务已记录，请在文件页执行真实命令`, 'info');
    addActivity(`新增${direction}任务`);
  };

  // ── VNC ──
  const [vncQuality, setVncQuality] = useState<'smooth' | 'balanced' | 'sharp'>('balanced');
  const [vncLayout, setVncLayout] = useState<'fit' | 'pixel' | 'dual'>('fit');
  const [vncOverlay] = useState(true);
  const [vncConnected, setVncConnected] = useState(false);
  const [vncProgress, setVncProgress] = useState(0);
  const [vncPhase, setVncPhase] = useState('等待连接');

  const startVncSession = () => {
    if (!currentDevice) {
      addToast('请先连接真实设备', 'warning');
      return;
    }
    setVncConnected(false);
    setVncProgress(0);
    setVncPhase('正在检查设备 VNC 服务状态');

    fetchVncStatus(currentDevice.id)
      .then((result) => {
        if (result.active) {
          setVncConnected(true);
          setVncProgress(100);
          setVncPhase('设备 VNC 服务已运行');
          addToast('VNC 服务可用', 'success');
          addActivity('设备 VNC 服务状态: active');
        } else {
          setVncConnected(false);
          setVncProgress(0);
          setVncPhase('设备未检测到 VNC 服务，请先在板端启动');
          addToast('未检测到 VNC 服务，请先在设备上启动 x11vnc/vncserver', 'warning');
        }
      })
      .catch((error) => {
        setVncConnected(false);
        setVncProgress(0);
        setVncPhase('VNC 状态检查失败');
        addToast(error instanceof Error ? error.message : 'VNC 状态检查失败', 'error');
      });
  };

  // ── Lowcode ──
  const [flowTemplate, setFlowTemplate] = useState('vision');
  const [flowMode, setFlowMode] = useState<'draft' | 'review' | 'staging'>('draft');
  const [flowCheckProgress, setFlowCheckProgress] = useState(0);
  const [isFlowChecking, setIsFlowChecking] = useState(false);

  const runFlowValidation = () => {
    if (!currentDevice) {
      addToast('请先连接真实设备', 'warning');
      return;
    }
    setFlowCheckProgress(0);
    setIsFlowChecking(true);
    addToast('部署前检查已开始', 'info');
    addActivity('执行流程编排部署前检查');

    (async () => {
      try {
        setFlowCheckProgress(20);
        const nodeRed = await fetchNodeRedStatus(currentDevice.id);
        setFlowCheckProgress(50);
        const ros = await fetchRosTopics(currentDevice.id);
        setFlowCheckProgress(80);
        await executeDeviceCommand(
          currentDevice.id,
          'bash -lc "(openclaw status || clawctl status || echo openclaw-unavailable); (systemctl is-active nodered || echo nodered-inactive)"',
        );
        setFlowCheckProgress(100);
        addToast('流程编排部署前检查完成', 'success');
        addActivity(`Node-RED: ${nodeRed.active ? 'active' : 'inactive'} · ROS topics: ${ros.topics.length}`);
      } catch (error) {
        addToast(error instanceof Error ? error.message : '流程部署前检查失败', 'error');
      } finally {
        setIsFlowChecking(false);
      }
    })();
  };

  // ── OpenClaw ──
  const [openclawMode, setOpenclawMode] = useState('model');
  const [openclawThreshold] = useState(74);
  const [openclawChatMode, setOpenclawChatMode] = useState(false);
  const [openclawConnected, setOpenclawConnected] = useState(false);
  const openclawSendRef = useRef<((text: string) => void) | null>(null);
  const registerOpenclawSend = useCallback((fn: ((text: string) => void) | null) => {
    openclawSendRef.current = fn;
  }, []);

  // ── Rail ──
  const [railExpandedState, setRailExpandedState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const saved = localStorage.getItem('rdk-rail-expanded');
    if (saved == null) return true;
    return saved === '1';
  });
  const setRailExpanded = (v: boolean) => {
    setRailExpandedState(v);
    if (typeof window !== 'undefined') {
      localStorage.setItem('rdk-rail-expanded', v ? '1' : '0');
    }
  };

  // ── Hardware ──
  const [hardwareRange, setHardwareRange] = useState<'realtime' | '10m' | '1h'>('realtime');

  // ── Examples ──
  const [examplePreset, setExamplePreset] = useState('follow');

  // ── ROS ──
  const [rosTopic, setRosTopic] = useState('/hobot_dnn/bbox');
  const [rosRecording, setRosRecording] = useState(false);

  // ── Diagnostics ──
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const [diagnosticStep, setDiagnosticStep] = useState(0);

  // ── Settings ──
  const [showSettings, setShowSettings] = useState(false);
  const [autoReconnect, setAutoReconnect] = useState(true);
  const [connectionTimeout, setConnectionTimeout] = useState(30);
  const [language, setLanguageState] = useState<'zh-CN' | 'en'>(readStoredLocale);
  const setLanguage = (v: string) => {
    const next: 'zh-CN' | 'en' = v === 'en' ? 'en' : 'zh-CN';
    setLanguageState(next);
    if (typeof window !== 'undefined') localStorage.setItem(UI_LOCALE_KEY, next);
  };

  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  }, [language]);

  // ── Confirm dialog ──
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmDialog({ show: true, title, message, onConfirm });
  };

  const value: UIStoreState = {
    theme, setTheme, toggleTheme,
    activeTab, setActiveTab,
    obStep, setObStep, selectedBoard, setSelectedBoard, obReturnStep, setObReturnStep,
    isLoading, loadingMsg, openWorkspace,
    flashImage, setFlashImage, flashTarget, setFlashTarget,
    flashMode, setFlashMode, flashVerify, setFlashVerify,
    flashBackup, setFlashBackup, flashProgress, flashPhase,
    isFlashing, flashStep, setFlashStep, startFlash,
    transferProtocol, fileAction, setFileAction, transferQueue, appendTransferTask,
    vncQuality, setVncQuality, vncLayout, setVncLayout, vncOverlay,
    vncConnected, vncProgress, vncPhase, startVncSession,
    flowTemplate, setFlowTemplate, flowMode, setFlowMode,
    flowCheckProgress, isFlowChecking, runFlowValidation,
    openclawMode, setOpenclawMode, openclawThreshold,
    openclawChatMode, setOpenclawChatMode, openclawConnected, setOpenclawConnected,
    openclawSendMessage: openclawSendRef.current, registerOpenclawSend,
    railExpanded: railExpandedState, setRailExpanded,
    hardwareRange, setHardwareRange,
    examplePreset, setExamplePreset,
    rosTopic, setRosTopic, rosRecording, setRosRecording,
    diagnosticOpen, setDiagnosticOpen, diagnosticStep, setDiagnosticStep,
    showSettings, setShowSettings,
    autoReconnect, setAutoReconnect, connectionTimeout, setConnectionTimeout,
    language, setLanguage,
    confirmDialog, setConfirmDialog, showConfirm,
  };

  return React.createElement(UIContext.Provider, { value }, children);
}
