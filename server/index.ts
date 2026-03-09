import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { v4 as uuid } from 'uuid';
import type { ChatMessage, Device } from '../shared/types.js';
import { readDevices, writeDevices } from './storage.js';
import { runRemoteCommands, verifySshConnection } from './ssh.js';

const app = express();
const port = Number(process.env.PORT ?? 8787);
const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://coding.dashscope.aliyuncs.com/v1';
const apiKey = process.env.OPENAI_API_KEY ?? '';
const model = process.env.OPENAI_MODEL ?? 'qwen3.5-plus';

app.use(cors());
app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/devices', async (_request, response) => {
  const devices = await readDevices();
  response.json({ devices });
});

app.post('/api/devices/connect', async (request, response) => {
  const { host, username, password } = request.body as {
    host?: string;
    username?: string;
    password?: string;
  };

  if (!host || !username || !password) {
    response.status(400).json({ error: 'host、username、password 均为必填项' });
    return;
  }

  try {
    await verifySshConnection({ host, username, password });

    const devices = await readDevices();
    const now = new Date().toISOString();
    const nextDevice: Device = {
      id: devices.find((device) => device.host === host && device.username === username)?.id ?? uuid(),
      host,
      username,
      status: 'connected',
      lastCheckedAt: now,
    };

    const nextDevices = [
      nextDevice,
      ...devices.filter((device) => !(device.host === host && device.username === username)),
    ];

    await writeDevices(nextDevices);
    response.json({ device: nextDevice });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? `SSH 连接失败: ${error.message}` : 'SSH 连接失败',
    });
  }
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
    response.json({ output, device: nextDevice });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? `OpenClaw 执行失败: ${error.message}` : 'OpenClaw 执行失败',
    });
  }
});

app.post('/api/chat', async (request, response) => {
  if (!apiKey) {
    response.status(500).json({ error: '缺少 OPENAI_API_KEY，请先配置后端环境变量' });
    return;
  }

  const { messages } = request.body as { messages?: ChatMessage[] };

  if (!messages?.length) {
    response.status(400).json({ error: '消息不能为空' });
    return;
  }

  try {
    const upstreamResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      }),
    });

    const payload = (await upstreamResponse.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
      error?: { message?: string };
    };

    if (!upstreamResponse.ok) {
      response.status(500).json({ error: payload.error?.message ?? '模型调用失败' });
      return;
    }

    const content = payload.choices?.[0]?.message?.content?.trim();

    response.json({
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: content || '模型返回了空结果。',
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? `模型调用失败: ${error.message}` : '模型调用失败',
    });
  }
});

app.listen(port, () => {
  console.log(`RDK Studio server running on http://localhost:${port}`);
});