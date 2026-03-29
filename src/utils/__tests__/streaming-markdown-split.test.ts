import { describe, expect, it } from 'vitest';
import {
  adjustFadeSplitAvoidHanAdjacent,
  buildNeutralPrefixFlags,
  findAdjustedStreamingFadeSplitIndex,
  findStreamingFadeSplitIndex,
} from '../streaming-markdown-split';

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

describe('findAdjustedStreamingFadeSplitIndex', () => {
  it('matches find + adjust with single flags build (Han boundary)', () => {
    const t = 'xx姿态yy';
    const minTail = 3;
    const raw = findStreamingFadeSplitIndex(t, minTail);
    const chained = adjustFadeSplitAvoidHanAdjacent(t, raw);
    expect(findAdjustedStreamingFadeSplitIndex(t, minTail)).toBe(chained);
    expect(chained).toBe(2);
  });

  it('matches find + adjust for plain ASCII', () => {
    const t = 'hello world';
    const minTail = 5;
    const raw = findStreamingFadeSplitIndex(t, minTail);
    expect(findAdjustedStreamingFadeSplitIndex(t, minTail)).toBe(
      adjustFadeSplitAvoidHanAdjacent(t, raw),
    );
  });
});

describe('adjustFadeSplitAvoidHanAdjacent', () => {
  it('moves split left so adjacent Han chars are not head|tail boundary', () => {
    const t = 'xx姿态yy';
    const split = 3;
    expect(t.slice(0, split)).toBe('xx姿');
    expect(t.slice(split)).toBe('态yy');
    const adj = adjustFadeSplitAvoidHanAdjacent(t, split);
    expect(adj).toBe(2);
    expect(t.slice(0, adj)).toBe('xx');
    expect(t.slice(adj)).toBe('姿态yy');
  });

  it('does not cross into non-neutral markdown when moving left', () => {
    const t = '**姿态**';
    const split = 3;
    const adj = adjustFadeSplitAvoidHanAdjacent(t, split);
    expect(adj).toBe(split);
  });
});
