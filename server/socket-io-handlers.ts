import type { Server as SocketIOServer } from 'socket.io';
import { Client } from 'ssh2';
import type { Device } from '../shared/types.js';
import { OPENCLAW_GATEWAY_PORT } from './constants.js';
import type { OpenClawDeploymentManager } from './managers/OpenClawDeploymentManager.js';
import { recordTokenUsage } from './monitoring/token-usage.js';

export type SocketIoHandlerDeps = {
  readDevices: () => Promise<Device[]>;
  credentialCacheKey: (host: string, username: string, port?: number) => string;
  defaultSshPassword: string;
  devicePasswordCache: Map<string, string>;
  toOpenClawDevice: (device: Device, password?: string) => {
    ip: string;
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
        let streamed = '';

        openclawChatSession = openClawManager.sendAgentMessage(
          message,
          (chunk) => {
            streamed += chunk;
            socket.emit('openclaw:data', { chunk });
          },
          (success) => {
            recordTokenUsage({
              source: 'openclaw',
              deviceId,
              sessionId: `session-${socket.id}`,
              model: 'openclaw-gateway',
              promptText: String(message || ''),
              completionText: streamed || '',
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

        const pwd = password || devicePasswordCache.get(credentialCacheKey(device.host, device.username, device.port ?? 22)) || defaultSshPassword;

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
        }).connect({
          host: device.host,
          port: device.port ?? 22,
          username: device.username,
          password: pwd,
          readyTimeout: 8000,
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
      if (openclawChatSession) {
        openclawChatSession.abort();
        openclawChatSession = null;
      }
      sshStream?.end();
      sshClient?.end();
    });
  });
}
