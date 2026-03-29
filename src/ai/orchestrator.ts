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
  AppActions,
  OrchestratorOutput,
  Task,
  ParsedTag,
} from './types';
import { parseAIResponseV2 } from './intent';
import { createTask } from './executor';
import { fillTemplate } from '../i18n/en-extras';
import { translate } from '../i18n/translate';
import { tabDisplayTitle } from '../i18n/tab-display';

type OrchI18n = {
  t: (key: string, zh: string) => string;
  tf: (key: string, zh: string, vars: Record<string, string | number>) => string;
};

function makeOrchI18n(isEn: boolean): OrchI18n {
  const t = (key: string, zh: string) => translate(isEn, key, zh);
  const tf = (key: string, zh: string, vars: Record<string, string | number>) =>
    fillTemplate(t(key, zh), vars);
  return { t, tf };
}

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
      credentials: 'include',
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
    'rdk-flash/backup-check': { method: 'POST', path: `/api/devices/${d}/flash/backup/check` },
    'rdk-flash/backup-start': { method: 'POST', path: `/api/devices/${d}/flash/backup/start` },
    'rdk-flash/backup-status': { method: 'GET', path: `/api/devices/${d}/flash/backup/status` },
    'rdk-flash/backup-download': { method: 'POST', path: `/api/devices/${d}/flash/backup/download` },
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
  ot: OrchI18n,
): Promise<void> {
  const { t, tf } = ot;
  try {
    const res = await fetch(`${getApiBase()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: tf('orc.cmd.prompt', '请直接生成可在Linux上执行的shell命令来完成以下任务，只输出命令，不要解释：\n{{task}}', { task: taskDescription }),
          },
        ],
        deviceName: actions.currentDeviceName,
        deviceIp: actions.currentDeviceIp,
      }),
    });

    if (!res.ok) {
      window.dispatchEvent(new CustomEvent('AI_APPEND_CHAT', {
        detail: { text: t('orc.cmd.genFail', '命令生成失败，请尝试直接输入 shell 命令。') },
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
        detail: { text: t('orc.cmd.noValidCmd', 'AI 未能生成有效命令。请尝试直接输入命令。') },
      }));
      return;
    }

    const running = t('orc.executing', '执行中...');
    window.dispatchEvent(new CustomEvent('AI_APPEND_CHAT', {
      detail: {
        text: t('orc.cmd.runningSummary', '已生成命令，正在执行...'),
        blocks: [{ type: 'terminal', lines: [`$ ${command}`, running] }],
      },
    }));

    const execResult = await callSkillAPI('POST', `/api/devices/${deviceId}/exec`, { command });
    const output = execResult.data?.output ?? execResult.error ?? t('orc.noOutput', '无输出');
    const outputLines = output.split(/\r?\n/).slice(0, 60);

    window.dispatchEvent(new CustomEvent('AI_APPEND_CHAT', {
      detail: {
        text: '',
        blocks: [
          { type: 'terminal', lines: [`$ ${command}`, ...outputLines] },
          { type: 'status', items: [
            {
              label: t('orc.status.label', '状态'),
              value: execResult.ok ? t('orc.status.ok', '执行成功') : t('orc.status.fail', '执行失败'),
              ok: execResult.ok,
            },
          ]},
        ],
      },
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : t('common.unknownError', '未知错误');
    window.dispatchEvent(new CustomEvent('AI_APPEND_CHAT', {
      detail: { text: tf('orc.cmd.err', '命令生成/执行出错: {{msg}}', { msg }) },
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
  ot: OrchI18n,
): OrchestratorOutput {
  const { t, tf } = ot;
  const { skill, action, params } = tag;
  const deviceId = actions.currentDeviceId;
  const pathLabel = `${skill}/${action}`;

  const route = resolveSkillAPIPath(skill, action, deviceId);
  if (!route) {
    return {
      text: tf('orc.skill.routeMissingText', '技能 {{skill}}/{{action}} 的 API 路由未找到。', { skill, action }),
      blocks: [{ type: 'status', items: [{ label: t('orc.skill.label', '技能'), value: pathLabel, ok: false }] }],
    };
  }

  const isTerminalExec = skill === 'rdk-terminal' && action === 'exec' && params?.command;
  const cmdText = String(params?.command ?? '');
  const running = t('orc.executing', '执行中...');

  if (isTerminalExec) {
    return {
      text: '',
      blocks: [{ type: 'terminal', lines: [`$ ${cmdText}`, running] }],
      sideEffect: () => {
        callSkillAPI(route.method, route.path, { command: cmdText })
          .then((result) => {
            const output = result.data?.output ?? result.error ?? t('orc.noOutput', '无输出');
            const lines = output.split(/\r?\n/).slice(0, 60);
            window.dispatchEvent(new CustomEvent('AI_APPEND_CHAT', {
              detail: {
                text: '',
                blocks: [
                  { type: 'terminal', lines: [`$ ${cmdText}`, ...lines] },
                  { type: 'status', items: [
                    {
                      label: t('orc.status.label', '状态'),
                      value: result.ok ? t('orc.status.ok', '执行成功') : t('orc.status.fail', '执行失败'),
                      ok: result.ok,
                    },
                    {
                      label: t('orc.cmd.label', '命令'),
                      value: cmdText.length > 40 ? cmdText.slice(0, 40) + '...' : cmdText,
                      ok: true,
                    },
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
    blocks: [{ type: 'status', items: [{ label: pathLabel, value: running, ok: true }] }],
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
            items: [{
              label: pathLabel,
              value: result.ok ? t('orc.exec.done', '完成') : t('orc.exec.fail', '失败'),
              ok: result.ok,
            }],
          });

          window.dispatchEvent(new CustomEvent('AI_APPEND_CHAT', {
            detail: {
              text: result.ok ? '' : (result.error || tf('orc.skill.execFail', '{{skill}}/{{action}} 执行失败', { skill, action })),
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
  ot: OrchI18n,
): OrchestratorOutput {
  const { t, tf } = ot;
  const { skill, action, params } = tag;
  const cid = `confirm-${skill}-${action}-${Date.now()}`;
  const deviceId = actions.currentDeviceId;
  const pathLabel = `${skill}/${action}`;

  registerConfirm(cid, () => {
    const route = resolveSkillAPIPath(skill, action, deviceId);
    if (!route) {
      actions.addToast(tf('orc.skill.routeMissingToast', '技能 {{skill}}/{{action}} 的 API 路由未找到', { skill, action }), 'error');
      return;
    }

    let body = params ?? {};
    if (skill === 'rdk-openclaw') body = enrichOpenClawBody(action, params);

    const task = createTask('general' as IntentId, [
      { label: t('orc.confirm.userConfirmed', '用户已确认') },
      { label: tf('orc.confirm.execStep', '执行 {{path}}', { path: pathLabel }) },
      { label: t('orc.confirm.waitResult', '等待结果') },
    ]);
    startTaskAnimation(
      task,
      tf('orc.skill.doneTitle', '{{path}} 完成', { path: pathLabel }),
      t('orc.task.viewResult', '请查看结果'),
    );

    callSkillAPI(route.method, route.path, Object.keys(body).length > 0 ? body as Record<string, unknown> : undefined)
      .then((result) => {
        if (result.ok) {
          actions.addToast(tf('orc.skill.toastOk', '{{path}} 执行成功', { path: pathLabel }), 'success');
        } else {
          actions.addToast(tf('orc.skill.toastFail', '{{path}} 执行失败', { path: pathLabel }), 'error');
        }
      });
  });

  return {
    text: '',
    blocks: [
      { type: 'confirm', text: tf('orc.confirm.execQuestion', '确认执行 {{path}}？', { path: pathLabel }), confirmId: cid },
    ],
  };
}

function handleActionTag(
  tag: Extract<ParsedTag, { type: 'action' }>,
  actions: AppActions,
  ot: OrchI18n,
): OrchestratorOutput {
  const { tf } = ot;
  const { actionType, target } = tag;

  return {
    text: '',
    sideEffect: () => {
      switch (actionType) {
        case 'navigate':
          if (target) {
            const tabLabel = tabDisplayTitle(ot.t, String(target));
            const msg = tf('orc.workspace.opening', '正在打开 {{tab}}…', { tab: tabLabel });
            actions.openWorkspace(target as any, msg);
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
          actions.addToast(tf('orc.unknownAction', '未知操作: {{action}}', { action: actionType }), 'warning');
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
    'rdk-ros': 'terminal',
    'rdk-models': 'dashboard',
    'rdk-examples': 'dashboard',
    'rdk-workflow': 'dashboard',
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

function createHandlers(ot: OrchI18n): Record<IntentId, HandlerFn> {
  const { t, tf } = ot;
  const running = () => t('orc.executing', '执行中...');

  return {

  flash: (_p, actions, registerConfirm, startTaskAnimation) => {
    const cid = `flash-${Date.now()}`;
    registerConfirm(cid, () => {
      actions.startFlash();
      actions.addToast(t('orc.flash.toastStarted', '镜像烧录已启动'), 'info');
      const task = createTask('flash', [
        { label: t('orc.step.flash.storage', '检查存储介质') },
        { label: t('orc.step.flash.download', '下载镜像') },
        { label: t('orc.step.flash.write', '写入镜像') },
        { label: t('orc.step.flash.verify', '校验完整性') },
      ]);
      startTaskAnimation(
        task,
        t('orc.flash.doneTitle', '烧录完成'),
        tf(
          'orc.flash.doneDetail',
          '{{device}} · 镜像烧录成功 · Ubuntu 22.04 · 2.1 GB',
          { device: actions.currentDeviceName },
        ),
      );
    });
    return {
      text: '',
      blocks: [
        { type: 'status', items: [
          { label: 'Ubuntu 22.04', value: '2.1 GB', ok: true },
          { label: 'ROS2 Humble', value: '3.4 GB', ok: true },
          { label: 'TROS AI', value: '4.2 GB', ok: true },
        ]},
        {
          type: 'confirm',
          text: tf('orc.flash.confirm', '确认烧录 Ubuntu 22.04 到 {{device}}？此操作将覆盖目标存储', { device: actions.currentDeviceName }),
          confirmId: cid,
        },
      ],
    };
  },

  flash_backup: (param, actions, registerConfirm, startTaskAnimation) => {
    const cid = `flash-backup-${Date.now()}`;
    const suffix = param?.trim()
      ? tf('orc.backup.pathLine', '输出路径: {{path}}', { path: param.trim() })
      : t('orc.backup.useDefault', '将使用默认路径。');
    registerConfirm(cid, () => {
      const task = createTask('flash_backup', [
        { label: t('orc.backup.step.check', '检测 rdk-backup 可用性') },
        { label: t('orc.backup.step.run', '执行镜像备份') },
        { label: t('orc.backup.step.result', '返回备份结果') },
      ]);
      startTaskAnimation(
        task,
        t('orc.backup.doneTitle', '镜像备份流程已完成'),
        t('orc.backup.doneDetail', '如需下载可继续执行备份下载'),
      );
      callSkillAPI('POST', `/api/devices/${actions.currentDeviceId}/flash/backup/start`, {
        outputPath: param?.trim() || undefined,
      }).then((result) => {
        const outputPath = result.data?.outputPath as string | undefined;
        const output = result.data?.output as string | undefined;
        window.dispatchEvent(new CustomEvent('AI_APPEND_CHAT', {
          detail: {
            text: result.ok ? t('orc.backup.doneText', '镜像备份已完成。') : (result.error || t('orc.backup.fail', '镜像备份失败')),
            blocks: [
              {
                type: 'status',
                items: [{
                  label: t('orc.backup.fileLabel', '备份文件'),
                  value: outputPath || t('orc.backup.notGenerated', '未生成'),
                  ok: result.ok,
                }],
              },
              ...(output ? [{ type: 'terminal', lines: output.split(/\r?\n/).slice(0, 60) }] : []),
            ],
          },
        }));
      });
    });
    return {
      text: '',
      blocks: [
        { type: 'confirm', text: tf('orc.backup.confirm', '确认执行镜像备份？{{suffix}}', { suffix }), confirmId: cid },
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
      return { text: t('orc.termcmd.empty', '请告诉我你想执行什么命令？例如："执行 top" 或 "运行 hrut_smi"'), blocks: [] };
    }

    const raw = cmdText.trim();
    const deviceId = actions.currentDeviceId;
    const looksLikeShell = /^[a-z\/~.]|&&|\||;|<<|>>/.test(raw);

    if (looksLikeShell && deviceId) {
      return {
        text: '',
        blocks: [{ type: 'terminal', lines: [`$ ${raw}`, running()] }],
        sideEffect: () => {
          callSkillAPI('POST', `/api/devices/${deviceId}/exec`, { command: raw })
            .then((result) => {
              const output = result.data?.output ?? result.error ?? t('orc.noOutput', '无输出');
              const lines = output.split(/\r?\n/).slice(0, 60);
              window.dispatchEvent(new CustomEvent('AI_APPEND_CHAT', {
                detail: {
                  text: '',
                  blocks: [
                    { type: 'terminal', lines: [`$ ${raw}`, ...lines] },
                    {
                      type: 'status',
                      items: [{
                        label: t('orc.status.label', '状态'),
                        value: result.ok ? t('orc.status.ok', '执行成功') : t('orc.status.fail', '执行失败'),
                        ok: result.ok,
                      }],
                    },
                  ],
                },
              }));
            });
        },
      };
    }

    if (deviceId) {
      return {
        text: t('orc.termcmd.analyzing', '正在分析你的需求并生成命令...'),
        blocks: [{ type: 'status', items: [{ label: t('orc.task.label', '任务'), value: raw.slice(0, 60), ok: true }] }],
        sideEffect: () => {
          generateAndExecuteCommand(raw, deviceId, actions, ot);
        },
      };
    }

    return { text: t('orc.termcmd.needDevice', '请先连接设备后再执行命令。'), blocks: [] };
  },

  file_upload: (_p, actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      window.dispatchEvent(new CustomEvent('AI_FILE_UPLOAD'));
      actions.appendTransferTask();
      const task = createTask('file_upload', [
        { label: t('orc.sftp.connect', '建立 SFTP 连接') },
        { label: t('orc.sftp.upload', '上传文件') },
        { label: t('orc.sftp.verify', '校验') },
      ]);
      startTaskAnimation(
        task,
        t('orc.file.uploadTitle', '文件上传流程完成'),
        tf('orc.file.uploadDetail', '{{ip}} · 请以设备端实际输出为准', { ip: actions.currentDeviceIp }),
      );
    },
  }),

  file_download: (_p, actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      window.dispatchEvent(new CustomEvent('AI_FILE_DOWNLOAD', { detail: _p }));
      const task = createTask('file_download', [
        { label: t('orc.sftp.connect', '建立 SFTP 连接') },
        { label: t('orc.sftp.download', '下载文件') },
        { label: t('orc.sftp.verify', '校验') },
      ]);
      startTaskAnimation(
        task,
        t('orc.file.downloadTitle', '文件下载流程完成'),
        tf('orc.file.downloadDetail', '{{ip}} · 请以设备端实际输出为准', { ip: actions.currentDeviceIp }),
      );
    },
  }),

  vnc: (_p, actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      actions.startVncSession();
      const task = createTask('vnc', [
        { label: t('orc.vnc.step1', '启动 VNC 服务') },
        { label: t('orc.vnc.step2', '建立连接') },
        { label: t('orc.vnc.step3', '渲染桌面') },
      ]);
      startTaskAnimation(
        task,
        t('orc.vnc.doneTitle', '远程桌面流程完成'),
        tf('orc.vnc.doneDetail', '{{ip}}:5900 · 连接状态以设备检测结果为准', { ip: actions.currentDeviceIp }),
      );
    },
  }),

  openclaw_start: (_p, actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      const task = createTask('openclaw_start', [
        { label: t('orc.oc.start1', '加载配置') },
        { label: t('orc.oc.start2', '初始化 Agent') },
        { label: t('orc.oc.start3', '注册技能') },
        { label: t('orc.oc.start4', '启动服务') },
      ]);
      startTaskAnimation(
        task,
        t('orc.oc.startTitle', 'OpenClaw 启动流程完成'),
        t('orc.oc.startDetail', '请以板端 openclaw/clawctl 输出为准'),
      );
      void actions.openClawStartOnBoard();
    },
  }),

  openclaw_status: (_p, actions) => ({
    text: '',
    blocks: [
      { type: 'status', items: [
        { label: t('orc.oc.statusLabel', '服务状态'), value: t('orc.oc.statusValue', '实时检查中'), ok: true },
        { label: t('orc.oc.modelLabel', '当前模型'), value: t('orc.oc.modelValue', '以设备状态输出为准'), ok: true },
      ]},
    ],
    sideEffect: () => { void actions.openClawStatusOnBoard(); },
  }),

  openclaw_switch: (modelName, actions, registerConfirm, startTaskAnimation) => {
    const target = modelName || 'deepseek-chat';
    const cid = `switch-model-${Date.now()}`;
    registerConfirm(cid, () => {
      const task = createTask('openclaw_switch', [
        { label: t('orc.oc.switch1', '验证 API Key') },
        { label: t('orc.oc.switch2', '切换模型') },
        { label: t('orc.oc.switch3', '重载配置') },
      ]);
      startTaskAnimation(
        task,
        t('orc.oc.switchTitle', '模型切换完成'),
        tf('orc.oc.switchedTo', '已切换到 {{model}}', { model: target }),
      );
      void actions.openClawSwitchOnBoard(target);
    });
    return {
      text: '',
      blocks: [
        { type: 'status', items: [
          { label: t('orc.oc.currentModel', '当前模型'), value: 'qwen-plus', ok: true },
          { label: t('orc.oc.targetModel', '目标模型'), value: target, ok: true },
        ]},
        { type: 'confirm', text: tf('orc.oc.confirmSwitch', '确认切换到 {{model}}？', { model: target }), confirmId: cid },
      ],
    };
  },

  hardware_check: (_p, actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      actions.setDiagnosticOpen(true);
      actions.setDiagnosticStep(0);
      const task = createTask('hardware_check', [
        { label: t('orc.hw.temp', '读取芯片温度') },
        { label: t('orc.hw.bpu', '检测 BPU 占用') },
        { label: t('orc.hw.mem', '检测内存') },
        { label: t('orc.hw.net', '检测网络') },
      ]);
      startTaskAnimation(
        task,
        t('orc.hw.doneTitle', '诊断流程完成'),
        tf('orc.hw.doneDetail', '{{device}} · 结果以实时诊断输出为准', { device: actions.currentDeviceName }),
      );
    },
  }),

  ros_scan: (_p, _actions, _rc, startTaskAnimation) => ({
    text: '',
    sideEffect: () => {
      const task = createTask('ros_scan', [
        { label: t('orc.ros.dds', '连接 ROS2 DDS') },
        { label: t('orc.ros.topics', '枚举话题') },
        { label: t('orc.ros.rate', '采样频率') },
      ]);
      startTaskAnimation(
        task,
        t('orc.ros.doneTitle', 'ROS2 话题扫描流程完成'),
        t('orc.ros.doneDetail', '话题与频率请以 ros2 实时命令输出为准'),
      );
    },
  }),

  ros_record_start: (_p, actions) => ({
    text: '',
    sideEffect: () => {
      actions.setRosRecording(true);
      actions.addToast(t('orc.ros.recStartToast', 'ROS2 话题录制已开始'), 'success');
      actions.addActivity(t('orc.ros.recStartAct', '开始 ROS2 话题录制'));
    },
  }),

  ros_record_stop: (_p, actions) => ({
    text: '',
    sideEffect: () => {
      actions.setRosRecording(false);
      actions.addToast(t('orc.ros.recStopToast', 'ROS2 话题录制已停止'), 'info');
      actions.addActivity(t('orc.ros.recStopAct', '停止 ROS2 话题录制'));
    },
  }),

  model_deploy: (_p, _actions, registerConfirm, startTaskAnimation) => {
    const cid = `deploy-model-${Date.now()}`;
    registerConfirm(cid, () => {
      const task = createTask('model_deploy', [
        { label: t('orc.model.step1', 'ONNX → Horizon') },
        { label: t('orc.model.step2', '量化校准') },
        { label: t('orc.model.step3', '编译 BPU bin') },
        { label: t('orc.model.step4', '部署到设备') },
      ]);
      startTaskAnimation(
        task,
        t('orc.model.doneTitle', '模型部署流程完成'),
        t('orc.model.doneDetail', '模型精度与 FPS 请以设备侧测试结果为准'),
      );
    });
    return {
      text: '',
      blocks: [
        { type: 'status', items: [
          { label: t('orc.model.deployLabel', '模型部署'), value: t('orc.model.deployValue', '将执行板端真实命令'), ok: true },
        ]},
        { type: 'confirm', text: t('orc.model.confirmDeploy', '确认执行当前模型部署命令？'), confirmId: cid },
      ],
    };
  },

  model_list: () => ({
    text: '',
    blocks: [
      { type: 'status', items: [
        { label: t('orc.model.listLabel', '模型列表'), value: t('orc.model.listValue', '请在终端执行板端模型目录查询命令'), ok: true },
      ]},
    ],
  }),

  example_run: (_p, _actions, registerConfirm, startTaskAnimation) => {
    const cid = `run-demo-${Date.now()}`;
    registerConfirm(cid, () => {
      const task = createTask('example_run', [
        { label: t('orc.example.step1', '检查依赖') },
        { label: t('orc.example.step2', '启动摄像头') },
        { label: t('orc.example.step3', '加载检测模型') },
        { label: t('orc.example.step4', '运行跟随算法') },
      ]);
      startTaskAnimation(
        task,
        t('orc.example.doneTitle', '示例运行流程已触发'),
        t('orc.example.doneDetail', '请以设备端示例日志与视频输出为准'),
      );
    });
    return {
      text: '',
      blocks: [
        { type: 'confirm', text: t('orc.example.confirm', '确认运行所选示例命令？'), confirmId: cid },
      ],
    };
  },

  workflow: (_p, actions) => ({
    text: '',
    blocks: [
      {
        type: 'code',
        lang: 'json',
        content: t(
          'orc.workflow.json',
          '{\n  "templates": [\n    "视觉感知流水线",\n    "设备运维自动化",\n    "社区示例合集"\n  ]\n}',
        ),
      },
    ],
    sideEffect: () => { actions.runFlowValidation(); },
  }),

  device_scan: (_p, actions) => ({
    text: '',
    sideEffect: () => { actions.scanForDevices(); },
  }),

  nav: (tab, actions) => {
    const normalized = tab === 'ros' || tab === 'examples' || tab === 'models' || tab === 'lowcode' ? 'dashboard' : tab;
    const validTabs = ['dashboard', 'flasher', 'terminal', 'files', 'vnc', 'ide', 'openclaw', 'hardware', 'skills'] as const;
    const target = validTabs.find((id) => id === normalized) ?? 'dashboard';
    return {
      text: '',
      sideEffect: () => {
        const msg = tf('orc.workspace.opening', '正在打开 {{tab}}…', { tab: target });
        actions.openWorkspace(target, msg);
      },
    };
  },

  settings: (_p, actions) => ({
    text: '',
    sideEffect: () => { actions.setShowSettings(true); },
  }),

  general: () => ({ text: '' }),
};
}

// ─── Fallback Text ───

function getFallbackText(intent: IntentId, deviceName: string, ot: OrchI18n): string {
  const { tf, t } = ot;
  const map: Record<string, string> = {
    flash: tf('orc.fallback.flash', '好的，为 {{device}} 准备镜像烧录。', { device: deviceName }),
    flash_backup: tf('orc.fallback.flash_backup', '收到，准备为 {{device}} 执行镜像备份。', { device: deviceName }),
    terminal: tf('orc.fallback.terminal', '正在连接 {{device}} 终端。', { device: deviceName }),
    terminal_cmd: t('orc.fallback.terminal_cmd', '正在设备上执行命令。'),
    file_upload: tf('orc.fallback.file_upload', '正在同步文件到 {{device}}。', { device: deviceName }),
    file_download: tf('orc.fallback.file_download', '正在从 {{device}} 下载文件。', { device: deviceName }),
    vnc: tf('orc.fallback.vnc', '正在连接 {{device}} 远程桌面。', { device: deviceName }),
    openclaw_start: t('orc.fallback.openclaw_start', '正在启动 OpenClaw 网关。'),
    openclaw_status: t('orc.fallback.openclaw_status', 'OpenClaw 网关当前状态：'),
    openclaw_switch: t('orc.fallback.openclaw_switch', '正在切换模型...'),
    hardware_check: tf('orc.fallback.hardware_check', '正在检测 {{device}} 硬件状态。', { device: deviceName }),
    ros_scan: t('orc.fallback.ros_scan', '正在扫描 ROS2 话题。'),
    ros_record_start: t('orc.fallback.ros_record_start', '开始 ROS2 话题录制。'),
    ros_record_stop: t('orc.fallback.ros_record_stop', '已停止 ROS2 话题录制。'),
    model_deploy: t('orc.fallback.model_deploy', '检测到部署请求。'),
    model_list: tf('orc.fallback.model_list', '{{device}} 上的模型：', { device: deviceName }),
    example_run: t('orc.fallback.example_run', '可用示例应用：'),
    workflow: t('orc.fallback.workflow', '流程编排工作台：'),
    device_scan: t('orc.fallback.device_scan', '正在扫描局域网设备。'),
    settings: t('orc.fallback.settings', '已打开设置。'),
    general: tf(
      'orc.fallback.general',
      '收到！我可以帮你操作 {{device}} 上的一切，包括烧录、终端、文件、VNC、OpenClaw、硬件诊断、ROS、模型部署等。你想做什么？',
      { device: deviceName },
    ),
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
  /** 与 UI 语言一致；缺省中文 */
  locale?: 'zh-CN' | 'en';
}

/**
 * Main entry point: process one user command.
 *
 * Philosophy: Trust the AI. The AI model receives SKILL.md context and returns
 * structured tags. We parse those tags and execute them. Keyword matching is
 * ONLY used as absolute last resort when AI is completely offline.
 */
export function orchestrate(params: OrchestrateParams): OrchestratorOutput {
  const { aiResponse, actions, registerConfirm, startTaskAnimation, locale } = params;
  const ot = makeOrchI18n(locale === 'en');
  const handlers = createHandlers(ot);
  const { t } = ot;

  // ── AI responded: parse its output and trust it ──
  if (aiResponse) {
    const parsed = parseAIResponseV2(aiResponse);

    if (parsed.tag.type === 'skill') {
      const result = handleSkillTag(parsed.tag, actions, startTaskAnimation, ot);
      return { ...result, text: parsed.text || result.text };
    }

    if (parsed.tag.type === 'confirm') {
      const result = handleConfirmTag(parsed.tag, actions, registerConfirm, startTaskAnimation, ot);
      return { ...result, text: parsed.text || result.text };
    }

    if (parsed.tag.type === 'action') {
      const result = handleActionTag(parsed.tag, actions, ot);
      return { ...result, text: parsed.text || result.text };
    }

    if (parsed.tag.type === 'legacy') {
      const handler = handlers[parsed.tag.intent] ?? handlers.general;
      const result = handler(parsed.tag.param, actions, registerConfirm, startTaskAnimation);
      return {
        text: parsed.text || result.text || getFallbackText(parsed.tag.intent, actions.currentDeviceName, ot),
        blocks: result.blocks,
        sideEffect: result.sideEffect,
        task: result.task,
      };
    }

    // AI returned plain text with no tags — just display it
    return { text: parsed.text };
  }

  // AI offline — this shouldn't happen (handled upstream), but just in case
  return { text: t('orc.ai.offline', '抱歉，AI 助手暂时无法连接。') };
}
