/**
 * Bounded accumulation for child_process / SSH streams to avoid unbounded heap growth.
 * Aligns with server/index.ts runProcess OUTPUT_LIMIT philosophy (tail retention).
 *
 * Manual soak (optional): run server with `node --inspect`, trigger `runRemoteCommands` / 设备 exec
 * with a command that floods stdout; RSS should plateau instead of growing linearly.
 * Automated coverage: `server/utils/__tests__/stream-output-limit.test.ts`.
 */

export const DEFAULT_STREAM_OUTPUT_CHAR_LIMIT = 512_000;
export const STDERR_STREAM_CHAR_LIMIT = 128_000;

export function appendUtf8WithTailCap(
  acc: string,
  chunk: Buffer | string,
  maxChars: number,
): { value: string; truncated: boolean } {
  const piece = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  const next = acc + piece;
  if (next.length <= maxChars) {
    return { value: next, truncated: false };
  }
  return { value: next.slice(next.length - maxChars), truncated: true };
}
