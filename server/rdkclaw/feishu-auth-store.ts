import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type PendingCode = {
  openId: string;
  chatId?: string;
  code: string;
  expireAt: number;
  used: boolean;
  rejected?: boolean;
  createdAt: number;
};

type BoundUser = {
  openId: string;
  boundAt: number;
  viaCode: string;
  studioSessionId?: string;
  activeSessionId?: string;
  lastSessionSyncAt?: number;
  lastChatId?: string;
  lastLinkedAt?: number;
};

type FeishuAuthData = {
  pending: PendingCode[];
  bound: BoundUser[];
  meta?: {
    latestUiSessionId?: string;
    latestUiDeviceId?: string;
    latestUiSessionUpdatedAt?: number;
    latestUiDeviceUpdatedAt?: number;
    updatedAt?: number;
  };
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
      if (!fs.existsSync(AUTH_FILE)) return { pending: [], bound: [], meta: {} };
      const raw = fs.readFileSync(AUTH_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Partial<FeishuAuthData>;
      return {
        pending: Array.isArray(parsed.pending) ? parsed.pending : [],
        bound: Array.isArray(parsed.bound)
          ? parsed.bound.map((item) => ({
              openId: String((item as BoundUser).openId || ""),
              boundAt: Number((item as BoundUser).boundAt || now()),
              viaCode: String((item as BoundUser).viaCode || ""),
              studioSessionId: (item as BoundUser).studioSessionId ? String((item as BoundUser).studioSessionId) : undefined,
              activeSessionId: (item as BoundUser).activeSessionId ? String((item as BoundUser).activeSessionId) : undefined,
              lastSessionSyncAt: (item as BoundUser).lastSessionSyncAt ? Number((item as BoundUser).lastSessionSyncAt) : undefined,
              lastChatId: (item as BoundUser).lastChatId ? String((item as BoundUser).lastChatId) : undefined,
              lastLinkedAt: (item as BoundUser).lastLinkedAt ? Number((item as BoundUser).lastLinkedAt) : undefined,
            }))
          : [],
        meta: typeof parsed.meta === "object" && parsed.meta
          ? {
              latestUiSessionId: parsed.meta.latestUiSessionId ? String(parsed.meta.latestUiSessionId) : undefined,
              latestUiDeviceId: parsed.meta.latestUiDeviceId ? String(parsed.meta.latestUiDeviceId) : undefined,
              latestUiSessionUpdatedAt: parsed.meta.latestUiSessionUpdatedAt ? Number(parsed.meta.latestUiSessionUpdatedAt) : undefined,
              latestUiDeviceUpdatedAt: parsed.meta.latestUiDeviceUpdatedAt ? Number(parsed.meta.latestUiDeviceUpdatedAt) : undefined,
              updatedAt: parsed.meta.updatedAt ? Number(parsed.meta.updatedAt) : undefined,
            }
          : {},
      };
    } catch {
      return { pending: [], bound: [], meta: {} };
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

  private ensureMeta() {
    if (!this.data.meta) this.data.meta = {};
  }

  isBound(openId: string): boolean {
    this.gc();
    return this.data.bound.some((item) => item.openId === openId);
  }

  getBound(openId: string): BoundUser | undefined {
    this.gc();
    return this.data.bound.find((item) => item.openId === openId);
  }

  issueCode(openId: string, chatId?: string): string {
    this.gc();
    const existing = this.data.pending
      .filter((item) => !item.used && !item.rejected && item.expireAt > now() && item.openId === openId)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (existing) return existing.code;

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
    if (token.rejected) {
      return { ok: false, reason: "该配对请求已被拒绝" };
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
    // 同一用户完成绑定后，清理其它未使用的待配对码，避免重复干扰
    this.data.pending = this.data.pending.map((item) => {
      if (item.openId === token.openId && item.code !== token.code && !item.used && !item.rejected) {
        return { ...item, rejected: true };
      }
      return item;
    });
    this.save();
    return { ok: true, openId: token.openId };
  }

  bindByCodeForOpenId(code: string, openId: string): { ok: boolean; openId?: string; reason?: string } {
    this.gc();
    const token = this.data.pending.find((item) => item.code === code);
    if (!token) return { ok: false, reason: "授权码不存在或已过期" };
    if (token.openId !== openId) return { ok: false, reason: "授权码与当前飞书账号不匹配" };
    return this.bindByCode(code);
  }

  linkStudioSession(openId: string, studioSessionId: string): { ok: boolean; reason?: string } {
    this.gc();
    const session = String(studioSessionId || "").trim();
    if (!session) return { ok: false, reason: "sessionId 不能为空" };
    const bound = this.data.bound.find((item) => item.openId === openId);
    if (!bound) return { ok: false, reason: "飞书账号尚未绑定" };
    bound.studioSessionId = session;
    bound.activeSessionId = session;
    bound.lastSessionSyncAt = now();
    bound.lastLinkedAt = now();
    this.ensureMeta();
    this.data.meta!.latestUiSessionId = session;
    this.data.meta!.latestUiSessionUpdatedAt = now();
    this.data.meta!.updatedAt = now();
    this.save();
    return { ok: true };
  }

  resolveSession(openId: string, fallbackSessionId: string): string {
    this.gc();
    const fallback = String(fallbackSessionId || "").trim();
    const bound = this.data.bound.find((item) => item.openId === openId);
    if (!bound) return fallback;
    return String(bound.activeSessionId || bound.studioSessionId || fallback).trim();
  }

  touchSession(openId: string, sessionId: string, chatId?: string): void {
    this.gc();
    const session = String(sessionId || "").trim();
    if (!session) return;
    const bound = this.data.bound.find((item) => item.openId === openId);
    if (!bound) return;
    bound.activeSessionId = session;
    bound.lastSessionSyncAt = now();
    if (chatId) bound.lastChatId = String(chatId);
    this.save();
  }

  setLatestUiSession(sessionId: string): void {
    this.gc();
    const value = String(sessionId || "").trim();
    if (!value) return;
    this.ensureMeta();
    this.data.meta!.latestUiSessionId = value;
    this.data.meta!.latestUiSessionUpdatedAt = now();
    this.data.meta!.updatedAt = now();
    this.save();
  }

  setLatestUiDevice(deviceId: string): void {
    this.gc();
    const value = String(deviceId || "").trim();
    if (!value) return;
    this.ensureMeta();
    this.data.meta!.latestUiDeviceId = value;
    this.data.meta!.latestUiDeviceUpdatedAt = now();
    this.data.meta!.updatedAt = now();
    this.save();
  }

  getLatestUiSession(): string {
    this.gc();
    return String(this.data.meta?.latestUiSessionId || "").trim();
  }

  getLatestUiDevice(): string {
    this.gc();
    return String(this.data.meta?.latestUiDeviceId || "").trim();
  }

  getLatestUiMeta(): {
    latestUiSessionId: string;
    latestUiDeviceId: string;
    latestUiSessionUpdatedAt: number | null;
    latestUiDeviceUpdatedAt: number | null;
  } {
    this.gc();
    return {
      latestUiSessionId: String(this.data.meta?.latestUiSessionId || "").trim(),
      latestUiDeviceId: String(this.data.meta?.latestUiDeviceId || "").trim(),
      latestUiSessionUpdatedAt: this.data.meta?.latestUiSessionUpdatedAt || null,
      latestUiDeviceUpdatedAt: this.data.meta?.latestUiDeviceUpdatedAt || null,
    };
  }

  listBound() {
    this.gc();
    return [...this.data.bound];
  }

  listPending() {
    this.gc();
    return this.data.pending
      .filter((item) => !item.used && !item.rejected && item.expireAt > now())
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  approveByCode(code: string) {
    return this.bindByCode(code);
  }

  rejectByCode(code: string): { ok: boolean; reason?: string } {
    this.gc();
    const token = this.data.pending.find((item) => item.code === code);
    if (!token) return { ok: false, reason: "配对码不存在或已过期" };
    if (token.used) return { ok: false, reason: "配对码已被使用" };
    token.rejected = true;
    this.save();
    return { ok: true };
  }
}

