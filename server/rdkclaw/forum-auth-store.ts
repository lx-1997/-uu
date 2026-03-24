import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CONFIG_DIR = path.join(os.homedir(), ".rdkstudio");
const AUTH_FILE = path.join(CONFIG_DIR, "forum-auth.json");

interface ForumAuthData {
  username?: string;
  password?: string;
  cookie?: string;
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
    writeAuth(data);
    syncToEnv(data);
    return data;
  }

  saveCookie(cookie: string): ForumAuthData {
    const data = readAuth();
    data.cookie = cookie;
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
      hasApiKey: !!data.apiKey?.trim(),
      hasApiUsername: !!data.apiUsername?.trim(),
      lastVerified: data.lastVerified ?? null,
      lastVerifyResult: data.lastVerifyResult ?? null,
    };
  }
}
