import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';

/**
 * 揭示节奏（与产品对外表述对齐时 Dock 使用 `natural`）：
 * - `natural`：拟人步频（标点略停、缓冲落后时批量加速），比早期版本更贴 SSE，仍保留句读节奏。
 * - `uniform`：固定间隔、每步一字，仅用于刻意匀速演示，不对应默认产品话术。
 */
export type StreamRevealPacing = 'natural' | 'uniform';

/** 匀速模式：每字间隔（ms），约 22ms ≈ 45 字/秒 */
const UNIFORM_CHAR_INTERVAL_MS = 22;

/** 微调节奏：首段略加速；中段不再人为放慢，避免「跟手」感被拖住 */
function phaseDelayMultiplier(visibleLen: number): number {
  return visibleLen < 20 ? 0.82 : 1;
}

export type StreamRevealView = {
  /** 当前应展示的文本前缀（与 fullText 同步长度上限） */
  visible: string;
  /** 本批揭示用于尾段渐入的 React key */
  tailKey: number;
  /** 本批新露出的字符数（用于切分 minTail）；catchup 整段时为全文长度 */
  lastStepLen: number;
  /** 切后台等一次性追上整段，本帧不与「尾段渐入」混用 */
  singleInstant: boolean;
};

type RevealState = {
  visibleLen: number;
  tailKey: number;
  lastStepLen: number;
  singleInstant: boolean;
};

type RevealAction =
  | { type: 'reset' }
  | { type: 'reveal'; delta: string; nextLen: number; key: number }
  | { type: 'catchup'; full: string; key: number };

function revealReducer(state: RevealState, action: RevealAction): RevealState {
  switch (action.type) {
    case 'reset':
      return { visibleLen: 0, tailKey: 0, lastStepLen: 0, singleInstant: false };
    case 'catchup': {
      const full = action.full;
      if (!full) return { visibleLen: 0, tailKey: 0, lastStepLen: 0, singleInstant: false };
      return {
        visibleLen: full.length,
        tailKey: action.key,
        lastStepLen: full.length,
        singleInstant: true,
      };
    }
    case 'reveal': {
      if (!action.delta) return state;
      return {
        visibleLen: action.nextLen,
        tailKey: action.key,
        lastStepLen: action.delta.length,
        singleInstant: false,
      };
    }
    default:
      return state;
  }
}

/**
 * 流式揭示：按节奏露出正文（不累积 segments 数组，visible 用 slice，省内存）。
 * @param pacing 默认 `natural`（动态步频）。`uniform` 为固定间隔一字一步。
 */
export function useStreamRevealSegments(
  fullText: string,
  active: boolean,
  pacing: StreamRevealPacing = 'natural',
): StreamRevealView {
  const [state, dispatch] = useReducer(revealReducer, {
    visibleLen: 0,
    tailKey: 0,
    lastStepLen: 0,
    singleInstant: false,
  });
  const fullRef = useRef(fullText);
  fullRef.current = fullText;
  const keyRef = useRef(0);

  useLayoutEffect(() => {
    if (fullText.length < state.visibleLen) {
      dispatch({ type: 'reset' });
    }
  }, [fullText, state.visibleLen]);

  useEffect(() => {
    if (!active) return;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        dispatch({ type: 'catchup', full: fullRef.current, key: ++keyRef.current });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    if (state.visibleLen >= fullRef.current.length) return;

    const v = state.visibleLen;
    const full = fullRef.current;
    const behind = full.length - v;

    let n: number;
    let delayMs: number;

    if (pacing === 'uniform') {
      n = 1;
      delayMs = UNIFORM_CHAR_INTERVAL_MS;
    } else {
      /** 尾段仍逐字，保证收尾与 Markdown 切分稳定；更早进入 2～4 字批量以追赶 SSE */
      const TAIL_SINGLE = 22;
      n =
        behind <= TAIL_SINGLE
          ? 1
          : behind > 120
            ? 4
            : behind > 52
              ? 3
              : behind > 16
                ? 2
                : 1;

      const ch = full[v] ?? '';
      if (n === 1) {
        // 句读仍略停，比例与旧版相近，绝对值下调以整体更轻快
        if (/[。！？!?]/.test(ch)) delayMs = 36;
        else if (/[，、；：;,]/.test(ch)) delayMs = 18;
        else if (ch === '\n') delayMs = 12;
        else if (/\s/.test(ch)) delayMs = 4;
        else delayMs = 6;
        delayMs = Math.round(delayMs * phaseDelayMultiplier(v));
        delayMs = Math.max(2, delayMs);
      } else {
        delayMs = Math.max(4, 11 - Math.floor(behind / 44));
        delayMs = Math.round(delayMs * phaseDelayMultiplier(v));
        delayMs = Math.max(3, delayMs);
      }
    }

    const id = window.setTimeout(() => {
      const cur = fullRef.current;
      const next = Math.min(v + n, cur.length);
      const delta = cur.slice(v, next);
      if (delta) {
        dispatch({ type: 'reveal', delta, nextLen: next, key: ++keyRef.current });
      }
    }, delayMs);

    return () => clearTimeout(id);
  }, [active, fullText, pacing, state.visibleLen]);

  if (!active) {
    return {
      visible: fullText,
      tailKey: 0,
      lastStepLen: 0,
      singleInstant: false,
    };
  }

  return {
    visible: fullText.slice(0, state.visibleLen),
    tailKey: state.tailKey,
    lastStepLen: state.lastStepLen,
    singleInstant: state.singleInstant,
  };
}
