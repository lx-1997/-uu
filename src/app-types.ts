export type Tab =
  | 'dashboard'
  | 'flasher'
  | 'terminal'
  | 'files'
  | 'vnc'
  | 'lowcode'
  | 'openclaw'
  | 'hardware'
  | 'examples'
  | 'ros'
  | 'models';

export interface Device {
  id: string;
  name: string;
  status: string;
  ip: string;
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

export interface ChatMessage {
  id: number;
  role: 'user' | 'ai';
  text: string;
  action?: { label: string; tab: Tab };
  blocks?: ChatBlock[];
}

export type ChatBlock =
  | { type: 'code'; lang: string; content: string }
  | { type: 'image'; src: string; caption?: string }
  | { type: 'terminal'; lines: string[] }
  | { type: 'status'; items: Array<{ label: string; value: string; ok: boolean }> };

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
