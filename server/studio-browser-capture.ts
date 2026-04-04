/**
 * Studio 桌面端嵌入浏览器抓取：Agent 阻塞等待用户在 Electron 内嵌 WebContentsView 中登录并提交正文。
 * 与 Playwright 无头并行存在：本路径复用用户会话（Cookie），适合 NodeHub 等需登录的页面。
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Server as SocketIOServer } from "socket.io";
import type { Tool } from "./agent/tools/types.js";
import { assertStudioClientOpenUrlAllowed } from "./agent/tools/browser-tools.js";
import { buildStudioOpenLocalPreviewTool } from "./studio-local-preview.js";

/** 用户只说 www.example.com 时补全 https://，便于 studio_open_url 与抓取工具 */
function coerceHttpUrlInput(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/.*)?$/i.test(v)) {
    return `https://${v}`;
  }
  return v;
}

const MAX_SUBMIT_CHARS = 150_000;

export type StudioBrowserCaptureConfig = {
  version?: number;
  allowedHostSuffixes?: string[];
};

let ioRef: SocketIOServer | null = null;

type Pending = {
  outerResolve: (text: string) => void;
  outerReject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();

function configPath(): string {
  return path.join(process.cwd(), "config", "studio-browser-capture.json");
}

export function loadStudioBrowserCaptureConfig(): StudioBrowserCaptureConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf-8");
    const j = JSON.parse(raw) as StudioBrowserCaptureConfig;
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

function hostMatchesSuffixes(hostname: string, rules: string[]): boolean {
  const h = hostname.toLowerCase();
  for (const rule of rules) {
    const r = rule.trim().toLowerCase();
    if (!r) continue;
    if (h === r) return true;
    if (h.endsWith(`.${r}`)) return true;
  }
  return false;
}

export function registerStudioBrowserCaptureSocket(io: SocketIOServer): void {
  ioRef = io;
}

export function submitStudioBrowserCapture(
  captureId: string,
  text: string,
): { ok: true } | { ok: false; error: string } {
  const id = captureId.trim();
  if (!id) return { ok: false, error: "缺少 captureId" };
  const rec = pending.get(id);
  if (!rec) return { ok: false, error: "无效或已过期的 captureId" };
  pending.delete(id);
  clearTimeout(rec.timer);
  const body = String(text ?? "").slice(0, MAX_SUBMIT_CHARS);
  rec.outerResolve(body);
  return { ok: true };
}

export function cancelStudioBrowserCapture(captureId: string, reason: string): { ok: boolean; error?: string } {
  const id = captureId.trim();
  const rec = pending.get(id);
  if (!rec) return { ok: false, error: "无效或已过期的 captureId" };
  pending.delete(id);
  clearTimeout(rec.timer);
  rec.outerReject(new Error(reason));
  return { ok: true };
}

/** 「全部停止」时释放所有阻塞中的抓取，避免设备队列一直占用 */
export function cancelAllPendingStudioBrowserCaptures(reason = "任务已停止"): number {
  const ids = [...pending.keys()];
  let n = 0;
  for (const id of ids) {
    if (cancelStudioBrowserCapture(id, reason).ok) n += 1;
  }
  return n;
}

export async function waitForStudioEmbeddedCapture(
  urlRaw: string,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<string> {
  if (!ioRef) {
    throw new Error("Studio 浏览器捕获未初始化（服务端未挂载 Socket.IO）");
  }
  const safe = assertStudioClientOpenUrlAllowed(coerceHttpUrlInput(urlRaw));
  const url = safe.toString();
  const cfg = loadStudioBrowserCaptureConfig();
  const rules = (cfg.allowedHostSuffixes || []).map((s) => String(s).trim()).filter(Boolean);
  if (rules.length > 0 && !hostMatchesSuffixes(safe.hostname, rules)) {
    throw new Error(
      `主机 ${safe.hostname} 不在仓库 config/studio-browser-capture.json 的 allowedHostSuffixes 中；可编辑该文件后重试。`,
    );
  }

  return new Promise<string>((resolve, reject) => {
    const captureId = crypto.randomUUID();

    const onAbort = () => {
      cancelStudioBrowserCapture(captureId, "任务已停止（对话已取消）");
    };

    let abortCleanup: (() => void) | undefined;
    if (abortSignal) {
      if (abortSignal.aborted) {
        reject(new Error("任务已停止（对话已取消）"));
        return;
      }
      abortSignal.addEventListener("abort", onAbort, { once: true });
      abortCleanup = () => {
        abortSignal.removeEventListener("abort", onAbort);
      };
    }

    const timer = setTimeout(() => {
      const p = pending.get(captureId);
      if (!p) return;
      pending.delete(captureId);
      p.outerReject(
        new Error(
          `等待超时（${timeoutMs}ms）：请在 RDK Studio 桌面端查看弹窗，在内嵌页面登录后点击「提交正文」。纯浏览器/Web 端无法完成此步骤。`,
        ),
      );
    }, timeoutMs);

    pending.set(captureId, {
      outerResolve: (text) => {
        try {
          abortCleanup?.();
        } catch {
          /* ignore */
        }
        resolve(text);
      },
      outerReject: (e) => {
        try {
          abortCleanup?.();
        } catch {
          /* ignore */
        }
        reject(e);
      },
      timer,
    });
    ioRef!.emit("studio_browser_capture_request", { captureId, url });
  });
}

/**
 * 仅打开链接（内嵌 WebView），不进入抓取等待；**不检查** studio-browser-capture.json 的白名单。
 * URL 校验用 assertStudioClientOpenUrlAllowed（宿主打开，非服务端代请求，允许局域网/板卡 IP）。
 */
export function emitStudioOpenUrlToClients(url: string): void {
  ioRef?.emit("studio_open_url_request", { url });
}

export function emitStudioOpenLocalPreviewToClients(filePath: string): void {
  ioRef?.emit("studio_open_local_preview_request", { filePath });
}

function studioOpenUrlTool(): Tool<{ url: string }> {
  return {
    name: "studio_open_url",
    description:
      "【RDK Studio 桌面端】用户说「打开某网页/网站」时**必须调用本工具**（默认可缩放的独立浏览窗口，约为屏幕约六成、系统标题栏可关；失败时回退主窗口内嵌）。不等待抓取。不受 studio-browser-capture.json 白名单限制。**允许** `http(s)://` 局域网/板卡 IP（如 192.168.x.x、10.x、与 SSH 同网段），由用户本机浏览器打开，非服务端代请求。失败时回显工具返回值；勿编造「内网禁止」。纯 Web 时走新标签。要登录后抓正文给 Agent 用 studio_embedded_browser_capture。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "http(s) 页面 URL" },
      },
      required: ["url"],
    },
    async execute(input) {
      if (!ioRef) {
        return "studio_open_url 失败：Socket.IO 未初始化，无法通知界面打开。";
      }
      try {
        const safe = assertStudioClientOpenUrlAllowed(coerceHttpUrlInput(String(input.url || "")));
        const url = safe.toString();
        emitStudioOpenUrlToClients(url);
        return `studio_open_url_ok: 已请求打开 ${url}（桌面端默认可缩放独立窗口；失败时可能回退内嵌。若未看见请确认已用 RDK Studio 桌面包且前端已连上 Socket）。`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return `studio_open_url 失败：${msg}`;
      }
    },
  };
}

export function createStudioOpenUrlTool(): Tool[] {
  return [studioOpenUrlTool()];
}

export function createStudioOpenLocalPreviewTool(): Tool[] {
  const inner = buildStudioOpenLocalPreviewTool((abs) => emitStudioOpenLocalPreviewToClients(abs));
  return [
    {
      ...inner,
      execute: async (input, ctx) => {
        if (!ioRef) {
          return "studio_open_local_preview 失败：Socket.IO 未初始化，无法通知界面打开。";
        }
        return inner.execute(input, ctx);
      },
    },
  ];
}

function studioEmbeddedBrowserCaptureTool(): Tool<{ url: string; timeoutMs?: number }> {
  return {
    name: "studio_embedded_browser_capture",
    description:
      "【仅 RDK Studio 桌面端】会打开独立小悬浮窗口（不遮挡主界面）加载 URL，由你登录后在窗口内浏览；正文稳定后自动提交给 Agent，也可手动点「立即抓取」。复用 Cookie，适合 NodeHub 等需登录页。服务端 Playwright 无登录态。团队允许域名见 config/studio-browser-capture.json。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "http(s) 页面 URL" },
        timeoutMs: { type: "number", description: "等待用户提交的最长时间（毫秒），默认 300000（5 分钟）" },
      },
      required: ["url"],
    },
    async execute(input, ctx) {
      const timeoutMs = Math.min(600_000, Math.max(30_000, Number(input.timeoutMs ?? 300_000)));
      try {
        const text = await waitForStudioEmbeddedCapture(
          String(input.url || ""),
          timeoutMs,
          ctx.abortSignal,
        );
        if (!text.trim()) {
          return "studio_embedded_browser_capture: 收到空正文，请确认页面已加载后重试。";
        }
        return `studio_embedded_browser_capture_ok:\n${text}`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return `studio_embedded_browser_capture 失败：${msg}`;
      }
    },
  };
}

export function createStudioEmbeddedBrowserCaptureTool(): Tool[] {
  return [studioEmbeddedBrowserCaptureTool()];
}
