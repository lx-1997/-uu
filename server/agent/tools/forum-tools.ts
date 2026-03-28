import type { Tool } from "./types.js";
import { createCipheriv } from "node:crypto";
import { ForumAuthStore } from "../../rdkclaw/forum-auth-store.js";

interface ForumToolOptions {
  timeoutMs?: number;
  maxFetchChars?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_FETCH_CHARS = 16_000;
const DEFAULT_FORUM_BASE = "https://forum.d-robotics.cc";
const SSO_BASE = "https://sso.d-robotics.cc";
const SSO_AES_KEY = "wJE911ku0VOpUtx0";
const FORUM_SESSION_COOKIE_NAME = "_forum_session";
const FORUM_TOKEN_COOKIE_NAME = "_t";
const SSO_COOKIE_TTL_MS = 30 * 60 * 1000;
let forumSessionCookieCache: { value: string; fetchedAt: number } | null = null;

function aesEncryptEcb(key: string, plaintext: string): string {
  const keyBuf = Buffer.from(key, "utf8");
  const cipher = createCipheriv("aes-128-ecb", keyBuf, null);
  cipher.setAutoPadding(true);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}

function withTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function sanitizeBaseUrl(raw?: string) {
  const base = (raw || DEFAULT_FORUM_BASE).trim();
  if (!/^https?:\/\//i.test(base)) {
    throw new Error("FORUM_BASE_URL 必须是 http/https URL");
  }
  const url = new URL(base);
  return url.toString().replace(/\/+$/, "");
}

function truncate(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[...内容已截断，总长度 ${text.length} 字符]`;
}

function normalizePostBody(raw: unknown) {
  if (typeof raw !== "string") return "";
  return raw.replace(/\r\n/g, "\n").trim();
}

function buildAuthHeaders() {
  const apiKey = (process.env.FORUM_DROBOTICS_API_KEY || "").trim();
  const apiUsername = (process.env.FORUM_DROBOTICS_API_USERNAME || "").trim();
  if (!apiKey || !apiUsername) {
    return null;
  }
  return {
    "Api-Key": apiKey,
    "Api-Username": apiUsername,
  };
}

function buildCookieHeaders() {
  const cookie = (process.env.FORUM_DROBOTICS_COOKIE || "").trim();
  if (!cookie) return null;
  return {
    Cookie: cookie,
  };
}

function buildCredentialAuth() {
  const username = (process.env.FORUM_DROBOTICS_USERNAME || "").trim();
  const password = (process.env.FORUM_DROBOTICS_PASSWORD || "").trim();
  if (!username || !password) return null;
  return { username, password };
}

async function fetchWithCookie(
  url: string,
  init: RequestInit & { timeoutMs: number; cookie?: string },
) {
  const timeout = withTimeout(init.timeoutMs);
  try {
    const headers = new Headers(init.headers || {});
    if (init.cookie) {
      headers.set("Cookie", init.cookie);
    }
    const res = await fetch(url, {
      ...init,
      headers,
      signal: timeout.signal,
    });
    return res;
  } finally {
    timeout.clear();
  }
}

function parseSetCookieHeader(setCookie: string) {
  const first = String(setCookie || "").split(";")[0] || "";
  const idx = first.indexOf("=");
  if (idx <= 0) return null;
  const name = first.slice(0, idx).trim();
  const value = first.slice(idx + 1).trim();
  if (!name || !value) return null;
  return { name, value };
}

function getResponseSetCookies(res: Response) {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

/** 将 Set-Cookie 合并进现有 Cookie 请求头（Discourse 在 csrf.json 等请求里常会刷新 _forum_session）。 */
function mergeCookieHeader(existing: string, setCookies: string[]): string {
  const bag = new Map<string, string>();
  for (const part of String(existing || "").split(";")) {
    const p = part.trim();
    if (!p) continue;
    const eq = p.indexOf("=");
    if (eq <= 0) continue;
    const name = p.slice(0, eq).trim();
    const value = p.slice(eq + 1).trim();
    if (name) bag.set(name, value);
  }
  for (const raw of setCookies) {
    const parsed = parseSetCookieHeader(raw);
    if (parsed) bag.set(parsed.name, parsed.value);
  }
  return Array.from(bag.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/**
 * 使用已获得的 SSO token（密码登录或 OAuth access_token）完成论坛 Discourse 会话。
 */
async function completeForumSsoBridgeWithToken(
  ssoTokenRaw: string,
  base: string,
  timeoutMs: number,
): Promise<{ ok: true; cookie: string } | { ok: false; reason: string }> {
  const ssoToken = ssoTokenRaw.replace(/^Bearer\s+/i, "").trim();
  if (!ssoToken) {
    return { ok: false, reason: "missing_sso_token" };
  }
  const forumCookies = new Map<string, string>();
  const toCookieHeader = (bag: Map<string, string>) =>
    Array.from(bag.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  const mergeCookies = (bag: Map<string, string>, setCookies: string[]) => {
    for (const raw of setCookies) {
      const parsed = parseSetCookieHeader(raw);
      if (parsed) bag.set(parsed.name, parsed.value);
    }
  };

  const ssoStart = await fetchWithCookie(`${base}/session/sso`, {
    method: "GET",
    redirect: "manual",
    timeoutMs,
    headers: {
      "User-Agent": "RDKClaw/1.0 (+forum-tool)",
      Accept: "text/html,application/json",
    },
    cookie: toCookieHeader(forumCookies),
  });
  mergeCookies(forumCookies, getResponseSetCookies(ssoStart));
  const devSsoUrl = ssoStart.headers.get("location") || "";
  if (!devSsoUrl || !/developer\.d-robotics\.cc\/communityApi\/discourseApi\/sso/i.test(devSsoUrl)) {
    return { ok: false, reason: "forum_sso_redirect_missing" };
  }

  const devResp = await fetchWithCookie(devSsoUrl, {
    method: "GET",
    redirect: "manual",
    timeoutMs,
    headers: {
      "User-Agent": "RDKClaw/1.0 (+forum-tool)",
      Accept: "text/html,application/json",
    },
    cookie: `token=${ssoToken}`,
  });
  const forumBackUrl = devResp.headers.get("location") || "";

  if (forumBackUrl && /forum\.d-robotics\.cc/i.test(forumBackUrl)) {
    const backResp = await fetchWithCookie(forumBackUrl, {
      method: "GET",
      redirect: "manual",
      timeoutMs,
      headers: {
        "User-Agent": "RDKClaw/1.0 (+forum-tool)",
        Accept: "text/html,application/json",
      },
      cookie: toCookieHeader(forumCookies),
    });
    mergeCookies(forumCookies, getResponseSetCookies(backResp));
  } else {
    return { ok: false, reason: "forum_sso_bridge_failed" };
  }

  const userToken = forumCookies.get(FORUM_TOKEN_COOKIE_NAME);
  const session = forumCookies.get(FORUM_SESSION_COOKIE_NAME);
  if (!userToken && !session) {
    return { ok: false, reason: "forum_session_not_obtained" };
  }
  const cookie = toCookieHeader(forumCookies);
  forumSessionCookieCache = { value: cookie, fetchedAt: Date.now() };
  return { ok: true, cookie };
}

async function tryLoginForumBySsoCredential(base: string, timeoutMs: number) {
  const creds = buildCredentialAuth();
  if (!creds) {
    return { ok: false as const, reason: "missing_credentials" };
  }
  if (forumSessionCookieCache && Date.now() - forumSessionCookieCache.fetchedAt < SSO_COOKIE_TTL_MS) {
    return { ok: true as const, cookie: forumSessionCookieCache.value, source: "cache" as const };
  }

  const encrypted = aesEncryptEcb(SSO_AES_KEY, JSON.stringify({
    username: creds.username,
    password: creds.password,
  }));
  const ssoLoginRes = await fetchWithCookie(`${SSO_BASE}/api/login`, {
    method: "POST",
    timeoutMs,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ type: "up", data: encrypted }),
  });
  let ssoToken: string;
  try {
    const ssoData = await ssoLoginRes.json() as { status: number; data: string; message?: string };
    if (ssoData.status !== 0 || !ssoData.data) {
      return { ok: false as const, reason: `sso_login_failed: ${ssoData.message || ssoData.data || "unknown"}` };
    }
    ssoToken = ssoData.data.replace(/^Bearer\s+/i, "");
  } catch {
    return { ok: false as const, reason: "sso_login_parse_error" };
  }

  const bridge = await completeForumSsoBridgeWithToken(ssoToken, base, timeoutMs);
  if (!bridge.ok) {
    return { ok: false as const, reason: bridge.reason };
  }
  return { ok: true as const, cookie: bridge.cookie, source: "sso_credential" as const };
}

function deriveForumUsernameFromSsoUser(user?: { name?: string; email?: string; id?: string }): string {
  if (!user) return "";
  const name = String(user.name || "").trim();
  if (name) return name;
  const email = String(user.email || "").trim();
  const at = email.indexOf("@");
  if (at > 0) return email.slice(0, at);
  if (email) return email;
  return String(user.id || "").trim();
}

/** 每次解析鉴权前从 ~/.rdkstudio/forum-auth.json 刷新到 process.env，避免 SSO 异步写入后 Agent 仍读到旧 env。 */
function refreshForumEnvFromDisk(): void {
  new ForumAuthStore().load();
}

/**
 * 主应用 OAuth 登录成功后，用 access_token 走与密码登录相同的开发者桥接，写入论坛 Cookie。
 */
export async function applyForumAuthFromAppSsoAccessToken(
  accessToken: string,
  userHint?: { name?: string; email?: string; id?: string },
): Promise<{ ok: boolean; detail: string }> {
  let base: string;
  try {
    base = sanitizeBaseUrl(process.env.FORUM_BASE_URL);
  } catch {
    return { ok: false, detail: "bad_forum_base" };
  }
  forumSessionCookieCache = null;
  const bridge = await completeForumSsoBridgeWithToken(accessToken, base, DEFAULT_TIMEOUT_MS);
  if (!bridge.ok) {
    return { ok: false, detail: bridge.reason };
  }
  const store = new ForumAuthStore();
  const usernameHint = deriveForumUsernameFromSsoUser(userHint);
  store.applyAppSsoForumBridge(bridge.cookie, usernameHint || undefined);
  store.markVerified("ok");
  return { ok: true, detail: "app_sso_token" };
}

/** 在 HttpOnly 会话提交后异步触发，避免阻塞 OAuth 回调重定向。 */
export function scheduleForumSyncFromSso(
  accessToken: string,
  userHint?: { name?: string; email?: string; id?: string },
): void {
  void applyForumAuthFromAppSsoAccessToken(accessToken, userHint).then((r) => {
    if (r.ok) {
      console.log("[Forum] synced session from app SSO (access_token bridge)");
    } else {
      console.warn("[Forum] app SSO → forum sync skipped:", r.detail);
    }
  }).catch((err) => {
    console.warn("[Forum] app SSO → forum sync error:", err instanceof Error ? err.message : err);
  });
}

/** 主应用退出登录时调用：清除由 SSO 同步的论坛 Cookie。 */
export function clearForumAuthOnAppSsoLogout(): void {
  forumSessionCookieCache = null;
  new ForumAuthStore().clearAppSsoLinkedForumState();
}

async function resolveForumAuth(base: string, timeoutMs: number) {
  refreshForumEnvFromDisk();
  const apiHeaders = buildAuthHeaders();
  if (apiHeaders) {
    return { mode: "api_key" as const, headers: apiHeaders, detail: "api_key" };
  }

  if (forumSessionCookieCache && Date.now() - forumSessionCookieCache.fetchedAt < SSO_COOKIE_TTL_MS) {
    return {
      mode: "cookie" as const,
      headers: { Cookie: forumSessionCookieCache.value },
      detail: "cache",
    };
  }

  const disk = new ForumAuthStore().get();
  const appToken = disk.appSsoAccessToken?.trim();
  if (appToken) {
    const bridge = await completeForumSsoBridgeWithToken(appToken, base, timeoutMs);
    if (bridge.ok) {
      new ForumAuthStore().applyAppSsoForumBridge(bridge.cookie, undefined);
      return {
        mode: "cookie" as const,
        headers: { Cookie: bridge.cookie },
        detail: "app_sso_token",
      };
    }
  }

  // 用户名+密码换 SSO 再进论坛（与用户手填设置一致）
  const ssoResult = await tryLoginForumBySsoCredential(base, timeoutMs);
  if (ssoResult.ok) {
    return {
      mode: "cookie" as const,
      headers: { Cookie: ssoResult.cookie },
      detail: ssoResult.source,
    };
  }
  const cookieHeaders = buildCookieHeaders();
  if (cookieHeaders) {
    return { mode: "cookie" as const, headers: cookieHeaders, detail: "env_cookie" };
  }
  const fallbackDetail = appToken ? "app_sso_token_bridge_failed" : ssoResult.reason;
  return {
    mode: "none" as const,
    headers: {} as Record<string, string>,
    detail: fallbackDetail,
  };
}

function resolveAuthDetailText(detail: string) {
  if (detail === "missing_credentials") return "未检测到论坛用户名/密码或 API/Cookie 配置。";
  if (detail === "app_sso_token_bridge_failed") {
    return "已保存主应用登录令牌，但用其换取论坛会话失败（令牌类型不符或网络/SSO 异常）。请在设置中「保存并验证」论坛密码，或重新登录主账号。";
  }
  if (detail === "interactive_login_required") return "已检测到账号密码，但 SSO 返回交互登录页（需要人工完成一次登录/验证）。";
  if (detail === "forum_sso_redirect_missing") return "论坛 SSO 跳转地址获取失败。";
  if (detail === "forum_session_not_obtained") return "SSO 已请求，但未拿到论坛会话 Cookie。";
  if (detail === "env_cookie") return "当前使用环境变量 Cookie 登录态。";
  if (detail === "sso_credential") return "当前使用用户名/密码自动换取的 SSO 会话。";
  if (detail === "app_sso_token") return "当前使用主应用 SSO access_token 自动同步的论坛会话。";
  if (detail === "cache") return "当前使用缓存的论坛会话。";
  if (detail === "api_key") return "当前使用 API Key 模式。";
  return detail || "unknown";
}

function authHint(base: string, detail = "") {
  return [
    `forum: ${base}`,
    detail ? `auth_detail: ${resolveAuthDetailText(detail)}` : "",
    "当前论坛访问需要登录认证（实测匿名 latest/about/topic 均会 403）。",
    "该论坛开启了 SSO，/u/login 会跳转到 /session/sso，不能直接用用户名密码调用 /session 登录。",
    "可用方式：",
    "0) 已用主账号登录 Studio 时，论坛可能已自动同步；可重试 forum_drobotics_auth_status 或让用户重新打开设置刷新状态",
    "1) 在对话中告诉我你的论坛用户名和密码，我会调用 forum_drobotics_set_credentials 自动配置",
    "2) 在 RDK Studio 设置面板中配置论坛账号",
    "3) 配置 API 凭据（FORUM_DROBOTICS_API_KEY + FORUM_DROBOTICS_API_USERNAME）",
    "4) 浏览器登录后导出 Cookie 到 FORUM_DROBOTICS_COOKIE",
  ].filter(Boolean).join("\n");
}

/** 供 auth_status 返回：与设置页同源，避免模型谎称「查不到」 */
function formatStudioForumConfigAudit(): string {
  const v = new ForumAuthStore().getView();
  return [
    "--- studio_forum_config (本机 forum-auth，与「设置 → 社区论坛」一致) ---",
    `studio_forum_username_masked: ${v.username || "未配置"}`,
    `studio_linked_from_app_sso: ${v.linkedFromAppSso ? "yes" : "no"}`,
    `studio_has_password_saved_locally: ${v.hasPassword ? "yes" : "no"}`,
    `studio_has_forum_cookie: ${v.hasCookie ? "yes" : "no"}`,
    `studio_has_app_sso_token_saved: ${v.hasAppSsoAccessTokenSaved ? "yes" : "no"}`,
    "password_policy: 助手不得复述明文密码（模型上下文无密码）。已保存/已同步时由服务端工具代用，勿让用户把密码发到聊天。",
  ].join("\n");
}

function decodeForumErrorBody(raw: string) {
  try {
    const json = JSON.parse(raw) as { error_type?: string; errors?: string[]; message?: string };
    const errorType = String(json.error_type || "").trim().toLowerCase();
    const errors = Array.isArray(json.errors) ? json.errors.map(String) : [];
    const message = String(json.message || "").trim();
    return { errorType, errors, message };
  } catch {
    return { errorType: "", errors: [] as string[], message: "" };
  }
}

/** 发帖/回复失败时的可读说明（含权限、分类、信任等级等） */
function forumPostFailureHint(status: number, parsed: ReturnType<typeof decodeForumErrorBody>): string {
  const detail = [...parsed.errors, parsed.message].filter(Boolean).join(" | ");
  if (status === 403 && parsed.errorType === "not_allowed") {
    return `（论坛拒绝该操作：常见于新账号信任等级不足、无目标分类发帖权、或需先在网页端完成验证。${detail ? ` 服务端提示：${detail}` : ""}）`;
  }
  if (status === 403 && parsed.errorType === "invalid_access") {
    return `（无权访问：${detail || "请确认已登录且账号可发帖"}）`;
  }
  if (status === 403 && !parsed.errorType && /permission|权限|forbidden/i.test(detail)) {
    return `（可能被拒绝发帖：${detail}。若 latest 可读但发帖失败，多为分类权限或信任等级限制。）`;
  }
  if (status === 422) {
    return `（内容或分类校验失败：${detail || "请检查标题、分类 ID、正文长度"}）`;
  }
  return detail ? `（${detail}）` : "";
}

function forumLatestTool(options: ForumToolOptions): Tool<{ page?: number; limit?: number }> {
  const timeoutMs = Math.max(3000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return {
    name: "forum_drobotics_latest",
    description: "读取地瓜机器人开发者社区最新主题列表（只读）。",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "number", description: "页码，从 0 开始，默认 0" },
        limit: { type: "number", description: "返回主题数量，默认 10，最大 30" },
      },
    },
    async execute(input) {
      const base = sanitizeBaseUrl(process.env.FORUM_BASE_URL);
      const auth = await resolveForumAuth(base, timeoutMs);
      const page = Math.max(0, Number(input.page || 0) || 0);
      const limit = Math.min(30, Math.max(1, Number(input.limit || 10) || 10));
      const timeout = withTimeout(timeoutMs);
      try {
        const url = `${base}/latest.json?page=${encodeURIComponent(String(page))}`;
        const res = await fetch(url, {
          method: "GET",
          signal: timeout.signal,
          headers: {
            Accept: "application/json",
            "User-Agent": "RDKClaw/1.0 (+forum-tool)",
            ...auth.headers,
          },
        });
        if (!res.ok) {
          const bodyText = await res.text();
          const parsed = decodeForumErrorBody(bodyText);
          if (res.status === 403 && parsed.errorType === "not_logged_in") {
            return authHint(base, auth.detail);
          }
          throw new Error(`请求失败: HTTP ${res.status} · ${bodyText.slice(0, 300)}`);
        }
        const data = (await res.json()) as {
          topic_list?: { topics?: Array<Record<string, unknown>> };
        };
        const topics = (data.topic_list?.topics || []).slice(0, limit);
        if (topics.length === 0) {
          return `forum: ${base}\nlatest: 暂无主题`;
        }
        const lines = topics.map((topic, idx) => {
          const id = Number(topic.id || 0);
          const title = String(topic.title || "(无标题)");
          const slug = String(topic.slug || "");
          const postsCount = Number(topic.posts_count || 0);
          const views = Number(topic.views || 0);
          const last = String(topic.last_posted_at || "");
          const topicUrl = slug ? `${base}/t/${slug}/${id}` : `${base}/t/${id}`;
          return `${idx + 1}. [${id}] ${title}\n   posts=${postsCount}, views=${views}, last_posted_at=${last}\n   ${topicUrl}`;
        });
        return `forum: ${base}\nlatest_topics:\n${lines.join("\n")}`;
      } finally {
        timeout.clear();
      }
    },
  };
}

function forumTopicTool(options: ForumToolOptions): Tool<{ topicId: number; maxPosts?: number; includeRaw?: boolean }> {
  const timeoutMs = Math.max(3000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxFetchChars = Math.max(2000, options.maxFetchChars ?? DEFAULT_MAX_FETCH_CHARS);
  return {
    name: "forum_drobotics_topic",
    description: "读取指定论坛主题及回复内容（只读）。",
    inputSchema: {
      type: "object",
      properties: {
        topicId: { type: "number", description: "主题 ID（例如 12345）" },
        maxPosts: { type: "number", description: "最多返回回复数，默认 20，最大 100" },
        includeRaw: { type: "boolean", description: "是否返回原始正文 raw 字段，默认 false（返回 excerpt）" },
      },
      required: ["topicId"],
    },
    async execute(input) {
      const base = sanitizeBaseUrl(process.env.FORUM_BASE_URL);
      const auth = await resolveForumAuth(base, timeoutMs);
      const topicId = Number(input.topicId || 0);
      if (!Number.isFinite(topicId) || topicId <= 0) {
        throw new Error("topicId 必须是正整数");
      }
      const maxPosts = Math.min(100, Math.max(1, Number(input.maxPosts || 20) || 20));
      const includeRaw = Boolean(input.includeRaw);
      const timeout = withTimeout(timeoutMs);
      try {
        const url = `${base}/t/${encodeURIComponent(String(topicId))}.json`;
        const res = await fetch(url, {
          method: "GET",
          signal: timeout.signal,
          headers: {
            Accept: "application/json",
            "User-Agent": "RDKClaw/1.0 (+forum-tool)",
            ...auth.headers,
          },
        });
        if (!res.ok) {
          const bodyText = await res.text();
          const parsed = decodeForumErrorBody(bodyText);
          if (res.status === 403 && parsed.errorType === "not_logged_in") {
            return authHint(base, auth.detail);
          }
          throw new Error(`请求失败: HTTP ${res.status} · ${bodyText.slice(0, 300)}`);
        }
        const data = (await res.json()) as {
          id?: number;
          title?: string;
          slug?: string;
          posts_count?: number;
          details?: { created_by?: { username?: string } };
          post_stream?: { posts?: Array<Record<string, unknown>> };
        };
        const posts = (data.post_stream?.posts || []).slice(0, maxPosts);
        const body = posts.map((post, idx) => {
          const postNo = Number(post.post_number || idx + 1);
          const username = String(post.username || "unknown");
          const createdAt = String(post.created_at || "");
          const content = includeRaw
            ? normalizePostBody(post.raw)
            : normalizePostBody(post.cooked).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          return `- #${postNo} @${username} (${createdAt})\n  ${content || "(空内容)"}`;
        }).join("\n");
        const topicUrl = data.slug
          ? `${base}/t/${data.slug}/${topicId}`
          : `${base}/t/${topicId}`;
        const output = [
          `forum: ${base}`,
          `topic: [${data.id || topicId}] ${data.title || "(无标题)"}`,
          `author: ${data.details?.created_by?.username || "unknown"}`,
          `posts_count: ${data.posts_count || posts.length}`,
          `url: ${topicUrl}`,
          "",
          "posts:",
          body || "(无可用回复)",
        ].join("\n");
        return truncate(output, maxFetchChars);
      } finally {
        timeout.clear();
      }
    },
  };
}

function forumCreatePostTool(options: ForumToolOptions): Tool<{
  title?: string;
  raw: string;
  topicId?: number;
  replyToPostNumber?: number;
  category?: number;
}> {
  const timeoutMs = Math.max(3000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return {
    name: "forum_drobotics_create_post",
    description: "在地瓜机器人论坛创建新主题或回复（支持 API Key，或使用用户名密码 SSO 会话 Cookie + CSRF）。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "新主题标题；创建回复时可不填" },
        raw: { type: "string", description: "帖子正文（Markdown）" },
        topicId: { type: "number", description: "回复目标主题 ID；不填则创建新主题" },
        replyToPostNumber: { type: "number", description: "可选，回复某楼层号" },
        category: { type: "number", description: "新主题分类 ID（可选）" },
      },
      required: ["raw"],
    },
    async execute(input) {
      const base = sanitizeBaseUrl(process.env.FORUM_BASE_URL);
      const auth = await resolveForumAuth(base, timeoutMs);
      if (auth.mode === "none") {
        return authHint(base, auth.detail);
      }
      const raw = normalizePostBody(input.raw);
      if (!raw) {
        throw new Error("raw 正文不能为空");
      }
      const topicId = Number(input.topicId || 0);
      const isReply = Number.isFinite(topicId) && topicId > 0;
      const title = String(input.title || "").trim();
      if (!isReply && !title) {
        throw new Error("创建新主题时 title 不能为空");
      }
      const form = new URLSearchParams();
      form.set("raw", raw);
      if (isReply) {
        form.set("topic_id", String(topicId));
        const replyTo = Number(input.replyToPostNumber || 0);
        if (replyTo > 0) {
          form.set("reply_to_post_number", String(replyTo));
        }
      } else {
        form.set("title", title);
        const category = Number(input.category || 0);
        if (category > 0) {
          form.set("category", String(category));
        }
      }
      const timeout = withTimeout(timeoutMs);
      try {
        let csrfToken = "";
        let cookieForWrite = auth.mode === "cookie" ? auth.headers.Cookie || "" : "";
        if (auth.mode === "cookie") {
          const csrfRes = await fetch(`${base}/session/csrf.json`, {
            method: "GET",
            signal: timeout.signal,
            headers: {
              Accept: "application/json",
              "User-Agent": "RDKClaw/1.0 (+forum-tool)",
              Referer: `${base}/`,
              Origin: base,
              ...auth.headers,
            },
          });
          cookieForWrite = mergeCookieHeader(cookieForWrite, getResponseSetCookies(csrfRes));
          const csrfText = await csrfRes.text();
          if (!csrfRes.ok) {
            throw new Error(`获取 CSRF 失败: HTTP ${csrfRes.status} · ${csrfText.slice(0, 200)}`);
          }
          try {
            const csrfPayload = JSON.parse(csrfText) as { csrf?: string };
            csrfToken = String(csrfPayload.csrf || "");
          } catch {
            csrfToken = "";
          }
          if (!csrfToken) {
            throw new Error("获取 CSRF 失败: 返回中没有 csrf 字段");
          }
        }
        const res = await fetch(`${base}/posts.json`, {
          method: "POST",
          signal: timeout.signal,
          headers: {
            ...(auth.mode === "cookie"
              ? { ...auth.headers, Cookie: cookieForWrite }
              : auth.headers),
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": "RDKClaw/1.0 (+forum-tool)",
            Referer: `${base}/`,
            Origin: base,
            ...(auth.mode === "cookie"
              ? {
                "x-csrf-token": csrfToken,
                "x-requested-with": "XMLHttpRequest",
              }
              : {}),
          },
          body: form.toString(),
        });
        const bodyText = await res.text();
        if (!res.ok) {
          const parsed = decodeForumErrorBody(bodyText);
          if (res.status === 403 && parsed.errorType === "not_logged_in") {
            return authHint(base, auth.detail);
          }
          const hint = forumPostFailureHint(res.status, parsed);
          throw new Error(`发帖失败: HTTP ${res.status}${hint}\n${bodyText.slice(0, 500)}`);
        }
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(bodyText) as Record<string, unknown>;
        } catch {
          // ignore parse failure
        }
        const createdTopicId = Number(payload.topic_id || payload.topicId || topicId || 0);
        const createdPostNumber = Number(payload.post_number || payload.postNumber || 0);
        const postId = Number(payload.id || 0);
        const topicUrl = createdTopicId > 0 ? `${base}/t/${createdTopicId}` : `${base}/latest`;
        return [
          `forum: ${base}`,
          isReply ? "action: reply_created" : "action: topic_created",
          `topic_id: ${createdTopicId || "unknown"}`,
          `post_number: ${createdPostNumber || "unknown"}`,
          `post_id: ${postId || "unknown"}`,
          `url: ${topicUrl}`,
        ].join("\n");
      } finally {
        timeout.clear();
      }
    },
  };
}

function forumSetCredentialsTool(options: ForumToolOptions): Tool<{ username: string; password: string }> {
  const timeoutMs = Math.max(3000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return {
    name: "forum_drobotics_set_credentials",
    description: "设置地瓜机器人论坛的登录凭据（用户名+密码），写入后立即验证 SSO 是否可用。用户在对话中提供账号密码时调用此工具。",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string", description: "论坛用户名" },
        password: { type: "string", description: "论坛密码" },
      },
      required: ["username", "password"],
    },
    async execute(input) {
      const username = String(input.username || "").trim();
      const password = String(input.password || "").trim();
      if (!username || !password) {
        return "错误：用户名和密码均不能为空。";
      }

      const store = new ForumAuthStore();
      store.saveCredentials(username, password);
      forumSessionCookieCache = null;

      const result = await verifyForumSsoLogin(timeoutMs);
      store.markVerified(result.ok ? "ok" : "failed");

      if (result.ok) {
        return [
          `论坛凭据已保存到本地并验证成功。`,
          `用户名: ${username}`,
          `认证方式: ${result.detail}`,
          `论坛读取权限: 已确认`,
          `凭据已持久化到 ~/.rdkstudio/forum-auth.json，重启后仍有效。`,
          `现在可以使用 forum_drobotics_create_post 发帖。`,
        ].join("\n");
      }

      const base = sanitizeBaseUrl(process.env.FORUM_BASE_URL);
      return [
        `论坛凭据已保存到本地，但 SSO 验证未通过。`,
        `用户名: ${username}`,
        `原因: ${resolveAuthDetailText(result.detail)}`,
        `建议: 请确认账号密码是否正确，或尝试浏览器登录 ${base} 后导出 Cookie。`,
      ].join("\n");
    },
  };
}

function forumAuthStatusTool(options: ForumToolOptions): Tool<Record<string, never>> {
  const timeoutMs = Math.max(3000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return {
    name: "forum_drobotics_auth_status",
    description:
      "检测论坛读写权限，并返回本机论坛配置摘要（脱敏用户名等）。用户问「我的论坛用户名/密码是多少」「是否已同步」时必须先调用；根据 studio_forum_username_masked 与 auth_status 作答，禁止未调用就说「查不到你的隐私」。密码永不输出，说明见 password_policy。",
    inputSchema: {
      type: "object",
      properties: {},
    },
    async execute() {
      const audit = formatStudioForumConfigAudit();
      const base = sanitizeBaseUrl(process.env.FORUM_BASE_URL);
      const auth = await resolveForumAuth(base, timeoutMs);
      const timeout = withTimeout(timeoutMs);
      try {
        const url = `${base}/latest.json?page=0`;
        const res = await fetch(url, {
          method: "GET",
          signal: timeout.signal,
          headers: {
            Accept: "application/json",
            "User-Agent": "RDKClaw/1.0 (+forum-tool)",
            ...auth.headers,
          },
        });
        const bodyText = await res.text();
        const parsed = decodeForumErrorBody(bodyText);
        if (res.ok) {
          return [
            audit,
            "",
            `forum: ${base}`,
            "auth_status: ok",
            `auth_mode: ${auth.mode}`,
            `auth_detail: ${auth.detail}`,
            `api_key_configured: ${auth.mode === "api_key" ? "yes" : "no"}`,
            `cookie_configured: ${auth.mode === "cookie" ? "yes" : "no"}`,
            "read_access: granted",
          ].join("\n");
        }
        if (res.status === 403 && parsed.errorType === "not_logged_in") {
          return [audit, "", authHint(base, auth.detail)].join("\n");
        }
        return [
          audit,
          "",
          `forum: ${base}`,
          "auth_status: failed",
          `auth_detail: ${auth.detail}`,
          `http_status: ${res.status}`,
          `error_type: ${parsed.errorType || "unknown"}`,
          `raw: ${bodyText.slice(0, 300)}`,
        ].join("\n");
      } finally {
        timeout.clear();
      }
    },
  };
}

/**
 * Verify forum SSO login and return the result.
 * Can be used by both the agent tool and the API endpoint.
 */
export async function verifyForumSsoLogin(
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ ok: boolean; detail: string }> {
  refreshForumEnvFromDisk();
  const base = sanitizeBaseUrl(process.env.FORUM_BASE_URL);
  forumSessionCookieCache = null;
  const auth = await resolveForumAuth(base, timeoutMs);
  if (auth.mode === "none") {
    return { ok: false, detail: auth.detail };
  }
  const timeout = withTimeout(timeoutMs);
  try {
    const res = await fetch(`${base}/latest.json?page=0`, {
      method: "GET",
      signal: timeout.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "RDKClaw/1.0 (+forum-tool)",
        ...auth.headers,
      },
    });
    if (res.ok) {
      return { ok: true, detail: auth.detail };
    }
    return { ok: false, detail: `http_${res.status}` };
  } catch {
    return { ok: false, detail: "network_error" };
  } finally {
    timeout.clear();
  }
}

export function createForumTools(options: ForumToolOptions = {}): Tool[] {
  return [
    forumSetCredentialsTool(options),
    forumAuthStatusTool(options),
    forumLatestTool(options),
    forumTopicTool(options),
    forumCreatePostTool(options),
  ];
}
