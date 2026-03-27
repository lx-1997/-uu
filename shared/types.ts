export type Role = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
}

export interface Device {
  id: string;
  host: string;
  port?: number;
  username: string;
  status: 'connected' | 'disconnected';
  lastCheckedAt: string;
  /** Normalized RDK platform id from board detect, e.g. rdk-x5 */
  boardPlatform?: string | null;
  boardModel?: string;
  boardOsVersion?: string;
  boardDetectedAt?: string;
  /** Suggested web_fetch / search entry points for this board */
  researchSeeds?: string[];
}

export interface DevicePayload {
  host: string;
  port?: number;
  username: string;
  password: string;
}

export interface OpenClawPayload {
  installCommand: string;
  configureCommand: string;
}

/**
 * Studio 界面已拉取的 OpenClaw / 通道状态，供 Agent 复用，减少重复 SSH health 与误判。
 * 由前端写入 sessionStorage，随 /api/agent/chat 一并提交。
 */
export interface StudioUiHints {
  capturedAt: number;
  /** 最近一次写入来源（调试） */
  source?: string;
  /** /api/devices/:id/openclaw/health 的快照 */
  openclaw?: {
    installed?: boolean;
    gatewayRunning?: boolean;
    aiReady?: boolean;
    version?: string;
  };
  /** /api/devices/:id/openclaw/status（OpenClaw 页顶栏） */
  gateway?: {
    running?: boolean;
    version?: string;
  };
  /** 板端网关侧飞书插件是否连上（与 Studio→飞书机器人通道不是同一概念，勿混为一谈） */
  feishuConnected?: boolean;
}