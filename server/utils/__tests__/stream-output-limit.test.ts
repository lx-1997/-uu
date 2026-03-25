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
