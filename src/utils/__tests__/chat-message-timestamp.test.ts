import { describe, expect, it } from 'vitest';
import { messageActivityTimestampMs, normalizeTimestampMs, threadLastActivityMs } from '../chat-message-timestamp';
import type { ChatMessage } from '../../app-types';

describe('normalizeTimestampMs', () => {
  it('treats values >= 1e12 as milliseconds', () => {
    const ms = 1_764_000_000_000;
    expect(normalizeTimestampMs(ms)).toBe(ms);
  });

  it('treats 10-digit unix seconds as seconds', () => {
    const sec = 1_764_000_000;
    expect(normalizeTimestampMs(sec)).toBe(sec * 1000);
  });
});

describe('threadLastActivityMs', () => {
  it('uses startedAt when id is tiny', () => {
    const ts = 1_764_000_000_000;
    const msgs: ChatMessage[] = [
      { id: 1, role: 'user', text: 'x' },
      { id: 2, role: 'ai', text: 'y', startedAt: ts },
    ];
    expect(threadLastActivityMs(msgs)).toBe(ts);
  });

  it('uses id when it looks like epoch ms', () => {
    const ts = 1_764_000_000_000;
    const msgs: ChatMessage[] = [{ id: ts, role: 'user', text: 'x' }];
    expect(threadLastActivityMs(msgs)).toBe(ts);
  });
});

describe('messageActivityTimestampMs', () => {
  it('prefers startedAt over id', () => {
    const s = 1_700_000_000;
    const m: ChatMessage = { id: 999, role: 'ai', text: 'x', startedAt: s };
    expect(messageActivityTimestampMs(m)).toBe(s * 1000);
  });
});
