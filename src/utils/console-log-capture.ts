import { useSyncExternalStore } from 'react';

export type ConsoleLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface ConsoleLogLine {
  id: number;
  ts: number;
  level: ConsoleLogLevel;
  text: string;
}

const CHANNEL = 'rdk-studio-console-capture-v1';
const MAX_LINES = 2500;

let seq = 0;
let lines: ConsoleLogLine[] = [];
let snapshot: ConsoleLogLine[] = [];
const listeners = new Set<() => void>();

let patched = false;
let bc: BroadcastChannel | null = null;
let bcReady = false;
let clearUiListenerAttached = false;

function notify() {
  snapshot = lines.slice();
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* noop */
    }
  });
}

function getBc(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    if (!bc) bc = new BroadcastChannel(CHANNEL);
    return bc;
  } catch {
    return null;
  }
}

function broadcastLine(line: ConsoleLogLine) {
  try {
    getBc()?.postMessage({ t: 'line', line });
  } catch {
    /* noop */
  }
}

function broadcastCleared() {
  try {
    getBc()?.postMessage({ t: 'cleared' });
  } catch {
    /* noop */
  }
}

function mirrorLineToElectron(line: ConsoleLogLine) {
  if (typeof window === 'undefined') return;
  try {
    window.rdkDesktop?.mirrorStudioLogLine?.(line);
  } catch {
    /* noop */
  }
}

function formatArg(a: unknown): string {
  if (a === null) return 'null';
  if (a === undefined) return 'undefined';
  if (typeof a === 'string') return a;
  if (typeof a === 'number' || typeof a === 'boolean' || typeof a === 'bigint') return String(a);
  if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ''}`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function formatArgs(args: unknown[]): string {
  return args.map(formatArg).join(' ');
}

function pushLine(level: ConsoleLogLevel, text: string) {
  const line: ConsoleLogLine = {
    id: ++seq,
    ts: Date.now(),
    level,
    text,
  };
  lines.push(line);
  if (lines.length > MAX_LINES) {
    lines = lines.slice(-MAX_LINES);
  }
  notify();
  broadcastLine(line);
  mirrorLineToElectron(line);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot(): ConsoleLogLine[] {
  return snapshot;
}

function attachBcListener() {
  if (bcReady) return;
  const ch = getBc();
  if (!ch) return;
  bcReady = true;
  ch.onmessage = (ev: MessageEvent<{ t?: string }>) => {
    const d = ev.data;
    if (d?.t === 'sync') {
      try {
        ch.postMessage({ t: 'snap', lines: lines.slice() });
      } catch {
        /* noop */
      }
      return;
    }
    if (d?.t === 'clear-request') {
      clearConsoleLogs();
    }
  };
}

/**
 * 写入与 console 捕获相同的缓冲（用于闪连等未走 console 的业务步骤）。
 */
export function appendStudioLog(level: ConsoleLogLevel, message: string): void {
  pushLine(level, message);
}

/**
 * 劫持 console，将前端日志写入环形缓冲并可选同步到弹窗（BroadcastChannel / Electron 子窗口）。
 * 幂等：重复调用无效。
 */
export function startConsoleLogCapture(): void {
  if (patched || typeof console === 'undefined') return;
  patched = true;
  attachBcListener();
  snapshot = lines.slice();

  if (typeof window !== 'undefined' && !clearUiListenerAttached) {
    clearUiListenerAttached = true;
    window.addEventListener('rdk-studio-log-clear-ui', () => {
      lines = [];
      snapshot = [];
      notify();
      broadcastCleared();
    });
  }

  const levels: ConsoleLogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];
  const originals = {} as Record<ConsoleLogLevel, (...a: unknown[]) => void>;
  for (const level of levels) {
    const orig = console[level] as (...a: unknown[]) => void;
    originals[level] = orig.bind(console);
  }

  for (const level of levels) {
    (console as unknown as Record<string, (...a: unknown[]) => void>)[level] = (...args: unknown[]) => {
      try {
        pushLine(level, formatArgs(args));
      } catch {
        try {
          pushLine(level, String(args[0] ?? ''));
        } catch {
          /* noop */
        }
      }
      originals[level](...args);
    };
  }
}

export function useConsoleLogLines(): ConsoleLogLine[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function clearConsoleLogs(): void {
  try {
    window.rdkDesktop?.notifyStudioLogClear?.();
  } catch {
    /* noop */
  }
  lines = [];
  snapshot = [];
  notify();
  broadcastCleared();
}

/** 浏览器内新开标签用的静态页（网页版）；桌面版请用 openConsoleLogWindowPreferred */
export function getConsoleLogPopupUrl(): string {
  return new URL('rdk-console-log.html', window.location.href).href;
}

export function openConsoleLogPopup(): Window | null {
  const url = getConsoleLogPopupUrl();
  const features = 'noopener,noreferrer,width=980,height=700,scrollbars=yes';
  return window.open(url, 'rdkStudioConsoleLog', features);
}

/** 桌面客户端优先开独立 BrowserWindow；否则退回 window.open */
export async function openConsoleLogWindowPreferred(): Promise<{
  ok: boolean;
  mode: 'electron' | 'browser' | 'blocked';
}> {
  if (typeof window === 'undefined') {
    return { ok: false, mode: 'blocked' };
  }
  if (window.rdkDesktop?.openConsoleLogWindow) {
    const r = await window.rdkDesktop.openConsoleLogWindow();
    return { ok: Boolean(r?.ok), mode: 'electron' };
  }
  const w = openConsoleLogPopup();
  return { ok: Boolean(w), mode: w ? 'browser' : 'blocked' };
}
