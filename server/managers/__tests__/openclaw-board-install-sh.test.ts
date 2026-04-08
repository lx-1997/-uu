import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  OPENCLAW_CONDITIONAL_PREINSTALL_DEEP_CLEAN_SNIPPET,
  OPENCLAW_ENSURE_NODE_MIN_VERSION_SNIPPET,
  OPENCLAW_ENSURE_NPM_SNIPPET,
  OPENCLAW_INSTALL_OPENCLAW_STEP,
  OPENCLAW_LOCAL_NODE_DIST_INSTALL_SNIPPET,
  OPENCLAW_LOCAL_TARBALL_INSTALL_SNIPPET,
  OPENCLAW_NPM_FAST_INSTALL_SNIPPET,
  OPENCLAW_PREINSTALL_GATEWAY_STOP_SNIPPET,
  OPENCLAW_REMOVE_SHELL_PATH_BASHRC_SNIPPET,
  OPENCLAW_UNINSTALL_PKILL_SNIPPET,
  OPENCLAW_UNINSTALL_RM_GLOBAL_NODE_MODULES_SNIPPET,
  OPENCLAW_WAIT_APT_LOCK_SNIPPET,
} from '../openclaw-board-install-sh.js';

function expectNoBrokenShellTokens(script: string) {
  expect(script).not.toMatch(/\bthen\s*;/);
  expect(script).not.toMatch(/\bdo\s*;/);
  expect(script).not.toMatch(/;\s*&&/);
  expect(script).not.toMatch(/&&\s*else\b/);
}

const bashAvailable = (() => {
  const result = spawnSync('bash', ['--version'], { encoding: 'utf8' });
  return result.status === 0;
})();

const itWithBash = bashAvailable ? it : it.skip;

function expectBashSyntaxOk(script: string) {
  const wrapped = `set -e\n${script}\n`;
  const result = spawnSync('bash', ['-n'], { input: wrapped, encoding: 'utf8' });
  expect(result.status).toBe(0);
}

describe('openclaw-board-install shell generation', () => {
  it('avoids fragile single-line control-flow separators', () => {
    expectNoBrokenShellTokens(OPENCLAW_WAIT_APT_LOCK_SNIPPET);
    expectNoBrokenShellTokens(OPENCLAW_ENSURE_NODE_MIN_VERSION_SNIPPET);
    expectNoBrokenShellTokens(OPENCLAW_ENSURE_NPM_SNIPPET);
    expectNoBrokenShellTokens(OPENCLAW_LOCAL_NODE_DIST_INSTALL_SNIPPET);
    expectNoBrokenShellTokens(OPENCLAW_LOCAL_TARBALL_INSTALL_SNIPPET);
    expectNoBrokenShellTokens(OPENCLAW_NPM_FAST_INSTALL_SNIPPET);
    expectNoBrokenShellTokens(OPENCLAW_CONDITIONAL_PREINSTALL_DEEP_CLEAN_SNIPPET);
    expectNoBrokenShellTokens(OPENCLAW_PREINSTALL_GATEWAY_STOP_SNIPPET);
    expectNoBrokenShellTokens(OPENCLAW_INSTALL_OPENCLAW_STEP);
    expectNoBrokenShellTokens(OPENCLAW_UNINSTALL_PKILL_SNIPPET);
    expectNoBrokenShellTokens(OPENCLAW_UNINSTALL_RM_GLOBAL_NODE_MODULES_SNIPPET);
    expectNoBrokenShellTokens(OPENCLAW_REMOVE_SHELL_PATH_BASHRC_SNIPPET);
  });

  it('keeps multiline control flow in apt lock wait snippet', () => {
    expect(OPENCLAW_WAIT_APT_LOCK_SNIPPET).toContain('while [ "$_oc_ai" -lt "$_oc_lock_max" ]; do\n');
    expect(OPENCLAW_WAIT_APT_LOCK_SNIPPET).toContain('/var/cache/apt/archives/lock');
    expect(OPENCLAW_WAIT_APT_LOCK_SNIPPET).toContain('\ndone\n');
    expect(OPENCLAW_ENSURE_NODE_MIN_VERSION_SNIPPET).toContain('Dpkg::Lock::Timeout=180');
  });

  itWithBash(
    'parses in bash -n',
    () => {
      expectBashSyntaxOk(OPENCLAW_WAIT_APT_LOCK_SNIPPET);
      expectBashSyntaxOk(OPENCLAW_LOCAL_NODE_DIST_INSTALL_SNIPPET);
      expectBashSyntaxOk(OPENCLAW_LOCAL_TARBALL_INSTALL_SNIPPET);
      expectBashSyntaxOk(OPENCLAW_NPM_FAST_INSTALL_SNIPPET);
      expectBashSyntaxOk(OPENCLAW_CONDITIONAL_PREINSTALL_DEEP_CLEAN_SNIPPET);
      expectBashSyntaxOk(OPENCLAW_PREINSTALL_GATEWAY_STOP_SNIPPET);
      expectBashSyntaxOk(OPENCLAW_INSTALL_OPENCLAW_STEP);
      expectBashSyntaxOk(OPENCLAW_UNINSTALL_PKILL_SNIPPET);
      expectBashSyntaxOk(OPENCLAW_UNINSTALL_RM_GLOBAL_NODE_MODULES_SNIPPET);
      expectBashSyntaxOk(OPENCLAW_REMOVE_SHELL_PATH_BASHRC_SNIPPET);
      expectBashSyntaxOk(OPENCLAW_ENSURE_NODE_MIN_VERSION_SNIPPET);
      expectBashSyntaxOk(OPENCLAW_ENSURE_NPM_SNIPPET);
    },
    120_000,
  );

  it('conditional preinstall deep clean runs only when probes suggest broken install', () => {
    expect(OPENCLAW_CONDITIONAL_PREINSTALL_DEEP_CLEAN_SNIPPET).toContain('oc_need_deep_clean');
    expect(OPENCLAW_CONDITIONAL_PREINSTALL_DEEP_CLEAN_SNIPPET).toContain('npm ls -g --depth=0 openclaw');
    expect(OPENCLAW_CONDITIONAL_PREINSTALL_DEEP_CLEAN_SNIPPET).toContain('OPENCLAW_SKIP_PREINSTALL_DEEP_CLEAN');
    expect(OPENCLAW_INSTALL_OPENCLAW_STEP).toContain('oc_need_deep_clean');
    expect(OPENCLAW_INSTALL_OPENCLAW_STEP).toContain('OPENCLAW_SKIP_PREINSTALL_GATEWAY_STOP');
    expect(OPENCLAW_PREINSTALL_GATEWAY_STOP_SNIPPET).toContain('不调用 openclaw CLI');
  });

  it('gateway orphan clean must use bracket trick to avoid self-kill via pkill -f', () => {
    expect(OPENCLAW_UNINSTALL_PKILL_SNIPPET).not.toContain('pkill -f openclaw 2');
    expect(OPENCLAW_UNINSTALL_PKILL_SNIPPET).not.toContain('pkill -f "openclaw gateway run"');
    expect(OPENCLAW_UNINSTALL_PKILL_SNIPPET).toContain('_ocgw=18789');
    expect(OPENCLAW_UNINSTALL_PKILL_SNIPPET).toContain('[o]penclaw gateway run');
  });

  it('npm fast install includes cache repair path after failed attempts', () => {
    expect(OPENCLAW_NPM_FAST_INSTALL_SNIPPET).toContain('npm cache clean --force');
    expect(OPENCLAW_NPM_FAST_INSTALL_SNIPPET).toContain('oc_npm_repair_after_fail');
    expect(OPENCLAW_NPM_FAST_INSTALL_SNIPPET).toContain('npm install -g openclaw@');
  });

  it('prefers Studio-uploaded local tarball before network install', () => {
    expect(OPENCLAW_LOCAL_TARBALL_INSTALL_SNIPPET).toContain('OPENCLAW_LOCAL_TARBALL');
    expect(OPENCLAW_LOCAL_TARBALL_INSTALL_SNIPPET).toContain('npm install -g "${OPENCLAW_LOCAL_TARBALL}"');
    expect(OPENCLAW_INSTALL_OPENCLAW_STEP).toContain('本地 tarball 快装未命中或失败');
  });

  it('prefers Studio-uploaded local Node runtime before NodeSource or network fallback', () => {
    expect(OPENCLAW_LOCAL_NODE_DIST_INSTALL_SNIPPET).toContain('OPENCLAW_LOCAL_NODE_DIST');
    expect(OPENCLAW_LOCAL_NODE_DIST_INSTALL_SNIPPET).toContain('Studio Node 快装成功');
    expect(OPENCLAW_ENSURE_NODE_MIN_VERSION_SNIPPET).toContain('OPENCLAW_LOCAL_NODE_DIST');
  });
});