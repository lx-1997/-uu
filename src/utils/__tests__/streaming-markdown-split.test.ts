import { describe, expect, it } from 'vitest';
import { buildNeutralPrefixFlags, findStreamingFadeSplitIndex } from '../streaming-markdown-split';

describe('buildNeutralPrefixFlags', () => {
  it('empty prefix is neutral', () => {
    const f = buildNeutralPrefixFlags('');
    expect(f).toEqual([true]);
  });

  it('inside bold is not neutral until closed', () => {
    const t = '**ab';
    const f = buildNeutralPrefixFlags(t);
    expect(f[0]).toBe(true);
    expect(f[2]).toBe(false); // after '**'
    expect(f[3]).toBe(false); // after 'a'
    expect(f[4]).toBe(false); // after 'b' still open bold
  });

  it('after closing bold is neutral', () => {
    const t = '**ab**c';
    const f = buildNeutralPrefixFlags(t);
    expect(f[t.length]).toBe(true);
  });
});

describe('findStreamingFadeSplitIndex', () => {
  it('returns full length when minTail is 0', () => {
    expect(findStreamingFadeSplitIndex('hello', 0)).toBe(5);
  });

  it('finds neutral split for plain suffix', () => {
    const s = findStreamingFadeSplitIndex('hello world', 5);
    expect(s).toBeLessThan(11);
    expect(s).toBeGreaterThanOrEqual(1);
  });

  it('extends split when minTail would land inside bold', () => {
    const t = 'pre **bold**';
    const idx = findStreamingFadeSplitIndex(t, 2);
    const tail = t.slice(idx);
    expect(t.slice(0, idx) + tail).toBe(t);
    expect(idx).toBeGreaterThanOrEqual(1);
  });
});
