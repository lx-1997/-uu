import type { AiDockContentSlot, ChatBlock, ChatMessage } from '../app-types';

function appendBlockPlainParts(parts: string[], b: ChatBlock, tr: (key: string, zh: string) => string) {
  switch (b.type) {
    case 'terminal':
      parts.push((b.label ? `${b.label}\n` : '') + b.lines.join('\n'));
      break;
    case 'collab': {
      const head = [b.title, b.subtitle].filter(Boolean).join(' — ');
      let role: string;
      if (b.side === 'openclaw') role = '[OpenClaw]';
      else if (b.collabRole === 'outbound') role = '[RDKClaw → OpenClaw]';
      else if (b.collabRole === 'reverse') role = '[OpenClaw → RDKClaw]';
      else if (b.collabRole === 'hint') role = '[RDKClaw 说明]';
      else role = '[RDKClaw]';
      parts.push(head ? `${role} ${head}\n${b.lines.join('\n')}` : `${role}\n${b.lines.join('\n')}`);
      break;
    }
    case 'code':
      parts.push(`\`\`\`${b.lang}\n${b.content}\n\`\`\``);
      break;
    case 'confirm':
    case 'approval':
      parts.push(b.text);
      break;
    case 'task-result':
      parts.push([b.title, b.detail].filter(Boolean).join('\n'));
      break;
    case 'recommendation':
      parts.push(
        [b.question, ...b.options.map((o) => `- ${o.label}: ${o.description || ''}`)].filter(Boolean).join('\n'),
      );
      break;
    case 'soul-update':
      parts.push([b.section, b.action, b.content, b.reason].filter(Boolean).join('\n'));
      break;
    case 'image':
      parts.push(b.caption || b.src || tr('dock.plain.image', '[图片]'));
      break;
    case 'video':
      parts.push(b.caption || b.src || tr('dock.plain.video', '[视频]'));
      break;
    case 'file':
      parts.push(b.fileName || b.src || tr('dock.plain.file', '[文件]'));
      break;
    case 'status': {
      const lines = b.items.map((i) => `${i.label}: ${i.value}`);
      parts.push([b.title, ...lines].filter(Boolean).join('\n'));
      break;
    }
    case 'reasoning':
      if (b.text.trim()) {
        parts.push(`${tr('dock.reasoning.title', '推理过程')}\n${b.text.trim()}`);
      }
      break;
    case 'progress':
      parts.push(b.steps.map((s) => `${s.label} (${s.status})`).join('\n'));
      break;
    case 'continue-run': {
      const head = tr('dock.continueRun.plainTitle', '[继续] 本轮推理已达上限');
      parts.push(b.hint ? `${head}\n${b.hint}` : head);
      break;
    }
    default:
      break;
  }
}

function walkContentSlotsPlain(
  slots: AiDockContentSlot[],
  blocks: ChatBlock[] | undefined,
  parts: string[],
  tr: (key: string, zh: string) => string,
) {
  for (const slot of slots) {
    if (slot.kind === 'markdown') {
      if (slot.text.trim()) parts.push(slot.text.trim());
    } else {
      const b = blocks?.[slot.index];
      if (b) appendBlockPlainParts(parts, b, tr);
    }
  }
}

/** 「不满意此回复」追加重发：上限默认约 2.5K 字，避免把整段工具输出塞进会话 */
const DEFAULT_RETRY_EXCERPT_MAX = 2800;

function appendBlockForRetryPlain(parts: string[], b: ChatBlock, tr: (key: string, zh: string) => string) {
  switch (b.type) {
    case 'continue-run':
    case 'status':
    case 'progress':
    case 'reasoning':
      /* 运行遥测、步骤条、推理过程：对改写回答噪声大，不带入重试上下文 */
      return;
    case 'terminal':
      parts.push((b.label ? `${b.label}\n` : '') + b.lines.join('\n'));
      break;
    case 'collab': {
      const head = [b.title, b.subtitle].filter(Boolean).join(' — ');
      let role: string;
      if (b.side === 'openclaw') role = '[OpenClaw]';
      else if (b.collabRole === 'outbound') role = '[RDKClaw → OpenClaw]';
      else if (b.collabRole === 'reverse') role = '[OpenClaw → RDKClaw]';
      else if (b.collabRole === 'hint') role = '[RDKClaw 说明]';
      else role = '[RDKClaw]';
      parts.push(head ? `${role} ${head}\n${b.lines.join('\n')}` : `${role}\n${b.lines.join('\n')}`);
      break;
    }
    case 'code':
      parts.push(`\`\`\`${b.lang}\n${b.content}\n\`\`\``);
      break;
    case 'confirm':
    case 'approval':
      parts.push(b.text);
      break;
    case 'task-result':
      parts.push([b.title, b.detail].filter(Boolean).join('\n'));
      break;
    case 'recommendation':
      parts.push(
        [b.question, ...b.options.map((o) => `- ${o.label}: ${o.description || ''}`)].filter(Boolean).join('\n'),
      );
      break;
    case 'soul-update':
      parts.push([b.section, b.action, b.content, b.reason].filter(Boolean).join('\n'));
      break;
    case 'image':
      parts.push(b.caption || b.src || tr('dock.plain.image', '[图片]'));
      break;
    case 'video':
      parts.push(b.caption || b.src || tr('dock.plain.video', '[视频]'));
      break;
    case 'file':
      parts.push(b.fileName || b.src || tr('dock.plain.file', '[文件]'));
      break;
    default:
      break;
  }
}

/**
 * 仅用于「不满意此回复」：保留助手正文与实质输出块，去掉状态栏/耗时/Token/推理条等 telemetry。
 */
export function chatMessageRetryExcerpt(
  msg: ChatMessage,
  tr: (key: string, zh: string) => string,
  maxChars = DEFAULT_RETRY_EXCERPT_MAX,
): string {
  const parts: string[] = [];
  if (msg.contentSlots?.length && msg.blocks?.length) {
    for (const slot of msg.contentSlots) {
      if (slot.kind === 'markdown') {
        if (slot.text.trim()) parts.push(slot.text.trim());
      } else {
        const b = msg.blocks[slot.index];
        if (b) appendBlockForRetryPlain(parts, b, tr);
      }
    }
  } else {
    if (msg.text?.trim()) parts.push(msg.text.trim());
    if (msg.blocks?.length) {
      for (const b of msg.blocks) {
        appendBlockForRetryPlain(parts, b, tr);
      }
    }
  }
  let s = parts.join('\n\n').trim();
  if (s.length > maxChars) {
    s = `${s.slice(0, maxChars)}…`;
  }
  return s;
}

/** 将一条对话消息转为可复制、可检索的纯文本（与 AI Dock 复制行为一致） */
export function chatMessageToPlainText(
  msg: ChatMessage,
  tr: (key: string, zh: string) => string,
): string {
  const parts: string[] = [];
  if (msg.contentSlots?.length && msg.blocks?.length) {
    walkContentSlotsPlain(msg.contentSlots, msg.blocks, parts, tr);
  } else {
    if (msg.text?.trim()) parts.push(msg.text.trim());
    if (msg.blocks?.length) {
      for (const b of msg.blocks) {
        appendBlockPlainParts(parts, b, tr);
      }
    }
  }
  return parts.join('\n\n').trim();
}
