import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type PendingCode = {
  openId: string;
  chatId?: string;
  code: string;
  expireAt: number;
  used: boolean;
  createdAt: number;
};

type BoundUser = {
  openId: string;
  boundAt: number;
  viaCode: string;
};

type FeishuAuthData = {
  pending: PendingCode[];
  bound: BoundUser[];
};

const AUTH_DIR = path.join(os.homedir(), ".rdkstudio");
const AUTH_FILE = path.join(AUTH_DIR, "feishu-auth.json");
const CODE_TTL_MS = 5 * 60 * 1000;

function ensureDir() {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
}

function now() {
  return Date.now();
}

export class FeishuAuthStore {
  private data: FeishuAuthData;

  constructor() {
    this.data = this.read();
    this.gc();
  }

  private read(): FeishuAuthData {
    try {
      if (!fs.existsSync(AUTH_FILE)) return { pending: [], bound: [] };
      const raw = fs.readFileSync(AUTH_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Partial<FeishuAuthData>;
      return {
        pending: Array.isArray(parsed.pending) ? parsed.pending : [],
        bound: Array.isArray(parsed.bound) ? parsed.bound : [],
      };
    } catch {
      return { pending: [], bound: [] };
    }
  }

  private save() {
    ensureDir();
    fs.writeFileSync(AUTH_FILE, JSON.stringify(this.data, null, 2), "utf-8");
  }

  private gc() {
    const ts = now();
    this.data.pending = this.data.pending.filter((item) => !item.used && item.expireAt > ts);
    const seen = new Set<string>();
    this.data.bound = this.data.bound.filter((item) => {
      if (!item.openId || seen.has(item.openId)) return false;
      seen.add(item.openId);
      return true;
    });
    this.save();
  }

  isBound(openId: string): boolean {
    this.gc();
    return this.data.bound.some((item) => item.openId === openId);
  }

  issueCode(openId: string, chatId?: string): string {
    this.gc();
    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.data.pending.push({
      openId,
      chatId,
      code,
      expireAt: now() + CODE_TTL_MS,
      used: false,
      createdAt: now(),
    });
    this.save();
    return code;
  }

  bindByCode(code: string): { ok: boolean; openId?: string; reason?: string } {
    this.gc();
    const token = this.data.pending.find((item) => item.code === code);
    if (!token) {
      return { ok: false, reason: "授权码不存在或已过期" };
    }
    if (token.used) {
      return { ok: false, reason: "授权码已使用" };
    }
    if (token.expireAt <= now()) {
      return { ok: false, reason: "授权码已过期" };
    }
    token.used = true;
    const exists = this.data.bound.some((item) => item.openId === token.openId);
    if (!exists) {
      this.data.bound.push({
        openId: token.openId,
        boundAt: now(),
        viaCode: token.code,
      });
    }
    this.save();
    return { ok: true, openId: token.openId };
  }

  listBound() {
    this.gc();
    return [...this.data.bound];
  }
}

