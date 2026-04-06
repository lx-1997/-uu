/**
 * AI Orchestrator — Type Definitions
 *
 * Core types for the intent → capability → task pipeline:
 *   1. IntentResult  — parsed from AI response
 *   2. Capability    — registered app function
 *   3. Task          — state-machine managed execution unit
 */

import type { ChatBlock, Tab } from '../app-types';

// ───── Intent ─────

/** All supported intent identifiers (kept for backward compat) */
export type IntentId =
  | 'flash'
  | 'flash_backup'
  | 'terminal'
  | 'terminal_cmd'
  | 'file_upload'
  | 'file_download'
  | 'vnc'
  | 'ide'
  | 'openclaw_start'
  | 'openclaw_status'
  | 'openclaw_switch'
  | 'hardware_check'
  | 'ros_scan'
  | 'ros_record_start'
  | 'ros_record_stop'
  | 'model_deploy'
  | 'model_list'
  | 'example_run'
  | 'workflow'
  | 'device_scan'
  | 'nav'
  | 'settings'
  | 'general';

/** Result of parsing an AI response */
export interface IntentResult {
  /** Clean display text (intent tags removed) */
  text: string;
  /** Detected intent */
  intent: IntentId;
  /** Optional parameter extracted from [[intent:xxx|param]] */
  param?: string;
}

// ───── Skill-based parsing (new) ─────

export type ParsedTag =
  | { type: 'skill'; skill: string; action: string; params?: Record<string, unknown> }
  | { type: 'action'; actionType: string; target?: string }
  | { type: 'confirm'; skill: string; action: string; params?: Record<string, unknown> }
  | { type: 'legacy'; intent: IntentId; param?: string }
  | { type: 'none' };

export interface ParsedAIResult {
  text: string;
  tag: ParsedTag;
}

// ───── Capability ─────

/** Lifecycle phase — determines if user confirmation is needed */
export type CapabilityPhase = 'immediate' | 'confirm' | 'background';

/** Describes one thing the app can do */
export interface Capability {
  /** Matches IntentId */
  id: IntentId;
  /** Human-readable name (CN) */
  label: string;
  /** Brief description of what this does */
  description: string;
  /** What kind of execution this involves */
  phase: CapabilityPhase;
  /** Keywords for keyword-fallback matching */
  keywords: string[];
  /** Navigation target if the capability opens a tab */
  tab?: Tab;
}

// ───── Task (state machine) ─────

export type TaskStatus = 'pending' | 'confirming' | 'running' | 'done' | 'failed' | 'cancelled';

export interface TaskStep {
  label: string;
  status: 'done' | 'running' | 'pending';
}

/** A single execution unit tracked by the state machine */
export interface Task {
  id: string;
  /** Which capability this task exercises */
  capabilityId: IntentId;
  /** Current state */
  status: TaskStatus;
  /** Progress steps (shown in chat) */
  steps: TaskStep[];
  /** Parameter passed from intent (e.g. command text, model name) */
  param?: string;
  /** Confirmation ID (if phase === 'confirm') */
  confirmId?: string;
  /** Result summary (filled when done) */
  result?: { success: boolean; title: string; detail: string };
  /** Timestamp */
  createdAt: number;
}

// ───── Orchestrator I/O ─────

/** What the orchestrator returns after processing one user command */
export interface OrchestratorOutput {
  /** AI text to display */
  text: string;
  /** Rich blocks to render in chat */
  blocks?: ChatBlock[];
  /** Side effect to run (real app action) — called after rendering */
  sideEffect?: () => void;
  /** Task created (if any) — for status tracking */
  task?: Task;
}

// ───── App Action Bridge ─────

/**
 * Functions that the AI orchestrator can call on the app.
 * Provided by useAppState — keeps the AI module decoupled from React state.
 */
export interface AppActions {
  // Navigation
  openWorkspace: (tab: Tab, message: string) => void;
  setActiveTab: (tab: Tab) => void;

  // Flash
  startFlash: () => void;

  // Terminal
  createSession: () => void;
  runTerminalCommand: (cmd: string) => void;

  // Files
  appendTransferTask: () => void;

  // VNC
  startVncSession: () => void;

  // Lowcode
  runFlowValidation: () => void;

  // Hardware
  setDiagnosticOpen: (v: boolean) => void;
  setDiagnosticStep: (v: number) => void;

  // ROS
  setRosRecording: (v: boolean) => void;

  // Devices
  scanForDevices: () => void;

  // OpenClaw board-side actions
  openClawStartOnBoard: () => Promise<{ ok: boolean; output?: string; error?: string }>;
  openClawStatusOnBoard: () => Promise<{ ok: boolean; output?: string; error?: string }>;
  openClawSwitchOnBoard: (modelName: string) => Promise<{ ok: boolean; output?: string; error?: string }>;

  // Settings
  setShowSettings: (v: boolean) => void;

  // Toast / Activity
  addToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  addActivity: (text: string) => void;

  // Current device info (read-only snapshot)
  currentDeviceName: string;
  currentDeviceIp: string;
  currentDeviceId: string;
}
