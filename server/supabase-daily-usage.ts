/**
 * 匿名日活写入 Supabase（与 conversation_turns 共用 Supabase 客户端与凭证，表名默认 studio_daily_usage）。
 * 需在库中执行 supabase/studio_daily_usage.sql。
 * 默认：已解析到 Supabase URL 与密钥时即写入；仅当 SUPABASE_DAILY_USAGE_ENABLED=0|false 时关闭。
 * 不向控制台输出任何与 Supabase 相关的日志（静默失败与重试）。
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
  | { ok: true; persisted: true }
  | {
      ok: true;
      persisted: false;
      /** 未写入：功能关闭 / 无凭证 / 远端不可用（不向客户端暴露具体原因） */
      reason: 'disabled' | 'no_credentials' | 'unavailable';
    }
  | { ok: false; error: string };

export function getResolvedDailyUsageTable(): string {
  const env = String(process.env.SUPABASE_DAILY_USAGE_TABLE ?? '').trim();
  return env || 'studio_daily_usage';
}

/** 与 studio_daily_usage.sql 注释一致：业务日历日按此时区切分（默认 Asia/Shanghai） */
export function getResolvedDailyUsageTimezone(): string {
  const raw = String(process.env.SUPABASE_DAILY_USAGE_TIMEZONE ?? '').trim();
  return raw || 'Asia/Shanghai';
}

/** 将 instant 格式化为指定 IANA 时区下的日历日 YYYY-MM-DD（非 UTC 日） */
export function formatCalendarDateYmdInTimeZone(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) {
    throw new Error(`Intl formatToParts failed for timeZone=${timeZone}`);
  }
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function resolveUsageDateString(now: Date): string {
  const tz = getResolvedDailyUsageTimezone();
  try {
    return formatCalendarDateYmdInTimeZone(now, tz);
  } catch {
    try {
      return formatCalendarDateYmdInTimeZone(now, 'Asia/Shanghai');
    } catch {
      return now.toISOString().slice(0, 10);
    }
  }
}

/**
 * 记录一次打开 PV（每验证/打开一行）。usage_key：SSO 为展示名；无 SSO 为匿名 id。
 */
export async function performDailyActiveInsert(
  usageKey: string,
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

  const usageDate = resolveUsageDateString(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(usageDate)) {
    return { ok: true, persisted: false, reason: 'unavailable' };
  }
  const aid = usageKey.trim().slice(0, 256);
  const ver = appVersion.trim().slice(0, 48);
  if (!aid) {
    return { ok: false, error: 'usage_key empty' };
  }

  const row = {
    usage_date: usageDate,
    anonymous_id: aid,
    app_version: ver || null,
  };

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const retryDelaysMs = [0, 600, 1800];

  for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelaysMs[attempt]!);
    }
    try {
      /** 列名与 supabase/studio_daily_usage.sql 一致：usage_date / anonymous_id / app_version */
      const { error } = await sb.from(table).insert(row);
      if (!error) {
        return { ok: true, persisted: true };
      }
      const msg = error.message || '';
      const code = (error as { code?: string }).code || '';
      if (code === '23505' || /duplicate|unique constraint/i.test(msg)) {
        return { ok: true, persisted: true };
      }
    } catch {
      /* 静默重试 */
    }
  }
  return { ok: true, persisted: false, reason: 'unavailable' };
}
