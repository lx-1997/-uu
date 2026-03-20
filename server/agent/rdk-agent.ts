/**
 * RDK Studio Agent — 轻量版 Agent 入口
 *
 * 替代 openclaw-mini 的 agent.ts（710行），只保留核心功能：
 * - 构建 system prompt（从 TOOLS.md + SKILLS.md + SOUL.md）
 * - 创建 session
 * - 调用 runAgentLoop
 * - 事件分发
 *
 * 去掉: memory、heartbeat、skills manager、subagent、command-queue
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { runAgentLoop, type AgentLoopParams } from './agent-loop.js';
import { SessionManager, type Message } from './session.js';
import type { MiniAgentEvent, MiniAgentResult } from './agent-events.js';
import type { Tool, ToolContext } from './tools/types.js';
import type { EventStream } from '@mariozechner/pi-ai';
import {
  buildModelDef,
  buildStreamFn,
  getApiKey,
  getBaseUrl,
  loadProviderConfig,
  type ProviderConfig,
} from './provider-setup.js';
import { createRdkTools } from './tools/rdk-tools.js';

const AGENT_DIR = path.join(process.cwd(), 'agent');
const SESSION_DIR = path.join(os.homedir(), '.rdkstudio', 'sessions');

function readAgentFile(filename: string): string {
  const filePath = path.join(AGENT_DIR, filename);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function buildSystemPrompt(): string {
  const soul = readAgentFile('SOUL.md');
  const tools = readAgentFile('TOOLS.md');
  const skills = readAgentFile('SKILLS.md');

  const parts = [soul, tools, skills].filter(Boolean);
  return parts.join('\n\n---\n\n');
}

export interface RdkAgentRunOptions {
  message: string;
  deviceId?: string;
  sessionId?: string;
  providerConfig?: ProviderConfig;
}

export interface RdkAgentRunResult {
  stream: EventStream<MiniAgentEvent, MiniAgentResult>;
  runId: string;
  sessionKey: string;
}

/**
 * 运行 RDK Agent
 *
 * 先完成 session 初始化（加载历史 + 追加用户消息），
 * 再启动 agent loop，避免竞态导致 LLM 收到空上下文。
 */
export async function runRdkAgent(options: RdkAgentRunOptions): Promise<RdkAgentRunResult> {
  const config = options.providerConfig || loadProviderConfig();
  if (!config || !config.apiKey) {
    throw new Error('未配置 AI 模型。请在设置页面配置 Provider 和 API Key。');
  }

  const runId = crypto.randomUUID();
  const sessionKey = options.sessionId || `rdk-chat-${Date.now()}`;

  const sessionManager = new SessionManager(SESSION_DIR);

  const modelDef = buildModelDef(config);
  const streamFn = buildStreamFn(config);
  const apiKey = getApiKey(config);
  const baseUrl = getBaseUrl(config);

  console.log('[RDK-Agent] baseUrl:', baseUrl, 'model:', modelDef.id, 'modelBaseUrl:', (modelDef as any).baseUrl);

  // Set env vars before any LLM call
  process.env.OPENAI_BASE_URL = baseUrl;
  process.env.OPENAI_API_KEY = apiKey;

  const tools: Tool[] = [];
  if (options.deviceId) {
    tools.push(...createRdkTools(options.deviceId));
  }

  const systemPrompt = buildSystemPrompt();

  const toolCtx: ToolContext = {
    workspaceDir: process.cwd(),
    sessionKey,
    agentId: 'rdk-studio',
    abortSignal: AbortSignal.timeout(120_000),
  };

  const userMessage: Message = {
    role: 'user',
    content: options.message,
    timestamp: Date.now(),
  };

  // Load session history and append user message BEFORE starting the loop
  const history = await sessionManager.load(sessionKey);
  const currentMessages: Message[] = [...history, userMessage];
  await sessionManager.append(sessionKey, userMessage);

  const loopParams: AgentLoopParams = {
    runId,
    sessionKey,
    agentId: 'rdk-studio',
    currentMessages,
    compactionSummary: undefined,
    systemPrompt,
    toolsForRun: tools,
    toolCtx,
    modelDef,
    streamFn,
    apiKey,
    temperature: 0.7,
    maxTurns: 10,
    contextTokens: modelDef.contextWindow ?? 128000,

    async getSteeringMessages() {
      return [];
    },

    async appendMessage(_sk: string, msg: Message) {
      await sessionManager.append(sessionKey, msg);
    },

    async prepareCompaction() {
      return {};
    },

    abortSignal: AbortSignal.timeout(120_000),
  };

  const stream = runAgentLoop(loopParams);

  return { stream, runId, sessionKey };
}
