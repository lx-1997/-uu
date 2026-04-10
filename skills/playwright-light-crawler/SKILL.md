---
name: playwright-light-crawler
description: >-
  Lightweight Playwright-based web crawling: Chromium context, JSON response interception,
  polite rate limits, storageState sessions, SPA waits. Use when the user wants Playwright
  crawling, 轻量爬虫, headless collection, or intercepting XHR/Fetch JSON without heavy frameworks.
version: 1.0.0
trigger: playwright,轻量爬虫,无头采集,chromium爬虫,页面采集,JSON拦截,xhr拦截,network监听,playwright爬取
risk: high
permissions: workspace_read,workspace_write
delegate_preference: local
requires_board: false
approval_level: confirm
cooldown_seconds: 0
scheduler_template: none
category: Procedure
---

# Playwright 轻量爬虫

## 与 Agent Browser 的分工

| 场景 | 优先 |
|------|------|
| 多步点击、复杂表单、无障碍树稳定操作 | `skills/agent-browser/`（`agent-browser` CLI） |
| 以 **网络 JSON** 为主、少量滚动/跳转、可脚本化维护 | 本技能（Playwright API） |

## 安装

```bash
npm init -y
npm install playwright
npx playwright install chromium
```

仅爬虫时可只装 **chromium** 以减小体积。项目需 **ESM**（`"type": "module"`）或与下文示例一致的 `import`。

## 核心思路（轻量四步）

1. **单 Browser、单 Context**：并发爬取时用 `maxConcurrency` 限制 context 数量，避免被封。
2. **数据优先从 JSON 来**：`page.on('response')` 或 `page.route` 过滤 `content-type: application/json`（及站点实际返回类型），比 CSS 选择器耐改版。
3. **礼貌访问**：串行或低并发、请求间隔（`await new Promise((r) => setTimeout(r, 2000))` 或队列 + delay）、合理 `userAgent` 与视口；遇 429/验证码即停。
4. **会话外置**：登录态用 `storageState` 文件，**加入 `.gitignore`**，勿提交 Cookie。

## 最小可运行骨架（TypeScript / ESM）

```typescript
import { chromium, type Response } from 'playwright';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = 'crawl-out';
const DELAY_MS = 2500;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function shouldCaptureJson(res: Response): boolean {
  const ct = (res.headers()['content-type'] || '').toLowerCase();
  if (!ct.includes('json')) return false;
  // 按目标站 host/path 收紧，避免海量无关 JSON
  return res.url().includes('example.com');
}

async function crawlOne(url: string) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: process.env.CRAWL_STORAGE_STATE, // 可选：已登录态 JSON 路径
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  page.on('response', async (res) => {
    if (!shouldCaptureJson(res)) return;
    try {
      const body = await res.json();
      mkdirSync(OUT_DIR, { recursive: true });
      const line = JSON.stringify({ url: res.url(), body }) + '\n';
      appendFileSync(join(OUT_DIR, 'records.ndjson'), line);
    } catch {
      /* 非 JSON 或已读 body */
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await delay(DELAY_MS);
  await browser.close();
}

crawlOne(process.argv[2] || 'https://example.com').catch(console.error);
```

## 常用技巧

- **列表页滚动加载**：`page.evaluate` 内 `window.scrollBy` 循环 + 等待新 `response`，设 `maxScrolls` 上限。
- **只拦特定 API**：在 `shouldCaptureJson` 里匹配 `url.pathname` 或 query，避免磁盘爆量。
- **超时与重试**：`page.goto` 设 `timeout`；失败重试 1–2 次并加长间隔，勿 tight loop。
- **调试**：`headless: false` 或 `PWDEBUG=1`；`page.screenshot({ path: 'debug.png' })`。

## 生成登录态（一次性）

```bash
npx playwright codegen https://目标站 --save-storage=storage-state.json
```

人工登录完成后关闭浏览器即可得到 `storage-state.json`；爬虫里 `storageState: 'storage-state.json'`。

## 故障速查

| 现象 | 处理 |
|------|------|
| 空白/骨架屏 | `waitUntil: 'networkidle'` 或等待关键 `response` |
| 拿不到 JSON | 检查是否 WebSocket/protobuf；或 JSON 在 script 标签内需单独解析 |
| 频繁跳转登录 | 换有效 `storageState`、降速、减采集量 |
| 429 / CAPTCHA | 停止自动化，不协助绕过人机验证 |

## 合规（必须）

仅采集用户有权访问的公开数据；遵守目标站服务条款与 robots；不用于垃圾营销、撞库或未授权大规模商用分发。目标与上述冲突时应拒绝实现。
