/* ═══════════════════════════════════════════
   OpenClaw — Shared Type Definitions
   ═══════════════════════════════════════════ */

export interface GatewayStatus {
  running: boolean;
  version: string;
  /** 与后端 GatewayStatus.installed 一致；旧响应可能缺省，用 version 兜底 */
  installed?: boolean;
  feishuConnected: boolean;
  weixinConnected?: boolean;
}

export interface ConfigData {
  modelGateway?: {
    baseUrl: string;
    apiKey: string;
    api: string;
    modelId: string;
    modelName: string;
  };
  feishu?: {
    appId: string;
    appSecret: string;
    connectionMode?: 'websocket' | 'webhook';
    domain?: 'feishu' | 'lark';
    dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
    verificationToken?: string;
    encryptKey?: string;
  };
  runtimeModel?: {
    provider: string;
    modelId: string;
    apiKey: string;
  };
  primaryModel?: string;
  configuredProviders?: Array<{
    provider: string;
    modelId: string;
    label: string;
    hasKey: boolean;
  }>;
  pluginsAllow?: string[];
  allProviders?: Record<string, any>;
  agentDefaults?: {
    thinkingDefault?: string;
    reasoning?: string;
  };
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

export type DeployStepState = 'pending' | 'running' | 'done' | 'error';
export type DeployStepName = 'check' | 'prepare' | 'install' | 'config';
export interface DeployJob {
  id: string;
  deviceId?: string;
  status: 'running' | 'done' | 'error';
  steps: Record<DeployStepName, DeployStepState>;
  output?: string;
  error?: string;
}

export type ConfigTab = 'model' | 'feishu';
export type SetupStep = 'gateway' | 'model' | 'feishu';

export interface SetupStatus {
  gateway: 'ok' | 'warn' | 'error';
  model: 'ok' | 'warn' | 'unconfigured';
  feishu: 'ok' | 'warn' | 'unconfigured';
}

/** OpenClaw 页面的三个主阶段 */
export type OpenClawPhase = 'install' | 'chat' | 'settings';

/** 安装向导内部步骤 */
export type WizardStep = 'precheck' | 'model' | 'deploy' | 'done';

/** 预检结果 */
export interface PrecheckResult {
  network: 'checking' | 'ok' | 'fail' | 'skip';
  node: 'checking' | 'ok' | 'fail' | 'skip';
  disk: 'checking' | 'ok' | 'fail' | 'skip';
  npm: 'checking' | 'ok' | 'fail' | 'skip';
  overall: 'checking' | 'ok' | 'warn' | 'fail';
  details?: string;
}
