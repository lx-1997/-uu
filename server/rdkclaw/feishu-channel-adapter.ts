import type { RDKClawEvent } from "./types.js";
import { RDKClawApp } from "./app.js";

export interface FeishuInboundPayload {
  userId: string;
  chatId?: string;
  text: string;
}

export interface FeishuSessionRecord {
  userId: string;
  sessionKey: string;
  lastSeenAt: number;
}

export class FeishuChannelAdapter {
  private app: RDKClawApp;
  private sessions = new Map<string, FeishuSessionRecord>();
  private static SESSION_TTL_MS = 24 * 60 * 60 * 1000;
  private static MAX_SESSIONS = 5000;
  private lastGcAt = 0;

  constructor(app: RDKClawApp) {
    this.app = app;
  }

  private gcSessions() {
    const now = Date.now();
    if (now - this.lastGcAt < 60_000) return;
    this.lastGcAt = now;
    for (const [key, record] of this.sessions.entries()) {
      if (now - record.lastSeenAt > FeishuChannelAdapter.SESSION_TTL_MS) {
        this.sessions.delete(key);
      }
    }
    if (this.sessions.size > FeishuChannelAdapter.MAX_SESSIONS) {
      const sorted = [...this.sessions.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
      const toRemove = sorted.slice(0, sorted.length - FeishuChannelAdapter.MAX_SESSIONS);
      for (const [key] of toRemove) this.sessions.delete(key);
    }
  }

  private getSessionKey(userId: string) {
    this.gcSessions();
    const existing = this.sessions.get(userId);
    if (existing) {
      existing.lastSeenAt = Date.now();
      return existing.sessionKey;
    }
    const sessionKey = `feishu:${userId}`;
    this.sessions.set(userId, {
      userId,
      sessionKey,
      lastSeenAt: Date.now(),
    });
    return sessionKey;
  }

  async handleInbound(payload: FeishuInboundPayload): Promise<{
    text: string;
    events: RDKClawEvent[];
  }> {
    const sessionId = this.getSessionKey(payload.userId);
    const events: RDKClawEvent[] = [];
    let text = "";
    for await (const event of this.app.streamChat({
      message: payload.text,
      userId: payload.userId,
      sessionId,
      mode: "board-preferred",
    })) {
      events.push(event);
      if (event.type === "text") {
        text += String(event.data.delta ?? "");
      }
      if (event.type === "error") {
        const errorMsg = String(event.data.error ?? "RDKClaw 执行失败");
        if (!text.trim()) text = errorMsg;
      }
    }
    return {
      text: (text.trim() || "RDKClaw 已处理完成。").slice(0, 3500),
      events,
    };
  }
}

