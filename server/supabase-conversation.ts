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

/** 与 scripts/supabase-conversation-test.mjs 及 DB text 列对齐；超限截断避免单轮超大回复导致 insert 失败 */
const MAX_MESSAGE_CHARS = 1_048_576;
const MAX_ERROR_DETAIL_CHARS = 32_768;
const MAX_SSO_USER_NAME_CHARS = 512;
const MAX_CHANNEL_CHARS = 32;
const MAX_OUTCOME_CHARS = 32;
const MAX_TOOL_NAME_CHARS = 128;
const MAX_TOOLS = 200;

function truncateForSupabaseField(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated for Supabase]`;
}

function sanitizeToolsUsedForSupabase(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const t = String(raw ?? '').trim().slice(0, MAX_TOOL_NAME_CHARS);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TOOLS) break;
  }
  return out;
}

/** 供测试：与 `.insert()` 使用同一套清洗规则 */
export function buildSupabaseConversationRow(record: ConversationTurnRecord): {
  recorded_at: string;
  sso_user_name: string | null;
  user_message: string;
  assistant_message: string;
  tools_used: string[];
  channel: string;
  outcome: string;
  error_detail: string | null;
} {
  const recordedAtMs = Number(record.recordedAt);
  const safeTime = Number.isFinite(recordedAtMs) ? recordedAtMs : Date.now();
  const ch = String(record.channel ?? 'studio').trim().slice(0, MAX_CHANNEL_CHARS) || 'studio';
  const oc = String(record.outcome ?? 'completed').trim().slice(0, MAX_OUTCOME_CHARS) || 'completed';
  return {
    recorded_at: new Date(safeTime).toISOString(),
    sso_user_name: record.ssoUserName != null && String(record.ssoUserName).trim()
      ? truncateForSupabaseField(String(record.ssoUserName).trim(), MAX_SSO_USER_NAME_CHARS)
      : null,
    user_message: truncateForSupabaseField(String(record.userMessage ?? ''), MAX_MESSAGE_CHARS),
    assistant_message: truncateForSupabaseField(String(record.assistantMessage ?? ''), MAX_MESSAGE_CHARS),
    tools_used: sanitizeToolsUsedForSupabase(record.toolsUsed ?? []),
    channel: ch,
    outcome: oc,
    error_detail:
      record.errorDetail != null && String(record.errorDetail).trim()
        ? truncateForSupabaseField(String(record.errorDetail), MAX_ERROR_DETAIL_CHARS)
        : null,
  };
}

export function scheduleSupabaseConversationInsert(record: ConversationTurnRecord): void {
  const table = getResolvedSupabaseTable().trim() || 'conversation_turns';
  const sb = getClient();
  if (!sb) return;

  void (async () => {
    try {
      const { error } = await sb.from(table).insert(buildSupabaseConversationRow(record));
      if (error) {
        console.warn('[conversation-log] supabase:', error.message);
      }
    } catch (e) {
      console.warn('[conversation-log] supabase:', e instanceof Error ? e.message : e);
    }
  })();
}
