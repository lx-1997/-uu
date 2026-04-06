import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  NPM_INSTALL_CMD,
  OPENCLAW_DEPLOY_PREPARE_AND_INSTALL_CMD,
  OPENCLAW_PREPARE_CMD,
} from '../OpenClawDeploymentManager.js';

function expectNoFragilePatterns(script: string) {
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
  const result = spawnSync('bash', ['-n'], { input: `set -e\n${script}\n`, encoding: 'utf8' });
  expect(result.status).toBe(0);
}

describe('OpenClaw prepare/install command audit', () => {
  it('avoids fragile shell token patterns across the full chain', () => {
    expectNoFragilePatterns(OPENCLAW_PREPARE_CMD);
    expectNoFragilePatterns(NPM_INSTALL_CMD);
    expectNoFragilePatterns(OPENCLAW_DEPLOY_PREPARE_AND_INSTALL_CMD);
  });

  it('contains the expected major phases', () => {
    expect(OPENCLAW_DEPLOY_PREPARE_AND_INSTALL_CMD).toContain('[Studio] 环境准备（Node / npm / 目录）');
    expect(OPENCLAW_DEPLOY_PREPARE_AND_INSTALL_CMD).toContain('[Studio] 安装 OpenClaw（npm / ClawHub / 网关）');
    expect(OPENCLAW_DEPLOY_PREPARE_AND_INSTALL_CMD).toContain('[OpenClaw] 安装完成');
  });

  itWithBash('parses end-to-end in bash -n', () => {
    expectBashSyntaxOk(OPENCLAW_PREPARE_CMD);
    expectBashSyntaxOk(NPM_INSTALL_CMD);
    expectBashSyntaxOk(OPENCLAW_DEPLOY_PREPARE_AND_INSTALL_CMD);
  });
});