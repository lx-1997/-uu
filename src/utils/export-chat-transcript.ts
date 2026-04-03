import type { ChatMessage } from '../app-types';
import { chatMessageToPlainText } from './chat-message-plain';

function formatDurationMsLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  return `${m}m ${rs}s`;
}

export type ChatTranscriptMeta = {
  deviceLabel: string;
  sessionId?: string;
};

/**
 * 生成带简单版式、便于记事本阅读的 UTF-8 文本（导出 .txt）。
 */
export function buildChatTranscriptTxt(
  messages: ChatMessage[],
  tr: (key: string, zh: string) => string,
  meta: ChatTranscriptMeta,
): string {
  const divider = '────────────────────────────────────────';
  const lines: string[] = [];

  lines.push('════════════════════════════════════════════════════════');
  lines.push(tr('chat.export.bannerTitle', 'RDKClaw 对话导出'));
  lines.push('════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`${tr('chat.export.exportedAt', '导出时间')}\t${new Date().toLocaleString()}`);
  lines.push(`${tr('chat.export.device', '对话设备')}\t${meta.deviceLabel}`);
  if (meta.sessionId?.trim()) {
    lines.push(`${tr('chat.export.sessionId', '会话 ID')}\t${meta.sessionId.trim()}`);
  }
  lines.push('');
  lines.push(divider);
  lines.push('');

  if (!messages.length) {
    lines.push(tr('chat.export.emptyThread', '（当前线程暂无消息）'));
    lines.push('');
    return lines.join('\n');
  }

  for (const msg of messages) {
    const isAi = msg.role === 'ai';
    const roleLabel = isAi ? 'RDKClaw' : tr('dock.history.you', '你');
    const ts = new Date(msg.id).toLocaleString();
    lines.push(divider);
    lines.push(`【${roleLabel}】 ${ts}`);
    if (isAi && msg.durationMs != null) {
      lines.push(`${tr('dock.msg.took', '用时')} ${formatDurationMsLabel(msg.durationMs)}`);
    }
    lines.push('');
    lines.push(chatMessageToPlainText(msg, tr) || '—');
    lines.push('');
  }

  lines.push(divider);
  lines.push(tr('chat.export.footer', '— 全文结束 —'));
  lines.push('');
  return lines.join('\n');
}

export function downloadTranscriptTxt(filename: string, body: string) {
  const bom = '\uFEFF';
  const blob = new Blob([bom + body], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
