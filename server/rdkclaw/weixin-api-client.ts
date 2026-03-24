import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const DEFAULT_ILINK_BASE = "https://ilinkai.weixin.qq.com";
const WEIXIN_CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";
const LONGPOLL_TIMEOUT_MS = 35_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const CDN_TIMEOUT_MS = 30_000;

export interface WeixinMessageItem {
  type: number; // 1=TEXT, 2=IMAGE, 3=VOICE, 4=FILE, 5=VIDEO
  text_item?: { text: string };
  image_item?: { cdn_media?: CdnMedia };
  voice_item?: { cdn_media?: CdnMedia; duration_ms?: number };
  file_item?: { cdn_media?: CdnMedia; file_name?: string; file_size?: number };
  video_item?: { cdn_media?: CdnMedia; thumb_cdn_media?: CdnMedia };
  ref_msg?: { message_id?: number; from_user_id?: string; item_list?: WeixinMessageItem[] };
}

export interface CdnMedia {
  encrypt_query_param?: string;
  aes_key?: string;
}

export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number; // 1=USER, 2=BOT
  message_state?: number; // 0=NEW, 1=GENERATING, 2=FINISH
  item_list?: WeixinMessageItem[];
  context_token?: string;
}

export interface GetUpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  sync_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageResponse {
  ret: number;
  errcode?: number;
  errmsg?: string;
}

export interface GetConfigResponse {
  ret?: number;
  typing_ticket?: string;
}

export interface GetUploadUrlResponse {
  ret?: number;
  errmsg?: string;
  upload_param?: UploadParam;
  thumb_upload_param?: UploadParam;
}

export interface UploadParam {
  upload_url?: string;
  encrypt_query_param?: string;
}

export const MediaType = { IMAGE: 1, VIDEO: 2, FILE: 3 } as const;

function aesEcbEncrypt(data: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function aesEcbDecrypt(data: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function randomUin(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const view = new DataView(buf.buffer);
  const val = view.getUint32(0, true);
  return Buffer.from(String(val)).toString("base64");
}

function randomClientId(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}

export class WeixinApiClient {
  private token: string;
  private baseUrl: string;
  private uin: string;

  constructor(token: string, baseUrl?: string) {
    this.token = token;
    this.baseUrl = (baseUrl || DEFAULT_ILINK_BASE).replace(/\/+$/, "");
    this.uin = randomUin();
  }

  updateToken(token: string) {
    this.token = token;
  }

  isConfigured() {
    return !!this.token;
  }

  private api(path: string): string {
    return `${this.baseUrl}/ilink/bot/${path}`;
  }

  private static BASE_INFO = { channel_version: "rdkstudio" };

  private buildHeaders(body: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body, "utf-8")),
      AuthorizationType: "ilink_bot_token",
      Authorization: `Bearer ${this.token}`,
      "X-WECHAT-UIN": this.uin,
    };
  }

  private async post<T>(endpoint: string, payload: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    const bodyWithInfo = { ...payload, base_info: WeixinApiClient.BASE_INFO };
    const bodyStr = JSON.stringify(bodyWithInfo);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    try {
      const res = await fetch(this.api(endpoint), {
        method: "POST",
        headers: this.buildHeaders(bodyStr),
        body: bodyStr,
        signal: combinedSignal,
      });
      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`Invalid JSON from ${endpoint}: ${text.slice(0, 200)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async getUpdates(syncBuf: string, signal?: AbortSignal): Promise<GetUpdatesResponse> {
    return this.post<GetUpdatesResponse>("getupdates", {
      get_updates_buf: syncBuf || "",
    }, LONGPOLL_TIMEOUT_MS + 5_000, signal);
  }

  async sendMessage(
    toUserId: string,
    contextToken: string,
    items: WeixinMessageItem[],
    state: 1 | 2 = 2,
  ): Promise<SendMessageResponse> {
    const res = await this.post<SendMessageResponse>("sendmessage", {
      msg: {
        to_user_id: toUserId,
        client_id: randomClientId(),
        message_type: 2,
        message_state: state,
        context_token: contextToken,
        item_list: items,
      },
    }, DEFAULT_TIMEOUT_MS);
    if (res.ret !== undefined && res.ret !== 0) {
      console.warn(`[WeixinApiClient] sendMessage failed: ret=${res.ret} errmsg=${res.errmsg || ""}`);
    }
    return res;
  }

  async sendText(toUserId: string, contextToken: string, text: string) {
    return this.sendMessage(toUserId, contextToken, [
      { type: 1, text_item: { text } },
    ]);
  }

  async sendTyping(userId: string, ticket: string, status: 1 | 2): Promise<void> {
    await this.post<unknown>("sendtyping", {
      ilink_user_id: userId,
      typing_ticket: ticket,
      status,
    }, DEFAULT_TIMEOUT_MS);
  }

  async getConfig(userId: string, contextToken?: string): Promise<GetConfigResponse> {
    const payload: Record<string, string> = { ilink_user_id: userId };
    if (contextToken) payload.context_token = contextToken;
    return this.post<GetConfigResponse>("getconfig", payload, 10_000);
  }

  // ── CDN media download ──

  async downloadMedia(cdnMedia: CdnMedia): Promise<Buffer> {
    if (!cdnMedia.encrypt_query_param || !cdnMedia.aes_key) {
      throw new Error("CdnMedia missing encrypt_query_param or aes_key");
    }
    const url = `${WEIXIN_CDN_BASE}?${cdnMedia.encrypt_query_param}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CDN_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`CDN download failed: ${res.status}`);
      const encrypted = Buffer.from(await res.arrayBuffer());
      const key = Buffer.from(cdnMedia.aes_key, "base64");
      return aesEcbDecrypt(encrypted, key);
    } finally {
      clearTimeout(timer);
    }
  }

  // ── CDN media upload ──

  async getUploadUrl(
    mediaType: (typeof MediaType)[keyof typeof MediaType],
    rawSize: number,
    rawMd5: string,
    encSize: number,
  ): Promise<GetUploadUrlResponse> {
    return this.post<GetUploadUrlResponse>("getuploadurl", {
      media_type: mediaType,
      rawsize: rawSize,
      rawfilemd5: rawMd5,
      filesize: encSize,
    }, DEFAULT_TIMEOUT_MS);
  }

  async uploadMedia(
    fileBuf: Buffer,
    mediaType: (typeof MediaType)[keyof typeof MediaType] = MediaType.IMAGE,
  ): Promise<CdnMedia> {
    const aesKey = randomBytes(16);
    const encrypted = aesEcbEncrypt(fileBuf, aesKey);
    const rawMd5 = createHash("md5").update(fileBuf).digest("hex");

    const urlRes = await this.getUploadUrl(mediaType, fileBuf.length, rawMd5, encrypted.length);
    const uploadParam = urlRes.upload_param;
    if (!uploadParam?.upload_url) {
      throw new Error(`getUploadUrl failed: ${urlRes.errmsg || "no upload_url"}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CDN_TIMEOUT_MS);
    try {
      const uploadRes = await fetch(uploadParam.upload_url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: encrypted,
        signal: controller.signal,
      });
      if (!uploadRes.ok) throw new Error(`CDN upload failed: ${uploadRes.status}`);
    } finally {
      clearTimeout(timer);
    }

    return {
      encrypt_query_param: uploadParam.encrypt_query_param || "",
      aes_key: aesKey.toString("base64"),
    };
  }

  async sendImage(toUserId: string, contextToken: string, cdn: CdnMedia) {
    return this.sendMessage(toUserId, contextToken, [
      { type: 2, image_item: { cdn_media: cdn } },
    ]);
  }

  async sendFile(toUserId: string, contextToken: string, cdn: CdnMedia, fileName: string) {
    return this.sendMessage(toUserId, contextToken, [
      { type: 4, file_item: { cdn_media: cdn, file_name: fileName } },
    ]);
  }
}
