/**
 * 匿名日活写入 Supabase（与 conversation 共用 URL/密钥，表名默认 studio_daily_usage）。
 * 需在库中执行 supabase/studio_daily_usage.sql。
 * 默认：已解析到 Supabase URL 与密钥时即写入；仅当 SUPABASE_DAILY_USAGE_ENABLED=0|false 时关闭。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  getResolvedSupabaseKey,
  getResolvedSupabaseUrl,
} from './supabase-embedded-config.js';

let client: SupabaseClient | null = null;
let clientCacheKey = '';

function isDailyUsageExplicitlyDisabled(): boolean {
  const v = String(process.env.SUPABASE_DAILY_USAGE_ENABLED ?? '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off' || v === 'no';
}

/** 与 performDailyActiveInsert 的开关逻辑一致（供运维/测试查询） */
export function isDailyUsageWriteEnabled(): boolean {
  if (isDailyUsageExplicitlyDisabled()) return false;
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

function getClient(): SupabaseClient | null {
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
  const sb = getClient();
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
      return { ok: true, persisted: true };
    }
    const msg = error.message || '';
    if (/duplicate|unique|23505/i.test(msg)) {
      return { ok: true, persisted: true, duplicate: true };
    }
    console.warn('[daily-usage] supabase:', msg);
    return { ok: false, error: msg };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[daily-usage] supabase:', msg);
    return { ok: false, error: msg };
  }
}
