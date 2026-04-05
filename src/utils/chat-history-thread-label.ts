import type { ChatMessage } from '../app-types';
import { chatMessageToPlainText } from './chat-message-plain';

/** 会话列表 / Dock 顶栏用：单行标题，略长于旧版拼接式摘要以便展示首问 */
const HISTORY_THREAD_SUMMARY_MAX = 78;

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function truncateSummary(s: string, maxChars: number): string {
  const t = collapseWhitespace(s);
  if (!t) return '';
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 1))}…`;
}

function msgPlain(m: ChatMessage, tr: (key: string, zh: string) => string): string {
  return collapseWhitespace(chatMessageToPlainText(m, tr));
}

function isGenericGreeting(text: string): boolean {
  const head = collapseWhitespace(text).slice(0, 24);
  if (!head) return false;
  return /^(你好|您好|在吗|在么|hi\b|hello\b|hey\b|早上好|晚上好)/i.test(head);
}

function dropLeadingGreetingSnippets(snippets: string[]): string[] {
  if (snippets.length <= 1) return snippets;
  let i = 0;
  while (i < snippets.length - 1 && isGenericGreeting(snippets[i])) i += 1;
  return snippets.slice(i);
}

/**
 * 从整段对话抽取标题概要（与对话历史下拉的规则一致；纯本地、不调模型）。
 * 规则：以「开场首条实质性用户消息」为一行标题，避免多轮拼接与「共 N 问」等噪声。
 */
export function buildThreadSummaryLine(messages: ChatMessage[], tr: (key: string, zh: string) => string): string {
  const userMsgs = messages.filter((m) => m.role === 'user');
  const userSnippets = userMsgs.map((m) => msgPlain(m, tr)).filter((s) => s.length > 0);
  const snippets = dropLeadingGreetingSnippets(userSnippets);

  if (snippets.length === 0) {
    const firstAi = messages.find((m) => m.role === 'ai');
    const any = firstAi ?? messages[0];
    return truncateSummary(msgPlain(any, tr), HISTORY_THREAD_SUMMARY_MAX);
  }

  const firstSubstantive = snippets[0];
  if (snippets.length === 1 && isGenericGreeting(firstSubstantive)) {
    const firstAi = messages.find((m) => m.role === 'ai');
    if (firstAi) {
      const hint = msgPlain(firstAi, tr);
      if (hint) return truncateSummary(hint, HISTORY_THREAD_SUMMARY_MAX);
    }
  }

  return truncateSummary(firstSubstantive, HISTORY_THREAD_SUMMARY_MAX);
}
