import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CONFIG_DIR = path.join(os.homedir(), ".rdkstudio");
const AUTH_FILE = path.join(CONFIG_DIR, "forum-auth.json");

interface ForumAuthData {
  username?: string;
  password?: string;
  cookie?: string;
  /**
   * 主应用 OAuth access_token（仅落盘，不写入 process.env）。
   * 论坛工具在鉴权时用它现场换 Discourse Cookie，避免仅依赖异步写入或过期 Cookie。
   */
  appSsoAccessToken?: string;
  /** 最近一次由主应用 SSO 登录自动写入论坛 Cookie 的时间戳 */
  linkedFromAppSsoAt?: number;
  apiKey?: string;
  apiUsername?: string;
  lastVerified?: number;
  lastVerifyResult?: "ok" | "failed";
}

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function readAuth(): ForumAuthData {
  try {
    if (!fs.existsSync(AUTH_FILE)) return {};
    const raw = fs.readFileSync(AUTH_FILE, "utf-8");
    return JSON.parse(raw) as ForumAuthData;
  } catch {
    return {};
  }
}

function writeAuth(data: ForumAuthData) {
  ensureConfigDir();
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function syncToEnv(data: ForumAuthData) {
  const set = (key: string, val?: string) => {
    if (val?.trim()) process.env[key] = val.trim();
    else delete process.env[key];
  };
  set("FORUM_DROBOTICS_USERNAME", data.username);
  set("FORUM_DROBOTICS_PASSWORD", data.password);
  set("FORUM_DROBOTICS_COOKIE", data.cookie);
  set("FORUM_DROBOTICS_API_KEY", data.apiKey);
  set("FORUM_DROBOTICS_API_USERNAME", data.apiUsername);
}

export class ForumAuthStore {
  /**
   * Load credentials from disk and populate process.env.
   * Call once at server startup.
   */
  load(): ForumAuthData {
    const data = readAuth();
    syncToEnv(data);
    return data;
  }

  get(): ForumAuthData {
    return readAuth();
  }

  saveCredentials(username: string, password: string): ForumAuthData {
    const data = readAuth();
    data.username = username;
    data.password = password;
    delete data.linkedFromAppSsoAt;
    delete data.appSsoAccessToken;
    writeAuth(data);
    syncToEnv(data);
    return data;
  }

  /**
   * 主应用登录成功时写入；供论坛鉴权链现场换 Cookie。
   * @param displayUsernameHint 用于设置页展示；仅在本地尚无用户名时写入，避免覆盖用户手填的论坛登录名。
   */
  saveAppSsoAccessToken(accessToken: string, displayUsernameHint?: string): ForumAuthData {
    const raw = String(accessToken || "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    const data = readAuth();
    if (raw) data.appSsoAccessToken = raw;
    else delete data.appSsoAccessToken;
    const hint = displayUsernameHint?.trim();
    if (hint && !data.username?.trim()) data.username = hint;
    writeAuth(data);
    syncToEnv(data);
    return data;
  }

  /**
   * @param fromAppSso 为 true 时表示由主应用 OAuth access_token 桥接得到，退出主账号时应一并清除。
   */
  saveCookie(cookie: string, fromAppSso = false): ForumAuthData {
    const data = readAuth();
    data.cookie = cookie;
    if (fromAppSso) data.linkedFromAppSsoAt = Date.now();
    else delete data.linkedFromAppSsoAt;
    writeAuth(data);
    syncToEnv(data);
    return data;
  }

  /** 主应用 SSO 退出：清除由 access_token 同步的论坛 Cookie，保留用户手填的用户名/密码。 */
  clearAppSsoLinkedForumState(): void {
    const data = readAuth();
    delete data.cookie;
    delete data.linkedFromAppSsoAt;
    delete data.appSsoAccessToken;
    writeAuth(data);
    syncToEnv(data);
  }

  /** OAuth access_token 桥接论坛成功后写入 Cookie 与展示用用户名。 */
  applyAppSsoForumBridge(cookie: string, usernameHint?: string): ForumAuthData {
    const data = readAuth();
    data.cookie = cookie;
    data.linkedFromAppSsoAt = Date.now();
    const u = usernameHint?.trim();
    if (u) data.username = u;
    writeAuth(data);
    syncToEnv(data);
    return data;
  }

  markVerified(result: "ok" | "failed") {
    const data = readAuth();
    data.lastVerified = Date.now();
    data.lastVerifyResult = result;
    writeAuth(data);
  }

  clear(): void {
    writeAuth({});
    syncToEnv({});
  }

  getView() {
    const data = readAuth();
    const mask = (s?: string) =>
      s && s.length > 4
        ? s.slice(0, 2) + "***" + s.slice(-2)
        : s
          ? "***"
          : "";
    return {
      username: mask(data.username),
      hasPassword: !!data.password?.trim(),
      hasCookie: !!data.cookie?.trim(),
      /** 已保存主应用 access_token（论坛桥接会用它；不暴露令牌内容） */
      hasAppSsoAccessTokenSaved: !!data.appSsoAccessToken?.trim(),
      /** 仅当磁盘上同时存在 SSO 同步标记与 Cookie 时为 true，避免「已同步」与未配置并列 */
      linkedFromAppSso: !!(data.linkedFromAppSsoAt && data.cookie?.trim()),
      hasApiKey: !!data.apiKey?.trim(),
      hasApiUsername: !!data.apiUsername?.trim(),
      lastVerified: data.lastVerified ?? null,
      lastVerifyResult: data.lastVerifyResult ?? null,
    };
  }
}
