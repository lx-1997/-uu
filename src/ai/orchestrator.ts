/**
 * AI Orchestrator — Main Coordinator
 *
 * Supports two routing modes:
 *   1. Skill-driven (new): [[skill:name/action|params]] → API call
 *   2. Legacy intent (backward compat): [[intent:xxx|param]] → hardcoded handler
 *
 * The system prompt now includes SKILL.md descriptions, so the AI model
 * will gradually shift to using [[skill:...]] tags.
 */

import type { ChatBlock, Tab } from '../app-types';
import type {
  IntentId,
  IntentResult,
  AppActions,
  OrchestratorOutput,
  Task,
  ParsedTag,
} from './types';
import { parseAIResponseV2 } from './intent';
import { createTask } from './executor';

// ─── Skill-based API execution ───

function getApiBase(): string {
  const isDesktop = !!(window as any).rdkDesktop?.isDesktop;
  if (isDesktop) return 'http://localhost:8787';
  if ((import.meta as any).env?.DEV) return 'http://localhost:8787';
  return '';
}

async function callSkillAPI(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; data: any; error?: string }> {
  try {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${getApiBase()}${path}`, opts);
    const data = await res.json();
    return { ok: res.ok && data.ok !== false, data };
  } catch (err) {
    return { ok: false, data: null, error: err instanceof Error ? err.message : 'API call failed' };
  }
}

function resolveSkillAPIPath(skill: string, action: string, deviceId: string): { method: string; path: string } | null {
  const d = deviceId;
  const routeMap: Record<string, { method: string; path: string }> = {
    'rdk-flash/check': { method: 'POST', path: `/api/devices/${d}/flash/check` },
    'rdk-flash/execute': { method: 'POST', path: `/api/devices/${d}/flash/execute` },
    'rdk-flash/verify': { method: 'POST', path: `/api/devices/${d}/flash/verify` },
    'rdk-flash/download': { method: 'POST', path: `/api/devices/${d}/flash/download` },
    'rdk-terminal/create': { method: 'POST', path: `/api/devices/${d}/terminal/create` },
    'rdk-terminal/exec': { method: 'POST', path: `/api/devices/${d}/exec` },
    'rdk-vnc/status': { method: 'GET', path: `/api/devices/${d}/services/vnc` },
    'rdk-vnc/start': { method: 'POST', path: `/api/devices/${d}/services/vnc/start` },
    'rdk-vnc/stop': { method: 'POST', path: `/api/devices/${d}/services/vnc/stop` },
    'rdk-files/list': { method: 'GET', path: `/api/devices/${d}/files/list` },
    'rdk-files/upload': { method: 'POST', path: `/api/devices/${d}/files/upload` },
    'rdk-files/download': { method: 'GET', path: `/api/devices/${d}/files/download` },
    'rdk-hardware/diagnose': { method: 'GET', path: `/api/devices/${d}/diagnostics` },
    'rdk-openclaw/start': { method: 'POST', path: `/api/openclaw/agent-action` },
    'rdk-openclaw/status': { method: 'POST', path: `/api/openclaw/agent-action` },
    'rdk-openclaw/switch': { method: 'POST', path: `/api/openclaw/agent-action` },
    'rdk-ros/topics': { method: 'GET', path: `/api/devices/${d}/ros/topics` },
    'rdk-ros/nodes': { method: 'GET', path: `/api/devices/${d}/ros/nodes` },
    'rdk-ros/record-start': { method: 'POST', path: `/api/devices/${d}/ros/record/start` },
    'rdk-ros/record-stop': { method: 'POST', path: `/api/devices/${d}/ros/record/stop` },
    'rdk-models/list': { method: 'GET', path: `/api/devices/${d}/models/list` },
    'rdk-models/deploy': { method: 'POST', path: `/api/devices/${d}/models/deploy` },
    'rdk-examples/run': { method: 'POST', path: `/api/devices/${d}/examples/run` },
    'rdk-workflow/node-red-status': { method: 'GET', path: `/api/devices/${d}/services/node-red` },
    'rdk-workflow/node-red-start': { method: 'POST', path: `/api/devices/${d}/services/node-red/start` },
    'rdk-device/list': { method: 'GET', path: `/api/devices` },
    'rdk-device/scan': { method: 'POST', path: `/api/devices/scan` },
    'rdk-device/ping': { method: 'GET', path: `/api/devices/${d}/ping` },
  };
  return routeMap[`${skill}/${action}`] ?? null;
}

/**
 * Convert a natural language task to shell commands via AI, then execute on device.
 */
async function generateAndExecuteCommand(
  taskDescription: string,
  deviceId: string,
  actions: AppActions,
): Promise<void> {
  try {
    const res = await fetch(`${getApiBase()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: `请直接生成可在Linux上执行的shell命令来完成以下任务，只输出命令，不要解释：\n${taskDescription}`,
          },
        ],
        deviceName: actions.currentDeviceName,
        deviceIp: actions.currentDeviceIp,
      }),
    });

    if (!res.ok) {
      window.dispatchEvent(new CustomEvent('AI_APPEND_CHAT', {
        detail: { text: '命令生成失败，请尝试直接输入 shell 命令。' },
      }));
      return;
    }

    const data = await res.json();
    let reply = (data.reply || '').replace(/\[\[(intent|skill|action|confirm):[^\]]*\]\]/g, '').trim();

    // Extract code block content if wrapped in ```
    const codeBlockMatch = reply.match(/```(?:bash|sh|shell)?\s*\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      reply = codeBlockMatch[1].trim();
    }

    // Clean up: take lines that look like shell commands
    const cmdLines = reply.split(/\r?\n/)
      .map((l: string) => l.trim())
      .filter((l: string) => l && !l.startsWith('#') && !l.startsWith('//'));
    const command = cmdLines.join(' && ');

    if (!command) {
      window.dispatchEvent(new CustomEvent('AI_APPEND_CHAT', {
        detail: { text: 'AI 未能生成有效命令。请尝试直接输入命令。' },
      }));
      return;
    }

    window.dispatchEvent(new CustomEvent('AI_APPEND_CHAT', {
      detail: {
        text: '已生成命令，正在执行...',
        blocks: [{ type: 'terminal', lines: [`$ ${command}`, '执行中...'] }],
      },
    }));

    const execResult = await callSkillAPI('POST', `/api/devices/${deviceId}/exec`, { command });
    const output = execResult.data?.output ?? execResult.error ?? '无输出';
    const outputLines = output.split(/\r?\n/).slice(0, 60);

    window.dispatchEvent(new CustomEvent('AI_APPEND_CHAT', {
      detail: {
        text: '',
        blocks: [
          { type: 'terminal', lines: [`$ ${command}`, ...outputLines] },
          { type: 'status', items: [
            { label: '状态', value: execResult.ok ? '执行成功' : '执行失败', ok: execResult.ok },
          ]},
        ],
      },
    }));
  } catch (err) {
    window.dispatchEvent(new CustomEvent('AI_APPEND_CHAT', {
      detail: { text: `命令生成/执行出错: ${err instanceof Error ? err.message : '未知错误'}` },
    }));
  }
}

function enrichOpenClawBody(action: string, params?: Record<string, unknown>): Record<string, unknown> {
  const actionMap: Record<string, string> = {
    start: 'start', status: 'status', switch: 'switch',
    install: 'install', logs: 'logs',
  };
  return { action: actionMap[action] || action, ...params };
}

function handleSkillTag(
  tag: Extract<ParsedTag, { type: 'skill' }>,
  actions: AppActions,
  startTaskAnimation: (task: Task, title: string, detail: string, extra?: ChatBlock[]) => void,
): OrchestratorOutput {
  const { skill, action, params } = tag;
  const deviceId = actions.currentDeviceId;

  const route = resolveSkillAPIPath(skill, action, deviceId);
  if (!route) {
    return {
      text: `技能 ${skill}/${action} 的 API 路由未找到。`,
      blocks: [{ type: 'status', items: [{ label: '技能', value: `${skill}/${action}`, ok: false }] }],
    };
  }

  const isTerminalExec = skill === 'rdk-terminal' && action === 'exec' && params?.command;
  const cmdText = String(params?.command ?? '');

  if (isTerminalExec) {
    return {
      text: '',
      blocks: [{ type: 'terminal', lines: [`$ ${cmdText}`, '执行中...'] }],
      sideEffect: () => {
        callSkillAPI(route.method, route.path, { command: cmdText })
          .then((result) => {
            const output = result.data?.output ?? result.error ?? '无输出';
            const lines = output.split(/\r?\n/).slice(0, 60);
            window.dispatchEvent(new CustomEvent('AI_APPEND_CHAT', {
              detail: {
                text: '',
                blocks: [
                  { type: 'terminal', lines: [`$ ${cmdText}`, ...lines] },
                  { type: 'status', items: [
                    { label: '状态', value: result.ok ? '执行成功' : '执行失败', ok: result.ok },
                    { label: '命令', value: cmdText.length > 40 ? cmdText.slice(0, 40) + '...' : cmdText, ok: true },
                  ]},
                ],
              },
            }));
          });
      },
    };
  }

  // All other skills: execute API, render result in chat (no page navigation)
  return {
    text: '',
    blocks: [{ type: 'status', items: [{ label: `${skill}/${action}`, value: '执行中...', ok: true }] }],
    sideEffect: () => {
      let body = params ?? {};
      if (skill === 'rdk-openclaw') body = enrichOpenClawBody(action, params);

      callSkillAPI(route.method, route.path, Object.keys(body).length > 0 ? body as Record<string, unknown> : undefined)
        .then((result) => {
          const blocks: ChatBlock[] = [];

          // Render output as terminal block if it's text
          const output = result.data?.output ?? result.data?.result;
          if (typeof output === 'string' && output.trim()) {
            blocks.push({ type: 'terminal', lines: output.split(/\r?\n/).slice(0, 50) });
          }

          // Render structured data as status cards
          if (result.data && typeof result.data === 'object') {
            const statusItems: { label: string; value: string; ok: boolean }[] = [];
            const skip = new Set(['ok', 'output', 'result', 'error']);
            for (const [k, v] of Object.entries(result.data)) {
              if (skip.has(k) || v === null || v === undefined) continue;
              if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                statusItems.push({ label: k, value: String(v), ok: result.ok });
              }
            }
            if (statusItems.length > 0) {
              blocks.push({ type: 'status', items: statusItems });
            }
          }

          // Always add a summary status
          blocks.push({
            type: 'status',
            items: [{ label: `${skill}/${action}`, value: result.ok ? '完成' : '失败', ok: result.ok }],
          });

          window.dispatchEvent(new CustomEvent('AI_APPEND_CHAT', {
            detail: {
              text: result.ok ? '' : (result.error || `${skill}/${action} 执行失败`),
              blocks,
            },
          }));
        });
    },
  };
}

function handleConfirmTag(
  tag: Extract<ParsedTag, { type: 'confirm' }>,
  actions: AppActions,
  registerConfirm: (confirmId: string, action: () => void) => void,
  startTaskAnimation: (task: Task, title: string, detail: string, extra?: ChatBlock[]) => void,
): OrchestratorOutput {
  const { skill, action, params } = tag;
  const cid = `confirm-${skill}-${action}-${Date.now()}`;
  const deviceId = actions.currentDeviceId;

  registerConfirm(cid, () => {
    const route = resolveSkillAPIPath(skill, action, deviceId);
    if (!route) {
      actions.addToast(`技能 ${skill}/${action} 的 API 路由未找到`, 'error');
      return;
    }

    let body = params ?? {};
    if (skill === 'rdk-openclaw') body = enrichOpenClawBody(action, params);

    const task = createTask('general' as IntentId, [
      { label: '用户已确认' },
      { label: `执行 ${skill}/${action}` },
      { label: '等待结果' },
    ]);
    startTaskAnimation(task, `${skill}/${action} 完成`, '请查看结果');

    callSkillAPI(route.method, route.path, Object.keys(body).length > 0 ? body as Record<string, unknown> : undefined)
      .then((result) => {
        if (result.ok) {
          actions.addToast(`${skill}/${action} 执行成功`, 'success');
        } else {
          actions.addToast(`${skill}/${action} 执行失败`, 'error');
        }
      });
  });

  return {
    text: '',
    blocks: [
      { type: 'confirm', text: `确认执行 ${skill}/${action}？`, confirmId: cid },
    ],
  };
}

function handleActionTag(
  tag: Extract<ParsedTag, { type: 'action' }>,
  actions: AppActions,
): OrchestratorOutput {
  const { actionType, target } = tag;

  return {
    text: '',
    sideEffect: () => {
      switch (actionType) {
        case 'navigate':
          if (target) {
            actions.openWorkspace(target as any, `正在打开 ${target}...`);
          }
          break;
        case 'openSettings':
          actions.setShowSettings(true);
          break;
        case 'openVnc':
          actions.startVncSession();
          break;
        case 'createTerminal':
          actions.createSession();
          actions.setActiveTab('terminal');
          break;
        case 'startDiagnostic':
          actions.setDiagnosticOpen(true);
          break;
        case 'scanDevices':
          actions.scanForDevices();
          break;
        case 'runFlowValidation':
          actions.runFlowValidation();
          break;
        default:
          actions.addToast(`未知操作: ${actionType}`, 'warning');
      }
    },
  };
}

function getSkillTab(skill: string): string | null {
  const map: Record<string, string> = {
    'rdk-flash': 'flasher',
    'rdk-terminal': 'terminal',
    'rdk-vnc': 'vnc',
    'rdk-files': 'files',
    'rdk-hardware': 'hardware',
    'rdk-openclaw': 'openclaw',
    'rdk-ros': 'ros',
    'rdk-models': 'models',
    'rdk-examples': 'examples',
    'rdk-workflow': 'lowcode',
    'rdk-ide': 'ide',
  };
  return map[skill] ?? null;
}

// ─── Legacy Intent Handlers (kept for backward compatibility) ───

type HandlerFn = (
  param: string | undefined,
  actions: AppActions,
  registerConfirm: (confirmId: string, action: () => void) => void,
  startTaskAnimation: (task: Task, resultTitle: string, resultDetail: string, extraBlocks?: ChatBlock[]) => void,
) => OrchestratorOutput;

const handlers: Record<IntentId, HandlerFn> = {

  flash: (_p, actions, registerConfirm, startTaskAnimation) => {
    const cid = `flash-${Date.now()}`;
    registerConfirm(cid, () => {
      actions.startFlash();
      actions.addToast('镜像烧录已启动', 'info');
      const task = createTask('flash', [
        { label: '检查存储介质' }, { label: '下载镜像' }, { label: '写入镜像' }, { label: '校验完整性' },
      ]);
      startTaskAnimation(task, '烧录完成', `${actions.currentDeviceName} 镜像烧录成功 · Ubuntu 22.04 · 2.1 GB`);
    });
    return {
      text: '',
      blocks: [
        { type: 'status', items: [
          { label: 'Ubuntu 22.04', value: '2.1 GB', ok: true },
          { label: 'ROS2 Humble', value: '3.4 GB', ok: true },
          { label: 'TROS AI', value: '4.2 GB', ok: true },
        ]},
        { type: 'confirm', text: `确认烧录 Ubuntu 22.04 到 ${actions.currentDeviceName}？此操作将覆盖目标存储`, confirmId: cid },
      ],
    };
  },

  terminal: (_p, actions) => ({
    text: '',
    blocks: [
      { type: 'terminal', lines: [
        `$ ssh root@${actions.currentDeviceIp}`,
        `Welcome to Ubuntu 22.04.3 LTS (RDK X5)`,
        `Last login: ${new Date().toLocaleString()}`,
        `${actions.currentDeviceName}@rdk:~$`,
      ]},
    ],
    sideEffect: () => { actions.createSession(); actions.setActiveTab('terminal'); },
  }),

  terminal_cmd: (cmdText, actions) => {
    if (!cmdText?.trim()) {
      return { text: '请告诉我你想执行什么命令？例如："执行 top" 或 "运行 hrut_smi"', blocks: [] };
    }

    const raw = cmdText.trim();
    const deviceId = actions.currentDeviceId;
    const looksLikeShell = /^[a-z\/~.]|&&|\||;|<<|>>/.test(raw);

    if (looksLikeShell && deviceId) {
      return {
        text: '',
        blocks: [{ type: 'terminal', lines: [`$ ${raw}`, '执行中...'] }],
        sideEffect: () => {
          callSkillAPI('POST', `/api/devices/${deviceId}/exec`, { command: raw })
            .then((result) => {
              const output = result.data?.output ?? result.error ?? '无输出';
              const lines = output.split(/\r?\n/).slice(0, 60);
              window.dispatchEvent(new CustomEvent('AI_APPEND_CHAT', {
                detail: {
                  text: '',
                  blocks: [
                    { type: 'terminal', lines: [`$ ${raw}`, ...lines] },
                    { type: 'status', items: [{ label: '状态', value: result.ok ? '执行成功' : '执行失败', ok: result.ok }] },
                  ],
                },
              }));
            });
        },
      };
    }

    if (deviceId) {
      return {
        text: '正在分析你的需求并生成命令...',
        blocks: [{ type: 'status', items: [{ label: '任务', value: raw.slice(0, 60), ok: true }] }],
        sideEffect: () => {
          generateAndExecuteCommand(raw, deviceId, actions);
        },
      };
    }

    return { text: '请先连接设备后再执行命令。', blocks: [] };
  },

  file_upload: (_p, actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      window.dispatchEvent(new CustomEvent('AI_FILE_UPLOAD'));
      actions.appendTransferTask();
      const task = createTask('file_upload', [{ label: '建立 SFTP 连接' }, { label: '上传文件' }, { label: '校验' }]);
      startTaskAnimation(task, '文件上传流程完成', `${actions.currentDeviceIp} · 请以设备端实际输出为准`);
    },
  }),

  file_download: (_p, actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      window.dispatchEvent(new CustomEvent('AI_FILE_DOWNLOAD', { detail: _p }));
      const task = createTask('file_download', [{ label: '建立 SFTP 连接' }, { label: '下载文件' }, { label: '校验' }]);
      startTaskAnimation(task, '文件下载流程完成', `${actions.currentDeviceIp} · 请以设备端实际输出为准`);
    },
  }),

  vnc: (_p, actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      actions.startVncSession();
      const task = createTask('vnc', [{ label: '启动 VNC 服务' }, { label: '建立连接' }, { label: '渲染桌面' }]);
      startTaskAnimation(task, '远程桌面流程完成', `${actions.currentDeviceIp}:5900 · 连接状态以设备检测结果为准`);
    },
  }),

  openclaw_start: (_p, actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      const task = createTask('openclaw_start', [{ label: '加载配置' }, { label: '初始化 Agent' }, { label: '注册技能' }, { label: '启动服务' }]);
      startTaskAnimation(task, 'OpenClaw 启动流程完成', '请以板端 openclaw/clawctl 输出为准');
      void actions.openClawStartOnBoard();
    },
  }),

  openclaw_status: (_p, actions) => ({
    text: '',
    blocks: [
      { type: 'status', items: [
        { label: '服务状态', value: '实时检查中', ok: true },
        { label: '当前模型', value: '以设备状态输出为准', ok: true },
      ]},
    ],
    sideEffect: () => { void actions.openClawStatusOnBoard(); },
  }),

  openclaw_switch: (modelName, actions, registerConfirm, startTaskAnimation) => {
    const target = modelName || 'deepseek-chat';
    const cid = `switch-model-${Date.now()}`;
    registerConfirm(cid, () => {
      const task = createTask('openclaw_switch', [{ label: '验证 API Key' }, { label: '切换模型' }, { label: '重载配置' }]);
      startTaskAnimation(task, '模型切换完成', `已切换到 ${target}`);
      void actions.openClawSwitchOnBoard(target);
    });
    return {
      text: '',
      blocks: [
        { type: 'status', items: [
          { label: '当前模型', value: 'qwen3.5-plus', ok: true },
          { label: '目标模型', value: target, ok: true },
        ]},
        { type: 'confirm', text: `确认切换到 ${target}？`, confirmId: cid },
      ],
    };
  },

  hardware_check: (_p, actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      actions.setDiagnosticOpen(true);
      actions.setDiagnosticStep(0);
      const task = createTask('hardware_check', [{ label: '读取芯片温度' }, { label: '检测 BPU 占用' }, { label: '检测内存' }, { label: '检测网络' }]);
      startTaskAnimation(task, '诊断流程完成', `${actions.currentDeviceName} · 结果以实时诊断输出为准`);
    },
  }),

  ros_scan: (_p, _actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      const task = createTask('ros_scan', [{ label: '连接 ROS2 DDS' }, { label: '枚举话题' }, { label: '采样频率' }]);
      startTaskAnimation(task, 'ROS2 话题扫描流程完成', '话题与频率请以 ros2 实时命令输出为准');
    },
  }),

  ros_record_start: (_p, actions) => ({
    text: '',
    sideEffect: () => {
      actions.setRosRecording(true);
      actions.addToast('ROS2 话题录制已开始', 'success');
      actions.addActivity('开始 ROS2 话题录制');
    },
  }),

  ros_record_stop: (_p, actions) => ({
    text: '',
    sideEffect: () => {
      actions.setRosRecording(false);
      actions.addToast('ROS2 话题录制已停止', 'info');
      actions.addActivity('停止 ROS2 话题录制');
    },
  }),

  model_deploy: (_p, _actions, registerConfirm, startTaskAnimation) => {
    const cid = `deploy-model-${Date.now()}`;
    registerConfirm(cid, () => {
      const task = createTask('model_deploy', [{ label: 'ONNX → Horizon' }, { label: '量化校准' }, { label: '编译 BPU bin' }, { label: '部署到设备' }]);
      startTaskAnimation(task, '模型部署流程完成', '模型精度与 FPS 请以设备侧测试结果为准');
    });
    return {
      text: '',
      blocks: [
        { type: 'status', items: [
          { label: '模型部署', value: '将执行板端真实命令', ok: true },
        ]},
        { type: 'confirm', text: '确认执行当前模型部署命令？', confirmId: cid },
      ],
    };
  },

  model_list: () => ({
    text: '',
    blocks: [
      { type: 'status', items: [
        { label: '模型列表', value: '请在模型页执行板端查询命令', ok: true },
      ]},
    ],
  }),

  example_run: (_p, _actions, registerConfirm, startTaskAnimation) => {
    const cid = `run-demo-${Date.now()}`;
    registerConfirm(cid, () => {
      const task = createTask('example_run', [{ label: '检查依赖' }, { label: '启动摄像头' }, { label: '加载检测模型' }, { label: '运行跟随算法' }]);
      startTaskAnimation(task, '示例运行流程已触发', '请以设备端示例日志与视频输出为准');
    });
    return {
      text: '',
      blocks: [
        { type: 'confirm', text: '确认运行所选示例命令？', confirmId: cid },
      ],
    };
  },

  workflow: (_p, actions) => ({
    text: '',
    blocks: [
      { type: 'code', lang: 'json', content: '{\n  "templates": [\n    "视觉感知流水线",\n    "设备运维自动化",\n    "社区示例合集"\n  ]\n}' },
    ],
    sideEffect: () => { actions.runFlowValidation(); },
  }),

  device_scan: (_p, actions) => ({
    text: '',
    sideEffect: () => { actions.scanForDevices(); },
  }),

  nav: (tab, actions) => {
    const validTabs = ['dashboard','flasher','terminal','files','vnc','lowcode','openclaw','hardware','examples','ros','models'] as const;
    const target = validTabs.find((t) => t === tab) ?? 'dashboard';
    return {
      text: '',
      sideEffect: () => { actions.openWorkspace(target, `正在打开 ${target}...`); },
    };
  },

  settings: (_p, actions) => ({
    text: '',
    sideEffect: () => { actions.setShowSettings(true); },
  }),

  general: () => ({ text: '' }),
};

// ─── Fallback Text ───

function getFallbackText(intent: IntentId, deviceName: string): string {
  const map: Record<string, string> = {
    flash: `好的，为 ${deviceName} 准备镜像烧录。`,
    terminal: `正在连接 ${deviceName} 终端。`,
    terminal_cmd: '正在设备上执行命令。',
    file_upload: `正在同步文件到 ${deviceName}。`,
    file_download: `正在从 ${deviceName} 下载文件。`,
    vnc: `正在连接 ${deviceName} 远程桌面。`,
    openclaw_start: '正在启动 OpenClaw 网关。',
    openclaw_status: 'OpenClaw 网关当前状态：',
    openclaw_switch: '正在切换模型...',
    hardware_check: `正在检测 ${deviceName} 硬件状态。`,
    ros_scan: '正在扫描 ROS2 话题。',
    ros_record_start: '开始 ROS2 话题录制。',
    ros_record_stop: '已停止 ROS2 话题录制。',
    model_deploy: '检测到部署请求。',
    model_list: `${deviceName} 上的模型：`,
    example_run: '可用示例应用：',
    workflow: '流程编排工作台：',
    device_scan: '正在扫描局域网设备。',
    settings: '已打开设置。',
    general: `收到！我可以帮你操作 ${deviceName} 上的一切，包括烧录、终端、文件、VNC、OpenClaw、硬件诊断、ROS、模型部署等。你想做什么？`,
  };
  return map[intent] ?? map.general;
}

// ─── Main Orchestration ───

export interface OrchestrateParams {
  aiResponse: string | null;
  userText: string;
  actions: AppActions;
  registerConfirm: (confirmId: string, action: () => void) => void;
  startTaskAnimation: (task: Task, resultTitle: string, resultDetail: string, extraBlocks?: ChatBlock[]) => void;
}

/**
 * Main entry point: process one user command.
 *
 * Philosophy: Trust the AI. The AI model receives SKILL.md context and returns
 * structured tags. We parse those tags and execute them. Keyword matching is
 * ONLY used as absolute last resort when AI is completely offline.
 */
export function orchestrate(params: OrchestrateParams): OrchestratorOutput {
  const { aiResponse, userText, actions, registerConfirm, startTaskAnimation } = params;

  // ── AI responded: parse its output and trust it ──
  if (aiResponse) {
    const parsed = parseAIResponseV2(aiResponse);

    if (parsed.tag.type === 'skill') {
      const result = handleSkillTag(parsed.tag, actions, startTaskAnimation);
      return { ...result, text: parsed.text || result.text };
    }

    if (parsed.tag.type === 'confirm') {
      const result = handleConfirmTag(parsed.tag, actions, registerConfirm, startTaskAnimation);
      return { ...result, text: parsed.text || result.text };
    }

    if (parsed.tag.type === 'action') {
      const result = handleActionTag(parsed.tag, actions);
      return { ...result, text: parsed.text || result.text };
    }

    if (parsed.tag.type === 'legacy') {
      const handler = handlers[parsed.tag.intent] ?? handlers.general;
      const result = handler(parsed.tag.param, actions, registerConfirm, startTaskAnimation);
      return {
        text: parsed.text || result.text || getFallbackText(parsed.tag.intent, actions.currentDeviceName),
        blocks: result.blocks,
        sideEffect: result.sideEffect,
        task: result.task,
      };
    }

    // AI returned plain text with no tags — just display it
    return { text: parsed.text };
  }

  // AI offline — this shouldn't happen (handled upstream), but just in case
  return { text: '抱歉，AI 助手暂时无法连接。' };
}
