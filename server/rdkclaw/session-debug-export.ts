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

/** 历史说明：旧版仅在助手回复后才落盘；现已支持首条用户消息即创建 JSONL。导出仍可能因 sessionKey 不一致而缺席。 */
const AGENT_SESSION_DISK_NOTE =
  '服务端会话文件：在收到用户消息后即会尝试落盘 JSONL（无需等待助手首 token）。若仍缺失，多为 sessionKey / 工作区目录与导出时不一致，或进程异常退出。';

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

type UiSnapshotShape = {
  chatMessages?: unknown;
  rdkClawRunTimeline?: unknown;
  agentExecution?: unknown;
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
    const ui = input.uiSnapshot as UiSnapshotShape | undefined;
    const cm = ui?.chatMessages;
    const hasUiMessages = Array.isArray(cm) && cm.length > 0;
    if (hasUiMessages) {
      zip.file(
        'agent-session-ui-fallback.json',
        JSON.stringify(
          {
            note: '磁盘上无对应 JSONL 时由前端 Dock 快照提供的会话摘要（不含工具级 JSONL 细节，仅作排障）。',
            sessionKey: input.sessionKey,
            exportedAt: new Date().toISOString(),
            chatMessages: cm,
            rdkClawRunTimeline: ui?.rdkClawRunTimeline,
            agentExecution: ui?.agentExecution,
          },
          null,
          2,
        ),
      );
      (manifest.bundleFiles as string[]).push('agent-session-ui-fallback.json');
    }
    manifest.agentSessionDisk = {
      status: hasUiMessages ? 'missing_ui_fallback' : 'missing',
      note: AGENT_SESSION_DISK_NOTE,
      commonCauses: [
        '本轮在服务端未找到对应会话文件（可能 sessionKey / 工作区与导出不一致，或后端未写入）。',
        '导出所用的 userId / 工作区配置与发起对话时不一致，JSONL 落在其它 profile 目录。',
        'deviceId 或 Studio sessionId 与对话时不一致，sessionKey 不同（多设备桶 / 多窗口线程）。',
        ...(hasUiMessages ? ['已附带 agent-session-ui-fallback.json（来自 Dock UI 快照）。'] : []),
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
        '  · sessionKey 与当前服务端会话不一致，或会话文件尚未写入该目录。',
        '  · 导出所用的工作区 / userId 与对话时不一致。',
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
        'dock-ui-snapshot.json 含完整 UI 快照；若存在 agent-session-ui-fallback.json，为同一会话的摘要副本。',
        '',
        '---',
        'EN: No JSONL for this sessionKey. Check dock-ui-snapshot.json, agent-session-ui-fallback.json (if present), and manifest.sessionDirOtherKeysSample.',
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
      let logs = await execOnDevice(input.deviceId.trim(), [shell], { timeoutMs: 45_000 });
      if (/pairing required|Gateway not reachable|Is it running/i.test(logs)) {
        logs =
          [
            '【说明】以下为板上 openclaw 命令输出。若出现 pairing required / Gateway not reachable',
            '表示板上 OpenClaw 网关未配对或未在 127.0.0.1:18789 监听，与 RDKClaw（Studio 侧 SSH）是否成功无关。',
            '排查：板上执行 `openclaw doctor` 或 `openclaw gateway status`；需配对时按文档完成配对。',
            '---',
            '',
            logs,
          ].join('\n');
      }
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
    '  若无：见 agent-session.MISSING.txt；若存在 agent-session-ui-fallback.json，为 Dock 侧摘要。',
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
