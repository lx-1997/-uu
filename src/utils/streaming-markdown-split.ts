/**
 * 流式揭示时：仅在「安全切分点」之后用纯文本 + 渐入，之前用 Markdown；
 * 避免在 **、`、``` 围栏中间切开导致加粗/代码错乱。
 */

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

/**
 * 返回切分下标 split：head = [0,split)，tail = [split,len)。
 * 目标 tail 至少约 minTailLen，且 split 尽量小；O(n) 单次建表 + 线性扫描。
 */
export function findStreamingFadeSplitIndex(full: string, minTailLen: number): number {
  if (!full || minTailLen <= 0) return full.length;
  if (full.length <= 1) return full.length;

  const flags = buildNeutralPrefixFlags(full);
  let split = Math.max(1, full.length - minTailLen);
  while (split < full.length && !flags[split]) {
    split += 1;
  }
  return split;
}
