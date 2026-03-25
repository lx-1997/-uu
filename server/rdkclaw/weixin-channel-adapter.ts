import type { RDKClawEvent } from "./types.js";
import { RDKClawApp } from "./app.js";

export interface WeixinInboundPayload {
  userId: string;
  text: string;
  contextToken?: string;
}

export interface WeixinSessionRecord {
  userId: string;
  sessionKey: string;
  lastSeenAt: number;
}

export class WeixinChannelAdapter {
  private app: RDKClawApp;
  private sessions = new Map<string, WeixinSessionRecord>();

  constructor(app: RDKClawApp) {
    this.app = app;
  }

  private getSessionKey(userId: string) {
    const existing = this.sessions.get(userId);
    if (existing) {
      existing.lastSeenAt = Date.now();
      return existing.sessionKey;
    }
    const sessionKey = `weixin:${userId}`;
    this.sessions.set(userId, {
      userId,
      sessionKey,
      lastSeenAt: Date.now(),
    });
    return sessionKey;
  }

  async handleInbound(payload: WeixinInboundPayload): Promise<{
    text: string;
    events: RDKClawEvent[];
  }> {
    const trimmed = payload.text.trim();
    if (/^(?:停止|stop|全部停止|停止所有任务|stop\s*all)$/i.test(trimmed)) {
      const count = this.app.cancelAllRuns();
      return {
        text: `已停止所有运行中的任务（${count} 个）`,
        events: [],
      };
    }

    const sessionId = this.getSessionKey(payload.userId);
    const events: RDKClawEvent[] = [];
    let text = "";
    let toolCalls = 0;
    let elapsedDisplay = "";
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
      if (event.type === "run_complete") {
        toolCalls = Number(event.data.tool_calls ?? 0);
        elapsedDisplay = String(event.data.elapsed_display ?? "");
      }
    }
    let body = text.trim() || "RDKClaw 已处理完成。";
    const footerParts: string[] = [];
    if (elapsedDisplay) footerParts.push(elapsedDisplay);
    if (toolCalls > 0) footerParts.push(`${toolCalls} 步`);
    const footer = footerParts.length > 0 ? `\n\n─── ✓ 回复完成 (${footerParts.join(' · ')}) ───` : "\n\n─── ✓ 回复完成 ───";
    body += footer;
    return {
      text: body.slice(0, 4000),
      events,
    };
  }
}
