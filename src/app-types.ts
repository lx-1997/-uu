export type Tab =
  | 'dashboard'
  | 'flasher'
  | 'terminal'
  | 'files'
  | 'vnc'
  | 'ide'
  | 'openclaw'
  | 'hardware'
  | 'skills';

export interface Device {
  id: string;
  name: string;
  status: string;
  ip: string;
  port?: number;
  description?: string;
  /**
   * 本机是否至少成功完成过一次 SSH 可达验证（添加设备成功或 ping 成功）。
   * 未验证前 UI 一律不显示「在线」，避免刚进应用就沿用服务端/缓存的误判。
   */
  sshSessionVerified?: boolean;
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
  /** 默认 ssh；usb 为浏览器 Web Serial，不经服务器 */
  transport?: 'ssh' | 'serial';
  /** 串口会话的波特率（仅 transport=serial 时使用） */
  baudRate?: number;
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
  /** 模型扩展思考（reasoning / thinking_delta 流式合并） */
  | { type: 'reasoning'; text: string; collapsible?: boolean; defaultCollapsed?: boolean; summary?: string }
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
  /** 危险操作（删除等）：强调色与主按钮样式 */
  variant?: 'default' | 'danger';
  /** 主按钮文案，默认「确认执行」 */
  confirmLabel?: string;
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
