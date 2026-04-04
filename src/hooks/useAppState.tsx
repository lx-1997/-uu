import React, { useContext, useEffect, useMemo, useRef } from 'react';
import { AppStateContext } from './app-state-context';
import type {
  Tab,
  Device,
  Toast,
  TerminalSession,
  TransferItem,
  Activity,
  ChatMessage,
  ConfirmDialogState,
  AgentPlan,
  AgentExecutionState,
  ChatAttachment,
  DrAuthenticatedPortal,
  DrAuthenticatedPortalKind,
} from '../app-types';
import type { CmdSuggestion } from '../constants';
import type { Task } from '../ai';
import type { AgentAttachmentPayload, StudioResponseMode } from '../api';

import { translate } from '../i18n/translate';
import { fillTemplate } from '../i18n/en-extras';
import { ToastProvider, useToastStore } from './useToastStore';
import { DeviceProvider, useDeviceStore } from './useDeviceStore';
import { UIProvider, useUIStore, type ThemeMode } from './useUIStore';
import { TerminalProvider, useTerminalStore } from './useTerminalStore';
import { AIChatProvider, useAIChatStore, type RdkClawTimelineEntry } from './useAIChatStore';
import { getRdkEmbedPanel } from '../utils/embed-mode';
import type { EmbedToolbarApi } from './useUIStore';

// ---- State shape (unchanged — backward compatible) ----
export type { ThemeMode };

export interface AppState {
  theme: ThemeMode;

  // Device
  activeDevice: string;
  setActiveDevice: (id: string) => void;
  devices: Device[];
  setDevices: React.Dispatch<React.SetStateAction<Device[]>>;
  currentDevice: Device | undefined;

  // Navigation
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  /** 桌面：forum/RoboGo 内嵌页；浏览器无此状态 */
  drAuthenticatedPortal: DrAuthenticatedPortal | null;
  openDrAuthenticatedPortal: (kind: DrAuthenticatedPortalKind, baseUrl: string) => Promise<void>;
  closeDrAuthenticatedPortal: () => void;

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

  // Terminal
  terminalProfile: string;
  setTerminalProfile: (v: string) => void;
  terminalDraft: string;
  setTerminalDraft: (v: string) => void;
  terminalSessions: TerminalSession[];
  activeSessionId: string;
  setActiveSessionId: (v: string) => void;
  currentSession: TerminalSession;
  createSession: () => void;
  removeSession: (id: string) => void;
  replaceTerminalSessions: (sessions: TerminalSession[], activeId: string) => void;
  appendTerminalSession: (session: TerminalSession) => void;
  runTerminalCommand: (cmd: string, password?: string) => void;
  runTerminalAIAnalysis: () => void;

  // Files / Transfer
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
  vncEmbedToolbar: EmbedToolbarApi | null;
  setVncEmbedToolbar: (v: EmbedToolbarApi | null) => void;
  ideEmbedToolbar: EmbedToolbarApi | null;
  setIdeEmbedToolbar: (v: EmbedToolbarApi | null) => void;

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

  // Toasts / Activity
  toasts: Toast[];
  addToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  activities: Activity[];
  addActivity: (text: string) => void;

  // Modals
  showAddDevice: boolean;
  setShowAddDevice: (v: boolean) => void;
  addDeviceInitialMethod: 'manual' | 'usb' | 'typec' | null;
  setAddDeviceInitialMethod: (v: 'manual' | 'usb' | 'typec' | null) => void;
  newDeviceName: string;
  setNewDeviceName: (v: string) => void;
  newDeviceIp: string;
  setNewDeviceIp: (v: string) => void;
  scanForDevices: () => void;
  addNewDevice: (payload?: { host: string; port?: number; username: string; password: string; name?: string }) => void;
  registerDeviceAfterVerify: (payload: { host: string; port?: number; username: string; password: string; name?: string }) => Promise<Device | null>;
  removeDevice: (id: string) => void;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  autoReconnect: boolean;
  setAutoReconnect: (v: boolean) => void;
  connectionTimeout: number;
  setConnectionTimeout: (v: number) => void;
  language: string;
  setLanguage: (v: string) => void;
  confirmDialog: ConfirmDialogState | null;
  setConfirmDialog: (v: ConfirmDialogState | null) => void;
  showConfirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: { variant?: 'default' | 'danger'; confirmLabel?: string },
  ) => void;

  // AI Chat
  cmd: string;
  setCmd: (v: string) => void;
  showSuggestions: boolean;
  setShowSuggestions: (v: boolean) => void;
  filteredSuggestions: CmdSuggestion[];
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  chatExpanded: boolean;
  setChatExpanded: (v: boolean) => void;
  aiTyping: boolean;
  setAiTyping: React.Dispatch<React.SetStateAction<boolean>>;
  handleCommand: (
    e: React.FormEvent,
    options?: {
      messageOverride?: string;
      chatPreviewText?: string;
      attachments?: AgentAttachmentPayload[];
      displayAttachments?: ChatAttachment[];
      regenerate?: {
        removeAiMessageId: number;
        anchorUserMessageId: number;
        message: string;
        attachments: AgentAttachmentPayload[];
      };
    },
  ) => void;
  executeConfirm: (confirmId: string) => void;
  dismissConfirm: (confirmId: string) => void;
  clearChatHistory: () => void;
  resumeStudioThread: (deviceId: string, studioSessionId: string) => void;
  deleteStudioThread: (deviceId: string, studioSessionId: string) => void;
  agentMode: boolean;
  setAgentMode: (v: boolean) => void;
  agentPlan: AgentPlan | null;
  agentExecution: AgentExecutionState;

  // OpenClaw Chat Mode
  openclawChatMode: boolean;
  setOpenclawChatMode: (v: boolean) => void;
  openclawConnected: boolean;
  setOpenclawConnected: (v: boolean) => void;
  openclawSendMessage: ((text: string) => void) | null;
  registerOpenclawSend: (fn: ((text: string) => void) | null) => void;

  // Rail
  railExpanded: boolean;
  setRailExpanded: (v: boolean) => void;

  // Task tracking
  taskHistory: Task[];
  showTaskPanel: boolean;
  setShowTaskPanel: (v: boolean) => void;
  cancelRunningTask: (taskId: string) => void;
  handleApprovalAction: (
    approvalId: string,
    action: 'allow_once' | 'allow_session_auto' | 'allow_global_auto' | 'deny' | 'cancel_run',
    runId?: string,
  ) => void;
  handleRecommendationChoice: (recommendationId: string, choiceId: string, autoExecute: boolean) => void;
  handleSoulUpdateDecision: (proposalId: string, accepted: boolean) => void;
  stopCurrentRun: () => void;
  stopAllRuns: () => void;
  backgroundCurrentRun: () => void;
  backgroundRuns: Array<{
    runId: string;
    status: 'running' | 'ended';
    detachedAt: number;
  }>;
  stopBackgroundRun: (runId: string) => void;

  rdkClawRunTimeline: RdkClawTimelineEntry[];
  runTimelinePanelOpen: boolean;
  setRunTimelinePanelOpen: (v: boolean) => void;

  studioResponseMode: StudioResponseMode;
  setStudioResponseMode: (v: StudioResponseMode) => void;
  exportDebugBundle: (options?: { includeBoardLogs?: boolean }) => Promise<void>;
  exportDebugBundleForThread: (opts: {
    archiveDevId: string;
    sessionId: string;
    snapshotMessages: ChatMessage[];
    includeBoardLogs?: boolean;
  }) => Promise<void>;
  getStudioChatSessionId: () => string;
  getStudioChatDeviceId: () => string;
}

/** 与 app-state-context 同源，供仅需 Context 引用的模块直接导入（避免经本文件再取 context） */
export { AppStateContext } from './app-state-context';

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext) as AppState | null;
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}

/**
 * Inner component that composes all sub-stores into one AppState facade
 * and registers global keyboard shortcuts.
 */
function AppStateComposer({ children }: { children: React.ReactNode }) {
  const toast = useToastStore();
  const device = useDeviceStore();
  const ui = useUIStore();
  const terminal = useTerminalStore();
  const chat = useAIChatStore();
  const apiErrorSeenRef = useRef<Record<string, number>>({});

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target instanceof HTMLInputElement ||
                      target instanceof HTMLTextAreaElement ||
                      target.isContentEditable ||
                      target.closest('.monaco-editor') !== null ||
                      target.closest('.xterm') !== null;
      if (e.key === '/' && !isInput) {
        e.preventDefault();
        const input = document.querySelector('.dock-cmd-input') as HTMLInputElement;
        input?.focus();
      }
      if (e.key === 'Escape') {
        if (chat.chatExpanded && !getRdkEmbedPanel()) chat.setChatExpanded(false);
        if (ui.showSettings) ui.setShowSettings(false);
        if (device.showAddDevice) device.setShowAddDevice(false);
        if (ui.diagnosticOpen) ui.setDiagnosticOpen(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.querySelector('.dock-cmd-input') as HTMLInputElement;
        input?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 't' && ui.activeTab === 'terminal') {
        e.preventDefault();
        terminal.createSession();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        ui.setActiveTab(ui.activeTab === 'terminal' ? 'dashboard' : 'terminal');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chat.chatExpanded, ui.showSettings, device.showAddDevice, ui.diagnosticOpen, ui.activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll viewport to top on tab change
  useEffect(() => {
    const viewport = document.querySelector('.content-area');
    if (viewport) viewport.scrollTo({ top: 0, behavior: 'smooth' });
  }, [ui.activeTab]);

  // Global API error routing: convert raw backend failures into
  // user-actionable guidance without changing page structure.
  useEffect(() => {
    type ApiErrorDetail = {
      status?: number;
      url?: string;
      message?: string;
      code?: string;
      retryable?: boolean;
    };

    const isEn = ui.language === 'en';
    const t = (key: string, zh: string) => translate(isEn, key, zh);
    const tf = (key: string, zh: string, vars: Record<string, string | number>) =>
      fillTemplate(t(key, zh), vars);

    const onApiError = (evt: Event) => {
      const e = evt as CustomEvent<ApiErrorDetail>;
      const detail = e.detail ?? {};
      const code = String(detail.code || '').trim();
      const message = String(detail.message || t('api.err.default', '请求失败')).trim();
      const status = Number(detail.status || 0);
      const retryable = Boolean(detail.retryable);

      const key = `${status}:${code}:${message}`;
      const now = Date.now();
      const lastSeen = apiErrorSeenRef.current[key] ?? 0;
      if (now - lastSeen < 2200) return;
      apiErrorSeenRef.current[key] = now;

      if (code === 'DEVICE_AUTH_REQUIRED') {
        toast.addToast(t('api.err.deviceAuth', '设备认证失效，请重新填写账号密码'), 'warning');
        device.setShowAddDevice(true);
        return;
      }

      /* 板端命令/SSH 超时（含 Dashboard 轮询 diagnostics 等）：离线即显示为离线即可，勿反复弹窗 */
      if (code === 'DEVICE_COMMAND_TIMEOUT') {
        return;
      }

      if (code === 'SSH_CONNECT_TIMEOUT') {
        toast.addToast(
          t(
            'api.err.sshConnectTimeout',
            'SSH 连接超时（握手未完成）：请确认设备已开机、网络可达；若本机正在大量写盘（如烧录镜像），请稍后再试。',
          ),
          'warning',
        );
        return;
      }

      if (status === 404 && (code === 'DEVICE_NOT_FOUND' || /设备不存在/.test(message))) {
        const url = String(detail.url || '');
        if (/\/api\/devices\/[^/]+\/ping$/.test(url)) {
          return;
        }
        toast.addToast('服务端没有该设备的记录，请打开设置 → 设备连接核对列表，或重新添加设备。', 'warning');
        return;
      }

      /** 旧版 cancel 曾返回 404；停止应为幂等，连接旧后端时也不弹红错 */
      if (status === 404 && /\/api\/rdkclaw\/runs\/[^/]+\/cancel(?:\?|$)/.test(String(detail.url || ''))) {
        if (/运行不存在|已结束/.test(message)) return;
      }

      if (code === 'FILE_NOT_FOUND') {
        toast.addToast(t('api.err.fileNotFound', '目标文件不存在，请刷新目录后重试'), 'info');
        return;
      }

      if (code.startsWith('INVALID_')) {
        toast.addToast(message, 'warning');
        return;
      }

      if (retryable || status === 504) {
        toast.addToast(tf('api.err.retryWrap', '{{msg}}（可重试）', { msg: message }), 'warning');
        return;
      }

      if (status >= 500) {
        toast.addToast(tf('api.err.serverWrap', '{{msg}}（服务端错误）', { msg: message }), 'error');
        return;
      }

      toast.addToast(message, 'error');
    };

    window.addEventListener('rdk-api-error', onApiError as EventListener);
    return () => window.removeEventListener('rdk-api-error', onApiError as EventListener);
  }, [device, toast, ui.language]);

  const value = useMemo<AppState>(
    () => ({
      ...toast,
      ...device,
      ...ui,
      ...terminal,
      ...chat,
    }),
    [toast, device, ui, terminal, chat],
  );

  return React.createElement(AppStateContext.Provider, { value }, children);
}

/** 入口见 `main.tsx`：须位于 `AuthProvider` 之内、`App` 之外，勿把顺序反了（DeviceProvider 依赖 useAuth）。 */
export function AppProvider({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <DeviceProvider>
        <UIProvider>
          <TerminalProvider>
            <AIChatProvider>
              <AppStateComposer>
                {children}
              </AppStateComposer>
            </AIChatProvider>
          </TerminalProvider>
        </UIProvider>
      </DeviceProvider>
    </ToastProvider>
  );
}
