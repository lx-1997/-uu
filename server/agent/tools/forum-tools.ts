import type { Tool } from "./types.js";

interface ForumToolOptions {
  timeoutMs?: number;
  maxFetchChars?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_FETCH_CHARS = 16_000;
const DEFAULT_FORUM_BASE = "https://forum.d-robotics.cc";
const FORUM_SESSION_COOKIE_NAME = "_forum_session";
const SSO_COOKIE_TTL_MS = 30 * 60 * 1000;
let forumSessionCookieCache: { value: string; fetchedAt: number } | null = null;

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

async function tryLoginForumBySsoCredential(base: string, timeoutMs: number) {
  const creds = buildCredentialAuth();
  if (!creds) {
    return { ok: false as const, reason: "missing_credentials" };
  }
  if (forumSessionCookieCache && Date.now() - forumSessionCookieCache.fetchedAt < SSO_COOKIE_TTL_MS) {
    return { ok: true as const, cookie: forumSessionCookieCache.value, source: "cache" as const };
  }
  const forumCookies = new Map<string, string>();
  const devCookies = new Map<string, string>();
  const toCookieHeader = (bag: Map<string, string>) =>
    Array.from(bag.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  const mergeCookies = (bag: Map<string, string>, setCookies: string[]) => {
    for (const raw of setCookies) {
      const parsed = parseSetCookieHeader(raw);
      if (parsed) bag.set(parsed.name, parsed.value);
    }
  };

  // 1) 从论坛拿 SSO 跳转地址
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
    return { ok: false as const, reason: "forum_sso_redirect_missing" };
  }

  // 2) 带账号密码请求 developer 侧 SSO 桥接（站点启用 SSO，若后端支持将回跳论坛）
  const devUrl = new URL(devSsoUrl);
  devUrl.searchParams.set("username", creds.username);
  devUrl.searchParams.set("password", creds.password);
  const devResp = await fetchWithCookie(devUrl.toString(), {
    method: "GET",
    redirect: "manual",
    timeoutMs,
    headers: {
      "User-Agent": "RDKClaw/1.0 (+forum-tool)",
      Accept: "text/html,application/json",
    },
    cookie: toCookieHeader(devCookies),
  });
  mergeCookies(devCookies, getResponseSetCookies(devResp));
  const maybeForumBack = devResp.headers.get("location") || "";

  // 3) 若回跳论坛，继续跟随一次，拿 _forum_session
  if (maybeForumBack && /forum\.d-robotics\.cc/i.test(maybeForumBack)) {
    const backResp = await fetchWithCookie(maybeForumBack, {
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
    // developer 常见返回 HTML，并携带 from=disLogin，表示需要交互式登录
    const text = await devResp.text().catch(() => "");
    if (/from["']?\s*:\s*["']disLogin/i.test(text) || /disLogin/i.test(text)) {
      return { ok: false as const, reason: "interactive_login_required" };
    }
  }

  const session = forumCookies.get(FORUM_SESSION_COOKIE_NAME);
  if (!session) {
    return { ok: false as const, reason: "forum_session_not_obtained" };
  }
  const cookie = `${FORUM_SESSION_COOKIE_NAME}=${session}`;
  forumSessionCookieCache = { value: cookie, fetchedAt: Date.now() };
  return { ok: true as const, cookie, source: "sso_credential" as const };
}

async function resolveForumAuth(base: string, timeoutMs: number) {
  const apiHeaders = buildAuthHeaders();
  if (apiHeaders) {
    return { mode: "api_key" as const, headers: apiHeaders, detail: "api_key" };
  }
  // Prefer credential-based SSO attempt over static cookie.
  // This avoids stale cookie masking newly saved username/password.
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
  return {
    mode: "none" as const,
    headers: {} as Record<string, string>,
    detail: ssoResult.reason,
  };
}

function resolveAuthDetailText(detail: string) {
  if (detail === "missing_credentials") return "未检测到论坛用户名/密码或 API/Cookie 配置。";
  if (detail === "interactive_login_required") return "已检测到账号密码，但 SSO 返回交互登录页（需要人工完成一次登录/验证）。";
  if (detail === "forum_sso_redirect_missing") return "论坛 SSO 跳转地址获取失败。";
  if (detail === "forum_session_not_obtained") return "SSO 已请求，但未拿到论坛会话 Cookie。";
  if (detail === "env_cookie") return "当前使用环境变量 Cookie 登录态。";
  if (detail === "sso_credential") return "当前使用用户名/密码自动换取的 SSO 会话。";
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
    "1) 服务端配置 API 凭据（推荐）",
    "   - FORUM_DROBOTICS_API_KEY",
    "   - FORUM_DROBOTICS_API_USERNAME",
    "2) 配置 FORUM_DROBOTICS_USERNAME / FORUM_DROBOTICS_PASSWORD（将尝试 SSO 自动换取会话）",
    "3) 浏览器登录后导出 Cookie 到 FORUM_DROBOTICS_COOKIE（模拟人工登录态）",
    "4) 浏览器登录后通过 Web 端手动操作发帖（不走 API）",
  ].filter(Boolean).join("\n");
}

function decodeForumErrorBody(raw: string) {
  try {
    const json = JSON.parse(raw) as { error_type?: string; errors?: string[] };
    const errorType = String(json.error_type || "").trim().toLowerCase();
    const errors = Array.isArray(json.errors) ? json.errors : [];
    return { errorType, errors };
  } catch {
    return { errorType: "", errors: [] as string[] };
  }
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
    description: "在地瓜机器人论坛创建新主题或回复（需配置 API Key）。",
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
        return [
          "论坛发帖未配置认证信息，无法执行写操作。",
          "请在服务端环境变量设置：",
          "- FORUM_DROBOTICS_API_KEY",
          "- FORUM_DROBOTICS_API_USERNAME",
          "- 或 FORUM_DROBOTICS_COOKIE（浏览器登录态）",
          `目标论坛: ${base}`,
        ].join("\n");
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
        if (auth.mode === "cookie") {
          const csrfRes = await fetch(`${base}/session/csrf.json`, {
            method: "GET",
            signal: timeout.signal,
            headers: {
              Accept: "application/json",
              "User-Agent": "RDKClaw/1.0 (+forum-tool)",
              ...auth.headers,
            },
          });
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
            ...auth.headers,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": "RDKClaw/1.0 (+forum-tool)",
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
          throw new Error(`发帖失败: HTTP ${res.status} · ${bodyText.slice(0, 300)}`);
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

function forumAuthStatusTool(options: ForumToolOptions): Tool<Record<string, never>> {
  const timeoutMs = Math.max(3000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return {
    name: "forum_drobotics_auth_status",
    description: "检测论坛 API 是否已具备读写权限，并返回下一步配置建议。",
    inputSchema: {
      type: "object",
      properties: {},
    },
    async execute() {
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
          return authHint(base, auth.detail);
        }
        return [
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

export function createForumTools(options: ForumToolOptions = {}): Tool[] {
  return [
    forumAuthStatusTool(options),
    forumLatestTool(options),
    forumTopicTool(options),
    forumCreatePostTool(options),
  ];
}
