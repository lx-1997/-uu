/**
 * 避免「用户侧已打开」与「模型 studio_open_url」等对同一 URL 连续弹两个窗口。
 * 同一规范化 URL 在冷却时间内仅允许一次「占用槽位」后的打开。
 */

const COOLDOWN_MS = 12_000;
const lastOpenedAt = new Map<string, number>();

function normalizeDedupKey(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.hash = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return raw;
  }
}

const MAX_ENTRIES = 48;

function pruneOldEntries(now: number): void {
  if (lastOpenedAt.size <= MAX_ENTRIES) return;
  for (const [k, t] of lastOpenedAt) {
    if (now - t > COOLDOWN_MS) lastOpenedAt.delete(k);
  }
}

/**
 * 若近期已打开过同一 URL，返回 false（调用方应跳过打开）。
 * 否则记录时间并返回 true（调用方应继续打开）。
 */
export function tryConsumeStudioOpenSlot(url: string): boolean {
  const key = normalizeDedupKey(url);
  if (!key) return false;
  const now = Date.now();
  const prev = lastOpenedAt.get(key);
  if (prev !== undefined && now - prev < COOLDOWN_MS) {
    return false;
  }
  lastOpenedAt.set(key, now);
  pruneOldEntries(now);
  return true;
}
