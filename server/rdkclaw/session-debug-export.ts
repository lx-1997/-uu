/**
 * 将当前 RDKClaw 会话排查材料打成 zip：Agent JSONL、可选板端 OpenClaw 日志、UI 快照、安全审计摘要。
 */
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import JSZip from 'jszip';
import { execOnDevice } from '../agent/tools/rdk-ssh-helper.js';
import type { SecurityAuditLogEntry } from './security-audit-store.js';

/** 与 `RDKClawApp.studioAgentSessionKey`、磁盘 `SessionManager` 文件名规则一致 */
export function buildStudioAgentSessionKey(deviceId?: string, sessionId?: string): string {
  const sid = sessionId?.trim();
  const did = deviceId?.trim();
  if (did && sid) return `device:${did}:studio:${sid}`;
  if (did) return `device:${did}`;
  if (sid) return `local:studio:${sid}`;
  return 'local';
}

/** 与 `SessionManager.persistEntry` 一致：仅有助手消息后才会落盘 JSONL，导出过早会缺席 */
const AGENT_SESSION_DISK_NOTE =
  '服务端 RDKClaw 仅在至少持久化过一条助手消息后才创建/追加 JSONL；仅有用户输入、首轮未完成或运行被中断时，磁盘上可能尚无对应文件。这与「任务被判失败」无直接对应关系。';

/** 与 `rdk-tools.ts` 中 board_openclaw_logs 一致，便于在板上解析 openclaw CLI */
const OPENCLAW_RESOLVE_SNIPPET =
  'export NPM_CONFIG_PREFIX="$HOME/.npm-global"; export PATH="$HOME/.npm-global/bin:$PATH"; ' +
  'OPENCLAW_CMD="$(command -v openclaw 2>/dev/null || true)"; ' +
  'if [ -z "$OPENCLAW_CMD" ] && [ -x "$HOME/.local/bin/openclaw" ]; then OPENCLAW_CMD="$HOME/.local/bin/openclaw"; fi; ' +
  'if [ -z "$OPENCLAW_CMD" ] && [ -x "$(npm prefix -g 2>/dev/null)/bin/openclaw" ]; then OPENCLAW_CMD="$(npm prefix -g 2>/dev/null)/bin/openclaw"; fi; ' +
  'if [ ! -x "$OPENCLAW_CMD" ]; then OPENCLAW_CMD=""; fi';

export type SessionDebugExportInput = {
  sessionDir: string;
  sessionKey: string;
  deviceId?: string;
  /** 已连接设备且未显式关闭时为 true */
  includeBoardLogs: boolean;
  uiSnapshot?: unknown;
  securityAudit?: SecurityAuditLogEntry[];
};

function decodeJsonlBasename(base: string): string {
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
}

/** 缺少目标 JSONL 时，列出目录内其它会话基名（已解码），便于核对是否错工作区 / sessionKey */
async function sampleOtherSessionKeysInDir(sessionDir: string, excludeKey: string, max: number): Promise<string[]> {
  try {
    const entries = await fsp.readdir(sessionDir, { withFileTypes: true });
    const keys = entries
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map((e) => decodeJsonlBasename(e.name.replace(/\.jsonl$/u, '')))
      .filter((k) => k && k !== excludeKey);

    const uniq = [...new Set(keys)];
    uniq.sort();
    return uniq.slice(0, max);
  } catch {
    return [];
  }
}

export async function createRdkclawDebugExportZip(input: SessionDebugExportInput): Promise<Buffer> {
  const zip = new JSZip();
  const encoded = encodeURIComponent(input.sessionKey);
  const jsonlPath = path.join(input.sessionDir, `${encoded}.jsonl`);
  const legacyPath = path.join(
    input.sessionDir,
    `${input.sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`,
  );

  const manifest: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    sessionKey: input.sessionKey,
    sessionDir: input.sessionDir,
    sessionJsonlTried: [jsonlPath, legacyPath],
    deviceId: input.deviceId?.trim() || null,
    includeBoardLogs: input.includeBoardLogs,
    bundleFiles: [] as string[],
  };

  let sessionText = '';
  let sessionSource: string | null = null;
  try {
    sessionText = await fsp.readFile(jsonlPath, 'utf-8');
    sessionSource = jsonlPath;
  } catch {
    try {
      sessionText = await fsp.readFile(legacyPath, 'utf-8');
      sessionSource = legacyPath;
    } catch {
      sessionText = '';
    }
  }

  if (sessionText) {
    zip.file('agent-session.jsonl', sessionText);
    (manifest.bundleFiles as string[]).push('agent-session.jsonl');
    manifest.sessionJsonlResolved = sessionSource;
    manifest.agentSessionDisk = {
      status: 'ok',
      resolvedPath: sessionSource,
    };
  } else {
    const otherKeysSample = await sampleOtherSessionKeysInDir(input.sessionDir, input.sessionKey, 12);
    if (otherKeysSample.length > 0) {
      manifest.sessionDirOtherKeysSample = otherKeysSample;
    }
    manifest.agentSessionDisk = {
      status: 'missing',
      note: AGENT_SESSION_DISK_NOTE,
      commonCauses: [
        '本轮尚未产生已持久化的助手回复（例如仍在首 token、被中止或仅用户侧消息）。',
        '导出所用的 userId / 工作区配置与发起对话时不一致，JSONL 落在其它 profile 目录。',
        'deviceId 或 Studio sessionId 与对话时不一致，sessionKey 不同（多设备桶 / 多窗口线程）。',
      ],
    };
    zip.file(
      'agent-session.MISSING.txt',
      [
        '【说明】未在磁盘上找到与本 sessionKey 对应的 Agent 会话 JSONL。',
        '',
        AGENT_SESSION_DISK_NOTE,
        '',
        '常见原因：',
        '  · 尚无已落盘的助手消息（见上）。',
        '  · 会话目录或 sessionKey 与当前导出参数不一致。',
        '',
        `sessionKey: ${input.sessionKey}`,
        `sessionDir: ${input.sessionDir}`,
        '已尝试路径:',
        `  - ${jsonlPath}`,
        `  - ${legacyPath}`,
        ...(otherKeysSample.length > 0
          ? ['', '同目录下其它会话键示例（供核对是否错桶/错账号）:', ...otherKeysSample.map((k) => `  · ${k}`)]
          : []),
        '',
        'dock-ui-snapshot.json（若存在）仍包含界面中的对话与时间线，可优先查看。',
        '',
        '---',
        'EN: No JSONL on disk for this sessionKey yet. Server creates/appends the file only after at least one assistant message is persisted. This is not the same as "task failed". Check dock-ui-snapshot.json and manifest.sessionDirOtherKeysSample.',
      ].join('\n'),
    );
    (manifest.bundleFiles as string[]).push('agent-session.MISSING.txt');
  }

  if (input.uiSnapshot !== undefined) {
    zip.file('dock-ui-snapshot.json', JSON.stringify(input.uiSnapshot, null, 2));
    (manifest.bundleFiles as string[]).push('dock-ui-snapshot.json');
  }

  if (Array.isArray(input.securityAudit) && input.securityAudit.length > 0) {
    zip.file('security-audit-recent.json', JSON.stringify(input.securityAudit, null, 2));
    (manifest.bundleFiles as string[]).push('security-audit-recent.json');
  }

  if (input.includeBoardLogs && input.deviceId?.trim()) {
    const limit = 400;
    const shell = `bash -lc '${OPENCLAW_RESOLVE_SNIPPET}; (if [ -n "$OPENCLAW_CMD" ]; then "$OPENCLAW_CMD" logs --limit ${limit} 2>&1 || true; else false; fi) || journalctl --user -u openclaw-gateway --no-pager -n ${limit} 2>&1 || echo no_logs'`;
    try {
      const logs = await execOnDevice(input.deviceId.trim(), [shell], { timeoutMs: 45_000 });
      zip.file('board-openclaw-logs.txt', logs);
      (manifest.bundleFiles as string[]).push('board-openclaw-logs.txt');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      zip.file('board-openclaw-logs.ERROR.txt', msg);
      (manifest.bundleFiles as string[]).push('board-openclaw-logs.ERROR.txt');
    }
  }

  zip.file('README.txt', [
    'RDK Studio — RDKClaw 排查导出包',
    '',
    '- agent-session.jsonl：服务端 Agent 会话（工具调用与结果，含 board_openclaw_* 等）。',
    '  若仅见 agent-session.MISSING.txt：多为尚未落盘助手消息或 session 目录/键不一致，见其中说明与 manifest.agentSessionDisk。',
    '- dock-ui-snapshot.json：导出时 AI Dock 中的消息与时间线快照。',
    '- board-openclaw-logs.txt：板上 OpenClaw 网关近期日志（若已连接设备且导出时包含）。',
    '- security-audit-recent.json：最近安全审计记录（若存在）。',
    '- manifest.json：本次打包元数据（含 sessionDir、agentSessionDisk 状态）。',
    '',
    '请勿将含 API Key、密码、配对 token 的压缩包随意分享。',
  ].join('\n'));
  (manifest.bundleFiles as string[]).push('README.txt');

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
