/**
 * 匿名日活写入 Supabase（与 conversation_turns 共用 Supabase 客户端与凭证，表名默认 studio_daily_usage）。
 * 需在库中执行 supabase/studio_daily_usage.sql。
 * 默认：已解析到 Supabase URL 与密钥时即写入；仅当 SUPABASE_DAILY_USAGE_ENABLED=0|false 时关闭。
 */
import {
  getResolvedSupabaseKey,
  getResolvedSupabaseUrl,
} from './supabase-embedded-config.js';
import {
  getSharedSupabaseClient,
  isSupabaseConversationConfigured,
} from './supabase-conversation.js';

function isDailyUsageExplicitlyDisabled(): boolean {
  const v = String(process.env.SUPABASE_DAILY_USAGE_ENABLED ?? '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off' || v === 'no';
}

/** 与 performDailyActiveInsert 的开关逻辑一致（供运维/测试查询） */
export function isDailyUsageWriteEnabled(): boolean {
  if (isDailyUsageExplicitlyDisabled()) return false;
  // 与对话归档同口径时优先（conversation_turns 能写则日活同凭证）
  if (isSupabaseConversationConfigured()) return true;
  // 仅关闭对话归档、仍要写日活：具备 URL+密钥即可
  return !!(getResolvedSupabaseUrl() && getResolvedSupabaseKey());
}

export type DailyActiveInsertResult =
  | { ok: true; persisted: true; duplicate?: boolean }
  | { ok: true; persisted: false; reason: 'disabled' | 'no_credentials' }
  | { ok: false; error: string };

export function getResolvedDailyUsageTable(): string {
  const env = String(process.env.SUPABASE_DAILY_USAGE_TABLE ?? '').trim();
  return env || 'studio_daily_usage';
}

/**
 * 记录一次「当日活跃」；同一 anonymousId + UTC 日仅第一条生效（依赖表唯一约束）。
 * 返回 persisted 供前端决定是否写入「本日已上报」标记，避免误标成功而库中无行。
 */
export async function performDailyActiveInsert(
  anonymousId: string,
  appVersion: string,
): Promise<DailyActiveInsertResult> {
  if (!isDailyUsageWriteEnabled()) {
    return { ok: true, persisted: false, reason: 'disabled' };
  }
  const table = getResolvedDailyUsageTable();
  const sb = getSharedSupabaseClient();
  if (!sb) {
    return { ok: true, persisted: false, reason: 'no_credentials' };
  }

  const usageDate = new Date().toISOString().slice(0, 10);
  const aid = anonymousId.trim().slice(0, 64);
  const ver = appVersion.trim().slice(0, 48);
  if (!aid) {
    return { ok: false, error: 'anonymousId empty' };
  }

  try {
    const { error } = await sb.from(table).insert({
      usage_date: usageDate,
      anonymous_id: aid,
      app_version: ver || null,
    });
    if (!error) {
      console.log('[daily-usage] inserted', { table, usage_date: usageDate, app_version: ver || null });
      return { ok: true, persisted: true };
    }
    const msg = error.message || '';
    const code = (error as { code?: string }).code || '';
    if (/duplicate|unique|23505/i.test(msg) || code === '23505') {
      console.log('[daily-usage] duplicate (already counted today)', { table, usage_date: usageDate });
      return { ok: true, persisted: true, duplicate: true };
    }
    console.warn('[daily-usage] supabase insert failed:', { code, message: msg, table });
    return { ok: false, error: msg };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[daily-usage] supabase:', msg);
    return { ok: false, error: msg };
  }
}
