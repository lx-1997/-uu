import type { ChatMessage } from '../app-types';

/** 将一条对话消息转为可复制、可检索的纯文本（与 AI Dock 复制行为一致） */
export function chatMessageToPlainText(
  msg: ChatMessage,
  tr: (key: string, zh: string) => string,
): string {
  const parts: string[] = [];
  if (msg.text?.trim()) parts.push(msg.text.trim());
  if (msg.blocks?.length) {
    for (const b of msg.blocks) {
      if (b.type === 'terminal') {
        parts.push((b.label ? `${b.label}\n` : '') + b.lines.join('\n'));
      } else if (b.type === 'collab') {
        const head = [b.title, b.subtitle].filter(Boolean).join(' — ');
        let role: string;
        if (b.side === 'openclaw') role = '[OpenClaw]';
        else if (b.collabRole === 'outbound') role = '[RDKClaw → OpenClaw]';
        else if (b.collabRole === 'reverse') role = '[OpenClaw → RDKClaw]';
        else if (b.collabRole === 'hint') role = '[RDKClaw 说明]';
        else role = '[RDKClaw]';
        parts.push(head ? `${role} ${head}\n${b.lines.join('\n')}` : `${role}\n${b.lines.join('\n')}`);
      } else if (b.type === 'code') {
        parts.push(`\`\`\`${b.lang}\n${b.content}\n\`\`\``);
      } else if (b.type === 'status') {
        parts.push(b.items.map((i) => `${i.label}: ${i.value}`).join('\n'));
      } else if (b.type === 'confirm' || b.type === 'approval') {
        parts.push(b.text);
      } else if (b.type === 'progress') {
        parts.push(b.steps.map((s) => `${s.label} (${s.status})`).join('\n'));
      } else if (b.type === 'task-result') {
        parts.push([b.title, b.detail].filter(Boolean).join('\n'));
      } else if (b.type === 'image') {
        parts.push(b.caption || b.src || tr('dock.plain.image', '[图片]'));
      } else if (b.type === 'video') {
        parts.push(b.caption || b.src || tr('dock.plain.video', '[视频]'));
      } else if (b.type === 'file') {
        parts.push(b.fileName || b.src || tr('dock.plain.file', '[文件]'));
      }
    }
  }
  return parts.join('\n\n').trim();
}
