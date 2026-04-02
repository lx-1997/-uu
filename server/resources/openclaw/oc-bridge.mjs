#!/usr/bin/env node
/**
 * RDK Studio — OpenClaw 常驻桥（板端）
 * stdin/stdout NDJSON；维持单条 WS 到 127.0.0.1:18789。
 * RDK_OC_BRIDGE_VERSION 5 — WS 重连指数退避（对齐 Studio GatewayClient 1s→30s）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function resolveWebSocket() {
  if (typeof globalThis.WebSocket !== 'undefined') {
    return globalThis.WebSocket;
  }
  try {
    const WS = require('ws');
    return WS.WebSocket || WS;
  } catch {
    return null;
  }
}

const WebSocketImpl = resolveWebSocket();
if (!WebSocketImpl) {
  process.stdout.write(
    JSON.stringify({
      v: 1,
      type: 'fatal',
      message: 'WebSocket unavailable: Node>=22 or npm `ws` required',
    }) + '\n',
  );
  process.exit(1);
}

let token = '';
try {
  const cfgPath = path.join(process.env.HOME || '', '.openclaw/openclaw.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    token = (((cfg.gateway || {}).auth || {}).token || '').trim();
  }
} catch {}

const IDENTITY_PATH = path.join(process.env.HOME || '', '.openclaw/.rdkstudio-device.json');
let deviceIdentity;
try {
  if (fs.existsSync(IDENTITY_PATH)) {
    deviceIdentity = JSON.parse(fs.readFileSync(IDENTITY_PATH, 'utf8'));
  }
} catch {}
if (!deviceIdentity || !deviceIdentity.publicKey || !deviceIdentity.privateKey) {
  const kp = crypto.generateKeyPairSync('ed25519');
  const pubRaw = kp.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const pubB64 = Buffer.from(pubRaw).toString('base64url');
  const devId = crypto.createHash('sha256').update(pubRaw).digest('hex');
  const privPem = kp.privateKey.export({ type: 'pkcs8', format: 'pem' });
  deviceIdentity = { id: devId, publicKey: pubB64, privateKey: privPem };
  try {
    fs.mkdirSync(path.dirname(IDENTITY_PATH), { recursive: true });
    fs.writeFileSync(IDENTITY_PATH, JSON.stringify(deviceIdentity), 'utf8');
  } catch {}
}

const CLIENT_ID = 'cli';
const CLIENT_MODE = 'cli';
const ROLE = 'operator';
const SCOPES = ['operator.read', 'operator.write', 'operator.admin', 'operator.approvals', 'operator.pairing'];

function signChallenge(nonce, ts) {
  const signingToken = token || '';
  const payload = ['v2', deviceIdentity.id, CLIENT_ID, CLIENT_MODE, ROLE, SCOPES.join(','), String(ts), signingToken, nonce].join('|');
  const privKey = crypto.createPrivateKey(deviceIdentity.privateKey);
  const sig = crypto.sign(null, Buffer.from(payload), privKey);
  return {
    id: deviceIdentity.id,
    publicKey: deviceIdentity.publicKey,
    signature: Buffer.from(sig).toString('base64url'),
    signedAt: ts,
    nonce: nonce,
  };
}

function buildConnectParams(nonce, ts) {
  const params = {
    minProtocol: 3,
    maxProtocol: 3,
    client: { id: CLIENT_ID, version: '1.0.0', platform: os.platform(), mode: CLIENT_MODE },
    role: ROLE,
    scopes: SCOPES,
    device: signChallenge(nonce, ts),
    locale: 'zh-CN',
    userAgent: 'rdkstudio-oc-bridge/5',
    caps: ['agent-events', 'tool-events'],
  };
  if (token) params.auth = { token };
  return params;
}

const WS_URL = 'ws://127.0.0.1:18789';
/** 与 server/agent/gateway/client.ts GatewayClient 对齐 */
const WS_BACKOFF_MIN_MS = 1000;
const WS_BACKOFF_MAX_MS = 30000;

function emit(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + '\n');
  } catch {}
}

let wsReconnectBackoffMs = WS_BACKOFF_MIN_MS;
let wsReconnectTimer = null;
let ws = null;

function clearWsReconnectTimer() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
}

function scheduleWsReconnect() {
  clearWsReconnectTimer();
  const delay = wsReconnectBackoffMs;
  wsReconnectBackoffMs = Math.min(wsReconnectBackoffMs * 2, WS_BACKOFF_MAX_MS);
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    ws = connectWs();
  }, delay);
}
let wsConnected = false;
let bridgeReadyEmitted = false;
let onFrame = () => {};

function emitBridgeReadyOnce() {
  if (bridgeReadyEmitted) return;
  bridgeReadyEmitted = true;
  emit({ v: 1, type: 'bridge', ready: true, ws: true });
}

function handleConnectSuccess() {
  wsConnected = true;
  wsReconnectBackoffMs = WS_BACKOFF_MIN_MS;
  emitBridgeReadyOnce();
  drainInboundQueue();
}

const inboundQueue = [];

/** 须在 connectWs() / drainInboundQueue 之前初始化，避免回调极早触发时 TDZ */
let activeReqId = null;
let activeWsSendId = null;
let activeSessionKey = 'main';
let activeCorrelationId = '';
let activeStudioRunId = '';
let activeStudioSessionKey = '';
let collected = '';

function drainInboundQueue() {
  while (wsConnected && inboundQueue.length && !activeReqId) {
    const c = inboundQueue.shift();
    if (c && c.op === 'chat.send') startTurn(c);
  }
}

function connectWs() {
  clearWsReconnectTimer();
  const sock = new WebSocketImpl(WS_URL);
  const connectId = 'connect-' + Math.random().toString(16).slice(2);
  sock.onmessage = (ev) => {
    let frame;
    try {
      frame = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
    } catch {
      return;
    }
    if (!frame) return;
    if (frame.type === 'event' && frame.event === 'connect.challenge') {
      const nonce = frame.payload && frame.payload.nonce ? String(frame.payload.nonce) : '';
      const ts = frame.payload && frame.payload.ts ? Number(frame.payload.ts) : Date.now();
      sock.send(JSON.stringify({ type: 'req', id: connectId, method: 'connect', params: buildConnectParams(nonce, ts) }));
      return;
    }
    if (frame.type === 'res' && frame.id === connectId) {
      if (!frame.ok) {
        const msg = (frame.error && frame.error.message) || 'connect failed';
        emit({ v: 1, type: 'bridge', ready: false, ws: false, message: msg });
        if (activeReqId) {
          emit({ v: 1, type: 'error', code: 'CONNECT_FAILED', message: msg, reqId: activeReqId, correlationId: activeCorrelationId || undefined });
          finishTurn(false, msg);
        }
        try {
          sock.close();
        } catch {}
        /** onclose 内统一 scheduleWsReconnect，避免 backoff 双计 */
        return;
      }
      handleConnectSuccess();
      return;
    }
    onFrame(frame);
  };
  /** 失败时通常紧跟 onclose；重连只挂在 onclose，避免双重 schedule */
  sock.onerror = () => {};
  sock.onclose = () => {
    wsConnected = false;
    bridgeReadyEmitted = false;
    emit({ v: 1, type: 'bridge', ws: false, message: 'websocket closed' });
    if (activeReqId) {
      emit({ v: 1, type: 'error', code: 'WS_CLOSED', message: 'websocket closed unexpectedly', reqId: activeReqId, correlationId: activeCorrelationId || undefined });
      finishTurn(false, 'ws closed');
    }
    scheduleWsReconnect();
  };
  return sock;
}

ws = connectWs();

function gatewayCancelBestEffort() {
  if (process.env.RDK_OC_BRIDGE_GATEWAY_CANCEL === '0') return;
  if (!ws || !wsConnected || !activeWsSendId) return;
  try {
    ws.send(
      JSON.stringify({
        type: 'req',
        id: 'cancel-' + Math.random().toString(16).slice(2),
        method: 'chat.cancel',
        params: {
          sessionKey: activeSessionKey,
          requestId: activeWsSendId,
          correlationId: activeCorrelationId || undefined,
          studioRunId: activeStudioRunId || undefined,
        },
      }),
    );
  } catch (_) {}
}

function finishTurn(ok, reason) {
  const rid = activeReqId;
  if (rid == null) return;
  activeReqId = null;
  activeWsSendId = null;
  onFrame = () => {};
  emit({
    v: 1,
    type: 'done',
    ok,
    reqId: rid,
    reason: reason !== undefined ? String(reason) : undefined,
    correlationId: activeCorrelationId || undefined,
  });
  activeCorrelationId = '';
  activeStudioRunId = '';
  activeStudioSessionKey = '';
  drainInboundQueue();
}

function startTurn(cmd) {
  if (!cmd || cmd.op !== 'chat.send') return;
  if (activeReqId) {
    inboundQueue.push(cmd);
    return;
  }
  if (!wsConnected) {
    inboundQueue.push(cmd);
    return;
  }

  collected = '';
  activeReqId = cmd.reqId || 'req-unknown';
  activeSessionKey = String(cmd.sessionKey || 'main');
  activeCorrelationId = cmd.correlationId ? String(cmd.correlationId) : '';
  activeStudioRunId = cmd.runId ? String(cmd.runId) : '';
  activeStudioSessionKey = cmd.studioSessionKey ? String(cmd.studioSessionKey) : '';
  const sessionKey = activeSessionKey;
  const message = String(cmd.message || '').trim();
  const idempotencyKey = String(cmd.idempotencyKey || 'msg-' + Date.now());

  if (!message) {
    emit({ v: 1, type: 'error', code: 'EMPTY_MESSAGE', message: 'empty message', reqId: activeReqId, correlationId: activeCorrelationId || undefined });
    finishTurn(false, 'empty message');
    return;
  }

  const sendId = 'send-' + Math.random().toString(16).slice(2);
  activeWsSendId = sendId;

  onFrame = (frame) => {
    if (!activeReqId) return;
    if (frame.type === 'res') {
      if (frame.id === sendId && !frame.ok) {
        const er = frame.error || {};
        const code = (er.code && String(er.code)) || 'CHAT_SEND_FAILED';
        const msg = er.message || 'chat.send failed';
        emit({ v: 1, type: 'error', code, message: msg, reqId: activeReqId, correlationId: activeCorrelationId || undefined });
        finishTurn(false, msg);
      }
      return;
    }
    if (frame.type !== 'event') return;
    const p = frame.payload || {};
    const stream = p.stream;
    const d = p.data || {};

    if (stream === 'assistant') {
      const chunk = d.delta || d.text || p.delta || p.text || '';
      if (chunk) {
        collected += chunk;
        emit({ v: 1, type: 'assistant', text: chunk, reqId: activeReqId });
      }
      return;
    }
    if (stream === 'thinking') return;
    if (stream === 'tool') {
      const tn = d.name || d.tool || '';
      const tp = d.phase || d.status || 'call';
      const tr = d.result
        ? typeof d.result === 'string'
          ? d.result.slice(0, 400)
          : JSON.stringify(d.result).slice(0, 400)
        : '';
      emit({
        v: 1,
        type: 'tool',
        phase: String(tp),
        name: String(tn),
        detail: tr,
        reqId: activeReqId,
      });
      return;
    }
    if (stream === 'lifecycle') {
      if (d.phase === 'end' || d.phase === 'complete') {
        finishTurn(true);
        return;
      }
      if (d.phase === 'error') {
        emit({ v: 1, type: 'error', code: 'LIFECYCLE_ERROR', message: d.error || d.message || 'lifecycle error', reqId: activeReqId, correlationId: activeCorrelationId || undefined });
        finishTurn(false, d.error || 'lifecycle error');
      }
      return;
    }
    if (stream) return;

    if (p.state === 'delta' && typeof p.text === 'string') {
      collected += p.text;
      emit({ v: 1, type: 'assistant', text: p.text, reqId: activeReqId });
      return;
    }
    if (p.state === 'final') {
      const t = typeof p.text === 'string' && p.text.trim() ? p.text : collected;
      if (typeof p.text === 'string' && p.text.trim() && !collected.trim()) {
        emit({ v: 1, type: 'assistant', text: p.text, reqId: activeReqId });
      }
      finishTurn(!!String(t || '').trim());
      return;
    }
    if (p.state === 'error') {
      emit({ v: 1, type: 'error', code: 'CHAT_STATE_ERROR', message: p.error || 'chat error', reqId: activeReqId, correlationId: activeCorrelationId || undefined });
      finishTurn(false, p.error);
      return;
    }
    if (p.type === 'message_delta' && typeof p.delta === 'string') {
      collected += p.delta;
      emit({ v: 1, type: 'assistant', text: p.delta, reqId: activeReqId });
      return;
    }
    if (p.type === 'message_end') {
      const t = typeof p.text === 'string' && p.text.trim() ? p.text : collected;
      if (typeof p.text === 'string' && p.text.trim() && !collected.trim()) {
        emit({ v: 1, type: 'assistant', text: p.text, reqId: activeReqId });
      }
      finishTurn(!!String(t || '').trim());
      return;
    }
    if (p.type === 'agent_error') {
      emit({ v: 1, type: 'error', code: 'AGENT_ERROR', message: p.error || 'agent error', reqId: activeReqId, correlationId: activeCorrelationId || undefined });
      finishTurn(false, p.error);
    }
  };

  // 不向板端附带 clientMeta：旧版/严格网关会拒绝未知字段（如 unexpected property 'clientMeta'）。
  // correlation / runId 仍用于本进程 emit 与 chat.cancel，见 activeCorrelationId 等。
  const params = { sessionKey, message, idempotencyKey };

  try {
    ws.send(
      JSON.stringify({
        type: 'req',
        id: sendId,
        method: 'chat.send',
        params,
      }),
    );
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    emit({ v: 1, type: 'error', code: 'WS_SEND_EXCEPTION', message: msg, reqId: activeReqId, correlationId: activeCorrelationId || undefined });
    finishTurn(false, msg);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed) return;
  let cmd;
  try {
    cmd = JSON.parse(trimmed);
  } catch {
    emit({ v: 1, type: 'error', message: 'invalid json line' });
    return;
  }
  if (cmd.op === 'ping') {
    emit({ v: 1, type: 'pong', id: cmd.id });
    return;
  }
  if (cmd.op === 'abort') {
    if (cmd.reqId && cmd.reqId === activeReqId) {
      gatewayCancelBestEffort();
      emit({ v: 1, type: 'done', ok: false, reqId: cmd.reqId, reason: 'aborted', correlationId: activeCorrelationId || cmd.correlationId || undefined });
      activeReqId = null;
      activeWsSendId = null;
      activeCorrelationId = '';
      activeStudioRunId = '';
      activeStudioSessionKey = '';
      onFrame = () => {};
      drainInboundQueue();
    }
    return;
  }
  if (cmd.op === 'chat.send') {
    if (!wsConnected) {
      inboundQueue.push(cmd);
      return;
    }
    startTurn(cmd);
  }
});

process.stdin.on('end', () => {
  try {
    ws?.close();
  } catch {}
  process.exit(0);
});
