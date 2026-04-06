/**
 * 服务端无头浏览器抓取（Playwright），用于 JS 渲染页等 web_fetch 无法覆盖的场景。
 * 需安装浏览器：npx playwright install chromium
 * 启用：BROWSER_FETCH_ENABLED=1
 */

import * as dns from "node:dns/promises";
import net from "node:net";
import type { Browser } from "playwright";
import type { Tool } from "./types.js";
import type { WebToolOptions } from "./web-tool-options.js";
import { normalizeUrl, stripHtml, truncate } from "./web-text-utils.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function envEnabled(): boolean {
  const v = (process.env.BROWSER_FETCH_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** 导航后额外等待（ms），给 SPA/XHR 注水；可用 BROWSER_FETCH_EXTRA_WAIT_MS 覆盖默认 */
function defaultExtraWaitMs(): number {
  const raw = (process.env.BROWSER_FETCH_EXTRA_WAIT_MS || "").trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.min(30_000, n);
  }
  return 4500;
}

function envHeaded(): boolean {
  const v = (process.env.BROWSER_FETCH_HEADED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** 逗号分隔；若非空，hostname 须等于某条或为 *.条（后缀匹配） */
function parseHostAllowlist(): string[] {
  const raw = (process.env.BROWSER_FETCH_HOST_ALLOWLIST || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatchesAllowlist(hostname: string, rules: string[]): boolean {
  const h = hostname.toLowerCase();
  for (const rule of rules) {
    if (h === rule) return true;
    if (h.endsWith(`.${rule}`)) return true;
  }
  return false;
}

function isPrivateIpv4(a: number, b: number, _c: number, _d: number): boolean {
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isUnsafeResolvedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    if (p.length === 4 && isPrivateIpv4(p[0]!, p[1]!, p[2]!, p[3]!)) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true;
    if (lower.startsWith("fe80:")) return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("::ffff:")) {
      const v4 = lower.slice("::ffff:".length);
      if (net.isIPv4(v4)) {
        const p = v4.split(".").map(Number);
        if (p.length === 4 && isPrivateIpv4(p[0]!, p[1]!, p[2]!, p[3]!)) return true;
      }
    }
  }
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0") return true;
  if (net.isIP(h) !== 0) {
    if (h === "::1") return true;
    if (net.isIPv4(h) && isUnsafeResolvedIp(h)) return true;
  }
  return false;
}

export const browserFetchDns = {
  lookup(host: string) {
    return dns.lookup(host, { all: true, verbatim: true });
  },
};

/**
 * 供 **studio_open_url**、设备输出中的 URL 自动打开等「仅把 URL 交给宿主 Electron 打开」的路径使用。
 * 服务端**不会**代为请求该 URL，故不做 RFC1918 拦截；板卡/局域网 `http://192.168.x.x:8000` 等与 SSH 同网段场景应放行。
 * 仍禁止非 http(s)、带账号密码的 URL。
 */
export function assertStudioClientOpenUrlAllowed(urlStr: string): URL {
  const url = new URL(normalizeUrl(urlStr));
  if (url.username || url.password) {
    throw new Error("URL 不允许包含用户名或密码");
  }
  const p = url.protocol.toLowerCase();
  if (p !== "http:" && p !== "https:") {
    throw new Error("URL 仅支持 http/https 协议");
  }
  if (!url.hostname) {
    throw new Error("URL 缺少主机名");
  }
  return url;
}

/**
 * SSRF：仅 http(s)，禁止明显内网主机名，DNS 解析后校验 IP 段。
 * 用于 **服务端** Playwright / web_fetch 等代为发起网络请求的场景。
 */
export async function assertBrowserFetchUrlSafe(urlStr: string): Promise<URL> {
  const url = new URL(normalizeUrl(urlStr));
  if (url.username || url.password) {
    throw new Error("URL 不允许包含用户名或密码");
  }
  const host = url.hostname;
  if (isBlockedHostname(host)) {
    throw new Error("禁止访问该主机（localhost / 内网等）");
  }
  const allow = parseHostAllowlist();
  if (allow.length > 0 && !hostMatchesAllowlist(host, allow)) {
    throw new Error(
      `主机不在 BROWSER_FETCH_HOST_ALLOWLIST 允许范围内（当前规则 ${allow.length} 条）`,
    );
  }

  if (net.isIP(host) !== 0) {
    if (isUnsafeResolvedIp(host)) {
      throw new Error("禁止访问内网或保留地址");
    }
    return url;
  }

  try {
    const addrs = await browserFetchDns.lookup(host);
    const list = Array.isArray(addrs) ? addrs : [addrs];
    if (!list.length) {
      throw new Error("DNS 未返回地址");
    }
    for (const a of list) {
      const addr = typeof a === "string" ? a : a.address;
      if (isUnsafeResolvedIp(addr)) {
        throw new Error("DNS 解析指向内网或保留地址，已拦截（SSRF 防护）");
      }
    }
    return url;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.message.includes("SSRF") || err.message.includes("内网")) throw err;
    throw new Error(`DNS 校验失败：${err.message}`);
  }
}

let browserSingleton: Browser | null = null;
let browserLaunching: Promise<Browser> | null = null;

async function getSharedBrowser(): Promise<Browser> {
  if (browserSingleton) return browserSingleton;
  if (browserLaunching) return browserLaunching;
  const { chromium } = await import("playwright");
  /**
   * Playwright 在 headless: true 时默认使用独立的 chromium-headless-shell；若用户只装了 chromium 或 shell 下载失败会报
   * Executable doesn't exist ... chrome-headless-shell.exe。此处固定 headless: false 以使用完整 Chromium，
   * 无 UI 时再传 --headless=new（Chrome for Testing 支持）。
   */
  const useHeadedUi = envHeaded();
  browserLaunching = chromium.launch({
    headless: false,
    args: [
      ...(useHeadedUi ? [] : ["--headless=new"]),
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  try {
    browserSingleton = await browserLaunching;
    return browserSingleton;
  } finally {
    browserLaunching = null;
  }
}

/** 串行化页面打开，避免多标签同时拖垮内存 */
let fetchChain = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = fetchChain.then(fn, fn);
  fetchChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function createBrowserFetchTools(options: WebToolOptions = {}): Tool[] {
  if (!envEnabled()) {
    return [];
  }

  /** RDKClaw 对 createWebTools 常传 15s；SPA 详情需更长，故设下限避免 goto 与 extraWait 抢时间 */
  const timeoutMs = Math.max(
    28_000,
    Math.min(120_000, options.timeoutMs ?? 60_000),
  );
  const maxFetchChars = Math.max(2000, options.maxFetchChars ?? 16_000);

  const tool: Tool<{
    url: string;
    maxChars?: number;
    waitUntil?: string;
    extraWaitMs?: number;
  }> = {
    name: "web_browser_fetch",
    description:
      "用 Chromium 打开 URL、在 load 后再等待数秒以让 SPA/Next 注水，抓取可见正文（优先 body.innerText）。默认 waitUntil=load（避免 networkidle 在部分站点永不结束或过早结束）。若页面要求登录或强反爬，仍可能只有壳或提示登录；此时需用户登录后操作或官方 API。服务端需 BROWSER_FETCH_ENABLED=1 且已 playwright install chromium。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "http(s) 页面 URL" },
        maxChars: { type: "number", description: "最大输出字符，默认与网络策略一致" },
        waitUntil: {
          type: "string",
          description: "load | domcontentloaded | networkidle；默认 load（推荐）。仅当站点无长连请求时再试 networkidle",
        },
        extraWaitMs: {
          type: "number",
          description:
            "导航完成后再等待的毫秒数（给 XHR 渲染），0–30000；默认约 4.5s，可用环境变量 BROWSER_FETCH_EXTRA_WAIT_MS 改全局默认",
        },
      },
      required: ["url"],
    },
    async execute(input) {
      let url: string;
      try {
        const urlObj = await assertBrowserFetchUrlSafe(String(input.url || ""));
        url = urlObj.toString();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return `web_browser_fetch 未执行：${msg}`;
      }
      const maxChars = Math.max(2000, Math.min(120_000, Number(input.maxChars || maxFetchChars)));
      const w = String(input.waitUntil ?? "load").toLowerCase();
      const waitUntil =
        w === "load" || w === "domcontentloaded" || w === "networkidle" ? w : "load";
      const extraWaitMs = Math.max(
        0,
        Math.min(
          30_000,
          Number.isFinite(Number(input.extraWaitMs))
            ? Number(input.extraWaitMs)
            : defaultExtraWaitMs(),
        ),
      );

      try {
        return await runSerialized(async () => {
          const browser = await getSharedBrowser();
          const context = await browser.newContext({
            userAgent: BROWSER_UA,
            locale: "zh-CN",
            timezoneId: "Asia/Shanghai",
            viewport: { width: 1280, height: 900 },
            javaScriptEnabled: true,
          });
          await context.addInitScript(() => {
            try {
              Object.defineProperty(navigator, "webdriver", {
                get: () => undefined,
                configurable: true,
              });
            } catch {
              /* ignore */
            }
          });
          const page = await context.newPage();
          const started = Date.now();
          try {
            await page.goto(url, {
              waitUntil: waitUntil as "load" | "domcontentloaded" | "networkidle",
              timeout: timeoutMs,
            });
            await page.evaluate(() => {
              const g = globalThis as unknown as {
                scrollTo?: (x: number, y: number) => void;
                document?: { body?: { scrollHeight?: number } };
              };
              try {
                g.scrollTo?.(0, g.document?.body?.scrollHeight ?? 800);
              } catch {
                /* ignore */
              }
            });
            await new Promise((r) => setTimeout(r, extraWaitMs));
            let text = await page.evaluate(() => {
              try {
                const g = globalThis as unknown as {
                  document?: { body?: { innerText?: string } };
                };
                return (g.document?.body?.innerText || "").replace(/\u00a0/g, " ").trim();
              } catch {
                return "";
              }
            });
            if (text.length < 80) {
              const html = await page.content();
              text = stripHtml(html);
            }
            const head = [
              `source: ${url}`,
              `mode: ${envHeaded() ? "chromium_headed" : "chromium_full_binary_headless_new"}`,
              `waitUntil: ${waitUntil}`,
              `extraWaitMs: ${extraWaitMs}`,
              `elapsed_ms: ${Date.now() - started}`,
              `fetched_at: ${new Date().toISOString()}`,
            ].join("\n");
            const loginHint =
              text.length < 2500 &&
              /请\s*\[?\s*登录|登录\s*\/\s*注册|请先登录/i.test(text)
                ? "\n\nfetch_hint: 正文偏短且含登录/注册提示：站点可能对未登录访客隐藏 NodeHub 详情；无头抓取无法携带用户 Cookie。可请用户在已登录浏览器中查看，或配置 TAVILY_API_KEY 让 web_fetch 尝试 Tavily Extract、及查阅官方公开文档。"
                : "";
            return `${head}\n\n${truncate(text, maxChars)}${loginHint}`;
          } finally {
            await context.close().catch(() => {});
          }
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return [
          `web_browser_fetch 失败：${msg}`,
          "提示：在项目根执行 `npx playwright install chromium`（下载完整 Chrome for Testing）。确认 BROWSER_FETCH_ENABLED=1。若仍报错，试 `npx playwright install --force chromium`。",
        ].join("\n");
      }
    },
  };

  return [tool];
}
