/**
 * 部分 OpenAI 兼容厂商把推理写在正文 delta 的「类 thinking 标签」里（如 <thinking>、 Qwen 系 `</redacted_thinking>`），
 * pi-ai 只认 reasoning / reasoning_content 等字段 → Studio 收不到 thinking_delta。
 * 此处在 agent-loop 层把正文流拆成「推理」与「对用户可见正文」两路事件。
 *
 * 持久化到 assistant 消息时统一用 `<thinking>...</thinking>`，与历史解析一致。
 */

/** 仅 ASCII 标签；匹配时不做整串 toLowerCase（性能与代理兼容性） */
const THINK_TAG_DEFS: ReadonlyArray<{ open: string; close: string }> = [
  { open: '<thinking>', close: '</thinking>' },
  /** Qwen / 部分国产推理模型在 content 中输出的 think 区段（非 XML 的 thinking） */
  { open: '<redacted_thinking>', close: '</redacted_thinking>' },
];

const OPEN_KEEP = Math.max(1, ...THINK_TAG_DEFS.map((d) => d.open.length - 1));

function closeKeepFor(close: string): number {
  return Math.max(1, close.length - 1);
}

/** ASCII 不区分大小写（标签仅含 ASCII，免整串 toLowerCase(carry)） */
function asciiLowerCode(c: number): number {
  return c >= 65 && c <= 90 ? c + 32 : c;
}

function findInsensitive(haystack: string, needle: string): number {
  const nlen = needle.length;
  if (nlen === 0 || haystack.length < nlen) return -1;
  const lastStart = haystack.length - nlen;
  for (let i = 0; i <= lastStart; i++) {
    let j = 0;
    for (; j < nlen; j++) {
      if (asciiLowerCode(haystack.charCodeAt(i + j)) !== asciiLowerCode(needle.charCodeAt(j))) break;
    }
    if (j === nlen) return i;
  }
  return -1;
}

export type InlineThinkingRouter = {
  push: (delta: string) => { thinking: string[]; message: string[] };
  /** 每个正文 text 块结束（text_end）后复位，避免与下一段文本串台 */
  reset: () => void;
  /** 流异常结束或缺少 text_end 时清空残留 */
  end: () => { thinking: string[]; message: string[] };
};

export function createInlineThinkingRouter(): InlineThinkingRouter {
  let inThinking = false;
  /** 当前等待的闭合标签（与 THINK_TAG_DEFS 某条一致） */
  let activeClose = '';
  let carry = '';

  const flush = (): { thinking: string[]; message: string[] } => {
    const thinking: string[] = [];
    const message: string[] = [];
    const emitThink = (s: string) => {
      if (s) thinking.push(s);
    };
    const emitMsg = (s: string) => {
      if (s) message.push(s);
    };

    while (carry.length > 0) {
      if (!inThinking) {
        let bestIdx = -1;
        let bestOpenLen = 0;
        let bestClose = '';
        for (const def of THINK_TAG_DEFS) {
          const o = findInsensitive(carry, def.open);
          if (o === -1) continue;
          if (bestIdx === -1 || o < bestIdx) {
            bestIdx = o;
            bestOpenLen = def.open.length;
            bestClose = def.close;
          }
        }
        if (bestIdx === -1) {
          if (carry.length > OPEN_KEEP) {
            emitMsg(carry.slice(0, carry.length - OPEN_KEEP));
            carry = carry.slice(carry.length - OPEN_KEEP);
          }
          break;
        }
        if (bestIdx > 0) emitMsg(carry.slice(0, bestIdx));
        carry = carry.slice(bestIdx + bestOpenLen);
        inThinking = true;
        activeClose = bestClose;
        continue;
      }
      const c = findInsensitive(carry, activeClose);
      if (c === -1) {
        const ck = closeKeepFor(activeClose);
        if (carry.length > ck) {
          emitThink(carry.slice(0, carry.length - ck));
          carry = carry.slice(carry.length - ck);
        }
        break;
      }
      if (c > 0) emitThink(carry.slice(0, c));
      carry = carry.slice(c + activeClose.length);
      inThinking = false;
      activeClose = '';
    }
    return { thinking, message };
  };

  return {
    push(delta: string) {
      carry += delta;
      return flush();
    },
    reset() {
      carry = '';
      inThinking = false;
      activeClose = '';
    },
    end() {
      const thinking: string[] = [];
      const message: string[] = [];
      if (!carry) return { thinking, message };
      if (inThinking) {
        if (carry) thinking.push(carry);
      } else if (carry) {
        message.push(carry);
      }
      carry = '';
      inThinking = false;
      activeClose = '';
      return { thinking, message };
    },
  };
}

/**
 * 从整段 assistant 文本块中提取所有已知「思考」标签内的正文，用于 text_end 落盘与可见部分拆分。
 */
export function splitThinkingTagsFromAssistantText(raw: string): { thinkingBodies: string[]; visible: string } {
  const thinkingBodies: string[] = [];
  let work = raw;
  let guard = 0;
  const maxPasses = 64;
  while (guard++ < maxPasses) {
    let bestIdx = -1;
    let bestDef: { open: string; close: string } | null = null;
    for (const def of THINK_TAG_DEFS) {
      const idx = findInsensitive(work, def.open);
      if (idx === -1) continue;
      if (bestIdx === -1 || idx < bestIdx) {
        bestIdx = idx;
        bestDef = def;
      }
    }
    if (bestIdx === -1 || !bestDef) break;
    const afterOpen = bestIdx + bestDef.open.length;
    const tail = work.slice(afterOpen);
    const closeRel = findInsensitive(tail, bestDef.close);
    if (closeRel === -1) break;
    const body = tail.slice(0, closeRel).trim();
    if (body) thinkingBodies.push(body);
    const end = afterOpen + closeRel + bestDef.close.length;
    work = (work.slice(0, bestIdx) + work.slice(end)).replace(/^\s*\n+/, '').replace(/\n+\s*$/, '');
  }
  return { thinkingBodies, visible: work.trim() };
}
