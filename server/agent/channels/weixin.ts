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
import { matchTextApproval } from "../../rdkclaw/channel-safety.js";

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
const DOC_EXT = "docx?|xlsx?|pptx?|pdf|csv|txt|md|zip|rar|7z";
const ALL_EXT = `${IMG_EXT}|${VID_EXT}|${DOC_EXT}`;
const MD_MEDIA_RE = new RegExp(`!\\[[^\\]]*\\]\\(([^)]+\\.(?:${ALL_EXT}))\\)`, "gi");
const LOCAL_PATH_RE = new RegExp(
  `(?:^|[\\s"'：])([A-Za-z]:[\\\\\/][\\w.\\-\\\\\/]+\\.(?:${ALL_EXT})|\/[\\w.\\-\/]+\\.(?:${ALL_EXT}))`,
  "gi",
);
const IMAGE_EXT_SET = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp"]);
const VIDEO_EXT_SET = new Set(["mp4", "webm", "avi", "mov", "mkv"]);
const DOC_EXT_SET = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf", "csv", "txt", "md", "zip", "rar", "7z"]);

type FileKind = "image" | "video" | "document";
interface MediaPath { path: string; kind: FileKind }

function extractMediaPathsFromResult(raw: string): MediaPath[] {
  const out: MediaPath[] = [];
  try {
    const obj = JSON.parse(raw);
    if (obj?.__type === "image_download" && obj.localPath) {
      out.push({ path: String(obj.localPath), kind: "image" });
    } else if (obj?.__type === "video_download" && obj.localPath) {
      out.push({ path: String(obj.localPath), kind: "video" });
    } else if (obj?.localPath) {
      const kind = classifyExt(String(obj.localPath));
      if (kind) out.push({ path: String(obj.localPath), kind });
    }
  } catch {
    for (const m of raw.matchAll(LOCAL_PATH_RE)) {
      const ext = m[1].split(".").pop()?.toLowerCase() || "";
      const kind: FileKind = VIDEO_EXT_SET.has(ext) ? "video"
        : DOC_EXT_SET.has(ext) ? "document" : "image";
      out.push({ path: m[1], kind });
    }
  }
  return out;
}

function classifyExt(filePath: string): FileKind | null {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXT_SET.has(ext)) return "image";
  if (VIDEO_EXT_SET.has(ext)) return "video";
  if (DOC_EXT_SET.has(ext)) return "document";
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

interface PendingChannelApproval {
  approvalId: string;
  toolName: string;
  risk: string;
  args: Record<string, unknown>;
  fromUserId: string;
  contextToken: string;
  createdAt: number;
}

export interface WeixinRecentUser {
  userId: string;
  maskedId: string;
  contextToken: string;
  accountId: string;
  lastMessageText: string;
  lastSeenAt: number;
}

export class WeixinPollingChannel {
  private rdkclaw: RDKClawApp;
  private accountStore: WeixinAccountStore;
  private getConfig: () => WeixinRuntimeConfig;
  private notificationHub?: NotificationHub;
  private feishuAuthStore?: FeishuAuthStore;

  private pollers = new Map<string, AccountPoller>();
  private started = false;

  private pendingApprovals = new Map<string, PendingChannelApproval>();
  private recentUsers = new Map<string, WeixinRecentUser>();
  private static readonly MAX_RECENT_USERS = 50;

  constructor(opts: WeixinChannelOptions) {
    this.rdkclaw = opts.rdkclaw;
    this.accountStore = opts.accountStore;
    this.getConfig = opts.getConfig;
    this.notificationHub = opts.notificationHub;
    this.feishuAuthStore = opts.feishuAuthStore;
  }

  getRecentUsers(): WeixinRecentUser[] {
    return Array.from(this.recentUsers.values())
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  async sendToUser(userId: string, text: string): Promise<boolean> {
    const user = this.recentUsers.get(userId);
    if (!user) return false;
    const poller = this.pollers.get(user.accountId);
    if (!poller) return false;
    try {
      await poller.client.sendText(userId, user.contextToken, text);
      return true;
    } catch (err) {
      console.warn(`[WeixinChannel] sendToUser failed:`, (err as Error).message);
      return false;
    }
  }

  private recordRecentUser(
    userId: string,
    contextToken: string,
    accountId: string,
    maskedId: string,
    lastMessageText: string,
  ) {
    this.recentUsers.set(userId, {
      userId,
      maskedId,
      contextToken,
      accountId,
      lastMessageText: lastMessageText.slice(0, 500),
      lastSeenAt: Date.now(),
    });
    const max = WeixinPollingChannel.MAX_RECENT_USERS;
    if (this.recentUsers.size <= max) return;
    const entries = [...this.recentUsers.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
    while (this.recentUsers.size > max && entries.length) {
      const [k] = entries.shift()!;
      this.recentUsers.delete(k);
    }
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

    this.recordRecentUser(fromUserId, contextToken, poller.account.accountId, maskedUser, displayText);

    if (text && this.tryHandleApprovalReply(poller, fromUserId, contextToken, text, tag, maskedUser)) {
      return;
    }

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

    let deviceId = this.feishuAuthStore?.getLatestUiDevice() || "";
    deviceId = await this.resolveDeviceId(deviceId);

    if (!deviceId) {
      console.log(`${tag} no connected device, proceeding without deviceId`);
      await poller.client.sendText(fromUserId, contextToken,
        "当前无 RDK 设备连接，板端操作暂不可用，其他功能正常。").catch(() => {});
    }

    const chunks: string[] = [];
    let finalText = "";
    const mediaPaths: MediaPath[] = [];

    try {
      for await (const event of this.rdkclaw.streamChat({
        message: displayText,
        userId: fromUserId,
        deviceId: deviceId || undefined,
        mode: deviceId ? "board-preferred" : "local",
        attachments: attachments.length > 0 ? attachments : undefined,
        channel: "weixin",
      })) {
        if (event.type === "queue_status") {
          const pos = Number(event.data?.position ?? 0);
          const current = String(event.data?.currentTask ?? "");
          const hint = pos > 0
            ? `当前设备正在处理其他任务${current ? `（${current}）` : ""}，你的请求排在第 ${pos} 位，请稍候...`
            : "正在排队中，请稍候...";
          await poller.client.sendText(fromUserId, contextToken, hint).catch(() => {});
          continue;
        }
        if (event.type === "text") {
          const delta = String(event.data?.delta ?? event.data?.text ?? "");
          if (delta) chunks.push(delta);
        } else if (event.type === "message_end") {
          finalText = String(event.data?.text ?? "").trim();
        } else if (event.type === "tool_start") {
          const toolName = String(event.data?.name ?? event.data?.toolName ?? "unknown_tool");
          const executor = String(event.data?.executor || (toolName === "board_openclaw_delegate" ? "board_openclaw" : "rdkclaw_local"));
          this.publishMirror("channel_message_ack", "微信流程", `开始执行工具：${toolName}`, {
            channel: "weixin", direction: "ack", fromUserId: maskedUser,
            rdkEventKind: "tool_start", toolName, executor,
          });
        } else if (event.type === "tool_progress") {
          const toolName = String(event.data?.name ?? event.data?.toolName ?? "unknown_tool");
          const chunk = String(event.data?.chunk || "").trim();
          if (chunk) {
            const previewLine = chunk.split("\n").map((l) => l.trim()).filter(Boolean).slice(-1)[0] || chunk;
            this.publishMirror("channel_message_ack", "微信流程", `${toolName}: ${previewLine.slice(0, 200)}`, {
              channel: "weixin", direction: "ack", fromUserId: maskedUser,
              rdkEventKind: "tool_progress", toolName,
            });
          }
        } else if (event.type === "tool_result") {
          const toolName = String(event.data?.name ?? event.data?.toolName ?? "unknown_tool");
          const isError = Boolean(event.data?.isError);
          const result = String(event.data?.result ?? "");
          this.publishMirror("channel_message_ack", "微信流程", `${toolName} ${isError ? "失败" : "完成"}`, {
            channel: "weixin", direction: "ack", fromUserId: maskedUser,
            rdkEventKind: "tool_result", toolName, isError,
          });
          for (const mp of extractMediaPathsFromResult(result)) {
            if (fs.existsSync(mp.path)) mediaPaths.push(mp);
          }
        } else if (event.type === "approval_required") {
          const approvalId = String(event.data?.approvalId ?? "");
          const toolName = String(event.data?.toolName ?? "");
          const risk = String(event.data?.risk ?? "medium");
          const args = (event.data?.args as Record<string, unknown>) || {};
          if (approvalId) {
            this.pendingApprovals.set(fromUserId, {
              approvalId, toolName, risk, args,
              fromUserId, contextToken,
              createdAt: Date.now(),
            });
            const argsPreview = Object.entries(args)
              .slice(0, 3)
              .map(([k, v]) => `  ${k}: ${String(v).slice(0, 60)}`)
              .join("\n");
            const promptText = [
              `⚠️ 需要你的确认`,
              `工具: ${toolName}`,
              `风险: ${risk}`,
              argsPreview ? `参数:\n${argsPreview}` : "",
              `\n回复「允许」执行，或「拒绝」取消`,
            ].filter(Boolean).join("\n");
            await poller.client.sendText(fromUserId, contextToken, promptText).catch(() => {});
            console.log(`${tag} sent approval prompt to ${maskedUser} for ${toolName} (${approvalId})`);
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

    // Send media/documents via CDN
    for (const mp of mediaPaths) {
      try {
        const buf = fs.readFileSync(mp.path);
        if (mp.kind === "video") {
          const uploaded = await poller.client.uploadMedia(fromUserId, buf, 2);
          await poller.client.sendVideo(fromUserId, contextToken, uploaded);
          console.log(`${tag} sent video to ${maskedUser}: ${mp.path}`);
        } else if (mp.kind === "document") {
          const uploaded = await poller.client.uploadMedia(fromUserId, buf, 3);
          await poller.client.sendFile(fromUserId, contextToken, uploaded, path.basename(mp.path));
          console.log(`${tag} sent file to ${maskedUser}: ${mp.path}`);
        } else {
          const uploaded = await poller.client.uploadMedia(fromUserId, buf, 1);
          await poller.client.sendImage(fromUserId, contextToken, uploaded);
          console.log(`${tag} sent image to ${maskedUser}: ${mp.path}`);
        }
      } catch (err) {
        console.warn(`${tag} uploadMedia failed for ${mp.path}:`, (err as Error).message);
      }
    }

    // Strip markdown media/file references from text before sending
    let cleanText = replyRaw;
    if (mediaPaths.length > 0) {
      cleanText = cleanText
        .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
        .replace(/本地路径[：:]\s*\S+\.(png|jpe?g|gif|bmp|webp|mp4|webm|avi|mov|mkv|docx?|xlsx?|pptx?|pdf|csv|txt|md|zip|rar|7z)/gi, "")
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
    const docCount = mediaPaths.filter(m => m.kind === "document").length;
    const mediaSummary = [imgCount && `${imgCount}图`, vidCount && `${vidCount}视频`, docCount && `${docCount}文件`].filter(Boolean).join("+");
    this.publishMirror("channel_message_outbound", "微信回复",
      (reply || `[${mediaSummary}]`).slice(0, 200), {
        channel: "weixin",
        direction: "outbound",
        fromUserId: maskedUser,
        accountId: poller.account.accountId,
      });
    console.log(`${tag} replied to ${maskedUser}, chars=${reply.length} media=${mediaPaths.length}(img=${imgCount} vid=${vidCount} doc=${docCount})`);
  }

  private tryHandleApprovalReply(
    poller: AccountPoller,
    fromUserId: string,
    contextToken: string,
    text: string,
    tag: string,
    maskedUser: string,
  ): boolean {
    const pending = this.pendingApprovals.get(fromUserId);
    if (!pending) return false;

    if (Date.now() - pending.createdAt > 300_000) {
      this.pendingApprovals.delete(fromUserId);
      return false;
    }

    const result = matchTextApproval(text);
    if (!result.matched) return false;

    this.pendingApprovals.delete(fromUserId);
    const success = this.rdkclaw.decideApproval(pending.approvalId, result.decision === "allow_once" ? "allow_once" : "deny");
    const label = result.decision === "allow_once" ? "已允许" : "已拒绝";
    console.log(`${tag} approval ${label} by ${maskedUser}: ${pending.toolName} (${pending.approvalId})`);

    if (success) {
      poller.client.sendText(fromUserId, contextToken,
        `${label}执行 ${pending.toolName}`).catch(() => {});
    } else {
      poller.client.sendText(fromUserId, contextToken,
        "该审批已过期或已被处理").catch(() => {});
    }

    this.publishMirror("channel_message_inbound", "微信审批",
      `${maskedUser} ${label} ${pending.toolName}`, {
        channel: "weixin",
        direction: "inbound",
        fromUserId: maskedUser,
        accountId: poller.account.accountId,
      });

    return true;
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
