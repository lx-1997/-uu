/**
 * RDKClaw 专用工具钩子：会话内可见的变更摘要 + 设备输出中的监控 URL 自动拉起浏览器
 */

import { ToolHookRegistry, createExecLikeFailureHintHook } from './tool-hooks.js';
import type { PostToolUseHook } from './tool-hooks.js';
import type { Tool } from './tools/types.js';
import {
  DEVICE_DASHBOARD_AUTO_OPEN_NOTE_PREFIX,
  emitDeviceDashboardUrlsFromText,
  formatDeviceDashboardAutoOpenNote,
} from '../device-dashboard-auto-open.js';
import {
  SHELL_SOFT_FAILURE_TOOL_NAMES,
  appendShellContinueHint,
} from '../rdkclaw/shell-soft-failure-hint.js';

const MUTATION_TOOL_NAMES = new Set([
  'write',
  'edit',
  'device_file_write',
  'device_file_upload_from_local',
  'memory_save',
  'board_openclaw_write_skill',
]);

function summarizeMutation(tool: Tool, input: Record<string, unknown>): string {
  const n = tool.name;
  if (n === 'write' || n === 'edit') {
    const p = String((input as { file_path?: string }).file_path ?? (input as { path?: string }).path ?? '');
    return `[会话变更 · ${n}] 工作区文件：${p || '（路径见参数）'}`;
  }
  if (n === 'device_file_write') {
    const p = String((input as { path?: string }).path ?? '');
    return `[会话变更 · 套件端写入] ${p || '（路径见参数）'}`;
  }
  if (n === 'device_file_upload_from_local') {
    const r = String((input as { remotePath?: string }).remotePath ?? '');
    return `[会话变更 · 套件端上传] ${r || '（远程路径见参数）'}`;
  }
  if (n === 'memory_save') {
    return `[会话变更 · 记忆] 已写入长期记忆`;
  }
  if (n === 'board_openclaw_write_skill') {
    return `[会话变更 · 套件端技能] 已写入/更新套件端技能文件`;
  }
  return `[会话变更] ${n}`;
}

const createMutationSessionEchoHook = (): PostToolUseHook => ({
  name: 'rdkclaw-mutation-echo',
  priority: 5,
  async process({ tool, input, result, isError }) {
    if (isError || !MUTATION_TOOL_NAMES.has(tool.name)) return null;
    if (result.includes('[会话变更')) return null;
    const line = summarizeMutation(tool, input);
    return { result: `${line}\n\n${result}` };
  },
});

/** `exec` / `device_exec` 在命令非零退出时常以**文本**返回（不抛错），PostFailure 钩子不会触发；此处统一追加「须继续」编排提示。 */
const createShellSoftFailureContinueHintHook = (): PostToolUseHook => ({
  name: 'rdkclaw-shell-soft-failure-continue-hint',
  priority: 42,
  async process({ tool, result, isError }) {
    if (isError || !SHELL_SOFT_FAILURE_TOOL_NAMES.has(tool.name)) return null;
    const next = appendShellContinueHint(tool.name, result);
    if (next === result) return null;
    return { result: next };
  },
});

/** 设备类工具输出中的 http(s) URL → 桌面端自动打开（与 studio_open_url 同规则，允许局域网/板卡 IP）。 */
const createAutoOpenDeviceDashboardUrlHook = (): PostToolUseHook => ({
  name: 'rdkclaw-auto-open-dashboard-url',
  priority: 40,
  async process({ tool, result, isError, ctx }) {
    if (isError) return null;
    const names = new Set(['device_exec', 'device_diagnose', 'board_openclaw_health', 'board_openclaw_logs']);
    if (!names.has(tool.name)) return null;
    /** device_exec 已在主命令返回后、ros2VerifyTopics 之前打开过，避免重复弹窗 */
    if (result.includes(DEVICE_DASHBOARD_AUTO_OPEN_NOTE_PREFIX)) return null;
    const opened = await emitDeviceDashboardUrlsFromText(result, ctx.studioDeviceId);
    if (opened.length === 0) return null;
    const note = formatDeviceDashboardAutoOpenNote(opened);
    if (result.includes(note)) return null;
    return { result: `${result}\n\n${note}` };
  },
});

/**
 * RDKClaw Agent 使用：含 exec 失败提示、变更可见性、设备 URL 自动打开浏览器
 */
export function buildRdkClawToolHookRegistry(): ToolHookRegistry {
  const r = new ToolHookRegistry();
  r.registerPost(createMutationSessionEchoHook());
  r.registerPost(createShellSoftFailureContinueHintHook());
  r.registerPost(createAutoOpenDeviceDashboardUrlHook());
  r.registerPostFailure(createExecLikeFailureHintHook());
  return r;
}
