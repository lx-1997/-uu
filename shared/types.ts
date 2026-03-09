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
  username: string;
  status: 'connected' | 'disconnected';
  lastCheckedAt: string;
}

export interface DevicePayload {
  host: string;
  username: string;
  password: string;
}

export interface OpenClawPayload {
  installCommand: string;
  configureCommand: string;
}