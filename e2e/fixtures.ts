import { test as base, type Page } from '@playwright/test';

const TAB_LABELS: Record<string, string> = {
  dashboard: '工作台',
  openclaw: 'OpenClaw',
  skills: '技能工坊',
  terminal: '终端',
  files: '文件',
  vnc: '远程桌面',
  ide: 'IDE',
  flasher: '烧录',
};

/* ────────────────────────────────────────────────────────────
 * RDK Studio — E2E Test Fixtures
 *
 * 封装可复用的 page helpers，减少每个 test 文件的样板代码。
 * ──────────────────────────────────────────────────────────── */

export interface StudioFixtures {
  /** 已导航到 RDK Studio 首页并等待加载完成 */
  studioPage: Page;
}

export const test = base.extend<StudioFixtures>({
  studioPage: async ({ page }, use) => {
    await page.goto('/');
    // 等待左侧导航栏可见（App 已加载完毕的信号）
    await page.waitForSelector('[data-testid="icon-rail"], .icon-rail', {
      state: 'visible',
      timeout: 15_000,
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';

/* ── 常用操作 helpers ── */

/** 切换当前激活的 Tab */
export async function switchTab(page: Page, tabName: string) {
  const btn = page.locator(`[data-tab="${tabName}"], [data-testid="tab-${tabName}"]`);
  if (await btn.count()) {
    await btn.first().click();
  } else {
    const label = TAB_LABELS[tabName] ?? tabName;
    const railButton = page.getByRole('button', { name: label, exact: true });
    if (await railButton.count()) {
      await railButton.first().click();
    } else {
      const rail = page.locator(`.rail-btn[title*="${tabName}" i], .rail-btn[data-tab="${tabName}"]`);
      if (await rail.count()) {
        await rail.first().click();
      }
    }
  }
  // 等待页面响应切换
  await page.waitForTimeout(300);
}

/** 检查 API 健康端点 */
export async function checkApiHealth(page: Page): Promise<boolean> {
  try {
    const res = await page.request.get('/api/health');
    return res.ok();
  } catch {
    return false;
  }
}

/** 等待 Toast 消息出现 */
export async function waitForToast(page: Page, textContains: string, timeout = 5000) {
  return page.locator('.toast, [role="alert"]').filter({ hasText: textContains }).waitFor({
    state: 'visible',
    timeout,
  });
}
