import * as Lark from "@larksuiteoapi/node-sdk";
import { RDKClawApp } from "../../rdkclaw/app.js";
import { FeishuAuthStore } from "../../rdkclaw/feishu-auth-store.js";
import type { FeishuRuntimeConfig } from "../../rdkclaw/feishu-config-store.js";

type FeishuChannelOptions = {
  rdkclaw: RDKClawApp;
  authStore: FeishuAuthStore;
  getConfig: () => FeishuRuntimeConfig;
};

type FeishuRuntimeStatus = {
  running: boolean;
  connected: boolean;
  lastError: string | null;
  lastEventAt: number | null;
  connectionMode: "websocket" | "webhook";
};

const FEISHU_MAX_TEXT = 1800;

function extractTextFromPost(parsed: Record<string, unknown>): string {
  const post = parsed.post as { zh_cn?: { content?: Array<Array<{ text?: string }>> } } | undefined;
  const rows = post?.zh_cn?.content ?? [];
  const tokens: string[] = [];
  for (const row of rows) {
    for (const node of row) {
      if (node?.text) tokens.push(String(node.text));
    }
  }
  return tokens.join(" ").trim();
}

function parseText(content: unknown): string {
  if (typeof content !== "string") return "";
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const text = String(parsed.text || "").trim();
    if (text) return text;
    return extractTextFromPost(parsed);
  } catch {
    return String(content).trim();
  }
}

function unwrapEventPayload(raw: any): any {
  if (raw?.event && typeof raw.event === "object") return raw.event;
  if (raw?.data?.event && typeof raw.data.event === "object") return raw.data.event;
  return raw;
}

function sessionKeyFor(chatType: string | undefined, openId: string, chatId: string): string {
  if (chatType === "p2p") return `feishu:${openId}`;
  return `feishu:chat:${chatId}`;
}

function authBaseByDomain(domain: "feishu" | "lark"): string {
  return domain === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn";
}

export class FeishuWebSocketChannel {
  private readonly rdkclaw: RDKClawApp;
  private readonly authStore: FeishuAuthStore;
  private readonly getConfig: () => FeishuRuntimeConfig;
  private client: Lark.Client | null = null;
  private wsClient: unknown | null = null;
  private status: FeishuRuntimeStatus = {
    running: false,
    connected: false,
    lastError: null,
    lastEventAt: null,
    connectionMode: "websocket",
  };

  constructor(opts: FeishuChannelOptions) {
    this.rdkclaw = opts.rdkclaw;
    this.authStore = opts.authStore;
    this.getConfig = opts.getConfig;
  }

  getStatus(): FeishuRuntimeStatus {
    const cfg = this.getConfig();
    return {
      ...this.status,
      connectionMode: cfg.connectionMode,
    };
  }

  async start(): Promise<void> {
    const cfg = this.getConfig();
    this.status.connectionMode = cfg.connectionMode;
    if (!cfg.enabled || cfg.connectionMode !== "websocket") {
      this.status.running = false;
      this.status.connected = false;
      this.status.lastError = null;
      return;
    }
    if (this.status.running) return;
    if (!cfg.appId || !cfg.appSecret) {
      throw new Error("飞书 WebSocket 模式缺少 App ID 或 App Secret");
    }

    const domain = cfg.domain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu;
    const authBase = authBaseByDomain(cfg.domain);
    const authRes = await fetch(`${authBase}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: cfg.appId,
        app_secret: cfg.appSecret,
      }),
    });
    const authData = (await authRes.json().catch(() => ({}))) as { code?: number; msg?: string };
    if (!authRes.ok || authData.code !== 0) {
      const reason = authData.msg || authRes.statusText || "unknown";
      this.status.lastError = `飞书凭据校验失败: ${reason}`;
      throw new Error(this.status.lastError);
    }

    this.client = new Lark.Client({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      appType: Lark.AppType.SelfBuild,
      domain,
    });

    const wsClient = new Lark.WSClient({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      domain,
      loggerLevel: Lark.LoggerLevel.info,
    });

    try {
      await wsClient.start({
        eventDispatcher: new Lark.EventDispatcher({}).register({
          "im.message.receive_v1": async (data: any) => {
            this.status.lastEventAt = Date.now();
            this.status.connected = true;
            void this.handleMessage(data).catch((err) => {
              this.status.lastError = err instanceof Error ? err.message : String(err);
            });
          },
          "im.chat.access_event.bot_p2p_chat_entered_v1": async (data: any) => {
            this.status.lastEventAt = Date.now();
            this.status.connected = true;
            void this.handleP2PEntered(data).catch((err) => {
              this.status.lastError = err instanceof Error ? err.message : String(err);
            });
          },
        }),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.status.lastError = `飞书长连接启动失败: ${reason}`;
      throw new Error(this.status.lastError);
    }

    this.wsClient = wsClient;
    this.status.running = true;
    this.status.connected = false;
    this.status.lastError = null;
  }

  async stop(): Promise<void> {
    const client = this.wsClient as { stop?: () => void; close?: () => void } | null;
    try {
      client?.stop?.();
      client?.close?.();
    } catch {
      // 忽略 SDK 停止异常，状态由上层兜底
    }
    this.wsClient = null;
    this.client = null;
    this.status.running = false;
    this.status.connected = false;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private async handleMessage(payload: any): Promise<void> {
    const cfg = this.getConfig();
    const event = unwrapEventPayload(payload);
    const message = event?.message;
    const sender = event?.sender;
    const chatId = String(message?.chat_id || "");
    const openId = String(sender?.sender_id?.open_id || "");
    const chatType = String(message?.chat_type || "");
    const senderType = String(sender?.sender_type || "");
    const text = parseText(message?.content);
    if (senderType === "app") return;
    if (!chatId || !openId || !text) {
      console.log(`[FeishuWS] skip message: chatId=${!!chatId} openId=${!!openId} text=${!!text}`);
      return;
    }
    console.log(`[FeishuWS] inbound chatType=${chatType || "unknown"} openId=${openId.slice(0, 6)}*** chatId=${chatId}`);

    const sessionId = sessionKeyFor(chatType, openId, chatId);
    const shouldRequirePairing = cfg.dmPolicy === "pairing";
    const isBound = this.authStore.isBound(openId);

    // 允许用户直接在飞书私信中回填配对码完成绑定，减少来回切换成本
    const maybeCode = (() => {
      const m = text.match(/(\d{6})/);
      return m?.[1] || "";
    })();
    if (!isBound && maybeCode) {
      const bind = this.authStore.bindByCodeForOpenId(maybeCode, openId);
      if (bind.ok) {
        await this.sendText(chatId, "配对成功，已绑定当前飞书账号。现在可以直接和 RDKClaw 对话。");
        return;
      }
      await this.sendText(chatId, `配对失败：${bind.reason || "授权码无效"}`);
      return;
    }

    if (shouldRequirePairing && !isBound) {
      await this.issuePairingPrompt(openId, chatId, "message");
      return;
    }

    const chunks: string[] = [];
    let finalText = "";
    for await (const event of this.rdkclaw.streamChat({
      message: text,
      userId: openId,
      sessionId,
      mode: "auto",
    })) {
      if (event.type === "text") {
        const delta = String(event.data?.delta ?? event.data?.text ?? "");
        if (delta) chunks.push(delta);
      } else if (event.type === "message_end") {
        finalText = String(event.data?.text ?? "").trim();
      }
    }
    const streamed = chunks.join("").trim();
    const reply = (finalText || streamed).trim() || "我已经执行完成，但未提取到可显示的文本结果。请让我重试并返回详细过程。";
    await this.sendText(chatId, reply);
    console.log(`[FeishuWS] replied to ${openId.slice(0, 6)}***, chars=${reply.length}`);
  }

  private async handleP2PEntered(payload: any): Promise<void> {
    const event = unwrapEventPayload(payload);
    const openId = String(
      event?.operator_id?.open_id
      || event?.open_id
      || event?.sender_id?.open_id
      || "",
    );
    const chatId = String(
      event?.chat_id
      || event?.chat?.chat_id
      || event?.message?.chat_id
      || "",
    );
    if (!openId || !chatId) return;

    const cfg = this.getConfig();
    if (cfg.dmPolicy !== "pairing") return;
    if (this.authStore.isBound(openId)) return;
    await this.issuePairingPrompt(openId, chatId, "p2p_entered");
  }

  private async issuePairingPrompt(openId: string, chatId: string, source: string): Promise<void> {
    const code = this.authStore.issueCode(openId, chatId);
    await this.sendText(chatId, [
      "RDKClaw 需要先完成配对授权。",
      `配对码：${code}`,
      "请在 RDK Studio 设置页的飞书配对列表中审批，或在聊天框发送：绑定飞书 <配对码>",
      "5 分钟内有效，仅可使用一次。",
    ].join("\n"));
    console.log(`[FeishuWS] issued pairing code for ${openId.slice(0, 6)}*** source=${source}`);
  }

  private async sendText(chatId: string, text: string): Promise<void> {
    if (!this.client || !chatId || !text) return;
    let remaining = text;
    while (remaining.length > 0) {
      const chunk = remaining.slice(0, FEISHU_MAX_TEXT);
      remaining = remaining.slice(FEISHU_MAX_TEXT);
      await this.client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text: chunk }),
        },
      });
    }
  }
}
