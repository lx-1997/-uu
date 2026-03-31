import type { ContentBlock, Message } from "../session.js";

export const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * CJK character detection via charCode ranges — avoids per-character regex
 * overhead. Token estimation is called on every message in the context window,
 * so this is a hot path worth optimizing.
 */
function isCJK(code: number): boolean {
  return (code >= 0x3000 && code <= 0x9fff) ||
         (code >= 0xac00 && code <= 0xd7af) ||
         (code >= 0xff00 && code <= 0xffef);
}

function estimateTokensForText(text: string): number {
  if (!text) return 0;
  let cjkChars = 0;
  let otherChars = 0;
  for (let i = 0; i < text.length; i++) {
    if (isCJK(text.charCodeAt(i))) {
      cjkChars++;
    } else {
      otherChars++;
    }
  }
  return Math.ceil(cjkChars / 1.5) + Math.ceil(otherChars / 4);
}

function estimateBlockChars(block: ContentBlock): number {
  if (block.type === "text") {
    return block.text?.length ?? 0;
  }
  if (block.type === "tool_use") {
    const base = block.name?.length ?? 0;
    try {
      const input = block.input ? JSON.stringify(block.input) : "";
      return base + input.length + 16;
    } catch {
      return base + 128;
    }
  }
  if (block.type === "tool_result") {
    return block.content?.length ?? 0;
  }
  return 0;
}

function estimateBlockTokens(block: ContentBlock): number {
  if (block.type === "text") {
    return estimateTokensForText(block.text ?? "");
  }
  if (block.type === "tool_result") {
    // tool_result 内容可能包含中文（如板端命令输出），使用精确估算
    return estimateTokensForText(block.content ?? "");
  }
  // tool_use 的 input 通常是 JSON（英文为主），使用字符数估算
  return Math.max(1, Math.ceil(estimateBlockChars(block) / CHARS_PER_TOKEN_ESTIMATE));
}

export function estimateMessageChars(message: Message): number {
  if (typeof message.content === "string") {
    return message.content.length;
  }
  let total = 0;
  for (const block of message.content) {
    total += estimateBlockChars(block);
  }
  return total;
}

export function estimateMessagesChars(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageChars(msg), 0);
}

export function estimateMessageTokens(message: Message): number {
  if (typeof message.content === "string") {
    return Math.max(1, estimateTokensForText(message.content));
  }
  let total = 0;
  for (const block of message.content) {
    total += estimateBlockTokens(block);
  }
  return Math.max(1, total);
}

export function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}
