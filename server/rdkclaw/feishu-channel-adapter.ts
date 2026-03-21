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

  constructor(app: RDKClawApp) {
    this.app = app;
  }

  private getSessionKey(userId: string) {
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

