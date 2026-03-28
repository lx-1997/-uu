#!/usr/bin/env node
/**
 * RDK Studio — OpenClaw 常驻桥（板端）
 * stdin/stdout NDJSON；维持单条 WS 到 127.0.0.1:18789。
 * RDK_OC_BRIDGE_VERSION 3
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
    userAgent: 'rdkstudio-oc-bridge/3',
    caps: ['agent-events', 'tool-events'],
  };
  if (token) params.auth = { token };
  return params;
}

const WS_URL = 'ws://127.0.0.1:18789';
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

function emit(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + '\n');
  } catch {}
}

let wsRetries = 0;
let ws = null;
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
  wsRetries = 0;
  emitBridgeReadyOnce();
  drainInboundQueue();
}

const inboundQueue = [];

function drainInboundQueue() {
  while (wsConnected && inboundQueue.length && !activeReqId) {
    const c = inboundQueue.shift();
    if (c && c.op === 'chat.send') startTurn(c);
  }
}

function connectWs() {
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
          emit({ v: 1, type: 'error', message: msg, reqId: activeReqId });
          finishTurn(false, msg);
        }
        return;
      }
      handleConnectSuccess();
      return;
    }
    onFrame(frame);
  };
  sock.onerror = () => {
    if (wsConnected) return;
    if (wsRetries < MAX_RETRIES) {
      wsRetries++;
      setTimeout(() => {
        ws = connectWs();
      }, RETRY_DELAY);
    } else {
      const msg = 'websocket connect failed after ' + MAX_RETRIES + ' retries (127.0.0.1:18789)';
      emit({ v: 1, type: 'bridge', ready: false, ws: false, message: msg });
      if (activeReqId) {
        emit({ v: 1, type: 'error', message: msg, reqId: activeReqId });
        finishTurn(false, msg);
      }
    }
  };
  sock.onclose = () => {
    wsConnected = false;
    bridgeReadyEmitted = false;
    emit({ v: 1, type: 'bridge', ws: false, message: 'websocket closed' });
    if (activeReqId) {
      emit({ v: 1, type: 'error', message: 'websocket closed unexpectedly', reqId: activeReqId });
      finishTurn(false, 'ws closed');
    }
    setTimeout(() => {
      wsRetries = 0;
      ws = connectWs();
    }, RETRY_DELAY);
  };
  return sock;
}

ws = connectWs();

let activeReqId = null;
let collected = '';

function finishTurn(ok, reason) {
  const rid = activeReqId;
  if (rid == null) return;
  activeReqId = null;
  onFrame = () => {};
  emit({ v: 1, type: 'done', ok, reqId: rid, reason: reason !== undefined ? String(reason) : undefined });
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
  const sessionKey = String(cmd.sessionKey || 'main');
  const message = String(cmd.message || '').trim();
  const idempotencyKey = String(cmd.idempotencyKey || 'msg-' + Date.now());

  if (!message) {
    emit({ v: 1, type: 'error', message: 'empty message', reqId: activeReqId });
    finishTurn(false, 'empty message');
    return;
  }

  const sendId = 'send-' + Math.random().toString(16).slice(2);

  onFrame = (frame) => {
    if (!activeReqId) return;
    if (frame.type === 'res') {
      if (frame.id === sendId && !frame.ok) {
        const msg = (frame.error && frame.error.message) || 'chat.send failed';
        emit({ v: 1, type: 'error', message: msg, reqId: activeReqId });
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
        emit({ v: 1, type: 'error', message: d.error || d.message || 'lifecycle error', reqId: activeReqId });
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
      emit({ v: 1, type: 'error', message: p.error || 'chat error', reqId: activeReqId });
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
      emit({ v: 1, type: 'error', message: p.error || 'agent error', reqId: activeReqId });
      finishTurn(false, p.error);
    }
  };

  try {
    ws.send(
      JSON.stringify({
        type: 'req',
        id: sendId,
        method: 'chat.send',
        params: { sessionKey, message, idempotencyKey },
      }),
    );
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    emit({ v: 1, type: 'error', message: msg, reqId: activeReqId });
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
      emit({ v: 1, type: 'done', ok: false, reqId: cmd.reqId, reason: 'aborted' });
      activeReqId = null;
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
