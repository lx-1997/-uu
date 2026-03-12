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
- 可直接操作: 镜像烧录、SSH终端、SFTP文件管理、VNC远程桌面、OpenClaw AI 网关管理、硬件诊断（BPU/温度/内存）、ROS2话题可视化、BPU模型部署、低代码流程编排

技术知识要点（按需引用）：
- RDK X5 使用 Sunrise 5 处理器，10 TOPS BPU 算力，双核 A55 CPU
- RDK X3 使用 Sunrise 3 处理器，5 TOPS BPU，四核 A53
- BPU 正常工作温度 45-75°C，超过 80°C 需散热优化
- hrut_smi 查看 BPU 负载，hobot_dnn 做模型推理
- ONNX 模型转 BPU 需先用 hb_mapper 工具链进行转换和量化
- OpenClaw 是小龙虾 AI Agent 网关，端口 18789，支持多 LLM 后端切换和技能插件

回复规范：
1. 用中文自然回复，2-4句话。复杂问题可展开但不超过6句
2. 绝对不要输出 markdown 格式标记（不要 **加粗**、# 标题、\`代码\`、\`\`\` 代码块、- 列表等），因为 UI 层自动渲染富文本和数据卡片
3. 主动补充有价值的技术细节和你的判断
4. 如果用户想执行某操作，语气上直接表达"帮你处理"或"正在执行"即可，系统会自动触发对应动作
5. 表达自然有人情味，可以说"这个我来"、"没问题"、"搞定"这些口语化表达
6. 不要重复用户已经说过的内容，直接给回应和补充信息`;

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

app.listen(port, '0.0.0.0', () => {
  console.log(`RDK Studio server running on http://0.0.0.0:${port}`);
});