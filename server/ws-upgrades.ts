import type http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import * as net from 'node:net';
import type { Device } from '../shared/types.js';
import { readDevices } from './storage.js';
import { getSessionSsoUserFromIncomingMessage, isSSORequired } from './sso.js';
import { DEFAULT_VNC_PORT } from './constants.js';

const ROSBRIDGE_DEVICE_PORT = 9090;

export function isPrivateIp(ip: string): boolean {
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|localhost$)/.test(ip);
}

export async function handleRosbridgeProxy(clientWs: WebSocket, req: http.IncomingMessage) {
  if (isSSORequired()) {
    const user = getSessionSsoUserFromIncomingMessage(req);
    if (!user) {
      clientWs.close(1008, 'unauthorized');
      return;
    }
  }
  const u = new URL(req.url || '', 'http://localhost');
  const deviceId = u.searchParams.get('deviceId')?.trim();
  if (!deviceId) {
    clientWs.close(1008, 'missing deviceId');
    return;
  }
  let devices: Device[];
  try {
    devices = await readDevices();
  } catch (err) {
    console.warn('[rosbridge-ws] readDevices failed:', err instanceof Error ? err.message : err);
    clientWs.close(1011, 'server error');
    return;
  }
  const device = devices.find(d => d.id === deviceId);
  if (!device) {
    clientWs.close(1008, 'device not found');
    return;
  }
  const host = device.host;
  const targetUrl = `ws://${host}:${ROSBRIDGE_DEVICE_PORT}/`;
  const upstream = new WebSocket(targetUrl);

  const pending: Buffer[] = [];
  const pendingBinary: boolean[] = [];

  clientWs.on('message', (data, isBinary) => {
    const bin = !!isBinary;
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: bin });
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      pending.push(Buffer.from(data as Buffer));
      pendingBinary.push(bin);
    }
  });

  upstream.on('open', () => {
    for (let i = 0; i < pending.length; i++) {
      upstream.send(pending[i], { binary: pendingBinary[i] });
    }
    pending.length = 0;
    pendingBinary.length = 0;
  });

  upstream.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: !!isBinary });
    }
  });

  upstream.on('error', (err) => {
    console.warn('[rosbridge-ws] upstream error:', err instanceof Error ? err.message : err);
    try { clientWs.close(); } catch { /* noop */ }
    try { upstream.close(); } catch { /* noop */ }
  });
  clientWs.on('error', () => {
    try { upstream.close(); } catch { /* noop */ }
  });
  upstream.on('close', () => {
    try { clientWs.close(); } catch { /* noop */ }
  });
  clientWs.on('close', () => {
    try { upstream.close(); } catch { /* noop */ }
  });
}

/**
 * 必须在 Engine.IO 的 upgrade 监听之前处理自定义路径，否则 engine 会先对非 /socket.io 路径
 * 安排 destroyUpgrade 定时器，与后续 handleUpgrade 竞态可能导致异常或连接被 RST。
 * prependListener 保证先于 socket.io 已注册的监听器执行。
 */
export function attachCustomHttpUpgrades(
  httpServer: http.Server,
  rosbridgeWss: WebSocketServer,
  wss: WebSocketServer,
): void {
  httpServer.prependListener('upgrade', (request, socket, head) => {
    const url = request.url || '';
    try {
      if (url.startsWith('/api/rosbridge-ws')) {
        rosbridgeWss.handleUpgrade(request, socket, head, (ws) => {
          void handleRosbridgeProxy(ws, request).catch((err) => {
            console.warn('[rosbridge-ws] proxy error:', err instanceof Error ? err.message : err);
            try { ws.close(); } catch { /* noop */ }
          });
        });
      } else if (url.startsWith('/websockify')) {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    } catch (err) {
      console.warn('[upgrade] custom path failed:', err instanceof Error ? err.message : err);
      try { socket.destroy(); } catch { /* noop */ }
    }
  });
}

export function attachVncWebSocketProxy(wss: WebSocketServer, defaultVncPort = DEFAULT_VNC_PORT): void {
  wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
    const target = urlParams.get('target');
    if (!target) { ws.close(); return; }

    const [host, portStr] = target.split(':');
    const targetPort = Number(portStr || defaultVncPort);
    if (!isPrivateIp(host) || targetPort < 1 || targetPort > 65535) {
      console.warn(`[noVNC] rejected proxy to non-private target: ${target}`);
      ws.close();
      return;
    }

    const tcpSocket = net.connect(targetPort, host, () => {
      console.log(`[noVNC] proxied to ${host}:${targetPort}`);
    });

    tcpSocket.on('data', (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    });

    ws.on('message', (msg: Buffer) => {
      if (!tcpSocket.destroyed) tcpSocket.write(msg);
    });

    tcpSocket.on('close', () => ws.close());
    tcpSocket.on('error', () => ws.close());
    ws.on('close', () => tcpSocket.destroy());
    ws.on('error', () => tcpSocket.destroy());
  });
}
