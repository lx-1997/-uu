/**
 * AI Orchestrator — Main Coordinator
 *
 * Pipeline:  User input → AI reply → parse intent → find capability
 *           → build blocks + create task → execute side effect
 *
 * This module is framework-agnostic (no React imports).
 * It receives AppActions to call real app functions.
 */

import type { ChatBlock } from '../app-types';
import type {
  IntentId,
  IntentResult,
  AppActions,
  OrchestratorOutput,
  Task,
} from './types';
import { getCapability } from './capabilities';
import { parseAIResponse, detectIntentByKeyword } from './intent';
import { createTask } from './executor';

// ─── Intent Handlers ───
// Each handler produces blocks + sideEffect + optional task.

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
      return {
        text: '\u8bf7\u544a\u8bc9\u6211\u4f60\u60f3\u6267\u884c\u4ec0\u4e48\u547d\u4ee4\uff1f\u4f8b\u5982\uff1a"\u6267\u884c top" \u6216 "\u8fd0\u884c hrut_smi"',
        blocks: [],
      };
    }
    const command = cmdText.trim();
    return {
      text: '',
      blocks: [
        { type: 'terminal', lines: [`root@rdk:~# ${command}`] },
      ],
      sideEffect: () => { actions.runTerminalCommand(command); },
    };
  },

  file_upload: (_p, actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      actions.appendTransferTask();
      const task = createTask('file_upload', [
        { label: '建立 SFTP 连接' }, { label: '上传文件' }, { label: '校验' },
      ]);
      startTaskAnimation(task, '文件上传流程完成', `${actions.currentDeviceIp} · 请以设备端实际输出为准`, [
        { type: 'terminal', lines: [`$ sftp root@${actions.currentDeviceIp}`, 'Connected', 'sftp> put <local-file> <remote-path>', '上传完成请在文件页核验实际结果'] },
      ]);
    },
  }),

  file_download: (_p, actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      const task = createTask('file_download', [
        { label: '建立 SFTP 连接' }, { label: '下载文件' }, { label: '校验' },
      ]);
      startTaskAnimation(task, '文件下载流程完成', `${actions.currentDeviceIp} · 请以设备端实际输出为准`, [
        { type: 'terminal', lines: [`$ sftp root@${actions.currentDeviceIp}`, 'Connected', 'sftp> get <remote-file> <local-path>', '下载完成请核验文件内容与大小'] },
      ]);
    },
  }),

  vnc: (_p, actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      actions.startVncSession();
      const task = createTask('vnc', [
        { label: '启动 VNC 服务' }, { label: '建立连接' }, { label: '渲染桌面' },
      ]);
      startTaskAnimation(task, '远程桌面流程完成', `${actions.currentDeviceIp}:5900 · 连接状态以设备检测结果为准`, [
        { type: 'status', items: [{ label: 'VNC 检查', value: '请查看设备服务输出', ok: true }] },
      ]);
    },
  }),

  openclaw_start: (_p, actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      const task = createTask('openclaw_start', [
        { label: '加载配置' }, { label: '初始化 Agent' }, { label: '注册技能' }, { label: '启动服务' },
      ]);
      startTaskAnimation(task, 'OpenClaw 启动流程完成', '请以板端 openclaw/clawctl 输出为准', [
        { type: 'status', items: [
          { label: '服务状态', value: '实时检查', ok: true },
          { label: '端口', value: '以设备输出为准', ok: true },
          { label: '模型', value: '以设备输出为准', ok: true },
          { label: '技能', value: '以设备输出为准', ok: true },
        ]},
      ]);
      void actions.openClawStartOnBoard();
    },
  }),

  openclaw_status: (_p, actions) => ({
    text: '',
    blocks: [
      { type: 'status', items: [
        { label: '服务状态', value: '实时检查中', ok: true },
        { label: '调用统计', value: '以真实网关日志为准', ok: true },
        { label: '当前模型', value: '以设备状态输出为准', ok: true },
        { label: '技能状态', value: '以设备状态输出为准', ok: true },
      ]},
      { type: 'terminal', lines: [
        '$ openclaw status 或 clawctl status',
        '请查看板端实时输出获取准确状态',
      ]},
    ],
    sideEffect: () => { void actions.openClawStatusOnBoard(); },
  }),

  openclaw_switch: (modelName, actions, registerConfirm, startTaskAnimation) => {
    const target = modelName || 'deepseek-chat';
    const cid = `switch-model-${Date.now()}`;
    registerConfirm(cid, () => {
      const task = createTask('openclaw_switch', [
        { label: '验证 API Key' }, { label: '切换模型' }, { label: '重载配置' },
      ]);
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
      const task = createTask('hardware_check', [
        { label: '读取芯片温度' }, { label: '检测 BPU 占用' }, { label: '检测内存' }, { label: '检测网络' },
      ]);
      startTaskAnimation(task, '诊断流程完成', `${actions.currentDeviceName} · 结果以实时诊断输出为准`, [
        { type: 'status', items: [
          { label: 'BPU 占用', value: '实时读取', ok: true },
          { label: '芯片温度', value: '实时读取', ok: true },
          { label: '内存使用', value: '实时读取', ok: true },
          { label: '系统运行', value: '实时读取', ok: true },
        ]},
        { type: 'terminal', lines: [
          '$ cat /sys/class/thermal/thermal_zone0/temp',
          '$ hrut_smi || bputop',
          '$ free -h',
          '请以设备命令实时输出判定当前健康状态',
        ]},
      ]);
    },
  }),

  ros_scan: (_p, _actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      const task = createTask('ros_scan', [
        { label: '连接 ROS2 DDS' }, { label: '枚举话题' }, { label: '采样频率' },
      ]);
      startTaskAnimation(task, 'ROS2 话题扫描流程完成', '话题与频率请以 ros2 实时命令输出为准', [
        { type: 'terminal', lines: [
          '$ ros2 topic list',
          '$ ros2 topic hz /<topic_name>',
          '请查看设备端实时话题与频率输出',
        ]},
        { type: 'status', items: [{ label: 'ROS 结果', value: '以设备实时输出为准', ok: true }] },
      ]);
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
      const task = createTask('model_deploy', [
        { label: 'ONNX → Horizon' }, { label: '量化校准' }, { label: '编译 BPU bin' }, { label: '部署到设备' },
      ]);
      startTaskAnimation(task, '模型部署流程完成', '模型精度与 FPS 请以设备侧测试结果为准');
    });
    return {
      text: '',
      blocks: [
        { type: 'status', items: [
          { label: '模型部署', value: '将执行板端真实命令', ok: true },
          { label: '执行结果', value: '以终端输出为准', ok: true },
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
        { label: '状态来源', value: '实时设备输出', ok: true },
      ]},
    ],
  }),

  example_run: (_p, _actions, registerConfirm, startTaskAnimation) => {
    const cid = `run-demo-${Date.now()}`;
    registerConfirm(cid, () => {
      const task = createTask('example_run', [
        { label: '检查依赖' }, { label: '启动摄像头' }, { label: '加载检测模型' }, { label: '运行跟随算法' },
      ]);
      startTaskAnimation(task, '示例运行流程已触发', '请以设备端示例日志与视频输出为准', [
        { type: 'status', items: [{ label: '结果来源', value: '以设备命令输出为准', ok: true }] },
      ]);
    });
    return {
      text: '',
      blocks: [
        { type: 'status', items: [
          { label: '示例执行', value: '将下发板端真实启动命令', ok: true },
          { label: '依赖状态', value: '以设备检测结果为准', ok: true },
        ]},
        { type: 'confirm', text: '确认运行所选示例命令？', confirmId: cid },
      ],
    };
  },

  workflow: (_p, actions) => ({
    text: '',
    blocks: [
      { type: 'code', lang: 'json', content: '{\n  "templates": [\n    "视觉感知流水线",\n    "设备运维自动化",\n    "社区示例合集"\n  ]\n}' },
      { type: 'status', items: [
        { label: '视觉感知', value: '节点数以实际流程为准', ok: true },
        { label: '设备运维', value: '节点数以实际流程为准', ok: true },
        { label: '社区合集', value: '节点数以实际流程为准', ok: true },
      ]},
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
  /** Raw AI response (null if API failed) */
  aiResponse: string | null;
  /** Original user message (for keyword fallback) */
  userText: string;
  /** App action bridge */
  actions: AppActions;
  /** Register a pending confirmation action */
  registerConfirm: (confirmId: string, action: () => void) => void;
  /** Start animated task progression in chat */
  startTaskAnimation: (task: Task, resultTitle: string, resultDetail: string, extraBlocks?: ChatBlock[]) => void;
}

/**
 * Main entry point: process one user command through the full pipeline.
 *
 * 1. Parse AI response (or fall back to keyword detection)
 * 2. Look up capability
 * 3. Execute handler → get blocks + sideEffect
 * 4. Return everything for the UI to render
 */
export function orchestrate(params: OrchestrateParams): OrchestratorOutput {
  const { aiResponse, userText, actions, registerConfirm, startTaskAnimation } = params;

  // Step 1: Determine intent
  let parsed: IntentResult;
  if (aiResponse) {
    parsed = parseAIResponse(aiResponse);
    if (parsed.intent === 'general') {
      const keywordParsed = detectIntentByKeyword(userText);
      if (keywordParsed.intent !== 'general') {
        parsed = {
          text: parsed.text,
          intent: keywordParsed.intent,
          param: keywordParsed.param,
        };
      }
    }
  } else {
    parsed = detectIntentByKeyword(userText);
  }

  // Step 2: Look up capability (for logging / future use)
  const _capability = getCapability(parsed.intent);

  // Step 3: Execute handler
  const handler = handlers[parsed.intent] ?? handlers.general;
  const result = handler(parsed.param, actions, registerConfirm, startTaskAnimation);

  // Step 4: Determine display text
  const displayText = parsed.text || result.text || getFallbackText(parsed.intent, actions.currentDeviceName);

  return {
    text: displayText,
    blocks: result.blocks,
    sideEffect: result.sideEffect,
    task: result.task,
  };
}
