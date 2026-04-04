import type { Server as SocketIOServer } from 'socket.io';
import { Client } from 'ssh2';
import { SSH_READY_TIMEOUT_MS, SSH_KEEPALIVE_INTERVAL_MS, SSH_KEEPALIVE_COUNT_MAX } from './ssh.js';
import type { Device } from '../shared/types.js';
import { OPENCLAW_GATEWAY_PORT } from './constants.js';
import { sshEndpointKey, type OpenClawDeploymentManager } from './managers/OpenClawDeploymentManager.js';
import { recordTokenUsage } from './monitoring/token-usage.js';
import { appendUtf8WithTailCap, DEFAULT_STREAM_OUTPUT_CHAR_LIMIT } from './utils/stream-output-limit.js';

/** Socket 侧为 token 统计累积的 assistant 文本上限（不影响已向浏览器 emit 的 chunk，只限制本地字符串） */
const OPENCLAW_SOCKET_METRICS_CAP = Math.min(256_000, DEFAULT_STREAM_OUTPUT_CHAR_LIMIT);

export type SocketIoHandlerDeps = {
  readDevices: () => Promise<Device[]>;
  credentialCacheKey: (host: string, username: string, port?: number) => string;
  defaultSshPassword: string;
  devicePasswordCache: Map<string, string>;
  toOpenClawDevice: (device: Device, password?: string) => {
    ip: string;
    port?: number;
    userName: string;
    id: string;
    password: string;
  };
  openClawManager: OpenClawDeploymentManager;
};

export function registerSocketIoHandlers(io: SocketIOServer, deps: SocketIoHandlerDeps): void {
  const {
    readDevices,
    credentialCacheKey,
    defaultSshPassword,
    devicePasswordCache,
    toOpenClawDevice,
    openClawManager,
  } = deps;

  io.on('connection', (socket) => {
    let sshClient: Client | null = null;
    let sshStream: any = null;
    let openclawChatSession: { abort: () => void } | null = null;
    const openclawLeasedIps = new Set<string>();
    const ensureOpenClawLease = (ip: string) => {
      const k = String(ip || '').trim();
      if (!k || openclawLeasedIps.has(k)) return;
      openClawManager.acquireOpenClawBridgeLease(k);
      openclawLeasedIps.add(k);
    };
    const releaseAllOpenClawLeases = () => {
      for (const ip of openclawLeasedIps) {
        openClawManager.releaseOpenClawBridgeLease(ip);
      }
      openclawLeasedIps.clear();
    };

    socket.on('openclaw:start', async (config) => {
      const { deviceId } = config;
      try {
        const devices = await readDevices();
        const device = devices.find(d => d.id === deviceId);
        if (!device) {
          socket.emit('openclaw:error', { error: 'Device not found' });
          return;
        }

        const deviceObj = toOpenClawDevice(device);
        ensureOpenClawLease(sshEndpointKey(deviceObj));

        openClawManager.startInteractiveChat(
          deviceObj,
          (data, err) => {
            if (err) {
              socket.emit('openclaw:error', { error: err });
              return;
            }
            socket.emit('openclaw:ready', { status: 'connected' });
          },
          () => {
            socket.emit('openclaw:disconnected', {});
            openclawChatSession = null;
          },
          `session-${socket.id}`,
        );
      } catch (e: any) {
        socket.emit('openclaw:error', { error: e.message });
      }
    });

    socket.on('openclaw:send', async (data) => {
      const { deviceId, message } = data;
      if (!message?.trim()) return;

      try {
        const devices = await readDevices();
        const device = devices.find(d => d.id === deviceId);
        if (!device) {
          socket.emit('openclaw:error', { error: 'Device not found' });
          return;
        }

        const deviceObj = toOpenClawDevice(device);
        ensureOpenClawLease(sshEndpointKey(deviceObj));
        let streamed = '';
        let streamedMetricsTruncated = false;

        openclawChatSession = openClawManager.sendAgentMessage(
          message,
          (chunk) => {
            const r = appendUtf8WithTailCap(streamed, chunk, OPENCLAW_SOCKET_METRICS_CAP);
            streamed = r.value;
            if (r.truncated) streamedMetricsTruncated = true;
            socket.emit('openclaw:data', { chunk });
          },
          (success) => {
            const completionForMetrics =
              streamedMetricsTruncated && streamed
                ? `${streamed}\n[openclaw:metrics tail-only; cap=${OPENCLAW_SOCKET_METRICS_CAP}]`
                : streamed || '';
            recordTokenUsage({
              source: 'openclaw',
              deviceId,
              sessionId: `session-${socket.id}`,
              model: 'openclaw-gateway',
              promptText: String(message || ''),
              completionText: completionForMetrics,
              success,
              estimated: true,
            });
            if (!success) {
              const raw = (streamed || '').trim();
              let msg = raw || 'OpenClaw 会话执行失败，请检查设备连接、密码或 Gateway 状态';
              if (/__OPENCLAW_HTTP_FAILED__/i.test(raw)) {
                msg = raw
                  .replace(/__OPENCLAW_HTTP_FAILED__/gi, '')
                  .trim() || `OpenClaw Gateway HTTP 接口不可用，请检查 ${OPENCLAW_GATEWAY_PORT} 端口与网关配置`;
              }
              if (/__OPENCLAW_WS_FAILED__/i.test(raw)) {
                msg = raw
                  .replace(/__OPENCLAW_WS_FAILED__/gi, '')
                  .trim() || `OpenClaw Gateway WS 调用失败，请检查 ${OPENCLAW_GATEWAY_PORT} 端口、token 与网关权限`;
              }
              if (/plugins\.allow is empty/i.test(raw)) {
                msg = 'OpenClaw 插件安全策略阻止加载本地插件（plugins.allow 为空）。请在 openclaw.json 中显式配置受信任插件 IDs，或移除未受信插件后重试。';
              }
              socket.emit('openclaw:error', { error: msg });
            }
            socket.emit('openclaw:complete', { success });
            openclawChatSession = null;
          },
          `session-${socket.id}`,
          deviceObj,
        );
      } catch (e: any) {
        socket.emit('openclaw:error', { error: e.message });
      }
    });

    socket.on('openclaw:stop', async (data) => {
      const { deviceId } = data;
      if (openclawChatSession) {
        openclawChatSession.abort();
        openclawChatSession = null;
      }

      try {
        const devices = await readDevices();
        const device = devices.find(d => d.id === deviceId);
        if (device) {
          const deviceObj = toOpenClawDevice(device);
          openClawManager.stopInteractiveChat(`session-${socket.id}`, deviceObj);
        }
      } catch {
        // Ignore errors on stop
      }

      socket.emit('openclaw:stopped', {});
    });

    socket.on('init', async (config) => {
      const { deviceId, password, cols, rows } = config;
      try {
        const devices = await readDevices();
        const device = devices.find(d => d.id === deviceId);
        if (!device) {
          socket.emit('data', '\r\n\x1b[31m[Error] Device not found.\x1b[0m\r\n');
          return;
        }

        const passKey = credentialCacheKey(device.host, device.username, device.port ?? 22);
        const persistedPassword = (device as Device & { password?: string }).password ?? '';
        const pwd =
          password
          || persistedPassword
          || devicePasswordCache.get(passKey)
          || defaultSshPassword;

        if (sshStream) {
          try { sshStream.close(); } catch { /* ignore */ }
          sshStream = null;
        }
        if (sshClient) {
          try { sshClient.end(); } catch { /* ignore */ }
          sshClient = null;
        }

        sshClient = new Client();
        sshClient.on('ready', () => {
          sshClient!.shell({ term: 'xterm-256color', cols: cols || 80, rows: rows || 24 }, (err, stream) => {
            if (err) {
              socket.emit('data', `\r\n\x1b[31m[Error] Shell error: ${err.message}\x1b[0m\r\n`);
              sshClient?.end();
              return;
            }
            sshStream = stream;
            stream.on('data', (d: any) => socket.emit('data', d.toString('utf-8')));
            stream.on('close', () => {
              socket.emit('data', '\r\n\x1b[33m[Session closed]\x1b[0m\r\n');
              sshClient?.end();
            });
          });
        }).on('error', (err) => {
          socket.emit('data', `\r\n\x1b[31m[SSH Error] ${err.message}\x1b[0m\r\n`);
          try { sshClient?.end(); } catch { /* ignore */ }
        }).connect({
          host: device.host,
          port: device.port ?? 22,
          username: device.username,
          password: pwd,
          readyTimeout: SSH_READY_TIMEOUT_MS,
          keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
          keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
        });
      } catch (e: any) {
        socket.emit('data', `\r\n\x1b[31m[Internal Error] ${e.message}\x1b[0m\r\n`);
      }
    });

    socket.on('data', (d) => {
      if (sshStream) sshStream.write(d);
    });

    socket.on('resize', ({ cols, rows }) => {
      if (sshStream && sshStream.setWindow) {
        sshStream.setWindow(rows, cols, 0, 0);
      }
    });

    socket.on('disconnect', () => {
      releaseAllOpenClawLeases();
      if (openclawChatSession) {
        openclawChatSession.abort();
        openclawChatSession = null;
      }
      sshStream?.end();
      sshClient?.end();
    });
  });
}
