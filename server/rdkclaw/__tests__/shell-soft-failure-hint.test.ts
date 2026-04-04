import { describe, expect, it } from 'vitest';
import {
  appendShellContinueHint,
  shouldAppendShellContinueHint,
} from '../shell-soft-failure-hint.js';

describe('shell-soft-failure-hint', () => {
  it('detects device_exec [exit code: n] non-zero', () => {
    const r = 'out\n\n[exit code: 2]';
    expect(shouldAppendShellContinueHint(r)).toBe(true);
    expect(appendShellContinueHint('device_exec', r)).toContain('[编排提示 · 须继续]');
    expect(appendShellContinueHint('device_exec', r)).toContain('板端');
  });

  it('detects local exec [EXIT CODE]', () => {
    const r = '[LOCAL_WORKSPACE 本机工作区，非 RDK 板端]\nfail\n[STDERR]\nerr\n[EXIT CODE] 1';
    expect(shouldAppendShellContinueHint(r)).toBe(true);
    expect(appendShellContinueHint('exec', r)).toContain('[编排提示 · 须继续]');
    expect(appendShellContinueHint('exec', r)).toContain('本机');
  });

  it('ignores exit code 0', () => {
    const r = 'ok\n[exit code: 0]';
    expect(shouldAppendShellContinueHint(r)).toBe(false);
  });

  it('idempotent when marker present', () => {
    const once = appendShellContinueHint('exec', 'x\n[EXIT CODE] 1');
    expect(appendShellContinueHint('exec', once)).toBe(once);
  });
});
