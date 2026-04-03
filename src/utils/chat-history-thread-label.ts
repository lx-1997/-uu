import type { ChatMessage } from '../app-types';
import { fillTemplate } from '../i18n/en-extras';
import { chatMessageToPlainText } from './chat-message-plain';

const HISTORY_THREAD_SUMMARY_MAX = 60;

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

  if (snippets.length === 1) {
    const only = snippets[0];
    if (isGenericGreeting(only)) {
      const firstAi = messages.find((m) => m.role === 'ai');
      if (firstAi) {
        const hint = msgPlain(firstAi, tr);
        if (hint) return truncateSummary(hint, HISTORY_THREAD_SUMMARY_MAX);
      }
    }
    return truncateSummary(only, HISTORY_THREAD_SUMMARY_MAX);
  }

  if (snippets.length === 2) {
    const a = truncateSummary(snippets[0], 26);
    const b = truncateSummary(snippets[1], 26);
    return truncateSummary(`${a} · ${b}`, HISTORY_THREAD_SUMMARY_MAX);
  }

  const head = truncateSummary(snippets[0], 22);
  const tailRaw = snippets[snippets.length - 1];
  const tail = truncateSummary(tailRaw, 18);
  const turnsHint = fillTemplate(tr('dock.history.summaryTurns', '共 {{n}} 问'), { n: userMsgs.length });
  if (tailRaw === snippets[0]) {
    return truncateSummary(`${head} · ${turnsHint}`, HISTORY_THREAD_SUMMARY_MAX);
  }
  return truncateSummary(`${head} · … · ${tail} · ${turnsHint}`, HISTORY_THREAD_SUMMARY_MAX + 8);
}
