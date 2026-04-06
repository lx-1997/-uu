import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  OPENCLAW_ENSURE_NODE_MIN_VERSION_SNIPPET,
  OPENCLAW_ENSURE_NPM_SNIPPET,
  OPENCLAW_NPM_FAST_INSTALL_SNIPPET,
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
    expectNoBrokenShellTokens(OPENCLAW_NPM_FAST_INSTALL_SNIPPET);
  });

  it('keeps multiline control flow in apt lock wait snippet', () => {
    expect(OPENCLAW_WAIT_APT_LOCK_SNIPPET).toContain('while [ "$_oc_ai" -lt 120 ]; do\n');
    expect(OPENCLAW_WAIT_APT_LOCK_SNIPPET).toContain('\ndone\n');
  });

  itWithBash('parses in bash -n', () => {
    expectBashSyntaxOk(OPENCLAW_WAIT_APT_LOCK_SNIPPET);
    expectBashSyntaxOk(OPENCLAW_NPM_FAST_INSTALL_SNIPPET);
    expectBashSyntaxOk(OPENCLAW_ENSURE_NODE_MIN_VERSION_SNIPPET);
    expectBashSyntaxOk(OPENCLAW_ENSURE_NPM_SNIPPET);
  });
});