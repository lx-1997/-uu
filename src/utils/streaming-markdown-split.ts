/**
 * 流式揭示时：仅在「安全切分点」之后用纯文本 + 渐入，之前用 Markdown；
 * 避免在 **、`、``` 围栏中间切开导致加粗/代码错乱。
 *
 * 另：head（MD）与 tail（纯 span）若在两个相邻汉字之间切开，换行时浏览器可能把两字拆到两行（如「姿」「态」），
 * 因此在不破坏 MD 安全的前提下将边界左移到前一个汉字之前，使相邻汉字同处 tail。
 */

function isHanCodePoint(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2ceaf) ||
    (cp >= 0x30000 && cp <= 0x3134f)
  );
}

function firstCodePointAt(s: string, start: number): { end: number; cp: number } | undefined {
  if (start >= s.length) return undefined;
  const cp = s.codePointAt(start);
  if (cp === undefined) return undefined;
  const width = cp > 0xffff ? 2 : 1;
  return { end: start + width, cp };
}

/** `end` 为开区间：取紧邻其左侧的完整 code point */
function codePointBeforeEnd(s: string, end: number): { start: number; cp: number } | undefined {
  if (end <= 0) return undefined;
  let i = end - 1;
  const low = s.charCodeAt(i);
  if (low >= 0xdc00 && low <= 0xdfff && i >= 1) {
    const high = s.charCodeAt(i - 1);
    if (high >= 0xd800 && high <= 0xdbff) {
      return { start: i - 1, cp: s.codePointAt(i - 1)! };
    }
  }
  return { start: i, cp: s.codePointAt(i)! };
}

/** 对每个前缀长度 k（已消费 text[0..k)），是否可在该处切开（plain 尾段不破坏 MD 语义） */
export function buildNeutralPrefixFlags(full: string): boolean[] {
  const len = full.length;
  const flags = new Array<boolean>(len + 1);
  let i = 0;
  let inFence = false;
  let inBold = false;
  let inInlineCode = false;
  const neutral = () => inFence || (!inBold && !inInlineCode);

  flags[0] = neutral();

  while (i < len) {
    if (inFence) {
      if (full.startsWith('```', i)) {
        inFence = false;
        i += 3;
      } else {
        i += 1;
      }
    } else if (inInlineCode) {
      if (full[i] === '\\' && i + 1 < len) {
        i += 2;
      } else if (full[i] === '`') {
        inInlineCode = false;
        i += 1;
      } else {
        i += 1;
      }
    } else if (full.startsWith('```', i)) {
      inFence = true;
      i += 3;
    } else if (full.startsWith('**', i)) {
      inBold = !inBold;
      i += 2;
    } else if (full[i] === '`') {
      inInlineCode = true;
      i += 1;
    } else {
      i += 1;
    }
    flags[i] = neutral();
  }

  return flags;
}

function computeFadeSplitIndexFromFlags(full: string, minTailLen: number, flags: boolean[]): number {
  let split = Math.max(1, full.length - minTailLen);
  while (split < full.length && !flags[split]) {
    split += 1;
  }
  return split;
}

function adjustFadeSplitAvoidHanAdjacentWithFlags(full: string, split: number, flags: boolean[]): number {
  if (split <= 0 || split >= full.length) return split;
  let s = split;
  while (s > 0) {
    const left = codePointBeforeEnd(full, s);
    const right = firstCodePointAt(full, s);
    if (!left || !right) break;
    if (!isHanCodePoint(left.cp) || !isHanCodePoint(right.cp)) break;
    if (!flags[left.start]) break;
    s = left.start;
  }
  return s;
}

/**
 * 返回切分下标 split：head = [0,split)，tail = [split,len)。
 * 目标 tail 至少约 minTailLen，且 split 尽量小；O(n) 单次建表 + 线性扫描。
 */
export function findStreamingFadeSplitIndex(full: string, minTailLen: number): number {
  if (!full || minTailLen <= 0) return full.length;
  if (full.length <= 1) return full.length;

  const flags = buildNeutralPrefixFlags(full);
  return computeFadeSplitIndexFromFlags(full, minTailLen, flags);
}

/**
 * 若当前切分落在相邻两个汉字之间，且允许将边界左移，则左移使两字同落入 tail（同一 inline 盒），避免行首行尾拆字。
 */
export function adjustFadeSplitAvoidHanAdjacent(full: string, split: number): number {
  if (split <= 0 || split >= full.length) return split;
  const flags = buildNeutralPrefixFlags(full);
  return adjustFadeSplitAvoidHanAdjacentWithFlags(full, split, flags);
}

/**
 * 一次建表：先取安全 MD 切分点，再左移避开相邻汉字边界（供流式 Dock 热路径，避免重复 buildNeutralPrefixFlags）。
 */
export function findAdjustedStreamingFadeSplitIndex(full: string, minTailLen: number): number {
  if (!full || minTailLen <= 0) return full.length;
  if (full.length <= 1) return full.length;
  const flags = buildNeutralPrefixFlags(full);
  const split = computeFadeSplitIndexFromFlags(full, minTailLen, flags);
  return adjustFadeSplitAvoidHanAdjacentWithFlags(full, split, flags);
}
