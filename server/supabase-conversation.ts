/**
 * 将对话轮次写入 Supabase Postgres（完整 user_message / assistant_message，无 Webhook 长度截断）。
 * 凭证来源：环境变量，或 `server/supabase-embedded-config.ts`（JSON / 可选 INLINE），便于打包发行不落表依赖用户 .env。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ConversationTurnRecord } from './conversation-types.js';
import {
  getResolvedSupabaseKey,
  getResolvedSupabaseTable,
  getResolvedSupabaseUrl,
} from './supabase-embedded-config.js';

let client: SupabaseClient | null = null;
let clientCacheKey = '';

/** 配置了 URL + 密钥即默认写入；仅当 SUPABASE_CONVERSATION_ENABLED=0 时关闭。 */
export function isSupabaseConversationConfigured(): boolean {
  if (String(process.env.SUPABASE_CONVERSATION_ENABLED ?? '').trim() === '0') return false;
  const url = getResolvedSupabaseUrl();
  const key = getResolvedSupabaseKey();
  return !!(url && key);
}

/** 与 conversation_turns、studio_daily_usage 共用同一客户端与凭证解析逻辑 */
export function getSharedSupabaseClient(): SupabaseClient | null {
  const url = getResolvedSupabaseUrl();
  const key = getResolvedSupabaseKey();
  if (!url || !key) return null;
  const cacheKey = `${url}\0${key}`;
  if (!client || clientCacheKey !== cacheKey) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clientCacheKey = cacheKey;
  }
  return client;
}

function getClient(): SupabaseClient | null {
  return getSharedSupabaseClient();
}

export function scheduleSupabaseConversationInsert(record: ConversationTurnRecord): void {
  const table = getResolvedSupabaseTable().trim() || 'conversation_turns';
  const sb = getClient();
  if (!sb) return;

  void (async () => {
    try {
      const { error } = await sb.from(table).insert({
        recorded_at: new Date(record.recordedAt).toISOString(),
        sso_user_name: record.ssoUserName ?? null,
        user_message: record.userMessage,
        assistant_message: record.assistantMessage,
        tools_used: record.toolsUsed.length > 0 ? record.toolsUsed : [],
        channel: record.channel ?? 'studio',
        outcome: record.outcome ?? 'completed',
        error_detail: record.errorDetail ?? null,
      });
      if (error) {
        console.warn('[conversation-log] supabase:', error.message);
      }
    } catch (e) {
      console.warn('[conversation-log] supabase:', e instanceof Error ? e.message : e);
    }
  })();
}
