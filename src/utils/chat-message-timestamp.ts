import type { ChatMessage } from '../app-types';

/**
 * 将可能为「秒」或「毫秒」的 Unix 时间规范为本地展示用的毫秒。
 * 历史数据里 id / startedAt 可能混用，错误单位会导致列表日期偏到 1970 年或错位。
 */
export function normalizeTimestampMs(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (raw >= 1e12) return raw;
  if (raw > 1e9 && raw < 1e11) return raw * 1000;
  return 0;
}

/** 单条消息可代表「最后活跃」的时间（优先 startedAt，其次 id） */
export function messageActivityTimestampMs(m: ChatMessage): number {
  const fromStarted = normalizeTimestampMs(m.startedAt ?? 0);
  if (fromStarted > 0) return fromStarted;
  return normalizeTimestampMs(m.id);
}

/** 线程最后活跃时间（取所有消息时间戳的最大值） */
export function threadLastActivityMs(msgs: ChatMessage[]): number {
  if (!msgs.length) return 0;
  let max = 0;
  for (const m of msgs) {
    max = Math.max(max, messageActivityTimestampMs(m));
  }
  return max;
}
