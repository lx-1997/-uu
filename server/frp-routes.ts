import type express from 'express';
import type { Device } from '../shared/types.js';
import {
  readFrpSettings,
  writeFrpSettings,
  generateFrpToken,
  type FrpStudioSettings,
} from './frp-settings.js';
import { runRemoteCommands, type SshCredentials } from './ssh.js';
import { resolvePrimarySshPassword } from './device-ssh-credentials.js';
import { setDevicePasswordCache } from './device-password-cache.js';

const FRP_VERSION = '0.61.0';

type SendApiError = (
  response: express.Response,
  status: number,
  code: string,
  message: string,
  options?: { retryable?: boolean; details?: Record<string, unknown> },
) => void;

export type FrpRoutesDeps = {
  sendApiError: SendApiError;
  readDevices: () => Promise<Device[]>;
  writeDevices: (devices: Device[]) => Promise<void>;
  serializedWriteDevices: (fn: () => Promise<void>) => Promise<void>;
  invalidateDevicesReadCache: () => void;
  sanitizeDevice: (device: Device & { password?: string }) => Omit<Device & { password?: string }, 'password'>;
};

function tomlEscapeToken(token: string): string {
  return token.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildFrpsToml(token: string): string {
  return [
    'bindPort = 7000',
    '',
    'auth.method = "token"',
    `auth.token = "${tomlEscapeToken(token)}"`,
    '',
  ].join('\n');
}

function buildFrpcToml(opts: {
  serverAddr: string;
  serverPort: number;
  token: string;
  remotePort: number;
  proxyName: string;
}): string {
  const tok = tomlEscapeToken(opts.token);
  return [
    `serverAddr = "${tomlEscapeToken(opts.serverAddr)}"`,
    `serverPort = ${opts.serverPort}`,
    '',
    'auth.method = "token"',
    `auth.token = "${tok}"`,
    '',
    '[[proxies]]',
    `name = "${opts.proxyName}"`,
    'type = "tcp"',
    'localIP = "127.0.0.1"',
    'localPort = 22',
    `remotePort = ${opts.remotePort}`,
    '',
  ].join('\n');
}

function frpProxyName(deviceId: string): string {
  const s = `rdk${deviceId.replace(/[^a-zA-Z0-9]/g, '')}`;
  return s.slice(0, 32) || 'rdkdevice';
}

function remoteInstallFrpSnippet(dir: string): string {
  return [
    'set -euo pipefail',
    `FRP_VER=${FRP_VERSION}`,
    'ARCH=$(uname -m)',
    'case "$ARCH" in',
    '  x86_64) FRP_ARCH=amd64 ;;',
    '  aarch64) FRP_ARCH=arm64 ;;',
    '  *) echo "unsupported arch: $ARCH"; exit 1 ;;',
    'esac',
    `DIR=${dir}`,
    'mkdir -p "$DIR" && cd "$DIR"',
    'rm -f frp.tar.gz',
    'URL="https://github.com/fatedier/frp/releases/download/v${FRP_VER}/frp_${FRP_VER}_linux_${FRP_ARCH}.tar.gz"',
    'if command -v curl >/dev/null 2>&1; then curl -fsSL -o frp.tar.gz "$URL"; else wget -q -O frp.tar.gz "$URL"; fi',
    'tar -xzf frp.tar.gz --strip-components=1',
    'rm -f frp.tar.gz',
  ].join('\n');
}

function base64EncodeUtf8(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

function frpsSystemdUnit(frpsDir: string): string {
  return [
    '[Unit]',
    'Description=RDK Studio frp server (frps)',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${frpsDir}/frps -c ${frpsDir}/frps.toml`,
    'Restart=on-failure',
    'RestartSec=3',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}

function frpcSystemdUnit(frpcDir: string): string {
  return [
    '[Unit]',
    'Description=RDK Studio frp client (frpc)',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${frpcDir}/frpc -c ${frpcDir}/frpc.toml`,
    'Restart=on-failure',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}

async function allocateRemotePort(readDevices: () => Promise<Device[]>): Promise<number> {
  const devices = await readDevices();
  let max = 5999;
  for (const d of devices) {
    const ext = d as Device & { frpRemotePort?: number };
    const p = ext.frpRemotePort;
    if (typeof p === 'number' && p > max) max = p;
  }
  return max + 1;
}

export function registerFrpRoutes(app: express.Application, deps: FrpRoutesDeps): void {
  const {
    sendApiError,
    readDevices,
    writeDevices,
    serializedWriteDevices,
    invalidateDevicesReadCache,
    sanitizeDevice,
  } = deps;

  app.get('/api/frp/settings', async (_req, res) => {
    const s = await readFrpSettings();
    res.json({
      serverAddr: s.serverAddr,
      serverPort: s.serverPort,
      publicSshHost: s.publicSshHost || s.serverAddr,
      tokenConfigured: Boolean(s.token),
    });
  });

  app.post('/api/frp/settings', async (req, res) => {
    const body = req.body as {
      serverAddr?: string;
      serverPort?: number;
      publicSshHost?: string;
      token?: string;
    };
    const cur = await readFrpSettings();
    const next: FrpStudioSettings = {
      serverAddr: String(body.serverAddr ?? cur.serverAddr).trim(),
      serverPort: Number(body.serverPort ?? cur.serverPort) || 7000,
      token: body.token !== undefined ? String(body.token).trim() : cur.token,
      publicSshHost: String(body.publicSshHost ?? cur.publicSshHost).trim(),
    };
    if (!next.publicSshHost && next.serverAddr) {
      next.publicSshHost = next.serverAddr;
    }
    await writeFrpSettings(next);
    res.json({
      ok: true,
      serverAddr: next.serverAddr,
      serverPort: next.serverPort,
      publicSshHost: next.publicSshHost || next.serverAddr,
      tokenConfigured: Boolean(next.token),
    });
  });

  /** 在用户的云服务器上通过 SSH 一键安装并启动 frps */
  app.post('/api/frp/server/deploy', async (req, res) => {
    const body = req.body as {
      sshHost?: string;
      sshPort?: number;
      sshUser?: string;
      sshPassword?: string;
      token?: string;
    };
    const sshHost = String(body.sshHost ?? '').trim();
    const sshUser = String(body.sshUser ?? '').trim();
    const sshPassword = String(body.sshPassword ?? '');
    const sshPort = Number(body.sshPort ?? 22) || 22;

    if (!sshHost || !sshUser || !sshPassword) {
      sendApiError(res, 400, 'FRP_SSH_MISSING', '请填写云服务器地址、SSH 用户名与密码', { retryable: false });
      return;
    }

    let token = String(body.token ?? '').trim();
    if (!token) {
      const existing = await readFrpSettings();
      token = existing.token || generateFrpToken();
    }

    const frpsDir = '/opt/rdk-studio-frp';
    const toml = buildFrpsToml(token);
    const tomlB64 = base64EncodeUtf8(toml);
    const unit = frpsSystemdUnit(frpsDir);
    const unitB64 = base64EncodeUtf8(unit);

    const installCmd = [
      remoteInstallFrpSnippet(frpsDir),
      `echo '${tomlB64}' | base64 -d > ${frpsDir}/frps.toml`,
      `chmod 600 ${frpsDir}/frps.toml`,
      `echo '${unitB64}' | base64 -d > /etc/systemd/system/rdk-frps.service`,
      'systemctl daemon-reload',
      'systemctl enable rdk-frps',
      'systemctl restart rdk-frps',
      'systemctl is-active rdk-frps || (journalctl -u rdk-frps -n 40 --no-pager; exit 1)',
    ].join('\n');

    const creds: SshCredentials = { host: sshHost, port: sshPort, username: sshUser, password: sshPassword };

    try {
      const output = await runRemoteCommands(creds, [`bash -lc ${JSON.stringify(installCmd)}`], {
        timeoutMs: 15 * 60 * 1000,
      });

      const settings: FrpStudioSettings = {
        serverAddr: sshHost,
        serverPort: 7000,
        token,
        publicSshHost: sshHost,
      };
      await writeFrpSettings(settings);

      res.json({
        ok: true,
        output,
        token,
        serverAddr: sshHost,
        hint:
          '请在云厂商安全组放行 TCP 7000（frp 控制）及用于 SSH 映射的端口段（如 6000–6100）。板端部署时会自动分配 remotePort。',
      });
    } catch (e) {
      sendApiError(
        res,
        500,
        'FRP_SERVER_DEPLOY_FAILED',
        e instanceof Error ? e.message : String(e),
        { retryable: true },
      );
    }
  });

  /** 在当前已连接的设备上安装 frpc，并将设备切换为经 frp 远程连接 */
  app.post('/api/frp/device/deploy', async (req, res) => {
    const body = req.body as { deviceId?: string; password?: string };
    const deviceId = String(body.deviceId ?? '').trim();
    if (!deviceId) {
      sendApiError(res, 400, 'FRP_DEVICE_ID', '缺少 deviceId', { retryable: false });
      return;
    }

    const settings = await readFrpSettings();
    if (!settings.token || !settings.serverAddr) {
      sendApiError(
        res,
        400,
        'FRP_SETTINGS_INCOMPLETE',
        '请先在「全局设置」中保存 frp token，或执行「一键部署 frps」后再部署板端。',
        { retryable: false },
      );
      return;
    }

    const devices = await readDevices();
    const device = devices.find((d) => d.id === deviceId) as (Device & { password?: string }) | undefined;
    if (!device) {
      sendApiError(res, 404, 'DEVICE_NOT_FOUND', '设备不存在', { retryable: false });
      return;
    }

    const pwd =
      String(body.password ?? '').trim() ||
      device.password ||
      resolvePrimarySshPassword(device, { requestHeaderPassword: String(req.header('x-device-password') ?? '') });

    if (!pwd) {
      sendApiError(res, 400, 'FRP_DEVICE_PASSWORD', '需要设备 SSH 密码（请在请求头 x-device-password 中传递或重新连接设备保存密码）', {
        retryable: false,
      });
      return;
    }

    const existingPort = (device as Device & { frpRemotePort?: number }).frpRemotePort;
    const remotePort =
      typeof existingPort === 'number' && existingPort >= 6000 && existingPort < 65535
        ? existingPort
        : await allocateRemotePort(readDevices);
    const proxyName = frpProxyName(device.id);
    const frpcDir = '/opt/rdk-studio-frp';
    const frpcToml = buildFrpcToml({
      serverAddr: settings.serverAddr,
      serverPort: settings.serverPort || 7000,
      token: settings.token,
      remotePort,
      proxyName,
    });
    const frpcTomlB64 = base64EncodeUtf8(frpcToml);
    const frpcUnit = frpcSystemdUnit(frpcDir);
    const frpcUnitB64 = base64EncodeUtf8(frpcUnit);

    const creds: SshCredentials = {
      host: device.host,
      port: device.port ?? 22,
      username: device.username,
      password: pwd,
    };

    const installCmd = [
      remoteInstallFrpSnippet(frpcDir),
      `echo '${frpcTomlB64}' | base64 -d > ${frpcDir}/frpc.toml`,
      `chmod 600 ${frpcDir}/frpc.toml`,
      `echo '${frpcUnitB64}' | base64 -d > /etc/systemd/system/rdk-frpc.service`,
      'systemctl daemon-reload',
      'systemctl enable rdk-frpc',
      'systemctl restart rdk-frpc',
      'systemctl is-active rdk-frpc || (journalctl -u rdk-frpc -n 40 --no-pager; exit 1)',
    ].join('\n');

    try {
      const output = await runRemoteCommands(creds, [`bash -lc ${JSON.stringify(installCmd)}`], {
        timeoutMs: 15 * 60 * 1000,
      });

      const publicHost = settings.publicSshHost || settings.serverAddr;
      let updated: (Device & { password?: string }) | undefined;

      await serializedWriteDevices(async () => {
        const list = await readDevices();
        const idx = list.findIndex((d) => d.id === deviceId);
        if (idx < 0) {
          throw new Error('设备在写入前被删除');
        }
        const d = list[idx] as Device & { password?: string };
        const lanHost = d.lanSshHost ?? d.host;
        const lanPort = d.lanSshPort ?? (d.port ?? 22);
        updated = {
          ...d,
          lanSshHost: lanHost,
          lanSshPort: lanPort,
          host: publicHost,
          port: remotePort,
          frpRemotePort: remotePort,
          sshReachability: 'tunnel',
          lastCheckedAt: new Date().toISOString(),
        };
        list[idx] = updated;
        await writeDevices(list);
      });

      if (!updated) {
        sendApiError(res, 500, 'FRP_DEVICE_STATE', '设备状态更新失败', { retryable: true });
        return;
      }

      invalidateDevicesReadCache();
      setDevicePasswordCache(updated.host, updated.username, updated.port ?? 22, pwd);

      res.json({
        ok: true,
        output,
        remotePort,
        publicSshHost: publicHost,
        device: sanitizeDevice(updated),
        note: `请在云安全组放行 TCP ${remotePort}。若曾用局域网连接，局域网地址已备份，可使用「切回局域网」恢复。`,
      });
    } catch (e) {
      sendApiError(
        res,
        500,
        'FRP_DEVICE_DEPLOY_FAILED',
        e instanceof Error ? e.message : String(e),
        { retryable: true },
      );
    }
  });

  /** 在「局域网备份」与「frp 远程」之间切换设备的 SSH 连接目标 */
  app.post('/api/frp/device/switch-mode', async (req, res) => {
    const body = req.body as { deviceId?: string; mode?: string; password?: string };
    const deviceId = String(body.deviceId ?? '').trim();
    const mode = String(body.mode ?? '').trim() as 'direct' | 'tunnel';
    if (!deviceId || (mode !== 'direct' && mode !== 'tunnel')) {
      sendApiError(res, 400, 'FRP_SWITCH_INVALID', 'deviceId 与 mode（direct|tunnel）为必填', { retryable: false });
      return;
    }

    const settings = await readFrpSettings();
    const pwdHeader = String(req.header('x-device-password') ?? '');

    try {
      let outDevice: (Device & { password?: string }) | undefined;
      await serializedWriteDevices(async () => {
        const list = await readDevices();
        const idx = list.findIndex((d) => d.id === deviceId);
        if (idx < 0) {
          throw new Error('设备不存在');
        }
        const d = list[idx] as Device & { password?: string };
        const pwd =
          String(body.password ?? '').trim() ||
          d.password ||
          resolvePrimarySshPassword(d, { requestHeaderPassword: pwdHeader });

        if (mode === 'direct') {
          if (!d.lanSshHost) {
            throw new Error('未找到局域网 SSH 备份，无法切回。请重新用局域网 IP 添加设备。');
          }
          d.host = d.lanSshHost;
          d.port = d.lanSshPort ?? 22;
          d.sshReachability = 'direct';
        } else {
          const rh = settings.publicSshHost || settings.serverAddr;
          if (!d.frpRemotePort || !rh) {
            throw new Error('未部署 frpc 或未配置公网地址。请先完成板端一键部署。');
          }
          if (!d.lanSshHost) {
            d.lanSshHost = d.host;
            d.lanSshPort = d.port ?? 22;
          }
          d.host = rh;
          d.port = d.frpRemotePort;
          d.sshReachability = 'tunnel';
        }

        d.lastCheckedAt = new Date().toISOString();
        list[idx] = d;
        outDevice = d;
        await writeDevices(list);

        if (pwd) {
          setDevicePasswordCache(d.host, d.username, d.port ?? 22, pwd);
        }
      });

      if (!outDevice) {
        sendApiError(res, 500, 'FRP_SWITCH_STATE', '更新失败', { retryable: true });
        return;
      }

      invalidateDevicesReadCache();
      res.json({ ok: true, device: sanitizeDevice(outDevice) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('设备不存在')) {
        sendApiError(res, 404, 'DEVICE_NOT_FOUND', msg, { retryable: false });
        return;
      }
      sendApiError(res, 400, 'FRP_SWITCH_FAILED', msg, { retryable: false });
    }
  });
}
