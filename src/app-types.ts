export type Tab =
  | 'dashboard'
  | 'flasher'
  | 'terminal'
  | 'files'
  | 'vnc'
  | 'ide'
  | 'lowcode'
  | 'openclaw'
  | 'hardware'
  | 'examples'
  | 'ros'
  | 'models'
  | 'skills';

export interface Device {
  id: string;
  name: string;
  status: string;
  ip: string;
  port?: number;
  description?: string;
}

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
}

export interface TerminalSession {
  id: string;
  name: string;
  profile: string;
  status: string;
  lines: string[];
}

export interface TransferItem {
  id: string;
  name: string;
  direction: string;
  progress: number;
  status: string;
}

export interface Activity {
  id: number;
  text: string;
  time: string;
}

export interface ChatAttachment {
  id: string;
  type: 'image' | 'file' | 'audio' | 'video';
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
  duration?: number;
  thumbnailUrl?: string;
  transcript?: string;
  textContent?: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'ai';
  text: string;
  source?: 'studio' | 'feishu';
  channelMeta?: {
    channel: 'feishu';
    direction?: 'inbound' | 'ack' | 'outbound' | 'error';
    openIdMasked?: string;
    chatId?: string;
    messageId?: string;
  };
  action?: { label: string; tab: Tab };
  blocks?: ChatBlock[];
  attachments?: ChatAttachment[];
}

export type ChatBlock =
  | { type: 'code'; lang: string; content: string }
  | { type: 'image'; src: string; caption?: string }
  | { type: 'video'; src: string; caption?: string }
  | { type: 'file'; src: string; fileName: string; caption?: string }
  | { type: 'terminal'; lines: string[]; label?: string; collapsible?: boolean; previewLines?: number }
  /** RDKClaw ↔ 板端 OpenClaw 协作：区分双方输出；outbound=发给板端，hint=结果中的 RDKClaw 说明 */
  | { type: 'collab'; side: 'openclaw' | 'rdkclaw'; collabRole?: 'outbound' | 'hint' | 'reverse' | 'wait_hint'; title?: string; subtitle?: string; lines: string[]; collapsible?: boolean; previewLines?: number }
  | { type: 'status'; items: Array<{ label: string; value: string; ok: boolean }>; collapsible?: boolean; defaultCollapsed?: boolean; summary?: string }
  | { type: 'confirm'; text: string; confirmId: string }
  | { type: 'approval'; text: string; approvalId: string; runId?: string; risk?: 'low' | 'medium' | 'high'; executor?: string }
  | { type: 'progress'; steps: Array<{ label: string; status: 'done' | 'running' | 'pending' }>; taskId?: string }
  | { type: 'task-result'; success: boolean; title: string; detail: string }
  | { type: 'recommendation'; recommendationId: string; runId?: string; question: string; options: Array<{ id: string; label: string; description: string; recommended?: boolean }>; allowAutoExecute?: boolean; chosen?: string }
  | { type: 'soul-update'; proposalId: string; section: string; action: 'add' | 'modify' | 'remove'; content: string; reason: string; currentSnippet?: string; accepted?: boolean | null };

export interface DashboardCard {
  tab: Tab;
  title: string;
  description: string;
  loading: string;
  statusLabel: string;
  statusOk: boolean;
  miniStats: Array<{ label: string; value: string }>;
  cta: string;
  quickActions: Array<{ label: string; icon: string }>;
}

export interface ConfirmDialogState {
  show: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

export interface AgentPlanStep {
  title: string;
  intent: string;
  param?: string;
  reason: string;
}

export interface AgentPlan {
  summary: string;
  steps: AgentPlanStep[];
  risk: string;
  done: string;
}

export interface AgentExecutionState {
  running: boolean;
  currentStep: number;
  totalSteps: number;
  lastError?: string;
}
