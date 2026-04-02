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
  } else {
    zip.file(
      'agent-session.MISSING.txt',
      [
        '未找到与本会话对应的 Agent 磁盘会话文件（可能尚未产生助手回复，或会话目录不同）。',
        `sessionKey: ${input.sessionKey}`,
        `尝试路径:`,
        `- ${jsonlPath}`,
        `- ${legacyPath}`,
        '',
        'dock-ui-snapshot.json 仍可能包含当前界面中的对话与运行时间线。',
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
    '- dock-ui-snapshot.json：导出时 AI Dock 中的消息与时间线快照。',
    '- board-openclaw-logs.txt：板上 OpenClaw 网关近期日志（若已连接设备且导出时包含）。',
    '- security-audit-recent.json：最近安全审计记录（若存在）。',
    '- manifest.json：本次打包元数据。',
    '',
    '请勿将含 API Key、密码、配对 token 的压缩包随意分享。',
  ].join('\n'));
  (manifest.bundleFiles as string[]).push('README.txt');

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
