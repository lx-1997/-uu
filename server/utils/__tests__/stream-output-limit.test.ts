import { describe, it, expect } from 'vitest';
import { appendUtf8WithTailCap, DEFAULT_STREAM_OUTPUT_CHAR_LIMIT } from '../stream-output-limit.js';

describe('appendUtf8WithTailCap', () => {
  it('returns unchanged when under limit', () => {
    const r = appendUtf8WithTailCap('ab', 'cd', 100);
    expect(r.value).toBe('abcd');
    expect(r.truncated).toBe(false);
  });

  it('keeps tail when over limit (string)', () => {
    const max = 10;
    const r = appendUtf8WithTailCap('0123456789', 'abcdefghij', max);
    expect(r.value.length).toBe(max);
    expect(r.value).toBe('abcdefghij');
    expect(r.truncated).toBe(true);
  });

  it('handles Buffer chunks', () => {
    const r = appendUtf8WithTailCap('', Buffer.from('xy'), 1);
    expect(r.value).toBe('y');
    expect(r.truncated).toBe(true);
  });

  it('default limit constant is positive', () => {
    expect(DEFAULT_STREAM_OUTPUT_CHAR_LIMIT).toBeGreaterThan(10_000);
  });
});

/** Mirrors useAIChatStore stripHeavyDataUrlsForStorage index guard (keep last N full). */
function storageKeepFrom(messagesLength: number, keepLast: number) {
  return Math.max(0, messagesLength - keepLast);
}

describe('localStorage strip index math (frontend parity)', () => {
  it('when fewer messages than keepLast, keepFrom is 0 so all rows keep attachments', () => {
    const keepLast = 6;
    expect(storageKeepFrom(3, keepLast)).toBe(0);
    expect([0, 1, 2].every((i) => i >= storageKeepFrom(3, keepLast))).toBe(true);
  });

  it('when many messages, only first segment may be stripped', () => {
    const keepLast = 6;
    const len = 10;
    const kf = storageKeepFrom(len, keepLast);
    expect(kf).toBe(4);
    expect([0, 1, 2, 3].every((i) => i < kf)).toBe(true);
    expect([4, 5, 6, 7, 8, 9].every((i) => i >= kf)).toBe(true);
  });
});
