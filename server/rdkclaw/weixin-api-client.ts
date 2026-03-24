const ILINK_BASE_URL = "https://oapi.weixinbridge.com/ilink/bot";
const LONGPOLL_TIMEOUT_MS = 35_000;
const DEFAULT_TIMEOUT_MS = 15_000;

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
  ret: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageResponse {
  ret: number;
  errcode?: number;
  errmsg?: string;
}

export interface GetConfigResponse {
  ret: number;
  typing_ticket?: string;
}

function randomUin(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const view = new DataView(buf.buffer);
  const val = view.getUint32(0, true);
  return Buffer.from(String(val)).toString("base64");
}

export class WeixinApiClient {
  private token: string;
  private uin: string;

  constructor(token: string) {
    this.token = token;
    this.uin = randomUin();
  }

  updateToken(token: string) {
    this.token = token;
  }

  isConfigured() {
    return !!this.token;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      Authorization: `Bearer ${this.token}`,
      "X-WECHAT-UIN": this.uin,
    };
  }

  async getUpdates(syncBuf: string, signal?: AbortSignal): Promise<GetUpdatesResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LONGPOLL_TIMEOUT_MS + 5_000);
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    try {
      const res = await fetch(`${ILINK_BASE_URL}/getupdates`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ get_updates_buf: syncBuf }),
        signal: combinedSignal,
      });
      const data = (await res.json()) as GetUpdatesResponse;
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendMessage(
    toUserId: string,
    contextToken: string,
    items: WeixinMessageItem[],
  ): Promise<SendMessageResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(`${ILINK_BASE_URL}/sendmessage`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          msg: {
            to_user_id: toUserId,
            context_token: contextToken,
            item_list: items,
          },
        }),
        signal: controller.signal,
      });
      return (await res.json()) as SendMessageResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendText(toUserId: string, contextToken: string, text: string) {
    return this.sendMessage(toUserId, contextToken, [
      { type: 1, text_item: { text } },
    ]);
  }

  async sendTyping(userId: string, ticket: string, status: 1 | 2): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      await fetch(`${ILINK_BASE_URL}/sendtyping`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          ilink_user_id: userId,
          typing_ticket: ticket,
          status,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async getConfig(userId: string, contextToken?: string): Promise<GetConfigResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const body: Record<string, string> = { ilink_user_id: userId };
      if (contextToken) body.context_token = contextToken;
      const res = await fetch(`${ILINK_BASE_URL}/getconfig`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return (await res.json()) as GetConfigResponse;
    } finally {
      clearTimeout(timeout);
    }
  }
}
