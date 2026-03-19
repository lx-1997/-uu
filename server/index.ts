import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { v4 as uuid } from 'uuid';
import type { ChatMessage, Device } from '../shared/types.js';
import { readDevices, writeDevices } from './storage.js';
import { runRemoteCommands, verifySshConnection, uploadFileSftp } from './ssh.js';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { Client } from 'ssh2';
import { WebSocketServer } from 'ws';
import * as net from 'net';
import { OpenClawDeploymentManager } from './managers/OpenClawDeploymentManager.js';
import * as path from 'path';

const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' }
});

const wss = new WebSocketServer({ noServer: true });
httpServer.on('upgrade', (request, socket, head) => {
  if (request.url?.startsWith('/websockify')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

wss.on('connection', (ws, req) => {
  // e.g. /websockify?target=192.168.1.10:5900
  const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
  const target = urlParams.get('target');
  if (!target) {
    ws.close();
    return;
  }
  const [host, targetPort] = target.split(':');
  
  const tcpSocket = net.connect(Number(targetPort || 5900), host, () => {
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

const port = Number(process.env.PORT ?? 8787);
const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://coding.dashscope.aliyuncs.com/v1';
const apiKey = process.env.OPENAI_API_KEY ?? '';
const model = process.env.OPENAI_MODEL ?? 'qwen3.5-plus';
const defaultSshPassword = process.env.RDK_SSH_PASSWORD ?? '';
const devicePasswordCache = new Map<string, string>();

// OpenClaw Manager
const resourcesPath = path.join(process.cwd(), 'build-resources');
const openClawManager = new OpenClawDeploymentManager(resourcesPath);

const credentialCacheKey = (host: string, username: string, port = 22) => `${host}:${port}::${username}`;
const shEscape = (raw: string) => `'${raw.replace(/'/g, `'"'"'`)}'`;
const sanitizeDevice = (device: Device & { password?: string }) => {
  const { password: _password, ...safe } = device;
  return safe;
};

async function resolveDevice(request: express.Request, response: express.Response, id: string) {
  const devices = await readDevices();
  const device = devices.find((item) => item.id === id);
  if (!device) {
    response.status(404).json({ error: '设备不存在' });
    return null;
  }
  return device;
}

function resolvePassword(request: express.Request, device: Device) {
  const key = credentialCacheKey(device.host, device.username, device.port ?? 22);
  const cachedPassword = devicePasswordCache.get(key);
  const providedPassword = request.header('x-device-password') ?? '';
  const persistedPassword = (device as Device & { password?: string }).password ?? '';
  const password = providedPassword || cachedPassword || persistedPassword || defaultSshPassword;
  return { password, key };
}

function passwordCandidates(username: string) {
  const candidates = [
    username,
    username === 'root' ? 'root' : '',
    username === 'sunrise' ? 'sunrise' : '',
    'root',
    'sunrise',
  ].filter(Boolean);
  return Array.from(new Set(candidates));
}

function isTransientSshError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /timed out|timeout|handshake|econnreset|socket closed|connection reset|connect failed/.test(message);
}

async function runOnDevice(
  request: express.Request,
  response: express.Response,
  id: string,
  commands: string[],
) {
  const device = await resolveDevice(request, response, id);
  if (!device) {
    return null;
  }

  const { password, key } = resolvePassword(request, device);
  const candidates = password ? [password] : passwordCandidates(device.username);
  let lastError: unknown = null;

  for (const pwd of candidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const output = await runRemoteCommands(
          {
            host: device.host,
            port: device.port ?? 22,
            username: device.username,
            password: pwd,
          },
          commands,
        );

        devicePasswordCache.set(key, pwd);
        return { device, output };
      } catch (error) {
        lastError = error;
        if (!(attempt === 0 && isTransientSshError(error))) {
          break;
        }
      }
    }
  }

  if (!password) {
    response.status(400).json({ error: '设备密码缺失或不正确，请在设备管理中重新连接并填写密码' });
    return null;
  }

  response.status(500).json({
    error: lastError instanceof Error ? `板端命令执行失败: ${lastError.message}` : '板端命令执行失败',
  });
  return null;
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/vnc', express.static(process.cwd() + '/public/vnc'));

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/devices', async (_request, response) => {
  const devices = await readDevices();
  response.json({ devices: devices.map((item) => sanitizeDevice(item as Device & { password?: string })) });
});

app.post('/api/devices/connect', async (request, response) => {
  const { host, port, username, password } = request.body as {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
  };

  if (!host || !username || !password) {
    response.status(400).json({ error: 'host、username、password 均为必填项' });
    return;
  }

  try {
    const normalizedPort = Number(port ?? 22);
    await verifySshConnection({ host, port: normalizedPort, username, password });

    const devices = await readDevices();
    const now = new Date().toISOString();
    const nextDevice: Device & { password?: string } = {
      id: devices.find((device) => device.host === host && (device.port ?? 22) === normalizedPort && device.username === username)?.id ?? uuid(),
      host,
      port: normalizedPort,
      username,
      password,
      status: 'connected',
      lastCheckedAt: now,
    };

    const nextDevices = [
      nextDevice,
      ...devices.filter((device) => !(device.host === host && (device.port ?? 22) === normalizedPort && device.username === username)),
    ];

    devicePasswordCache.set(credentialCacheKey(host, username, normalizedPort), password);

    await writeDevices(nextDevices);
    response.json({ device: sanitizeDevice(nextDevice) });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? `SSH 连接失败: ${error.message}` : 'SSH 连接失败',
    });
  }
});

app.post('/api/devices/verify', async (request, response) => {
  const { host, port, username, password } = request.body as {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
  };

  if (!host || !username || !password) {
    response.status(400).json({ error: 'host、username、password 均为必填项' });
    return;
  }

  try {
    await verifySshConnection({ host, port: Number(port ?? 22), username, password });
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? `SSH 连接失败: ${error.message}` : 'SSH 连接失败',
    });
  }
});

app.get('/api/devices/:id/ping', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  
  try {
    const client = new Client();
    await new Promise<void>((resolve, reject) => {
      client.on('ready', () => { client.end(); resolve(); })
            .on('error', reject)
            .connect({ host: device.host, port: device.port ?? 22, username: device.username, password: password || 'blank', readyTimeout: 3000 });
    });
    response.json({ ok: true, status: 'connected' });
  } catch {
    response.json({ ok: false, status: 'offline' });
  }
});

app.post('/api/openclaw/agent-action', async (request, response) => {
  const { action, modelName, host, username } = request.body as {
    action?: 'start' | 'status' | 'switch' | 'install' | 'logs';
    modelName?: string;
    host?: string;
    username?: string;
  };

  if (!action || !['start', 'status', 'switch', 'install', 'logs'].includes(action)) {
    response.status(400).json({ error: 'action 必须是 start/status/switch/install/logs' });
    return;
  }

  const devices = await readDevices();
  const target = host
    ? devices.find((d) => d.host === host && (username ? d.username === username : true))
    : devices[0];

  if (!target) {
    response.status(404).json({ error: '未找到可用设备，请先在设备管理中连接设备' });
    return;
  }

  const selectedUsername = username ?? target.username;
  const selectedPort = target.port ?? 22;
  const passKey = credentialCacheKey(target.host, selectedUsername, selectedPort);
  const cachedPassword = devicePasswordCache.get(passKey);
  const providedPassword = request.header('x-device-password') ?? '';
  const password = providedPassword || cachedPassword || defaultSshPassword;

  const targetModel = modelName?.trim() || 'qwen3.5-plus';
  const commandMap: Record<'start' | 'status' | 'switch' | 'install' | 'logs', string> = {
    install: `bash -lc '(curl -fsSL https://openclaw.sh/install.sh | bash || curl -fsSL https://code-server.dev/install.sh | sh || true); (openclaw --version || clawctl --version || echo "openclaw install command finished")'`,
    start: `bash -lc '(openclaw gateway start --port 18789 || openclaw start || clawctl start || true); (openclaw status || clawctl status || ps -ef | grep -E "openclaw|claw" | grep -v grep || true)'`,
    status: `bash -lc '(openclaw status || clawctl status || ps -ef | grep -E "openclaw|claw" | grep -v grep || true)'`,
    switch: `bash -lc '(openclaw model use "${targetModel}" || clawctl model use "${targetModel}" || echo "switch command unavailable"); (openclaw status || clawctl status || true)'`,
    logs: `bash -lc '(journalctl -u openclaw --no-pager -n 120 || tail -n 120 /var/log/openclaw.log || echo "no openclaw logs found")'`,
  };

  const candidates = password ? [password] : passwordCandidates(selectedUsername);
  let lastError: unknown = null;

  for (const pwd of candidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const output = await runRemoteCommands(
          {
            host: target.host,
            port: selectedPort,
            username: selectedUsername,
            password: pwd,
          },
          [commandMap[action]],
        );

        devicePasswordCache.set(passKey, pwd);

        response.json({
          ok: true,
          action,
          host: target.host,
          username: selectedUsername,
          output,
        });
        return;
      } catch (error) {
        lastError = error;
        if (!(attempt === 0 && isTransientSshError(error))) {
          break;
        }
      }
    }
  }

  if (!password) {
    response.status(400).json({ error: '设备密码缺失或不正确，请在设备管理中重新连接并填写密码' });
    return;
  }

  response.status(500).json({
    error: lastError instanceof Error ? `OpenClaw 板端执行失败: ${lastError.message}` : 'OpenClaw 板端执行失败',
  });
});

app.delete('/api/devices/:id', async (request, response) => {
  const { id } = request.params;
  const devices = await readDevices();

  if (!devices.some((device) => device.id === id)) {
    response.status(404).json({ error: '设备不存在' });
    return;
  }

  await writeDevices(devices.filter((device) => device.id !== id));
  response.json({ removedId: id });
});

app.post('/api/devices/:id/openclaw', async (request, response) => {
  const { id } = request.params;
  const { installCommand, configureCommand } = request.body as {
    installCommand?: string;
    configureCommand?: string;
  };
  const sshPassword = request.header('x-device-password');

  if (!sshPassword) {
    response.status(400).json({ error: '缺少设备密码，请补充当前设备密码后重试' });
    return;
  }

  const devices = await readDevices();
  const device = devices.find((item) => item.id === id);

  if (!device) {
    response.status(404).json({ error: '设备不存在' });
    return;
  }

  if (!installCommand && !configureCommand) {
    response.status(400).json({ error: '至少提供一条 OpenClaw 命令' });
    return;
  }

  try {
    const output = await runRemoteCommands(
      {
        host: device.host,
        port: device.port ?? 22,
        username: device.username,
        password: sshPassword,
      },
      [installCommand ?? '', configureCommand ?? ''],
    );

    const nextDevice: Device = {
      ...device,
      status: 'connected',
      lastCheckedAt: new Date().toISOString(),
    };

    await writeDevices(devices.map((item) => (item.id === nextDevice.id ? nextDevice : item)));
    response.json({ output, device: sanitizeDevice(nextDevice as Device & { password?: string }) });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? `OpenClaw 执行失败: ${error.message}` : 'OpenClaw 执行失败',
    });
  }
});

// OpenClaw 部署 API
app.post('/api/devices/:id/openclaw/check', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;
  const { password } = resolvePassword(request, device);

  const deviceObj = { ip: device.host, userName: device.username, id: device.id };
  let output = '';
  openClawManager.runCheck(deviceObj, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/openclaw/prepare', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const deviceObj = { ip: device.host, userName: device.username, id: device.id };
  let output = '';
  openClawManager.runPrepare(deviceObj, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/openclaw/install', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const deviceObj = { ip: device.host, userName: device.username, id: device.id };
  let output = '';
  openClawManager.runInstall(deviceObj, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/openclaw/upgrade', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const deviceObj = { ip: device.host, userName: device.username, id: device.id };
  let output = '';
  openClawManager.runUpgrade(deviceObj, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/openclaw/uninstall', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const deviceObj = { ip: device.host, userName: device.username, id: device.id };
  let output = '';
  openClawManager.runUninstall(deviceObj, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/openclaw/onboard', async (request, response) => {
  const { id } = request.params;
  const { provider, apiKey, modelId } = request.body as { provider?: string; apiKey?: string; modelId?: string };
  
  if (!provider || !apiKey) {
    response.status(400).json({ error: 'provider 和 apiKey 为必填项' });
    return;
  }

  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const deviceObj = { ip: device.host, userName: device.username, id: device.id };
  let output = '';
  openClawManager.runOnboard(deviceObj, provider, apiKey, modelId, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/openclaw/config', async (request, response) => {
  const { id } = request.params;
  const { config } = request.body as { config?: any };

  if (!config) {
    response.status(400).json({ error: '缺少配置数据' });
    return;
  }

  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const deviceObj = { ip: device.host, userName: device.username, id: device.id };
  let output = '';
  openClawManager.updateConfig(deviceObj, config, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.get('/api/devices/:id/openclaw/status', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const deviceObj = { ip: device.host, userName: device.username, id: device.id };
  openClawManager.getGatewayStatus(deviceObj, (status) => {
    response.json(status);
  });
});

app.get('/api/devices/:id/openclaw/config', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const deviceObj = { ip: device.host, userName: device.username, id: device.id };
  openClawManager.getCurrentConfig(deviceObj, (config, success) => {
    if (success && config) {
      response.json(config);
    } else {
      response.status(500).json({ error: '读取配置失败' });
    }
  });
});

app.post('/api/devices/:id/openclaw/restart-gateway', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const deviceObj = { ip: device.host, userName: device.username, id: device.id };
  let output = '';
  openClawManager.runRestartGateway(deviceObj, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.get('/api/devices/:id/openclaw/version', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const deviceObj = { ip: device.host, userName: device.username, id: device.id };
  let output = '';
  openClawManager.runGetVersion(deviceObj, (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, version: output.trim() });
  });
});

app.get('/api/devices/:id/openclaw/wifi-list', async (request, response) => {
  const { id } = request.params;
  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const deviceObj = { ip: device.host, userName: device.username, id: device.id };
  openClawManager.getWifiList(deviceObj, (wifiNames, success) => {
    response.json({ ok: success, wifiNames });
  });
});

app.post('/api/devices/:id/openclaw/wifi-connect', async (request, response) => {
  const { id } = request.params;
  const { wifiName, wifiPassword } = request.body as { wifiName?: string; wifiPassword?: string };

  if (!wifiName) {
    response.status(400).json({ error: 'wifiName 为必填项' });
    return;
  }

  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const deviceObj = { ip: device.host, userName: device.username, id: device.id };
  let output = '';
  openClawManager.setWifiConnection(deviceObj, wifiName, wifiPassword || '', (chunk) => { output += chunk; }, (success) => {
    response.json({ ok: success, output });
  });
});

app.post('/api/devices/:id/exec', async (request, response) => {
  const { id } = request.params;
  const { command } = request.body as { command?: string };

  if (!command?.trim()) {
    response.json({ ok: false, output: '', error: '空命令已忽略' });
    return;
  }

  const executed = await runOnDevice(request, response, id, [command]);
  if (!executed) return;

  response.json({
    ok: true,
    output: executed.output,
    device: sanitizeDevice(executed.device as Device & { password?: string }),
    command,
  });
});

app.post('/api/devices/:id/batch-exec', async (request, response) => {
  const { id } = request.params;
  const { commands } = request.body as { commands?: string[] };

  if (!Array.isArray(commands) || commands.length === 0) {
    response.json({ ok: false, output: '', error: '空命令批次已忽略' });
    return;
  }

  const filtered = commands.map((item) => item?.trim()).filter(Boolean) as string[];
  if (filtered.length === 0) {
    response.json({ ok: false, output: '', error: '空命令批次已忽略' });
    return;
  }

  const executed = await runOnDevice(request, response, id, filtered);
  if (!executed) return;

  response.json({
    ok: true,
    output: executed.output,
    device: sanitizeDevice(executed.device as Device & { password?: string }),
    commandCount: filtered.length,
  });
});

app.get('/api/devices/:id/diagnostics', async (request, response) => {
  const { id } = request.params;

  const commands = [
    'echo "###UPTIME###"; uptime',
    'echo "###TEMP###"; cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo "N/A"',
    'echo "###MEM###"; free -h',
    'echo "###DISK###"; df -h',
    'echo "###IP###"; ip -o -4 addr show',
    'echo "###TOP###"; top -bn1 | head -20',
    'echo "###BPU###"; (hrut_smi || bputop || echo "bpu command unavailable")',
    'echo "###SOMSTATUS###"; (sudo hrut_somstatus 2>/dev/null || echo "somstatus unavailable")',
  ];

  const executed = await runOnDevice(request, response, id, commands);
  if (!executed) return;

  response.json({
    ok: true,
    output: executed.output,
    device: sanitizeDevice(executed.device as Device & { password?: string }),
  });
});

/* ── Flash / System Update API ── */
app.post('/api/devices/:id/flash/check', async (request, response) => {
  const { id } = request.params;
  // 检查设备当前系统版本、存储空间、可用介质
  const executed = await runOnDevice(request, response, id, [
    'bash -lc "echo ===VERSION===; cat /etc/version 2>/dev/null || cat /etc/os-release 2>/dev/null | head -5 || echo unknown; echo ===STORAGE===; df -h / /userdata 2>/dev/null || df -h; echo ===EMMC===; ls -la /dev/mmcblk* 2>/dev/null || echo no-emmc; echo ===BOARD===; cat /sys/class/socinfo/board_id 2>/dev/null || cat /proc/device-tree/model 2>/dev/null || echo unknown-board; echo ===HBUPDATE===; which hbupdate 2>/dev/null && echo hbupdate-available || echo no-hbupdate"',
  ]);
  if (!executed) return;
  response.json({ ok: true, output: executed.output });
});

app.post('/api/devices/:id/flash/download', async (request, response) => {
  const { id } = request.params;
  const { imageUrl, targetPath } = request.body as { imageUrl?: string; targetPath?: string };
  if (!imageUrl?.trim()) {
    response.status(400).json({ error: '缺少镜像下载地址 imageUrl' });
    return;
  }
  const dest = targetPath?.trim() || '/tmp/rdk_image.img';
  // 在设备上下载镜像
  const executed = await runOnDevice(request, response, id, [
    `bash -lc "echo 'Downloading image...'; wget -q --show-progress -O ${shEscape(dest)} ${shEscape(imageUrl)} 2>&1 || curl -fSL -o ${shEscape(dest)} ${shEscape(imageUrl)} 2>&1; echo DONE; ls -lh ${shEscape(dest)}"`,
  ]);
  if (!executed) return;
  response.json({ ok: true, output: executed.output, path: dest });
});

app.post('/api/devices/:id/flash/write', async (request, response) => {
  const { id } = request.params;
  const { imagePath, target } = request.body as { imagePath?: string; target?: string };
  if (!imagePath?.trim()) {
    response.status(400).json({ error: '缺少镜像路径 imagePath' });
    return;
  }
  // target: emmc (/dev/mmcblk0), sd (/dev/mmcblk1), 或自定义路径
  const targetDev = target === 'emmc' ? '/dev/mmcblk0' : target === 'sd' ? '/dev/mmcblk1' : (target || '/dev/mmcblk0');
  // 使用 hbupdate 或 dd 写入
  const executed = await runOnDevice(request, response, id, [
    `bash -lc "if command -v hbupdate >/dev/null 2>&1; then echo 'Using hbupdate...'; hbupdate ${shEscape(imagePath)} 2>&1; else echo 'Using dd...'; dd if=${shEscape(imagePath)} of=${shEscape(targetDev)} bs=4M status=progress 2>&1; sync; fi; echo FLASH_COMPLETE"`,
  ]);
  if (!executed) return;
  response.json({ ok: true, output: executed.output });
});

app.post('/api/devices/:id/flash/verify', async (request, response) => {
  const { id } = request.params;
  // 验证烧录后的系统状态
  const executed = await runOnDevice(request, response, id, [
    'bash -lc "echo ===POST_FLASH===; cat /etc/version 2>/dev/null || echo no-version; uname -a; echo ===BOOT===; systemctl is-system-running 2>/dev/null || echo unknown; echo ===BPU===; hrut_smi 2>/dev/null | head -5 || echo bpu-check-unavailable"',
  ]);
  if (!executed) return;
  response.json({ ok: true, output: executed.output });
});

app.post('/api/devices/:id/flash/execute', async (request, response) => {
  const { id } = request.params;
  const {
    imageUrl,
    target,
    board,
    mode,
    wifiName,
    wifiPass,
    skipVerify,
  } = request.body as {
    imageUrl?: string;
    target?: string;
    board?: string;
    mode?: 'network' | 'local';
    wifiName?: string;
    wifiPass?: string;
    skipVerify?: boolean;
  };

  if (!imageUrl?.trim()) {
    response.status(400).json({ error: '缺少镜像地址 imageUrl' });
    return;
  }

  const targetMap: Record<string, string> = {
    emmc: '/dev/mmcblk0',
    sd: '/dev/mmcblk1',
    usb: '/dev/sda',
  };
  const targetDevice = targetMap[target ?? ''] ?? (target?.trim() || '/dev/mmcblk1');

  if (mode === 'local') {
    response.json({
      ok: true,
      strategy: 'local-guide',
      targetDevice,
      output: [
        `BOARD=${board ?? 'unknown'}`,
        `IMAGE=${imageUrl}`,
        `TARGET=${targetDevice}`,
        `WIFI=${wifiName ? `${wifiName}${wifiPass ? ' (已设置密码)' : ''}` : '未预配'}`,
        '请在本机使用 balenaEtcher / Raspberry Pi Imager / dd 执行写盘。',
      ].join('\n'),
    });
    return;
  }

  const imagePath = '/tmp/rdk_flash_image.img.xz';
  const rawImagePath = '/tmp/rdk_flash_image.img';
  const wifiScript = wifiName?.trim()
    ? `mkdir -p /tmp/rdk_netplan && cat >/tmp/rdk_netplan/01-rdk-studio.yaml <<'NETCFG'\nnetwork:\n  version: 2\n  wifis:\n    wlan0:\n      dhcp4: true\n      access-points:\n        \"${wifiName.replace(/"/g, '\\"')}\":\n          password: \"${(wifiPass ?? '').replace(/"/g, '\\"')}\"\nNETCFG\n`
    : 'echo "skip wifi pre-config"';

  const command = `bash -lc '
set -e
echo "===FLASH_PLAN==="
echo "board=${board ?? 'unknown'}"
echo "image=${imageUrl}"
echo "target=${targetDevice}"
echo "mode=network"

echo "===DOWNLOAD==="
(wget -O ${shEscape(imagePath)} ${shEscape(imageUrl)} 2>&1 || curl -fL ${shEscape(imageUrl)} -o ${shEscape(imagePath)} 2>&1)
ls -lh ${shEscape(imagePath)}

echo "===PREPARE==="
if file ${shEscape(imagePath)} | grep -qi "XZ compressed"; then
  xz -dc ${shEscape(imagePath)} > ${shEscape(rawImagePath)}
else
  cp ${shEscape(imagePath)} ${shEscape(rawImagePath)}
fi
ls -lh ${shEscape(rawImagePath)}

echo "===WRITE==="
if command -v pv >/dev/null 2>&1; then
  pv ${shEscape(rawImagePath)} | dd of=${shEscape(targetDevice)} bs=8M conv=fsync status=none
else
  dd if=${shEscape(rawImagePath)} of=${shEscape(targetDevice)} bs=8M conv=fsync status=progress
fi
sync

echo "===WIFI==="
${wifiScript}

echo "===VERIFY==="
if [ ${skipVerify ? '1' : '0'} -eq 1 ]; then
  echo "skip verify"
else
  fdisk -l ${shEscape(targetDevice)} 2>/dev/null | head -20 || true
fi

echo "===FLASH_DONE==="
'`;

  const executed = await runOnDevice(request, response, id, [command]);
  if (!executed) return;

  response.json({ ok: true, output: executed.output, strategy: 'network-direct', targetDevice });
});

app.get('/api/devices/:id/ros/topics', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(request, response, id, ['bash -lc "(command -v ros2 >/dev/null 2>&1 && ros2 topic list) || echo ROS2_NOT_INSTALLED"']);
  if (!executed) return;

  const topics = executed.output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('/'));

  response.json({
    ok: true,
    topics,
    output: executed.output,
  });
});

app.post('/api/devices/:id/models/deploy', async (request, response) => {
  const { id } = request.params;
  const { command } = request.body as { command?: string };

  if (!command?.trim()) {
    response.status(400).json({ error: '缺少部署命令 command' });
    return;
  }

  const executed = await runOnDevice(request, response, id, [command]);
  if (!executed) return;

  response.json({ ok: true, output: executed.output });
});

app.post('/api/devices/:id/examples/run', async (request, response) => {
  const { id } = request.params;
  const { command } = request.body as { command?: string };

  if (!command?.trim()) {
    response.status(400).json({ error: '缺少示例启动命令 command' });
    return;
  }

  const executed = await runOnDevice(request, response, id, [command]);
  if (!executed) return;

  response.json({ ok: true, output: executed.output });
});

app.get('/api/devices/:id/services/node-red', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(
    request,
    response,
    id,
    ['bash -lc "(systemctl is-active nodered || pgrep -af node-red || echo inactive)"'],
  );
  if (!executed) return;

  const active = /active|node-red/i.test(executed.output);
  response.json({ ok: true, active, output: executed.output });
});

app.get('/api/devices/:id/services/vnc', async (request, response) => {
  const { id } = request.params;
  const executed = await runOnDevice(
    request,
    response,
    id,
    ['bash -lc "(systemctl is-active vncserver || systemctl is-active x11vnc || pgrep -af \'x11vnc|Xtigervnc|vncserver\' || echo inactive)"'],
  );
  if (!executed) return;

  const active = /active|vnc/i.test(executed.output);
  response.json({ ok: true, active, output: executed.output });
});

app.get('/api/devices/:id/files/list', async (request, response) => {
  const { id } = request.params;
  const targetPath = String(request.query.path ?? '/userdata');
  const executed = await runOnDevice(
    request,
    response,
    id,
    [`sudo bash -lc "ls -al ${shEscape(targetPath)} || true"`],
  );
  if (!executed) return;
  response.json({ ok: true, output: executed.output, path: targetPath });
});

app.get('/api/devices/:id/files/read', async (request, response) => {
  const { id } = request.params;
  const targetPath = String(request.query.path ?? '');
  const lines = Number(request.query.lines ?? 200);

  if (!targetPath.trim()) {
    response.status(400).json({ error: 'path 不能为空' });
    return;
  }

  // Use base64 to avoid JSON encoding issues with weird characters
  const executed = await runOnDevice(
    request,
    response,
    id,
    [`sudo bash -lc "if [ -f ${shEscape(targetPath)} ]; then head -n ${Number.isFinite(lines) && lines > 0 ? Math.min(lines, 2000) : 200} ${shEscape(targetPath)} 2>/dev/null | base64 | tr -d '\\n'; else echo 'NOT_A_FILE'; fi || true"`],
  );
  if (!executed) return;
  
  if (executed.output.trim() === 'NOT_A_FILE') {
    response.json({ ok: true, output: 'NOT_A_FILE', path: targetPath });
    return;
  }

  const base64Str = executed.output.trim();
  const decoded = Buffer.from(base64Str, 'base64').toString('utf-8');
  response.json({ ok: true, output: decoded, contentBase64: base64Str, path: targetPath });
});

app.post('/api/devices/:id/files/write', async (request, response) => {
  const { id } = request.params;
  const { path: targetPath, content, append } = request.body as { path?: string; content?: string; append?: boolean };

  if (!targetPath?.trim()) {
    response.status(400).json({ error: 'path 不能为空' });
    return;
  }

  // If appending, use bash base64. If overriding, use SFTP to support larger files.
  if (!append) {
    const device = await resolveDevice(request, response, id);
    if (!device) return;
    const { password } = resolvePassword(request, device);
    const candidates = password ? [password] : passwordCandidates(device.username);
    let lastError = null;
    
    for (const pwd of candidates) {
      try {
        await runRemoteCommands({ host: device.host, port: device.port ?? 22, username: device.username, password: pwd }, [`mkdir -p $(dirname ${shEscape(targetPath)}) || true`]);
        await uploadFileSftp({ host: device.host, port: device.port ?? 22, username: device.username, password: pwd }, targetPath, Buffer.from(content ?? '', 'utf-8'));
        response.json({ ok: true, output: '写入完成', path: targetPath });
        return;
      } catch (e) {
        lastError = e;
      }
    }
    response.status(500).json({ error: lastError instanceof Error ? lastError.message : '写入失败' });
    return;
  }

  const base64Content = Buffer.from(content ?? '', 'utf-8').toString('base64');
  const redirect = append ? '>>' : '>';
  const executed = await runOnDevice(
    request,
    response,
    id,
    [`bash -lc "mkdir -p $(dirname ${shEscape(targetPath)}); echo ${shEscape(base64Content)} | base64 -d ${redirect} ${shEscape(targetPath)}"`],
  );
  if (!executed) return;
  response.json({ ok: true, output: executed.output || '写入完成', path: targetPath });
});

app.post('/api/devices/:id/files/upload', async (request, response) => {
  const { id } = request.params;
  const { path: targetPath, contentBase64 } = request.body as { path?: string; contentBase64?: string };

  if (!targetPath?.trim() || !contentBase64) {
    response.status(400).json({ error: 'path 和 contentBase64 不能为空' });
    return;
  }

  const device = await resolveDevice(request, response, id);
  if (!device) return;

  const { password } = resolvePassword(request, device);
  const candidates = password ? [password] : passwordCandidates(device.username);
  let lastError: unknown = null;

  for (const pwd of candidates) {
    try {
      // Create folder if needed via exec first
      await runRemoteCommands(
        { host: device.host, port: device.port ?? 22, username: device.username, password: pwd },
        [`mkdir -p $(dirname ${shEscape(targetPath)}) || true`]
      );
      
      const buffer = Buffer.from(contentBase64, 'base64');
      await uploadFileSftp(
        { host: device.host, port: device.port ?? 22, username: device.username, password: pwd },
        targetPath,
        buffer
      );
      
      response.json({ ok: true, path: targetPath });
      return;
    } catch (e) {
      lastError = e;
    }
  }

  response.status(500).json({
    error: lastError instanceof Error ? `长传失败: ${lastError.message}` : '文件上传失败'
  });
});

app.get('/api/devices/:id/files/download', async (request, response) => {
  const { id } = request.params;
  const targetPath = String(request.query.path ?? '');

  if (!targetPath.trim()) {
    response.status(400).json({ error: 'path 不能为空' });
    return;
  }

  // Support both file and directory download (tar.gz for directory).
  const executed = await runOnDevice(
    request,
    response,
    id,
    [`sudo bash -lc "if [ -d ${shEscape(targetPath)} ]; then tar czf - ${shEscape(targetPath)} 2>/dev/null | base64 | tr -d '\\n'; elif [ -f ${shEscape(targetPath)} ]; then base64 ${shEscape(targetPath)} | tr -d '\\n'; else echo 'NOT_FOUND'; fi || true"`],
  );
  
  if (!executed) return;
  if (executed.output.trim() === 'NOT_FOUND') {
    response.status(404).json({ error: '文件或目录不存在' });
    return;
  }
  
  response.json({ ok: true, path: targetPath, contentBase64: executed.output.trim(), isDir: true /* Frontend will check extension */ });
});

app.post('/api/agent/plan', async (request, response) => {
  if (!apiKey) {
    response.status(500).json({ error: '缺少 OPENAI_API_KEY，请先配置后端环境变量' });
    return;
  }

  const { goal, deviceName, deviceIp } = request.body as {
    goal?: string;
    deviceName?: string;
    deviceIp?: string;
  };

  if (!goal?.trim()) {
    response.status(400).json({ error: 'goal 不能为空' });
    return;
  }

  const plannerPrompt = `你是 RDK Studio 的任务规划 Agent。你只输出可执行计划 JSON，不要输出任何其它文本。

上下文：
- 设备名称: ${deviceName ?? '未知设备'}
- 设备 IP: ${deviceIp ?? '未知'}
- 用户目标: ${goal}

输出要求：
1) 返回严格 JSON 对象，结构：
{
  "summary": "一句话计划摘要",
  "steps": [
    {
      "title": "步骤名称",
      "intent": "intent id",
      "param": "可选参数",
      "reason": "为什么做这步"
    }
  ],
  "risk": "主要风险",
  "done": "完成判定"
}
2) steps 最少 1 步，最多 5 步。
3) intent 只能是以下之一：flash, terminal, terminal_cmd, file_upload, file_download, vnc, openclaw_start, openclaw_status, openclaw_switch, hardware_check, ros_scan, ros_record_start, ros_record_stop, model_deploy, model_list, example_run, workflow, device_scan, nav, settings, general
4) param 仅在 terminal_cmd / openclaw_switch / nav / file_download 场景填写。下载文件时填写需要下载的具体文件名。
5) 如果用户目标不需要实际操作，使用 general。
6) 不要使用 markdown，不要代码块，只返回 JSON。
7) 当目标涉及“板端 OpenClaw + 软件内能力联动”时，steps 必须同时包含 openclaw_* 与软件能力（如 hardware_check/terminal/model_* 等）步骤。`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const upstreamResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: plannerPrompt }],
        temperature: 0.2,
        max_tokens: 600,
        enable_thinking: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const payload = (await upstreamResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (!upstreamResponse.ok) {
      response.status(500).json({ error: payload.error?.message ?? 'Agent 规划失败' });
      return;
    }

    const content = payload.choices?.[0]?.message?.content?.trim() ?? '';
    const cleaned = content
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();

    const parsed = JSON.parse(cleaned) as {
      summary?: string;
      steps?: Array<{ title?: string; intent?: string; param?: string; reason?: string }>;
      risk?: string;
      done?: string;
    };

    const allowed = new Set([
      'flash', 'terminal', 'terminal_cmd', 'file_upload', 'file_download', 'vnc',
      'openclaw_start', 'openclaw_status', 'openclaw_switch', 'hardware_check',
      'ros_scan', 'ros_record_start', 'ros_record_stop', 'model_deploy', 'model_list',
      'example_run', 'workflow', 'device_scan', 'nav', 'settings', 'general',
    ]);

    const steps = (parsed.steps ?? [])
      .slice(0, 5)
      .map((step, idx) => ({
        title: step.title?.trim() || `步骤 ${idx + 1}`,
        intent: allowed.has(step.intent ?? '') ? step.intent! : 'general',
        param: step.param?.trim() || undefined,
        reason: step.reason?.trim() || '按目标自动规划',
      }));

    response.json({
      summary: parsed.summary?.trim() || '已生成执行计划',
      steps: steps.length > 0 ? steps : [{ title: '执行通用分析', intent: 'general', reason: '无法提取可执行动作' }],
      risk: parsed.risk?.trim() || '操作可能受设备在线状态影响',
      done: parsed.done?.trim() || '目标结果在任务反馈中出现',
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      response.status(504).json({ error: 'Agent 规划超时' });
      return;
    }

    response.status(500).json({
      error: error instanceof Error ? `Agent 规划失败: ${error.message}` : 'Agent 规划失败',
    });
  }
});

app.post('/api/chat', async (request, response) => {
  if (!apiKey) {
    response.status(500).json({ error: '缺少 OPENAI_API_KEY，请先配置后端环境变量' });
    return;
  }

  const { messages, deviceName, deviceIp } = request.body as {
    messages?: Array<{ role: string; content: string }>;
    deviceName?: string;
    deviceIp?: string;
  };

  if (!messages?.length) {
    response.status(400).json({ error: '消息不能为空' });
    return;
  }

  const systemPrompt = `你是「小地瓜」，RDK Studio 的 AI 助手。你运行在地平线机器人开发者套件工作站中，帮助开发者操作和管理 RDK 系列开发板。

身份背景：
- 你是一位经验丰富的嵌入式 AI 工程师朋友，精通地平线 RDK X3/X5 开发板、BPU（旭日处理器）、ROS2 机器人开发
- 说话自然亲切简洁，像一个靠谱的技术伙伴
- 你具备地平线工具链（hbdk、hrt_model_exec、hrut_smi、hobot_dnn 等）的深入知识

当前环境：
- 设备名称: ${deviceName ?? '未知设备'}
- 设备 IP: ${deviceIp ?? '未知'}
- 可直接操作: 镜像烧录、SSH 终端、SFTP 文件管理、VNC 远程桌面、OpenClaw AI 网关管理、硬件诊断（BPU/温度/内存）、ROS2 话题可视化、BPU 模型部署、低代码流程编排、扫描设备

技术知识要点（按需引用）：
- RDK X5 使用 Sunrise 5 处理器，10 TOPS BPU 算力，双核 A55 CPU
- RDK X3 使用 Sunrise 3 处理器，5 TOPS BPU，四核 A53
- BPU 正常工作温度 45-75°C，超过 80°C 需散热优化
- hrut_smi 查看 BPU 负载，hobot_dnn 做模型推理
- ONNX 模型转 BPU 需先用 hb_mapper 工具链进行转换和量化
- OpenClaw 是小龙虾 AI Agent 网关，端口 18789，支持多 LLM 后端切换和技能插件

回复规范：
1. 用中文自然回复，2-4 句话，不超过 100 字。复杂问题可展开但不超过 6 句
2. 绝对不要输出 markdown 格式标记（不要 **加粗**、# 标题、\`代码\`、\`\`\` 代码块、- 列表等），因为 UI 层自动渲染
3. 主动补充有价值的技术细节和你的判断
4. 如果用户想执行操作，直接表达"帮你处理""正在执行"即可，系统会自动触发对应动作
5. 表达自然有人情味，可以说"这个我来""没问题""搞定"
6. 不要重复用户已经说过的内容，直接给回应和补充信息

【关键】意图标签：
每次回复末尾必须附加一个意图标签，格式严格为 [[intent:xxx]]，用于系统内部路由，不会显示给用户。
可选意图：
- flash — 烧录镜像
- terminal — 打开/使用终端
- terminal_cmd — 执行具体命令，格式 [[intent:terminal_cmd|命令内容]]
- file_upload — 上传/同步文件到设备
- file_download — 从设备下载文件
- vnc — 连接远程桌面
- openclaw_start — 启动 OpenClaw 网关
- openclaw_status — 查看 OpenClaw 状态
- openclaw_switch — 切换模型，格式 [[intent:openclaw_switch|模型名]]
- hardware_check — 硬件诊断/温度/BPU/内存检查
- ros_scan — 扫描 ROS2 话题
- ros_record_start — 开始 ROS 录制
- ros_record_stop — 停止 ROS 录制
- model_deploy — 部署/转换模型到 BPU
- model_list — 查看已部署模型
- example_run — 运行示例应用
- workflow — 流程编排
- device_scan — 扫描局域网设备
- nav — 用户只是想去某个页面（附加 tab 名），格式 [[intent:nav|terminal]]
- settings — 打开设置
- general — 一般对话/技术问答/无法归类

示例：
用户: "帮我查一下板子温度" → "没问题，正在读取 RDK X5 的芯片温度和 BPU 负载数据。X5 的 Sunrise 5 正常工作范围在 45-75°C。[[intent:hardware_check]]"
用户: "执行一下 ls /userdata" → "好的，帮你跑一下看看 userdata 目录。[[intent:terminal_cmd|ls /userdata]]"
用户: "运行 cat /proc/cpuinfo" → "这就查一下 CPU 信息。[[intent:terminal_cmd|cat /proc/cpuinfo]]"
用户: "BPU 是什么架构？" → "RDK X5 用的是贝叶斯（Bernoulli）架构 BPU，专为边缘 AI 推理优化，INT8 下能跑到 10 TOPS。支持 ONNX 模型通过 hb_mapper 转换后高效执行。[[intent:general]]"
用户: "打开终端" → "这就为你打开终端。[[intent:terminal]]"
用户: "帮我连远程桌面" → "好的，正在连接 VNC 远程桌面。[[intent:vnc]]"
用户: "烧录 Ubuntu 22.04" → "准备烧录 Ubuntu 22.04 到当前设备，确认后即刻开始。[[intent:flash]]"
用户: "看看网关状态" → "帮你查一下 OpenClaw 网关运行情况。[[intent:openclaw_status]]"
用户: "启动小龙虾" → "正在启动 OpenClaw AI 网关服务。[[intent:openclaw_start]]"
用户: "切换到 deepseek" → "好的，准备切换到 deepseek 模型。[[intent:openclaw_switch|deepseek-chat]]"
用户: "把模型传到板子上" → "这就帮你同步模型文件到设备。[[intent:file_upload]]"
用户: "下载 aaa.txt" → "好的，帮你从设备拉取该文件。[[intent:file_download|aaa.txt]]"
用户: "扫描一下有哪些ROS话题" → "开始扫描 ROS2 DDS 域内的活跃话题。[[intent:ros_scan]]"
用户: "开始录制话题" → "好的，开始录制 ROS2 话题数据。[[intent:ros_record_start]]"
用户: "停止录制" → "已停止 ROS2 录制。[[intent:ros_record_stop]]"
用户: "部署 YOLOv5 到 BPU" → "准备将 YOLOv5 转换并部署到 BPU，需要确认后开始。[[intent:model_deploy]]"
用户: "有哪些模型" → "帮你列一下设备上的模型。[[intent:model_list]]"
用户: "跑一个示例" → "给你看看可用的示例应用。[[intent:example_run]]"
用户: "扫描局域网设备" → "好的，帮你扫描一下局域网内的 RDK 设备。[[intent:device_scan]]"
用户: "去设置页面" → "这就打开设置。[[intent:settings]]"
用户: "去硬件监控页面" → "好的，帮你打开硬件监控。[[intent:nav|hardware]]"
用户: "你好" → "你好！我是小地瓜，你的 RDK 开发助手。有什么可以帮你的？[[intent:general]]"

重要注意：
- 每条回复必须包含且只包含一个 [[intent:xxx]] 标签，放在最末尾
- 标签格式必须严格，不要有空格或换行
- 如果用户请求涉及执行某个具体 shell 命令（如 ls、cat、top、ros2、hrut_smi 等），使用 terminal_cmd 并带上完整命令
- 如果用户说"帮我看看xxx"但不涉及具体命令执行，根据语义选择 hardware_check、ros_scan 或 model_list 等
- 如果用户说的话模棱两可，选择最可能的意图，不要用 general 兜底
- 对于「打开xxx页面」「去xxx」类请求，优先用 nav 而不是具体功能的 intent
- 仅当确实无法判断动作时才可使用 general；包含“ros/话题/vnc/ssh/node-red/openclaw/模型/示例/文件/烧录”等关键词时，必须路由到对应 intent`;

  try {
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-8).map((m) => ({
        role: m.role === 'ai' ? 'assistant' : m.role,
        content: m.content,
      })),
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const upstreamResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: apiMessages,
        temperature: 0.7,
        max_tokens: 300,
        enable_thinking: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const payload = (await upstreamResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (!upstreamResponse.ok) {
      response.status(500).json({ error: payload.error?.message ?? '模型调用失败' });
      return;
    }

    const content = payload.choices?.[0]?.message?.content?.trim() ?? '';
    // Strip any <think>...</think> tags the model might produce
    const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    response.json({ reply: cleaned || '收到，请稍候。' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      response.status(504).json({ error: '模型响应超时' });
      return;
    }
    response.status(500).json({
      error: error instanceof Error ? `模型调用失败: ${error.message}` : '模型调用失败',
    });
  }
});

io.on('connection', (socket) => {
  let sshClient: Client | null = null;
  let sshStream: any = null;
  let openclawChatSession: { abort: () => void } | null = null;

  // OpenClaw Chat Events
  socket.on('openclaw:start', async (config) => {
    const { deviceId } = config;
    try {
      const devices = await readDevices();
      const device = devices.find(d => d.id === deviceId);
      if (!device) {
        socket.emit('openclaw:error', { error: 'Device not found' });
        return;
      }

      const deviceObj = { ip: device.host, userName: device.username, id: device.id };
      
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
        `session-${socket.id}`
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

      const deviceObj = { ip: device.host, userName: device.username, id: device.id };
      
      openclawChatSession = openClawManager.sendAgentMessage(
        message,
        (chunk) => {
          socket.emit('openclaw:data', { chunk });
        },
        (success) => {
          socket.emit('openclaw:complete', { success });
          openclawChatSession = null;
        },
        `session-${socket.id}`,
        deviceObj
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
        const deviceObj = { ip: device.host, userName: device.username, id: device.id };
        openClawManager.stopInteractiveChat(`session-${socket.id}`, deviceObj);
      }
    } catch (e: any) {
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
    sshStream?.end();
    sshClient?.end();
  });
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`RDK Studio server running on http://0.0.0.0:${port}`);
});