import fs from "node:fs";
import path from "node:path";
import { RDKClawApp } from "../../rdkclaw/app.js";
import { WeixinAccountStore, type WeixinAccount } from "../../rdkclaw/weixin-account-store.js";
import type { WeixinRuntimeConfig } from "../../rdkclaw/weixin-config-store.js";
import { WeixinApiClient, type WeixinMessage } from "../../rdkclaw/weixin-api-client.js";
import { extractAttachments } from "../../rdkclaw/weixin-media.js";
import { FeishuAuthStore } from "../../rdkclaw/feishu-auth-store.js";
import type { NotificationHub } from "../../rdkclaw/notification-hub.js";
import { readDevices } from "../../storage.js";

type WeixinChannelOptions = {
  rdkclaw: RDKClawApp;
  accountStore: WeixinAccountStore;
  getConfig: () => WeixinRuntimeConfig;
  notificationHub?: NotificationHub;
  feishuAuthStore?: FeishuAuthStore;
};

export type WeixinRuntimeStatus = {
  running: boolean;
  accountCount: number;
  lastPollAt: number | null;
  lastError: string | null;
};

const WEIXIN_MAX_TEXT = 4000;
const MIN_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 60_000;

const IMG_EXT = "png|jpe?g|gif|bmp|webp";
const VID_EXT = "mp4|webm|avi|mov|mkv";
const MEDIA_EXT = `${IMG_EXT}|${VID_EXT}`;
const MD_MEDIA_RE = new RegExp(`!\\[[^\\]]*\\]\\(([^)]+\\.(?:${MEDIA_EXT}))\\)`, "gi");
const LOCAL_PATH_RE = new RegExp(
  `(?:^|[\\s"'：])([A-Za-z]:[\\\\\/][\\w.\\-\\\\\/]+\\.(?:${MEDIA_EXT})|\/[\\w.\\-\/]+\\.(?:${MEDIA_EXT}))`,
  "gi",
);
const IMAGE_EXT_SET = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp"]);
const VIDEO_EXT_SET = new Set(["mp4", "webm", "avi", "mov", "mkv"]);

interface MediaPath { path: string; kind: "image" | "video" }

function extractMediaPathsFromResult(raw: string): MediaPath[] {
  const out: MediaPath[] = [];
  try {
    const obj = JSON.parse(raw);
    if (obj?.__type === "image_download" && obj.localPath) {
      out.push({ path: String(obj.localPath), kind: "image" });
    } else if (obj?.__type === "video_download" && obj.localPath) {
      out.push({ path: String(obj.localPath), kind: "video" });
    }
  } catch {
    for (const m of raw.matchAll(LOCAL_PATH_RE)) {
      const ext = m[1].split(".").pop()?.toLowerCase() || "";
      out.push({ path: m[1], kind: VIDEO_EXT_SET.has(ext) ? "video" : "image" });
    }
  }
  return out;
}

function classifyExt(filePath: string): "image" | "video" | null {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXT_SET.has(ext)) return "image";
  if (VIDEO_EXT_SET.has(ext)) return "video";
  return null;
}

function normalizeForWeixin(text: string): string {
  const raw = String(text || "").trim();
  if (!raw) return "";
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

interface AccountPoller {
  account: WeixinAccount;
  client: WeixinApiClient;
  syncBuf: string;
  running: boolean;
  abortController: AbortController;
  retryDelay: number;
  lastPollAt: number | null;
  lastError: string | null;
  typingTickets: Map<string, string>;
}

export class WeixinPollingChannel {
  private rdkclaw: RDKClawApp;
  private accountStore: WeixinAccountStore;
  private getConfig: () => WeixinRuntimeConfig;
  private notificationHub?: NotificationHub;
  private feishuAuthStore?: FeishuAuthStore;

  private pollers = new Map<string, AccountPoller>();
  private started = false;

  constructor(opts: WeixinChannelOptions) {
    this.rdkclaw = opts.rdkclaw;
    this.accountStore = opts.accountStore;
    this.getConfig = opts.getConfig;
    this.notificationHub = opts.notificationHub;
    this.feishuAuthStore = opts.feishuAuthStore;
  }

  getStatus(): WeixinRuntimeStatus {
    let lastPollAt: number | null = null;
    let lastError: string | null = null;
    for (const poller of this.pollers.values()) {
      if (poller.lastPollAt && (!lastPollAt || poller.lastPollAt > lastPollAt)) {
        lastPollAt = poller.lastPollAt;
      }
      if (poller.lastError) lastError = poller.lastError;
    }
    return {
      running: this.started,
      accountCount: this.pollers.size,
      lastPollAt,
      lastError,
    };
  }

  start() {
    if (this.started) return;
    this.started = true;
    const accounts = this.accountStore.listAccounts();
    console.log(`[WeixinChannel] starting with ${accounts.length} account(s)`);
    for (const account of accounts) {
      this.startPoller(account);
    }
  }

  stop() {
    this.started = false;
    for (const poller of this.pollers.values()) {
      poller.running = false;
      poller.abortController.abort();
    }
    this.pollers.clear();
    console.log("[WeixinChannel] stopped");
  }

  restart() {
    this.stop();
    this.start();
  }

  addAccount(account: WeixinAccount) {
    if (this.pollers.has(account.accountId)) {
      const existing = this.pollers.get(account.accountId)!;
      existing.running = false;
      existing.abortController.abort();
      this.pollers.delete(account.accountId);
    }
    if (this.started) {
      this.startPoller(account);
    }
  }

  removeAccount(accountId: string) {
    const poller = this.pollers.get(accountId);
    if (poller) {
      poller.running = false;
      poller.abortController.abort();
      this.pollers.delete(accountId);
    }
  }

  private startPoller(account: WeixinAccount) {
    const client = new WeixinApiClient(account.token, account.baseUrl);
    const poller: AccountPoller = {
      account,
      client,
      syncBuf: "",
      running: true,
      abortController: new AbortController(),
      retryDelay: MIN_RETRY_DELAY_MS,
      lastPollAt: null,
      lastError: null,
      typingTickets: new Map(),
    };
    this.pollers.set(account.accountId, poller);
    this.pollLoop(poller);
  }

  private async pollLoop(poller: AccountPoller) {
    const tag = `[WeixinChannel:${poller.account.accountId.slice(0, 8)}]`;
    console.log(`${tag} polling started`);

    while (poller.running && this.started) {
      try {
        const res = await poller.client.getUpdates(poller.syncBuf, poller.abortController.signal);
        poller.lastPollAt = Date.now();

        if (res.errcode === -14) {
          poller.lastError = "会话超时，需要重新登录";
          console.warn(`${tag} session expired (errcode -14)`);
          this.publishMirror("channel_message_error", "微信会话过期",
            `微信账号 ${poller.account.nickname || poller.account.accountId} 会话已过期，请重新扫码绑定。`);
          poller.running = false;
          break;
        }

        if (res.ret !== undefined && res.ret !== 0) {
          poller.lastError = res.errmsg || `ret=${res.ret}`;
          console.warn(`${tag} getUpdates error: ret=${res.ret} errmsg=${res.errmsg || ""}`);
          await this.delay(poller);
          continue;
        }

        poller.lastError = null;
        poller.retryDelay = MIN_RETRY_DELAY_MS;

        const syncBuf = res.get_updates_buf || (res as any).sync_buf || "";
        if (syncBuf) {
          poller.syncBuf = syncBuf;
        }

        const msgs = res.msgs || [];
        for (const msg of msgs) {
          if (msg.message_type !== 1) continue; // only process USER messages
          if (!msg.from_user_id) continue;
          this.handleMessage(poller, msg).catch((err) => {
            console.error(`${tag} handleMessage error:`, err instanceof Error ? err.message : err);
          });
        }
      } catch (err: any) {
        if (err.name === "AbortError") break;
        poller.lastError = err.message || "unknown poll error";
        console.error(`${tag} poll error:`, err.message || err);
        await this.delay(poller);
      }
    }

    console.log(`${tag} polling stopped`);
  }

  private async delay(poller: AccountPoller) {
    const ms = poller.retryDelay;
    poller.retryDelay = Math.min(poller.retryDelay * 2, MAX_RETRY_DELAY_MS);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      poller.abortController.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  private async handleMessage(poller: AccountPoller, msg: WeixinMessage) {
    const cfg = this.getConfig();
    if (!cfg.enabled) return;

    const fromUserId = msg.from_user_id!;
    const contextToken = msg.context_token || "";
    const tag = `[WeixinChannel:${poller.account.accountId.slice(0, 8)}]`;

    const { text, attachments } = await extractAttachments(poller.client, msg.item_list);

    const hasContent = text || attachments.length > 0;
    if (!hasContent) {
      console.log(`${tag} skipping empty message from ${fromUserId.slice(0, 6)}***`);
      return;
    }

    const hasVoice = attachments.some(a => a.type === "audio");
    const hasImage = attachments.some(a => a.type === "image");
    const displayText = text || (hasVoice ? "(语音消息)" : hasImage ? "(图片)" : "(媒体消息)");

    const maskedUser = `${fromUserId.slice(0, 4)}***${fromUserId.slice(-4)}`;
    const mediaTag = attachments.length ? ` +${attachments.length}附件` : "";
    console.log(`${tag} inbound from ${maskedUser}: ${displayText.slice(0, 80)}${mediaTag}`);

    this.publishMirror("channel_message_inbound", "微信消息",
      `来自 ${maskedUser}: ${displayText.slice(0, 200)}${mediaTag}`, {
        channel: "weixin",
        direction: "inbound",
        fromUserId: maskedUser,
        accountId: poller.account.accountId,
      });

    if (cfg.ackOnReceive && cfg.ackStyle !== "off") {
      const ack = cfg.ackStyle === "emoji" ? "👌" : "小地瓜正在为您服务...";
      await poller.client.sendText(fromUserId, contextToken, ack).catch(() => {});
    }

    let typingTicket: string | undefined;
    try {
      const configRes = await poller.client.getConfig(fromUserId, contextToken);
      if ((configRes.ret === undefined || configRes.ret === 0) && configRes.typing_ticket) {
        typingTicket = configRes.typing_ticket;
        poller.typingTickets.set(fromUserId, typingTicket);
      }
    } catch {
      typingTicket = poller.typingTickets.get(fromUserId);
    }

    if (typingTicket) {
      poller.client.sendTyping(fromUserId, typingTicket, 1).catch(() => {});
    }

    const fallbackSessionId = `weixin:${fromUserId}`;
    const latestUiSessionId = this.feishuAuthStore?.getLatestUiSession() || "";
    const sessionId = latestUiSessionId || fallbackSessionId;

    let deviceId = this.feishuAuthStore?.getLatestUiDevice() || "";
    deviceId = await this.resolveDeviceId(deviceId);

    if (!deviceId) {
      console.log(`${tag} no connected device, proceeding without deviceId`);
    }

    const chunks: string[] = [];
    let finalText = "";
    const mediaPaths: MediaPath[] = [];

    try {
      for await (const event of this.rdkclaw.streamChat({
        message: displayText,
        userId: fromUserId,
        sessionId,
        deviceId: deviceId || undefined,
        mode: deviceId ? "board-preferred" : "local",
        attachments: attachments.length > 0 ? attachments : undefined,
      })) {
        if (event.type === "text") {
          const delta = String(event.data?.delta ?? event.data?.text ?? "");
          if (delta) chunks.push(delta);
        } else if (event.type === "message_end") {
          finalText = String(event.data?.text ?? "").trim();
        } else if (event.type === "tool_result") {
          const result = String(event.data?.result ?? "");
          for (const mp of extractMediaPathsFromResult(result)) {
            if (fs.existsSync(mp.path)) mediaPaths.push(mp);
          }
        } else if (event.type === "error") {
          const errorMsg = String(event.data?.error ?? "RDKClaw 执行失败");
          if (!chunks.length) chunks.push(errorMsg);
        }
      }
    } catch (err: any) {
      const errMsg = `执行出错: ${err.message || "未知错误"}`;
      console.error(`${tag} streamChat error for ${maskedUser}:`, err.message);
      await poller.client.sendText(fromUserId, contextToken, errMsg).catch(() => {});
      if (typingTicket) {
        poller.client.sendTyping(fromUserId, typingTicket, 2).catch(() => {});
      }
      return;
    }

    if (typingTicket) {
      poller.client.sendTyping(fromUserId, typingTicket, 2).catch(() => {});
    }

    // Collect media paths from tool results + final text
    const streamed = chunks.join("").trim();
    const replyRaw = (finalText || streamed).trim();

    // Also scan the text reply for markdown images and local paths
    const seen = new Set(mediaPaths.map(mp => mp.path.toLowerCase()));
    for (const re of [MD_MEDIA_RE, LOCAL_PATH_RE]) {
      re.lastIndex = 0;
      for (const m of replyRaw.matchAll(re)) {
        let p = m[1];
        if (p.startsWith("/api/local-files/")) {
          const basename = path.basename(decodeURIComponent(p.replace("/api/local-files/", "")));
          const workDir = process.env.RDK_WORKSPACE_DIR || process.cwd();
          const candidates = [
            path.join(workDir, "workspace", "downloads", basename),
            path.join(workDir, "downloads", basename),
          ];
          p = candidates.find(c => fs.existsSync(c)) || p;
        }
        if (!seen.has(p.toLowerCase()) && fs.existsSync(p)) {
          const kind = classifyExt(p) || "image";
          mediaPaths.push({ path: p, kind });
          seen.add(p.toLowerCase());
        }
      }
    }

    // Send media via CDN
    for (const mp of mediaPaths) {
      try {
        const buf = fs.readFileSync(mp.path);
        if (mp.kind === "video") {
          const uploaded = await poller.client.uploadMedia(fromUserId, buf, 2);
          await poller.client.sendVideo(fromUserId, contextToken, uploaded);
          console.log(`${tag} sent video to ${maskedUser}: ${mp.path}`);
        } else {
          const uploaded = await poller.client.uploadMedia(fromUserId, buf, 1);
          await poller.client.sendImage(fromUserId, contextToken, uploaded);
          console.log(`${tag} sent image to ${maskedUser}: ${mp.path}`);
        }
      } catch (err) {
        console.warn(`${tag} uploadMedia failed for ${mp.path}:`, (err as Error).message);
      }
    }

    // Strip markdown media references from text before sending
    let cleanText = replyRaw;
    if (mediaPaths.length > 0) {
      cleanText = cleanText
        .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
        .replace(/本地路径[：:]\s*\S+\.(png|jpe?g|gif|bmp|webp|mp4|webm|avi|mov|mkv)/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    const reply = normalizeForWeixin(cleanText)
      || (mediaPaths.length > 0 ? "" : "已执行完成，但未提取到可显示的文本结果。");

    if (reply) {
      let remaining = reply;
      while (remaining.length > 0) {
        const chunk = remaining.slice(0, WEIXIN_MAX_TEXT);
        remaining = remaining.slice(WEIXIN_MAX_TEXT);
        await poller.client.sendText(fromUserId, contextToken, chunk).catch((err) => {
          console.error(`${tag} sendText error:`, err instanceof Error ? err.message : err);
        });
      }
    }

    const imgCount = mediaPaths.filter(m => m.kind === "image").length;
    const vidCount = mediaPaths.filter(m => m.kind === "video").length;
    const mediaSummary = [imgCount && `${imgCount}图`, vidCount && `${vidCount}视频`].filter(Boolean).join("+");
    this.publishMirror("channel_message_outbound", "微信回复",
      (reply || `[${mediaSummary}]`).slice(0, 200), {
        channel: "weixin",
        direction: "outbound",
        fromUserId: maskedUser,
        accountId: poller.account.accountId,
      });
    console.log(`${tag} replied to ${maskedUser}, chars=${reply.length} media=${mediaPaths.length}(img=${imgCount} vid=${vidCount})`);
  }

  private async resolveDeviceId(latestUiDeviceId: string): Promise<string> {
    try {
      const devices = await readDevices();
      if (latestUiDeviceId) {
        const exact = devices.find(d => d.id === latestUiDeviceId && d.status === "connected");
        if (exact) return latestUiDeviceId;
      }
      const connected = devices.find(d => d.status === "connected");
      return connected?.id || "";
    } catch {
      return latestUiDeviceId || "";
    }
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
    });
  }
}
