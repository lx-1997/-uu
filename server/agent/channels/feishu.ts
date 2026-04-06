import * as Lark from "@larksuiteoapi/node-sdk";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import type { ChatAttachmentInput } from "../tools/attachment-tools.js";
import { RDKClawApp } from "../../rdkclaw/app.js";
import { FeishuAuthStore } from "../../rdkclaw/feishu-auth-store.js";
import type { FeishuRuntimeConfig } from "../../rdkclaw/feishu-config-store.js";
import type { NotificationHub } from "../../rdkclaw/notification-hub.js";
import { readDevices } from "../../storage.js";
import { matchTextApproval } from "../../rdkclaw/channel-safety.js";

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

interface FeishuPendingApproval {
  approvalId: string;
  toolName: string;
  risk: string;
  chatId: string;
  createdAt: number;
}

/** 防抖合并后的入站内容（避免再次 resolveMessageAttachments） */
interface FeishuPreResolvedInbound {
  text: string;
  inboundText: string;
  attachments: ChatAttachmentInput[];
  /** 合并条数；1 表示单条 */
  mergeCount: number;
}

export interface FeishuRecentChat {
  chatId: string;
  openIdMasked: string;
  lastMessageText: string;
  lastSeenAt: number;
}

export class FeishuWebSocketChannel {
  private readonly rdkclaw: RDKClawApp;
  private readonly authStore: FeishuAuthStore;
  private readonly getConfig: () => FeishuRuntimeConfig;
  private readonly notificationHub?: NotificationHub;
  private static FETCH_TIMEOUT_MS = 15_000;
  private static DEDUP_TTL_MS = 10 * 60 * 1000;
  private static MAX_RECENT_CHATS = 50;
  private eventSeen = new Map<string, number>();
  private client: Lark.Client | null = null;
  private wsClient: unknown | null = null;
  private pendingApprovals = new Map<string, FeishuPendingApproval>();
  private recentChats = new Map<string, FeishuRecentChat>();
  private status: FeishuRuntimeStatus = {
    running: false,
    connected: false,
    lastError: null,
    lastEventAt: null,
    connectionMode: "websocket",
  };
  private tenantToken: { value: string; expireAt: number } | null = null;
  private tenantTokenInflight: Promise<string> | null = null;
  /** 与微信一致：短防抖合并连发；同会话串行执行 */
  private static readonly INBOUND_DEBOUNCE_MS = 350;
  private feishuPendingBuffers = new Map<string, {
    items: Array<{ payload: any; resolve: () => void; reject: (e: unknown) => void }>;
    timer: ReturnType<typeof setTimeout> | null;
  }>();
  private feishuSerialTail = new Map<string, Promise<void>>();

  constructor(opts: FeishuChannelOptions) {
    this.rdkclaw = opts.rdkclaw;
    this.authStore = opts.authStore;
    this.getConfig = opts.getConfig;
    this.notificationHub = opts.notificationHub;
  }

  getRecentChats(): FeishuRecentChat[] {
    return Array.from(this.recentChats.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  /**
   * @param allowUnknown 为 true 时允许向任意 chat_id 发送（如定时任务回执）；否则仅允许近期有过消息的会话，降低误发风险。
   */
  async sendOutboundChat(chatId: string, text: string, allowUnknown = false): Promise<boolean> {
    const id = chatId?.trim();
    if (!id || !text?.trim()) return false;
    if (!allowUnknown && !this.recentChats.has(id)) return false;
    if (!this.client) return false;
    try {
      await this.sendText(id, text);
      return true;
    } catch (err) {
      console.warn("[FeishuWS] sendOutboundChat failed:", (err as Error).message);
      return false;
    }
  }

  private recordRecentChat(chatId: string, openIdMasked: string, preview: string) {
    this.recentChats.set(chatId, {
      chatId,
      openIdMasked,
      lastMessageText: preview.slice(0, 500),
      lastSeenAt: Date.now(),
    });
    const max = FeishuWebSocketChannel.MAX_RECENT_CHATS;
    if (this.recentChats.size <= max) return;
    const entries = [...this.recentChats.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
    while (this.recentChats.size > max && entries.length) {
      const [k] = entries.shift()!;
      this.recentChats.delete(k);
    }
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
            try {
              await this.handleMessageInbound(data);
            } catch (err) {
              this.status.lastError = err instanceof Error ? err.message : String(err);
            }
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
    this.tenantTokenInflight = null;
    this.eventSeen.clear();
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
    if (this.tenantTokenInflight) return this.tenantTokenInflight;
    this.tenantTokenInflight = this.refreshTenantToken(cfg).finally(() => {
      this.tenantTokenInflight = null;
    });
    return this.tenantTokenInflight;
  }

  private async refreshTenantToken(cfg: FeishuRuntimeConfig): Promise<string> {
    const authBase = authBaseByDomain(cfg.domain);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FeishuWebSocketChannel.FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${authBase}/open-apis/auth/v3/tenant_access_token/internal`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          app_id: cfg.appId,
          app_secret: cfg.appSecret,
        }),
        signal: controller.signal,
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
        expireAt: Date.now() + Math.max(60, Number(payload.expire || 7200)) * 1000,
      };
      return this.tenantToken.value;
    } finally {
      clearTimeout(timer);
    }
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch(
      `${authBase}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(resourceKey)}?type=${type}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timer);
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

    /** 飞书部分客户端单独下发 video 类型，与 media/文件中的视频统一按 video 附件处理 */
    if (msgType === "video") {
      const fileKey = String(parsed.file_key || parsed.fileKey || "");
      if (!fileKey) return [];
      const file = await this.downloadMessageResource(messageId, fileKey, "file", `feishu-video-${messageId}`);
      return [{
        id: `feishu-${messageId}-video`,
        type: "video",
        name: file.name || `feishu-video-${messageId}.mp4`,
        mimeType: file.mimeType || "video/mp4",
        size: undefined,
        contentBase64: file.contentBase64,
        source: "feishu",
      }];
    }

    if (msgType === "file" || msgType === "audio" || msgType === "media") {
      const fileKey = String(parsed.file_key || parsed.fileKey || parsed.audio_key || parsed.audioKey || "");
      if (!fileKey) return [];
      const file = await this.downloadMessageResource(messageId, fileKey, "file", `feishu-${msgType}-${messageId}`);
      const nameLower = file.name.toLowerCase();
      const extVid = /\.(mp4|webm|avi|mov|mkv|m4v|mpeg|mpg)$/i.test(nameLower);
      const isVideo = msgType === "media" || /^video\//.test(file.mimeType) || extVid;
      const resolvedType = msgType === "audio" ? "audio" : isVideo ? "video" : "file";
      return [{
        id: `feishu-${messageId}-${msgType}`,
        type: resolvedType,
        name: file.name,
        mimeType: file.mimeType,
        size: undefined,
        contentBase64: file.contentBase64,
        source: "feishu",
      }];
    }

    return [];
  }

  private markEventSeen(key: string): boolean {
    if (!key) return false;
    const now = Date.now();
    for (const [k, v] of this.eventSeen.entries()) {
      if (now - v > FeishuWebSocketChannel.DEDUP_TTL_MS) this.eventSeen.delete(k);
    }
    if (this.eventSeen.has(key)) return true;
    this.eventSeen.set(key, now);
    return false;
  }

  private async enqueueFeishuSerial(key: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.feishuSerialTail.get(key) ?? Promise.resolve();
    const next = prev.then(() => fn());
    this.feishuSerialTail.set(key, next);
    await next;
  }

  /**
   * 去重 → 未配对仅串行（不合并，避免配对码被打散）→ 已配对防抖合并连发 → 同会话串行执行。
   */
  private async handleMessageInbound(payload: any): Promise<void> {
    const event = unwrapEventPayload(payload);
    const message = event?.message;
    const sender = event?.sender;
    const eventId = String(payload?.header?.event_id || payload?.event_id || "");
    const messageId = String(message?.message_id || "");
    const dedupKey = eventId || (messageId ? `msg:${messageId}` : "");
    if (dedupKey && this.markEventSeen(dedupKey)) {
      console.log(`[FeishuWS] dedup: skipping duplicate event ${dedupKey.slice(0, 20)}`);
      return;
    }

    const chatId = String(message?.chat_id || "");
    const openId = String(sender?.sender_id?.open_id || "");
    if (!chatId || !openId) {
      await this.handleMessageOriginal(payload);
      return;
    }
    const key = `${openId}::${chatId}`;
    const cfg = this.getConfig();
    const pairingStrict = cfg.dmPolicy === "pairing" && !this.authStore.isBound(openId);
    if (pairingStrict) {
      await this.enqueueFeishuSerial(key, () => this.handleMessageOriginal(payload));
      return;
    }

    return new Promise<void>((resolve, reject) => {
      let buf = this.feishuPendingBuffers.get(key);
      if (!buf) {
        buf = { items: [], timer: null };
        this.feishuPendingBuffers.set(key, buf);
      }
      buf.items.push({ payload, resolve, reject });
      if (buf.timer) clearTimeout(buf.timer);
      buf.timer = setTimeout(() => {
        buf!.timer = null;
        const items = buf!.items;
        this.feishuPendingBuffers.delete(key);
        if (items.length === 0) {
          return;
        }
        void this.enqueueFeishuSerial(key, async () => {
          try {
            if (items.length === 1) {
              await this.handleMessageOriginal(items[0].payload);
            } else {
              await this.handleMessageMergedBatch(items.map((i) => i.payload));
            }
            items.forEach((i) => i.resolve());
          } catch (e) {
            items.forEach((i) => i.reject(e));
          }
        });
      }, FeishuWebSocketChannel.INBOUND_DEBOUNCE_MS);
    });
  }

  private async handleMessageMergedBatch(payloads: any[]): Promise<void> {
    if (payloads.length === 0) return;
    const parts: Array<{ text: string; inboundText: string; attachments: ChatAttachmentInput[] }> = [];
    for (const payload of payloads) {
      const event = unwrapEventPayload(payload);
      const message = event?.message;
      const sender = event?.sender;
      const chatId = String(message?.chat_id || "");
      const openId = String(sender?.sender_id?.open_id || "");
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
        throw error;
      }
      const text = parseText(message?.content);
      const inboundText = text || summarizeInboundAttachments(attachments);
      parts.push({ text, inboundText, attachments });
    }
    const textJoin = parts.map((p) => p.text).filter(Boolean).join("\n---\n").trim();
    const allAttachments: ChatAttachmentInput[] = [];
    const seenAtt = new Set<string>();
    for (const p of parts) {
      for (const a of p.attachments) {
        if (seenAtt.has(a.id)) continue;
        seenAtt.add(a.id);
        allAttachments.push(a);
      }
    }
    const baseInbound = textJoin || summarizeInboundAttachments(allAttachments);
    const mergedInboundText = `[本轮连续 ${payloads.length} 条]\n${baseInbound}`;
    const lastPayload = payloads[payloads.length - 1];
    await this.handleMessageOriginal(lastPayload, {
      text: textJoin,
      inboundText: mergedInboundText,
      attachments: allAttachments,
      mergeCount: payloads.length,
    });
  }

  private async handleMessageOriginal(payload: any, preResolved?: FeishuPreResolvedInbound): Promise<void> {
    const cfg = this.getConfig();
    const event = unwrapEventPayload(payload);
    const message = event?.message;
    const sender = event?.sender;

    let eventId = "";
    let messageId = "";
    if (!preResolved) {
      eventId = String(payload?.header?.event_id || payload?.event_id || "");
      messageId = String(message?.message_id || "");
      const dedupKey = eventId || (messageId ? `msg:${messageId}` : "");
      if (dedupKey && this.markEventSeen(dedupKey)) {
        console.log(`[FeishuWS] dedup: skipping duplicate event ${dedupKey.slice(0, 20)}`);
        return;
      }
    }

    const chatId = String(message?.chat_id || "");
    const openId = String(sender?.sender_id?.open_id || "");
    const chatType = String(message?.chat_type || "");
    const senderType = String(sender?.sender_type || "");
    let attachments: ChatAttachmentInput[] = [];
    let text = "";
    let inboundText = "";
    if (preResolved) {
      attachments = preResolved.attachments;
      text = preResolved.text;
      inboundText = preResolved.inboundText;
    } else {
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
      text = parseText(message?.content);
      inboundText = text || summarizeInboundAttachments(attachments);
    }
    if (senderType === "app") return;
    if (!chatId || !openId || (!inboundText && attachments.length === 0)) {
      console.log(`[FeishuWS] skip message: chatId=${!!chatId} openId=${!!openId} text=${!!inboundText} attachments=${attachments.length}`);
      return;
    }
    const msgId = String(message?.message_id || "");
    const openIdMasked = `${openId.slice(0, 4)}***${openId.slice(-4)}`;
    console.log(`[FeishuWS] inbound chatType=${chatType || "unknown"} openId=${openId.slice(0, 6)}*** chatId=${chatId}`);

    if ((!preResolved || preResolved.mergeCount <= 1) && text && this.tryHandleApprovalReply(openId, chatId, text, openIdMasked)) {
      return;
    }

    const sessionId = sessionKeyFor(chatType, openId, chatId);
    let latestUiDeviceId = this.authStore.getLatestUiDevice();
    this.authStore.touchSession(openId, sessionId, chatId);
    this.publishMirror("channel_message_inbound", "飞书消息", inboundText, {
      channel: "feishu",
      direction: "inbound",
      openIdMasked,
      chatId,
      messageId: msgId,
      sessionId,
    });
    this.recordRecentChat(chatId, openIdMasked, inboundText);
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

    // 移除了 latestUiSessionId 强依赖：每个飞书用户独立 session，不再阻断

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
      await this.sendText(chatId, "当前无 RDK 设备连接，套件端操作暂不可用，其他功能正常。");
    }

    if (cfg.ackOnReceive && cfg.ackStyle !== "off") {
      const ack = cfg.ackStyle === "emoji"
        ? "👌"
        : preResolved && preResolved.mergeCount > 1
          ? `已收到 ${preResolved.mergeCount} 条消息，合并处理中…`
          : "已收到，正在同步到 RDK Studio 会话...";
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

    let toolCount = 0;
    let lastProgressAt = Date.now();
    const PROGRESS_INTERVAL_MS = 30_000;
    const pendingImages: Array<{ localPath: string; fileName: string }> = [];
    const pendingFiles: Array<{ localPath: string; fileName: string }> = [];
    let mirrorSeq = 0;
    const nextMirrorId = () => `${msgId || "no-msg"}:${++mirrorSeq}`;
    const summarizeResult = (raw: string) => {
      const compact = String(raw || "").replace(/\s+/g, " ").trim();
      if (!compact) return "无输出";
      return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
    };

    const streamMessage =
      preResolved && preResolved.mergeCount > 1
        ? inboundText
        : (text || "请结合我刚通过飞书发送的附件继续处理当前请求。");

    try {
      for await (const event of this.rdkclaw.streamChat({
        message: streamMessage,
        userId: openId,
        ssoUserName: `飞书·${openIdMasked}`,
        deviceId: latestUiDeviceId || undefined,
        mode: "auto",
        attachments,
        channel: "feishu",
      })) {
        if (event.type === "queue_status") {
          const hint = String(event.data?.userHint || "").trim() || "正在排队中，请稍候...";
          await this.sendText(chatId, hint);
          continue;
        }
        if (event.type === "text") {
          const delta = String(event.data?.delta ?? event.data?.text ?? "");
          if (delta) chunks.push(delta);
        } else if (event.type === "message_end") {
          finalText = String(event.data?.text ?? "").trim();
        } else if (event.type === "approval_required") {
          const approvalId = String(event.data?.approvalId ?? "");
          const toolName = String(event.data?.toolName ?? "");
          const risk = String(event.data?.risk ?? "medium");
          if (approvalId) {
            this.pendingApprovals.set(openId, {
              approvalId, toolName, risk, chatId, createdAt: Date.now(),
            });
            const promptText = `⚠️ 需要确认\n工具: ${toolName}\n风险: ${risk}\n\n回复「允许」执行，或「拒绝」取消`;
            await this.sendText(chatId, promptText);
          }
        } else if (event.type === "error") {
          const errorMsg = String(event.data?.error ?? "RDKClaw 执行失败");
          if (!chunks.length) chunks.push(errorMsg);
        } else if (event.type === "run_progress") {
          const msg = String(event.data?.message ?? "").trim();
          if (!msg) continue;
          const now = Date.now();
          if (now - lastProgressAt > 8_000) {
            lastProgressAt = now;
            await this.sendText(chatId, msg.slice(0, 900)).catch(() => {});
          }
        } else if (event.type === "tool_start") {
          toolCount++;
          const toolName = String(event.data?.name ?? event.data?.toolName ?? "unknown_tool");
          const executor = String(event.data?.executor || (toolName === "board_openclaw_delegate" ? "board_openclaw" : "rdkclaw_local"));
          this.publishMirror("channel_message_ack", "飞书流程", `开始执行工具：${toolName}`, {
            channel: "feishu",
            direction: "ack",
            openIdMasked,
            chatId,
            messageId: msgId,
            sessionId,
            mirrorId: nextMirrorId(),
            rdkEventKind: "tool_start",
            toolName,
            toolCallId: String(event.data?.toolCallId || ""),
            executor,
          });
          const now = Date.now();
          if (now - lastProgressAt > PROGRESS_INTERVAL_MS) {
            lastProgressAt = now;
            const progressMsg = `正在执行中... (${toolCount} 个步骤${toolName ? `，当前: ${toolName}` : ""})`;
            this.sendText(chatId, progressMsg).catch(() => {});
          }
        } else if (event.type === "tool_progress") {
          const toolName = String(event.data?.name ?? event.data?.toolName ?? "unknown_tool");
          const chunk = String(event.data?.chunk || "").trim();
          if (chunk) {
            const previewLine = chunk.split("\n").map((line) => line.trim()).filter(Boolean).slice(-1)[0] || chunk;
            this.publishMirror("channel_message_ack", "飞书流程", `${toolName}: ${previewLine}`, {
              channel: "feishu",
              direction: "ack",
              openIdMasked,
              chatId,
              messageId: msgId,
              sessionId,
              mirrorId: nextMirrorId(),
              rdkEventKind: "tool_progress",
              toolName,
              toolCallId: String(event.data?.toolCallId || ""),
              executor: String(event.data?.executor || (toolName === "board_openclaw_delegate" ? "board_openclaw" : "rdkclaw_local")),
            });
          }
        } else if (event.type === "tool_result") {
          const toolName = String(event.data?.name ?? event.data?.toolName ?? "unknown_tool");
          const executor = String(event.data?.executor || (toolName === "board_openclaw_delegate" ? "board_openclaw" : "rdkclaw_local"));
          const isError = Boolean(event.data?.isError);
          const resultStr = String(event.data?.result ?? "");
          this.publishMirror("channel_message_ack", "飞书流程", `${toolName} ${isError ? "失败" : "完成"}：${summarizeResult(resultStr)}`, {
            channel: "feishu",
            direction: "ack",
            openIdMasked,
            chatId,
            messageId: msgId,
            sessionId,
            mirrorId: nextMirrorId(),
            rdkEventKind: "tool_result",
            toolName,
            toolCallId: String(event.data?.toolCallId || ""),
            executor,
            isError,
          });
          if (resultStr.startsWith("{")) {
            try {
              const parsed = JSON.parse(resultStr) as Record<string, unknown>;
              if (parsed.__type === "image_download" && typeof parsed.localPath === "string") {
                pendingImages.push({
                  localPath: parsed.localPath as string,
                  fileName: String(parsed.fileName || "image"),
                });
              } else if (parsed.__type === "video_download" && typeof parsed.localPath === "string") {
                pendingFiles.push({
                  localPath: parsed.localPath as string,
                  fileName: String(parsed.fileName || "video.mp4"),
                });
              } else if (parsed.__type === "file_download" && typeof parsed.localPath === "string") {
                pendingFiles.push({
                  localPath: parsed.localPath as string,
                  fileName: String(parsed.fileName || "file"),
                });
              }
            } catch {
              // not JSON
            }
          }
        }
      }
    } catch (err: any) {
      const errMsg = `执行出错: ${err.message || "未知错误"}`;
      console.error(`[FeishuWS] streamChat error for ${openId.slice(0, 6)}***:`, err.message);
      await this.sendText(chatId, errMsg).catch(() => {});
      this.publishMirror("channel_message_error", "飞书错误", errMsg, {
        channel: "feishu",
        direction: "error",
        openIdMasked,
        chatId,
        messageId: msgId,
        sessionId,
      });
      return;
    }

    const streamed = chunks.join("").trim();
    const replyRaw = (finalText || streamed).trim() || "我已经执行完成，但未提取到可显示的文本结果。请让我重试并返回详细过程。";
    const reply = normalizeForFeishu(replyRaw);
    await this.sendText(chatId, reply);

    let imagesSent = 0;
    let filesSent = 0;
    for (const img of pendingImages) {
      try {
        if (fs.existsSync(img.localPath)) {
          const buffer = fs.readFileSync(img.localPath);
          const ext = nodePath.extname(img.localPath).toLowerCase();
          const mime = ext === ".png" ? "image/png"
            : ext === ".gif" ? "image/gif"
            : ext === ".webp" ? "image/webp"
            : "image/jpeg";
          const sent = await this.sendImageFromBuffer(chatId, buffer, mime);
          if (sent) imagesSent++;
        }
      } catch (err) {
        console.warn(`[FeishuWS] failed to send image ${img.fileName}:`, err instanceof Error ? err.message : err);
      }
    }

    for (const file of pendingFiles) {
      try {
        if (fs.existsSync(file.localPath)) {
          const buffer = fs.readFileSync(file.localPath);
          const ext = nodePath.extname(file.localPath).toLowerCase();
          const mime = ext === ".mp4" ? "video/mp4"
            : ext === ".webm" ? "video/webm"
            : ext === ".pdf" ? "application/pdf"
            : "application/octet-stream";
          const sent = await this.sendFileFromBuffer(chatId, buffer, file.fileName, mime);
          if (sent) filesSent++;
        }
      } catch (err) {
        console.warn(`[FeishuWS] failed to send file ${file.fileName}:`, err instanceof Error ? err.message : err);
      }
    }

    this.publishMirror("channel_message_outbound", "飞书回复", reply, {
      channel: "feishu",
      direction: "outbound",
      openIdMasked,
      chatId,
      messageId: msgId,
      sessionId,
    });
    console.log(`[FeishuWS] replied to ${openId.slice(0, 6)}***, chars=${reply.length}, tools=${toolCount}, images=${imagesSent}, files=${filesSent}`);
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

  private tryHandleApprovalReply(
    openId: string,
    chatId: string,
    text: string,
    openIdMasked: string,
  ): boolean {
    const pending = this.pendingApprovals.get(openId);
    if (!pending) return false;
    if (Date.now() - pending.createdAt > 300_000) {
      this.pendingApprovals.delete(openId);
      return false;
    }
    const result = matchTextApproval(text);
    if (!result.matched) return false;

    this.pendingApprovals.delete(openId);
    const success = this.rdkclaw.decideApproval(pending.approvalId, result.decision === "allow_once" ? "allow_once" : "deny");
    const label = result.decision === "allow_once" ? "已允许" : "已拒绝";
    console.log(`[FeishuWS] approval ${label} by ${openIdMasked}: ${pending.toolName} (${pending.approvalId})`);
    if (success) {
      this.sendText(chatId, `${label}执行 ${pending.toolName}`).catch(() => {});
    } else {
      this.sendText(chatId, "该审批已过期或已被处理").catch(() => {});
    }
    return true;
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

  private async uploadImage(imageBuffer: Buffer, mimeType?: string): Promise<string | null> {
    const cfg = this.getConfig();
    const authBase = authBaseByDomain(cfg.domain);
    const token = await this.getTenantToken();
    const ext = mimeType?.includes("png") ? ".png" : mimeType?.includes("gif") ? ".gif" : ".jpg";
    const blob = new Blob([imageBuffer], { type: mimeType || "image/png" });
    const formData = new FormData();
    formData.append("image_type", "message");
    formData.append("image", blob, `image${ext}`);
    const imgCtrl = new AbortController();
    const imgTimer = setTimeout(() => imgCtrl.abort(), 30_000);
    try {
      const res = await fetch(`${authBase}/open-apis/im/v1/images`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: imgCtrl.signal,
      });
      const payload = (await res.json().catch(() => ({}))) as {
        code?: number;
        data?: { image_key?: string };
      };
      if (payload.code === 0 && payload.data?.image_key) {
        return payload.data.image_key;
      }
      console.warn("[FeishuWS] uploadImage failed:", payload);
      return null;
    } catch (err) {
      console.warn("[FeishuWS] uploadImage error:", err instanceof Error ? err.message : err);
      return null;
    } finally {
      clearTimeout(imgTimer);
    }
  }

  private async sendImage(chatId: string, imageKey: string): Promise<void> {
    if (!this.client || !chatId || !imageKey) return;
    await this.client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "image",
        content: JSON.stringify({ image_key: imageKey }),
      },
    });
  }

  async sendImageFromBuffer(chatId: string, imageBuffer: Buffer, mimeType?: string): Promise<boolean> {
    const imageKey = await this.uploadImage(imageBuffer, mimeType);
    if (!imageKey) return false;
    await this.sendImage(chatId, imageKey);
    return true;
  }

  private async uploadFile(fileBuffer: Buffer, fileName: string, mimeType?: string): Promise<string | null> {
    const cfg = this.getConfig();
    const authBase = authBaseByDomain(cfg.domain);
    const token = await this.getTenantToken();
    const blob = new Blob([fileBuffer], { type: mimeType || "application/octet-stream" });
    const formData = new FormData();
    formData.append("file_type", "stream");
    formData.append("file_name", fileName);
    formData.append("file", blob, fileName);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await fetch(`${authBase}/open-apis/im/v1/files`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: ctrl.signal,
      });
      const payload = (await res.json().catch(() => ({}))) as {
        code?: number;
        data?: { file_key?: string };
      };
      if (payload.code === 0 && payload.data?.file_key) {
        return payload.data.file_key;
      }
      console.warn("[FeishuWS] uploadFile failed:", payload);
      return null;
    } catch (err) {
      console.warn("[FeishuWS] uploadFile error:", err instanceof Error ? err.message : err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async sendFileMessage(chatId: string, fileKey: string): Promise<void> {
    if (!this.client || !chatId || !fileKey) return;
    await this.client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "file",
        content: JSON.stringify({ file_key: fileKey }),
      },
    });
  }

  async sendFileFromBuffer(chatId: string, fileBuffer: Buffer, fileName: string, mimeType?: string): Promise<boolean> {
    const fileKey = await this.uploadFile(fileBuffer, fileName, mimeType);
    if (!fileKey) return false;
    await this.sendFileMessage(chatId, fileKey);
    return true;
  }
}
