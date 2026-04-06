/**
 * Gateway RPC 方法实现
 *
 * 对齐 OpenClaw:
 * - server-methods/connect.ts → connect 握手验证
 * - server-methods/chat.ts → chat.send / chat.history
 * - server-methods/sessions.ts → sessions.list / sessions.reset
 * - server-methods/health.ts → health
 *
 * Handler 签名对齐 openclaw GatewayRequestHandler:
 *   (params, client, ctx) → { ok, payload?, error? }
 */

import { timingSafeEqual } from "node:crypto";
import type { Agent } from "../agent.js";
import type { MiniAgentEvent } from "../agent-events.js";
import {
  ErrorCodes, errorShape,
  PROTOCOL_VERSION, GATEWAY_METHODS, GATEWAY_EVENTS,
  TICK_INTERVAL_MS, MAX_PAYLOAD_BYTES,
  type HelloOk, type ErrorShape,
} from "./protocol.js";
import {
  getGatewayChatDeltaProfile,
  normalizeStreamChannel,
} from "../../streaming-by-channel.js";

// ============== 类型 ==============

export type GwClient = {
  id: string;
  socket: { send: (data: string) => void; close: (code?: number, reason?: string) => void; bufferedAmount: number };
  authed: boolean;
};

export type BroadcastFn = (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;

export type HandlerContext = {
  agent: Agent;
  broadcast: BroadcastFn;
  clients: Set<GwClient>;
  token?: string;
  nonces: Map<string, string>;
  startedAt: number;
};

export type HandlerResult = { ok: boolean; payload?: unknown; error?: ErrorShape };
export type Handler = (params: unknown, client: GwClient, ctx: HandlerContext) => Promise<HandlerResult>;

/** 每会话当前活跃的 chat.send → agent runId（用于 chat.cancel / turn 级中止） */
const chatTurnRunIdBySession = new Map<string, string>();

// ============== 安全工具（对齐 openclaw auth.ts safeEqual） ==============

/** 防计时攻击的字符串比较 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ============== connect ==============

const handleConnect: Handler = async (params, client, ctx) => {
  const p = params as {
    token?: string;
    nonce?: string;
    auth?: { token?: string };
    device?: { nonce?: string; id?: string };
    minProtocol?: number;
    maxProtocol?: number;
    client?: { id?: string; version?: string; platform?: string; mode?: string };
    role?: string;
    scopes?: string[];
  } | undefined;

  const authToken = p?.auth?.token || p?.token || '';
  const challengeNonce = p?.device?.nonce || p?.nonce || '';

  if (ctx.token) {
    if (!authToken || !safeEqual(authToken, ctx.token)) {
      return { ok: false, error: errorShape(ErrorCodes.UNAUTHORIZED, "invalid token") };
    }
  }

  const expectedNonce = ctx.nonces.get(client.id);
  if (expectedNonce && challengeNonce !== expectedNonce) {
    return { ok: false, error: errorShape(ErrorCodes.UNAUTHORIZED, "nonce mismatch") };
  }
  ctx.nonces.delete(client.id);

  client.authed = true;

  const hello: HelloOk = {
    protocol: PROTOCOL_VERSION,
    methods: [...GATEWAY_METHODS],
    events: [...GATEWAY_EVENTS],
    policy: { tickIntervalMs: TICK_INTERVAL_MS, maxPayloadBytes: MAX_PAYLOAD_BYTES },
  };
  return { ok: true, payload: hello };
};

// ============== chat.send ==============

/**
 * 对齐 openclaw server-methods/chat.ts:
 * 1. 立即返回 { runId } (ACK)
 * 2. 异步执行 agent.run()
 * 3. agent 事件流 → broadcast("agent") + broadcast("chat" delta/final)
 */
const handleChatSend: Handler = async (params, _client, ctx) => {
  const p = params as {
    sessionKey?: string;
    message?: string;
    idempotencyKey?: string;
    /** 来源渠道：套件端网关可传 openclaw / studio，用于 delta 节奏 */
    channel?: string;
    clientMeta?: {
      correlationId?: string;
      studioRunId?: string;
      studioSessionKey?: string;
      channel?: string;
    };
  } | undefined;
  if (!p?.message) {
    return { ok: false, error: errorShape(ErrorCodes.INVALID_REQUEST, "message required") };
  }
  const sessionKey = p.sessionKey || "main";
  const streamCh = normalizeStreamChannel(p.channel || p.clientMeta?.channel);
  const { throttleMs: DELTA_THROTTLE_MS, charFlush: DELTA_CHAR_FLUSH } =
    getGatewayChatDeltaProfile(streamCh);

  // 追踪 agent 内部的 runId（通过 agent_start 事件获取）
  let agentRunId: string | undefined;

  // Delta 限流（对齐 openclaw，并增强首包与累计字符_flush；参数按渠道在 streaming-by-channel 调优）
  let deltaBuffer = "";
  let lastDeltaSentAt = 0;
  let lastDeltaSentLen = 0;
  let firstDeltaFlushed = false;

  // 异步执行，不阻塞响应（对齐 openclaw chat.send 的 ACK-then-stream 模式）
  const unsub = ctx.agent.subscribe((event: MiniAgentEvent) => {
    // 捕获 agent 内部 runId，用于后续事件关联
    if (event.type === "agent_start" && event.sessionKey === sessionKey) {
      agentRunId = event.runId;
      chatTurnRunIdBySession.set(sessionKey, event.runId);
    }

    // 仅转发属于本次 run 的事件（按 sessionKey 过滤，避免并发混杂）
    const eventRunId = "runId" in event ? (event as { runId: string }).runId : undefined;
    if (eventRunId && eventRunId !== agentRunId) return;

    // 桥接 agent 事件 → gateway 广播（附带 trace 便于套件端/VPN 弱网下排障）
    ctx.broadcast("agent", {
      ...event,
      sessionKey,
      streamChannel: streamCh,
    });

    // 转换为 chat delta/final（对齐 openclaw emitChatDelta / emitChatFinal）
    if (event.type === "message_delta") {
      deltaBuffer += event.delta;
      const now = Date.now();
      const pendingChars = deltaBuffer.length - lastDeltaSentLen;
      const dueTime = lastDeltaSentAt === 0 || now - lastDeltaSentAt >= DELTA_THROTTLE_MS;
      const dueBulk = pendingChars >= DELTA_CHAR_FLUSH;
      const dueFirst = !firstDeltaFlushed && pendingChars > 0;
      if (pendingChars > 0 && (dueFirst || dueTime || dueBulk)) {
        firstDeltaFlushed = true;
        lastDeltaSentAt = now;
        const newText = deltaBuffer.slice(lastDeltaSentLen);
        lastDeltaSentLen = deltaBuffer.length;
        ctx.broadcast(
          "chat",
          { runId: agentRunId, sessionKey, state: "delta", text: newText, streamChannel: streamCh },
          { dropIfSlow: true },
        );
      }
    } else if (event.type === "message_end") {
      deltaBuffer = "";
      lastDeltaSentLen = 0;
      lastDeltaSentAt = 0;
      firstDeltaFlushed = false;
      ctx.broadcast("chat", {
        runId: agentRunId,
        sessionKey,
        state: "final",
        text: event.text,
        streamChannel: streamCh,
      });
    } else if (event.type === "agent_error") {
      ctx.broadcast("chat", {
        runId: agentRunId,
        sessionKey,
        state: "error",
        error: event.error,
        streamChannel: streamCh,
      });
    }
  });

  ctx.agent.run(sessionKey, p.message)
    .catch((err) => {
      // 广播运行时错误，确保客户端能收到错误通知
      ctx.broadcast("chat", {
        runId: agentRunId,
        sessionKey,
        state: "error",
        error: String(err),
        streamChannel: streamCh,
      });
    })
    .finally(() => {
      unsub();
      const rid = agentRunId;
      if (rid && chatTurnRunIdBySession.get(sessionKey) === rid) {
        chatTurnRunIdBySession.delete(sessionKey);
      }
    });

  return {
    ok: true,
    payload: {
      sessionKey,
      clientMeta: p.clientMeta,
      idempotencyKey: p.idempotencyKey,
    },
  };
};

// ============== chat.cancel（turn 级取消，对齐 Studio/oc-bridge 尽力调用） ==============

const handleChatCancel: Handler = async (params, _client, ctx) => {
  const p = params as {
    sessionKey?: string;
    requestId?: string;
    correlationId?: string;
  } | undefined;
  const sessionKey = p?.sessionKey || "main";
  const runId = chatTurnRunIdBySession.get(sessionKey);
  if (!runId) {
    return { ok: false, error: errorShape(ErrorCodes.NO_ACTIVE_TURN, "no active chat turn for session") };
  }
  ctx.agent.abort(runId);
  if (chatTurnRunIdBySession.get(sessionKey) === runId) {
    chatTurnRunIdBySession.delete(sessionKey);
  }
  return {
    ok: true,
    payload: {
      sessionKey,
      runId,
      requestId: p?.requestId,
      correlationId: p?.correlationId,
    },
  };
};

// ============== chat.history ==============

const handleChatHistory: Handler = async (params, _client, ctx) => {
  const p = params as { sessionKey?: string } | undefined;
  const sessionKey = p?.sessionKey || "main";
  const messages = ctx.agent.getHistory(sessionKey);
  return { ok: true, payload: { sessionKey, messages } };
};

// ============== sessions.list ==============

const handleSessionsList: Handler = async (_params, _client, ctx) => {
  const sessions = await ctx.agent.listSessions();
  return { ok: true, payload: { sessions } };
};

// ============== sessions.reset ==============

const handleSessionsReset: Handler = async (params, _client, ctx) => {
  const p = params as { sessionKey?: string } | undefined;
  const sessionKey = p?.sessionKey || "main";
  await ctx.agent.reset(sessionKey);
  return { ok: true, payload: { sessionKey } };
};

// ============== health ==============

const handleHealth: Handler = async (_params, _client, ctx) => {
  return {
    ok: true,
    payload: {
      uptimeMs: Date.now() - ctx.startedAt,
      clients: ctx.clients.size,
      authedClients: [...ctx.clients].filter((c) => c.authed).length,
    },
  };
};

// ============== 方法注册表 ==============

export const handlers: Record<string, Handler> = {
  "connect": handleConnect,
  "chat.send": handleChatSend,
  "chat.cancel": handleChatCancel,
  "chat.history": handleChatHistory,
  "sessions.list": handleSessionsList,
  "sessions.reset": handleSessionsReset,
  "health": handleHealth,
};
