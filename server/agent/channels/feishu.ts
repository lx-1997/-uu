import * as Lark from "@larksuiteoapi/node-sdk";
import type { ChatAttachmentInput } from "../tools/attachment-tools.js";
import { RDKClawApp } from "../../rdkclaw/app.js";
import { FeishuAuthStore } from "../../rdkclaw/feishu-auth-store.js";
import type { FeishuRuntimeConfig } from "../../rdkclaw/feishu-config-store.js";
import type { NotificationHub } from "../../rdkclaw/notification-hub.js";
import { readDevices } from "../../storage.js";

type FeishuChannelOptions = {
  rdkclaw: RDKClawApp;
  authStore: FeishuAuthStore;
  getConfig: () => FeishuRuntimeConfig;
  notificationHub?: NotificationHub;
};

type FeishuRuntimeStatus = {
  running: boolean;
  connected: boolean;
  lastError: string | null;
  lastEventAt: number | null;
  connectionMode: "websocket" | "webhook";
};

const FEISHU_MAX_TEXT = 1800;

function parseContentObject(content: unknown): Record<string, unknown> {
  if (typeof content !== "string") return {};
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

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

function normalizeForFeishu(text: string): string {
  const raw = String(text || "").trim();
  if (!raw) return "";
  // 飞书文本消息对复杂 markdown 支持有限，这里做轻量降噪与分段。
  return raw
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, "").trim())
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extensionFromMime(mimeType: string) {
  if (!mimeType) return "";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("gif")) return ".gif";
  if (mimeType.includes("mpeg")) return ".mp3";
  if (mimeType.includes("wav")) return ".wav";
  if (mimeType.includes("ogg")) return ".ogg";
  if (mimeType.includes("webm")) return ".webm";
  if (mimeType.includes("mp4")) return ".mp4";
  if (mimeType.includes("pdf")) return ".pdf";
  return "";
}

function parseContentDispositionFileName(raw: string | null) {
  if (!raw) return "";
  const utf8 = raw.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      return utf8;
    }
  }
  const basic = raw.match(/filename="?([^"]+)"?/i)?.[1];
  return basic || "";
}

function summarizeInboundAttachments(attachments: ChatAttachmentInput[]) {
  if (attachments.length === 0) return "";
  return attachments
    .map((attachment) => {
      if (attachment.type === "image") return `[图片] ${attachment.name}`;
      if (attachment.type === "audio") return `[语音] ${attachment.name}`;
      if (attachment.type === "video") return `[视频] ${attachment.name}`;
      return `[文件] ${attachment.name}`;
    })
    .join(" ");
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
  private readonly notificationHub?: NotificationHub;
  private client: Lark.Client | null = null;
  private wsClient: unknown | null = null;
  private status: FeishuRuntimeStatus = {
    running: false,
    connected: false,
    lastError: null,
    lastEventAt: null,
    connectionMode: "websocket",
  };
  private tenantToken: { value: string; expireAt: number } | null = null;

  constructor(opts: FeishuChannelOptions) {
    this.rdkclaw = opts.rdkclaw;
    this.authStore = opts.authStore;
    this.getConfig = opts.getConfig;
    this.notificationHub = opts.notificationHub;
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
    this.tenantToken = null;
    this.status.running = false;
    this.status.connected = false;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private async getTenantToken(): Promise<string> {
    const cfg = this.getConfig();
    if (!cfg.appId || !cfg.appSecret) {
      throw new Error("飞书缺少 App ID 或 App Secret");
    }
    const now = Date.now();
    if (this.tenantToken && this.tenantToken.expireAt > now + 30_000) {
      return this.tenantToken.value;
    }
    const authBase = authBaseByDomain(cfg.domain);
    const res = await fetch(`${authBase}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: cfg.appId,
        app_secret: cfg.appSecret,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    };
    if (!res.ok || payload.code !== 0 || !payload.tenant_access_token) {
      throw new Error(payload.msg || "获取飞书 tenant_access_token 失败");
    }
    this.tenantToken = {
      value: payload.tenant_access_token,
      expireAt: now + Math.max(60, Number(payload.expire || 7200)) * 1000,
    };
    return this.tenantToken.value;
  }

  private async downloadMessageResource(
    messageId: string,
    resourceKey: string,
    type: "image" | "file",
    fallbackName: string,
  ): Promise<{ contentBase64: string; mimeType: string; name: string }> {
    const cfg = this.getConfig();
    const authBase = authBaseByDomain(cfg.domain);
    const token = await this.getTenantToken();
    const res = await fetch(
      `${authBase}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(resourceKey)}?type=${type}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`下载飞书资源失败 (${res.status}) ${text.slice(0, 120)}`);
    }
    const mimeType = res.headers.get("content-type") || "application/octet-stream";
    const fileName = parseContentDispositionFileName(res.headers.get("content-disposition"))
      || `${fallbackName}${extensionFromMime(mimeType)}`;
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      contentBase64: buffer.toString("base64"),
      mimeType,
      name: fileName,
    };
  }

  private async resolveMessageAttachments(message: any): Promise<ChatAttachmentInput[]> {
    const msgType = String(message?.message_type || message?.msg_type || "").toLowerCase();
    const parsed = parseContentObject(message?.content);
    const messageId = String(message?.message_id || "");
    if (!msgType || !messageId) return [];

    if (msgType === "image") {
      const imageKey = String(parsed.image_key || parsed.imageKey || "");
      if (!imageKey) return [];
      const file = await this.downloadMessageResource(messageId, imageKey, "image", `feishu-image-${messageId}`);
      return [{
        id: `feishu-${messageId}-image`,
        type: "image",
        name: file.name,
        mimeType: file.mimeType,
        size: undefined,
        contentBase64: file.contentBase64,
        source: "feishu",
      }];
    }

    if (msgType === "file" || msgType === "audio" || msgType === "media") {
      const fileKey = String(parsed.file_key || parsed.fileKey || parsed.audio_key || parsed.audioKey || "");
      if (!fileKey) return [];
      const file = await this.downloadMessageResource(messageId, fileKey, "file", `feishu-${msgType}-${messageId}`);
      return [{
        id: `feishu-${messageId}-${msgType}`,
        type: msgType === "audio" ? "audio" : "file",
        name: file.name,
        mimeType: file.mimeType,
        size: undefined,
        contentBase64: file.contentBase64,
        source: "feishu",
      }];
    }

    return [];
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
    let attachments: ChatAttachmentInput[] = [];
    try {
      attachments = await this.resolveMessageAttachments(message);
    } catch (error) {
      const msgId = String(message?.message_id || "");
      const openIdMasked = `${openId.slice(0, 4)}***${openId.slice(-4)}`;
      const hint = `收到附件，但下载解析失败：${error instanceof Error ? error.message : "未知错误"}`;
      if (chatId) {
        await this.sendText(chatId, hint);
      }
      this.publishMirror("channel_message_error", "飞书附件", hint, {
        channel: "feishu",
        direction: "error",
        openIdMasked,
        chatId,
        messageId: msgId,
      });
      return;
    }
    const text = parseText(message?.content);
    const inboundText = text || summarizeInboundAttachments(attachments);
    if (senderType === "app") return;
    if (!chatId || !openId || (!inboundText && attachments.length === 0)) {
      console.log(`[FeishuWS] skip message: chatId=${!!chatId} openId=${!!openId} text=${!!inboundText} attachments=${attachments.length}`);
      return;
    }
    const msgId = String(message?.message_id || "");
    const openIdMasked = `${openId.slice(0, 4)}***${openId.slice(-4)}`;
    console.log(`[FeishuWS] inbound chatType=${chatType || "unknown"} openId=${openId.slice(0, 6)}*** chatId=${chatId}`);
    const fallbackSessionId = sessionKeyFor(chatType, openId, chatId);
    const latestUiSessionId = this.authStore.getLatestUiSession();
    let latestUiDeviceId = this.authStore.getLatestUiDevice();
    const boundSessionId = this.authStore.resolveSession(openId, "");
    const sessionId = latestUiSessionId || boundSessionId || fallbackSessionId;
    this.authStore.touchSession(openId, sessionId, chatId);
    this.publishMirror("channel_message_inbound", "飞书消息", inboundText, {
      channel: "feishu",
      direction: "inbound",
      openIdMasked,
      chatId,
      messageId: msgId,
      sessionId,
    });
    const shouldRequirePairing = cfg.dmPolicy === "pairing";
    const isBound = this.authStore.isBound(openId);

    // 允许用户直接在飞书私信中回填配对码完成绑定，减少来回切换成本
    const maybeCode = (() => {
      const m = inboundText.match(/(\d{6})/);
      return m?.[1] || "";
    })();
    if (!isBound && maybeCode) {
      const bind = this.authStore.bindByCodeForOpenId(maybeCode, openId);
      if (bind.ok) {
        await this.sendText(chatId, "配对成功，已绑定当前飞书账号。现在可以直接和 RDKClaw 对话。");
        this.publishMirror("channel_message_ack", "飞书配对", "配对成功，已建立统一会话上下文。", {
          channel: "feishu",
          direction: "ack",
          openIdMasked,
          chatId,
          messageId: msgId,
        });
        return;
      }
      await this.sendText(chatId, `配对失败：${bind.reason || "授权码无效"}`);
      this.publishMirror("channel_message_error", "飞书配对", bind.reason || "授权码无效", {
        channel: "feishu",
        direction: "error",
        openIdMasked,
        chatId,
        messageId: msgId,
      });
      return;
    }

    if (shouldRequirePairing && !isBound) {
      await this.issuePairingPrompt(openId, chatId, "message");
      return;
    }

    if (!latestUiSessionId && !boundSessionId) {
      const hint = "请先打开 RDK Studio 聊天窗口并发送一条消息，建立活跃会话后再继续。";
      await this.sendText(chatId, hint);
      this.publishMirror("channel_message_error", "飞书会话", hint, {
        channel: "feishu",
        direction: "error",
        openIdMasked,
        chatId,
        messageId: msgId,
      });
      return;
    }

    if (!latestUiDeviceId) {
      // 没有设备心跳时，尝试从设备清单挑选当前已连接设备，避免因一次心跳缺失导致飞书链路退化。
      try {
        const devices = await readDevices();
        const connected = devices.find((item) => item.status === "connected");
        if (connected?.id) {
          latestUiDeviceId = connected.id;
          this.authStore.setLatestUiDevice(connected.id);
        }
      } catch {
        // ignore
      }
    } else {
      // 有设备心跳但可能是过期/无效键（例如历史测试值），优先校验并自动回退到当前真实已连接设备。
      try {
        const devices = await readDevices();
        const exact = devices.find((item) => item.id === latestUiDeviceId && item.status === "connected");
        if (!exact) {
          const connected = devices.find((item) => item.status === "connected");
          if (connected?.id) {
            latestUiDeviceId = connected.id;
            this.authStore.setLatestUiDevice(connected.id);
          } else {
            latestUiDeviceId = "";
          }
        }
      } catch {
        // ignore
      }
    }

    if (!latestUiDeviceId) {
      const hint = "请先在 RDK Studio 里连接目标设备，再通过飞书发起设备相关请求。";
      await this.sendText(chatId, hint);
      this.publishMirror("channel_message_error", "飞书设备", hint, {
        channel: "feishu",
        direction: "error",
        openIdMasked,
        chatId,
        messageId: msgId,
        sessionId,
      });
      return;
    }

    if (cfg.ackOnReceive && cfg.ackStyle !== "off") {
      const ack = cfg.ackStyle === "emoji" ? "👌" : "已收到，正在同步到 RDK Studio 会话...";
      await this.sendText(chatId, ack);
      this.publishMirror("channel_message_ack", "飞书回执", ack, {
        channel: "feishu",
        direction: "ack",
        openIdMasked,
        chatId,
        messageId: msgId,
        sessionId,
      });
    }

    const chunks: string[] = [];
    let finalText = "";
    if (cfg.ackOnRunning && cfg.ackStyle !== "off") {
      const runningAck = cfg.ackStyle === "emoji" ? "⏳" : "正在执行，请稍候...";
      await this.sendText(chatId, runningAck);
      this.publishMirror("channel_message_ack", "飞书回执", runningAck, {
        channel: "feishu",
        direction: "ack",
        openIdMasked,
        chatId,
        messageId: msgId,
        sessionId,
      });
    }
    for await (const event of this.rdkclaw.streamChat({
      message: text || "请结合我刚通过飞书发送的附件继续处理当前请求。",
      userId: openId,
      deviceId: latestUiDeviceId,
      sessionId,
      mode: "auto",
      attachments,
    })) {
      if (event.type === "text") {
        const delta = String(event.data?.delta ?? event.data?.text ?? "");
        if (delta) chunks.push(delta);
      } else if (event.type === "message_end") {
        finalText = String(event.data?.text ?? "").trim();
      }
    }
    const streamed = chunks.join("").trim();
    const replyRaw = (finalText || streamed).trim() || "我已经执行完成，但未提取到可显示的文本结果。请让我重试并返回详细过程。";
    const reply = normalizeForFeishu(replyRaw);
    await this.sendText(chatId, reply);
    this.publishMirror("channel_message_outbound", "飞书回复", reply, {
      channel: "feishu",
      direction: "outbound",
      openIdMasked,
      chatId,
      messageId: msgId,
      sessionId,
    });
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
    const text = [
      "RDKClaw 需要先完成配对授权。",
      `配对码：${code}`,
      "请在 RDK Studio 设置页的飞书配对列表中审批，或在聊天框发送：绑定飞书 <配对码>",
      "5 分钟内有效，仅可使用一次。",
    ].join("\n");
    await this.sendText(chatId, text);
    this.publishMirror("channel_message_ack", "飞书配对", `已下发配对码：${code}`, {
      channel: "feishu",
      direction: "ack",
      openIdMasked: `${openId.slice(0, 4)}***${openId.slice(-4)}`,
      chatId,
    });
    console.log(`[FeishuWS] issued pairing code for ${openId.slice(0, 6)}*** source=${source}`);
  }

  private publishMirror(
    type: "channel_message_inbound" | "channel_message_ack" | "channel_message_outbound" | "channel_message_error",
    title: string,
    message: string,
    payload?: Record<string, unknown>,
  ): void {
    if (!this.notificationHub) return;
    const cfg = this.getConfig();
    if (!cfg.mirrorToStudioChat && type !== "channel_message_error") return;
    this.notificationHub.publish({
      type,
      title,
      message,
      level: type === "channel_message_error" ? "error" : "info",
      ts: Date.now(),
      payload,
      sessionId: typeof payload?.sessionId === "string" ? payload.sessionId : undefined,
    });
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
