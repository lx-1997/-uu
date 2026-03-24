import { RDKClawApp } from "../../rdkclaw/app.js";
import { WeixinAccountStore, type WeixinAccount } from "../../rdkclaw/weixin-account-store.js";
import type { WeixinRuntimeConfig } from "../../rdkclaw/weixin-config-store.js";
import { WeixinApiClient, type WeixinMessage, type WeixinMessageItem } from "../../rdkclaw/weixin-api-client.js";
import type { NotificationHub } from "../../rdkclaw/notification-hub.js";

type WeixinChannelOptions = {
  rdkclaw: RDKClawApp;
  accountStore: WeixinAccountStore;
  getConfig: () => WeixinRuntimeConfig;
  notificationHub?: NotificationHub;
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

function extractText(items: WeixinMessageItem[] | undefined): string {
  if (!items) return "";
  const parts: string[] = [];
  for (const item of items) {
    if (item.type === 1 && item.text_item?.text) {
      parts.push(item.text_item.text);
    } else if (item.type === 2) {
      parts.push("[图片]");
    } else if (item.type === 3) {
      parts.push("[语音]");
    } else if (item.type === 4) {
      const name = item.file_item?.file_name || "文件";
      parts.push(`[文件] ${name}`);
    } else if (item.type === 5) {
      parts.push("[视频]");
    }
  }
  return parts.join(" ").trim();
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

  private pollers = new Map<string, AccountPoller>();
  private started = false;

  constructor(opts: WeixinChannelOptions) {
    this.rdkclaw = opts.rdkclaw;
    this.accountStore = opts.accountStore;
    this.getConfig = opts.getConfig;
    this.notificationHub = opts.notificationHub;
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
    const text = extractText(msg.item_list);
    const tag = `[WeixinChannel:${poller.account.accountId.slice(0, 8)}]`;

    if (!text) {
      console.log(`${tag} skipping empty message from ${fromUserId.slice(0, 6)}***`);
      return;
    }

    const maskedUser = `${fromUserId.slice(0, 4)}***${fromUserId.slice(-4)}`;
    console.log(`${tag} inbound from ${maskedUser}: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`);

    this.publishMirror("channel_message_inbound", "微信消息",
      `来自 ${maskedUser}: ${text.slice(0, 200)}`, {
        channel: "weixin",
        direction: "inbound",
        fromUserId: maskedUser,
        accountId: poller.account.accountId,
      });

    if (cfg.ackOnReceive && cfg.ackStyle !== "off") {
      const ack = cfg.ackStyle === "emoji" ? "👌" : "已收到，正在处理...";
      await poller.client.sendText(fromUserId, contextToken, ack).catch(() => {});
    }

    let typingTicket: string | undefined;
    try {
      const configRes = await poller.client.getConfig(fromUserId, contextToken);
      if (configRes.ret === 0 && configRes.typing_ticket) {
        typingTicket = configRes.typing_ticket;
        poller.typingTickets.set(fromUserId, typingTicket);
      }
    } catch {
      typingTicket = poller.typingTickets.get(fromUserId);
    }

    if (typingTicket) {
      poller.client.sendTyping(fromUserId, typingTicket, 1).catch(() => {});
    }

    const sessionId = `weixin:${fromUserId}`;
    const chunks: string[] = [];
    let finalText = "";

    try {
      for await (const event of this.rdkclaw.streamChat({
        message: text,
        userId: fromUserId,
        sessionId,
        mode: "board-preferred",
      })) {
        if (event.type === "text") {
          const delta = String(event.data?.delta ?? event.data?.text ?? "");
          if (delta) chunks.push(delta);
        } else if (event.type === "message_end") {
          finalText = String(event.data?.text ?? "").trim();
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

    const streamed = chunks.join("").trim();
    const replyRaw = (finalText || streamed).trim()
      || "已执行完成，但未提取到可显示的文本结果。";
    const reply = normalizeForWeixin(replyRaw);

    let remaining = reply;
    while (remaining.length > 0) {
      const chunk = remaining.slice(0, WEIXIN_MAX_TEXT);
      remaining = remaining.slice(WEIXIN_MAX_TEXT);
      await poller.client.sendText(fromUserId, contextToken, chunk).catch((err) => {
        console.error(`${tag} sendText error:`, err instanceof Error ? err.message : err);
      });
    }

    this.publishMirror("channel_message_outbound", "微信回复",
      reply.slice(0, 200), {
        channel: "weixin",
        direction: "outbound",
        fromUserId: maskedUser,
        accountId: poller.account.accountId,
      });
    console.log(`${tag} replied to ${maskedUser}, chars=${reply.length}`);
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
