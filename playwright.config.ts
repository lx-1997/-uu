import { defineConfig, devices } from '@playwright/test';

const e2ePort = 4173;

/**
 * RDK Studio — Playwright E2E Test Configuration
 *
 * 使用方式:
 *   npx playwright test                   # 运行所有 E2E 测试
 *   npx playwright test --project=windows # 仅 Windows
 *   npx playwright test --project=macos   # 仅 macOS
 *   npx playwright test --reporter=html   # 生成 HTML 报告
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e-results',
  timeout: 60_000,
  retries: 1,
  workers: 1,               // 客户端测试串行更稳定

  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e-report', open: 'never' }],
    ['json', { outputFile: 'e2e-report/results.json' }],
  ],

  /* 全局 Web Server：自动启动后端 + 前端 */
  webServer: {
    command: 'node scripts/start-e2e.mjs',
    port: e2ePort,
    reuseExistingServer: false,
    timeout: 30_000,
  },

  projects: [
    {
      name: 'windows',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'macos',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
