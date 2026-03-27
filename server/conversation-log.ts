/**
 * 完整对话归档（用户提问 + AI 最终回复），与匿名埋点分离。
 * 可选：本地 JSONL；云端仅 Supabase（见 supabase-conversation.ts）。
 * 并发请求通过内存队列串行 append，避免 JSONL 行交错；多机部署需换共享存储或消息队列。
 */
import { appendFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { getConversationTurnsFilePath } from './storage.js';
import {
  isSupabaseConversationConfigured,
  scheduleSupabaseConversationInsert,
} from './supabase-conversation.js';
import type { ConversationTurnRecord } from './conversation-types.js';

export { CONVERSATION_SCHEMA, type ConversationTurnRecord } from './conversation-types.js';

let appendChain: Promise<void> = Promise.resolve();

function conversationLogDiskEnabled(): boolean {
  return String(process.env.CONVERSATION_LOG_ENABLED ?? '').trim() === '1';
}

function supabaseConfigured(): boolean {
  return isSupabaseConversationConfigured();
}

export function recordConversationTurn(record: ConversationTurnRecord): void {
  const disk = conversationLogDiskEnabled();
  const supabase = supabaseConfigured();
  if (!disk && !supabase) return;

  if (disk) {
    const line = `${JSON.stringify(record)}\n`;
    const file = getConversationTurnsFilePath();

    appendChain = appendChain
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        await appendFile(file, line, 'utf-8');
      })
      .catch((err) => {
        console.warn('[conversation-log] append failed:', err instanceof Error ? err.message : err);
      });
  }

  if (supabase) {
    scheduleSupabaseConversationInsert(record);
  }
}
