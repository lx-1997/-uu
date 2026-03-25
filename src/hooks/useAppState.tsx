import React, { createContext, useContext, useEffect, useRef } from 'react';
import type { Tab, Device, Toast, TerminalSession, TransferItem, Activity, ChatMessage, ConfirmDialogState, AgentPlan, AgentExecutionState, ChatAttachment } from '../app-types';
import { CMD_SUGGESTIONS } from '../constants';
import type { Task } from '../ai';
import type { AgentAttachmentPayload } from '../api';

import { ToastProvider, useToastStore } from './useToastStore';
import { DeviceProvider, useDeviceStore } from './useDeviceStore';
import { UIProvider, useUIStore, type ThemeMode } from './useUIStore';
import { TerminalProvider, useTerminalStore } from './useTerminalStore';
import { AIChatProvider, useAIChatStore } from './useAIChatStore';

// ---- State shape (unchanged — backward compatible) ----
export type { ThemeMode };

export interface AppState {
  // Theme
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;

  // Device
  activeDevice: string;
  setActiveDevice: (id: string) => void;
  devices: Device[];
  setDevices: React.Dispatch<React.SetStateAction<Device[]>>;
  currentDevice: Device | undefined;

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
  newDeviceName: string;
  setNewDeviceName: (v: string) => void;
  newDeviceIp: string;
  setNewDeviceIp: (v: string) => void;
  isScanning: boolean;
  scannedDevices: Array<{ name: string; ip: string }>;
  scanForDevices: () => void;
  addNewDevice: (payload?: { host: string; port?: number; username: string; password: string; name?: string }) => void;
  addScannedDevice: (dev: { name: string; ip: string }) => void;
  removeDevice: (id: string) => void;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  settingsTab: 'rdkclaw' | 'about';
  setSettingsTab: (v: 'rdkclaw' | 'about') => void;
  autoReconnect: boolean;
  setAutoReconnect: (v: boolean) => void;
  connectionTimeout: number;
  setConnectionTimeout: (v: number) => void;
  language: string;
  setLanguage: (v: string) => void;
  confirmDialog: ConfirmDialogState | null;
  setConfirmDialog: (v: ConfirmDialogState | null) => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;

  // AI Chat
  cmd: string;
  setCmd: (v: string) => void;
  showSuggestions: boolean;
  setShowSuggestions: (v: boolean) => void;
  filteredSuggestions: typeof CMD_SUGGESTIONS;
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
      attachments?: AgentAttachmentPayload[];
      displayAttachments?: ChatAttachment[];
    },
  ) => void;
  executeConfirm: (confirmId: string) => void;
  dismissConfirm: (confirmId: string) => void;
  clearChatHistory: () => void;
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
  backgroundCurrentRun: () => void;
  backgroundRuns: Array<{
    runId: string;
    status: 'running' | 'ended';
    detachedAt: number;
  }>;
  stopBackgroundRun: (runId: string) => void;
}

const AppContext = createContext<AppState | null>(null);

export function useAppState() {
  const ctx = useContext(AppContext);
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
        const input = document.querySelector('.cmd-input') as HTMLInputElement;
        input?.focus();
      }
      if (e.key === 'Escape') {
        if (chat.chatExpanded) chat.setChatExpanded(false);
        if (ui.showSettings) ui.setShowSettings(false);
        if (device.showAddDevice) device.setShowAddDevice(false);
        if (ui.diagnosticOpen) ui.setDiagnosticOpen(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.querySelector('.cmd-input') as HTMLInputElement;
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
    const viewport = document.querySelector('.canvas-viewport');
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

    const onApiError = (evt: Event) => {
      const e = evt as CustomEvent<ApiErrorDetail>;
      const detail = e.detail ?? {};
      const code = String(detail.code || '').trim();
      const message = String(detail.message || '请求失败').trim();
      const status = Number(detail.status || 0);
      const retryable = Boolean(detail.retryable);

      const key = `${status}:${code}:${message}`;
      const now = Date.now();
      const lastSeen = apiErrorSeenRef.current[key] ?? 0;
      if (now - lastSeen < 2200) return;
      apiErrorSeenRef.current[key] = now;

      if (code === 'DEVICE_AUTH_REQUIRED') {
        toast.addToast('设备认证失效，请重新填写账号密码', 'warning');
        device.setShowAddDevice(true);
        return;
      }

      if (code === 'DEVICE_COMMAND_TIMEOUT') {
        toast.addToast('设备响应超时，建议稍后重试或检查网络质量', 'warning');
        return;
      }

      if (code === 'FILE_NOT_FOUND') {
        toast.addToast('目标文件不存在，请刷新目录后重试', 'info');
        return;
      }

      if (code.startsWith('INVALID_')) {
        toast.addToast(message, 'warning');
        return;
      }

      if (retryable || status === 504) {
        toast.addToast(`${message}（可重试）`, 'warning');
        return;
      }

      if (status >= 500) {
        toast.addToast(`${message}（服务端错误）`, 'error');
        return;
      }

      toast.addToast(message, 'error');
    };

    window.addEventListener('rdk-api-error', onApiError as EventListener);
    return () => window.removeEventListener('rdk-api-error', onApiError as EventListener);
  }, [device, toast]);

  const value: AppState = {
    // Toast
    ...toast,
    // Device
    ...device,
    // UI (showConfirm from UI takes precedence over device's stub)
    ...ui,
    // Terminal
    ...terminal,
    // AI Chat
    ...chat,
  };

  return React.createElement(AppContext.Provider, { value }, children);
}

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
