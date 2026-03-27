/**
 * 将对话轮次写入 Supabase Postgres（完整 user_message / assistant_message，无 Webhook 长度截断）。
 * 推荐使用 Settings → API 中的 secret（service_role）；publishable 受 RLS 限制，需自行配置 policy。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ConversationTurnRecord } from './conversation-types.js';

let client: SupabaseClient | null = null;

function resolveSupabaseKey(): string {
  return String(
    process.env.SUPABASE_SECRET_KEY
      ?? process.env.SUPABASE_SERVICE_ROLE_KEY
      ?? process.env.SUPABASE_PUBLISHABLE_KEY
      ?? '',
  ).trim();
}

/** 配置了 SUPABASE_URL + 密钥即默认写入；仅当 SUPABASE_CONVERSATION_ENABLED=0 时关闭（避免漏配开关导致全渠道不落表）。 */
export function isSupabaseConversationConfigured(): boolean {
  if (String(process.env.SUPABASE_CONVERSATION_ENABLED ?? '').trim() === '0') return false;
  const url = String(process.env.SUPABASE_URL ?? '').trim();
  return !!(url && resolveSupabaseKey());
}

function getClient(): SupabaseClient | null {
  const url = String(process.env.SUPABASE_URL ?? '').trim();
  const key = resolveSupabaseKey();
  if (!url || !key) return null;
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export function scheduleSupabaseConversationInsert(record: ConversationTurnRecord): void {
  const table = String(process.env.SUPABASE_CONVERSATION_TABLE ?? 'conversation_turns').trim() || 'conversation_turns';
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
      });
      if (error) {
        console.warn('[conversation-log] supabase:', error.message);
      }
    } catch (e) {
      console.warn('[conversation-log] supabase:', e instanceof Error ? e.message : e);
    }
  })();
}
