export type Tab =
  | 'dashboard'
  /** 桌面 / Web：RDKClaw 会话与完整本地历史 */
  | 'ai-chat-hub'
  | 'flasher'
  | 'terminal'
  | 'files'
  | 'vnc'
  | 'ide'
  | 'openclaw'
  | 'hardware'
  | 'skills'
  /** 桌面端：forum / RoboGo 内嵌 WebContentsView（与 VNC/IDE 同区域） */
  | 'dr-embed'
  /** 本地模型 / Ollama（可由 STUDIO_SHOW_LOCAL_OLLAMA_NAV 关闭；旧会话可能仍存此值） */
  | 'local-models';

export type DrAuthenticatedPortalKind = 'forum' | 'robogo';

export interface DrAuthenticatedPortal {
  /** viewsMap 主键，须稳定（无 query） */
  mapUrl: string;
  loadUrl: string;
  token: string;
  kind: DrAuthenticatedPortalKind;
}

export interface Device {
  id: string;
  name: string;
  status: string;
  ip: string;
  port?: number;
  /** SSH 登录名（与 GET /api/devices 的 username 一致；老缓存可能没有） */
  sshUsername?: string;
  description?: string;
  /** 与 POST /board/detect?persist=1 写入的板型一致，如 rdk-x5 */
  boardPlatform?: string | null;
  boardModel?: string | null;
  /**
   * 本机是否至少成功完成过一次 SSH 可达验证（添加设备成功或 ping 成功）。
   * 未验证前 UI 一律不显示「在线」，避免刚进应用就沿用服务端/缓存的误判。
   */
  sshSessionVerified?: boolean;
  lanSshHost?: string;
  lanSshPort?: number;
  frpRemotePort?: number;
  sshReachability?: 'direct' | 'tunnel';
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

/** Studio Agent SSE：正文与工具块按到达顺序交错，避免「整块工具在上、总结在下」的割裂感 */
export type AiDockContentSlot =
  | { kind: 'markdown'; text: string }
  | { kind: 'block'; index: number };

export interface ChatMessage {
  id: number;
  role: 'user' | 'ai';
  /** AI 气泡：本条回复自用户发出到生成结束所耗时间（ms），用于展示「用时」 */
  durationMs?: number;
  /** 部分场景（如飞书工具流）用于计算耗时：本条 AI 气泡开始展示时的时间戳 */
  startedAt?: number;
  text: string;
  /** 存在时 AI Dock 按此顺序自上而下渲染；缺省时回退为 blocks 再 text */
  contentSlots?: AiDockContentSlot[];
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
  | {
      type: 'terminal';
      lines: string[];
      label?: string;
      collapsible?: boolean;
      previewLines?: number;
      toolName?: string;
      executor?: string;
      status?: 'running' | 'success' | 'error';
      startedAt?: number;
      endedAt?: number;
      canMoveBackground?: boolean;
      canStop?: boolean;
    }
  /** RDKClaw ↔ 套件端 OpenClaw 协作：区分双方输出；outbound=发给套件端，hint=结果中的 RDKClaw 说明 */
  | { type: 'collab'; side: 'openclaw' | 'rdkclaw'; collabRole?: 'outbound' | 'hint' | 'reverse' | 'wait_hint'; title?: string; subtitle?: string; lines: string[]; collapsible?: boolean; previewLines?: number }
  | { type: 'status'; items: Array<{ label: string; value: string; ok: boolean }>; title?: string; collapsible?: boolean; defaultCollapsed?: boolean; summary?: string }
  /** 模型扩展思考（reasoning / thinking_delta 流式合并） */
  | { type: 'reasoning'; text: string; collapsible?: boolean; defaultCollapsed?: boolean; summary?: string }
  | { type: 'confirm'; text: string; confirmId: string }
  | { type: 'approval'; text: string; approvalId: string; runId?: string; risk?: 'low' | 'medium' | 'high'; executor?: string }
  | { type: 'progress'; steps: Array<{ label: string; status: 'done' | 'running' | 'pending' }>; taskId?: string }
  | { type: 'task-result'; success: boolean; title: string; detail: string }
  /** 单条消息内推理触顶：提供显式按钮发送续跑指令 */
  | { type: 'continue-run'; stopReason: 'max_turns_reached' | 'tool_followup_cap_reached'; hint?: string }
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
  /** 仅展示主按钮（用于提示类弹窗，避免「取消」语义不当） */
  hideCancel?: boolean;
  /** 取消、点遮罩或关闭时调用（不随确认执行） */
  onDismiss?: () => void;
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
