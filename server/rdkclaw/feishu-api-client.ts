type TenantToken = {
  value: string;
  expireAt: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;

function withTimeout(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export class FeishuApiClient {
  private readonly appId: string;
  private readonly appSecret: string;
  private token: TenantToken | null = null;
  private tokenInflight: Promise<string> | null = null;

  constructor(appId?: string, appSecret?: string) {
    this.appId = String(appId || process.env.FEISHU_APP_ID || "");
    this.appSecret = String(appSecret || process.env.FEISHU_APP_SECRET || "");
  }

  isConfigured() {
    return !!(this.appId && this.appSecret);
  }

  private async getToken() {
    if (!this.isConfigured()) {
      throw new Error("飞书配置缺失：请设置 FEISHU_APP_ID / FEISHU_APP_SECRET");
    }
    const now = Date.now();
    if (this.token && this.token.expireAt > now + 30_000) {
      return this.token.value;
    }
    if (this.tokenInflight) return this.tokenInflight;
    this.tokenInflight = this.refreshToken().finally(() => {
      this.tokenInflight = null;
    });
    return this.tokenInflight;
  }

  private async refreshToken(): Promise<string> {
    const { signal, clear } = withTimeout(DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
        signal,
      });
      const data = (await res.json()) as {
        code?: number;
        msg?: string;
        tenant_access_token?: string;
        expire?: number;
      };
      if (!res.ok || data.code !== 0 || !data.tenant_access_token) {
        throw new Error(`获取飞书 token 失败: ${data.msg || res.statusText}`);
      }
      this.token = {
        value: data.tenant_access_token,
        expireAt: Date.now() + Math.max(60, Number(data.expire || 7200)) * 1000,
      };
      return this.token.value;
    } finally {
      clear();
    }
  }

  async sendTextToChat(chatId: string, text: string) {
    const token = await this.getToken();
    const { signal, clear } = withTimeout(DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        }),
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || Number((data as { code?: number }).code) !== 0) {
        const msg = (data as { msg?: string }).msg || res.statusText;
        throw new Error(`飞书回消息失败: ${msg}`);
      }
      return data;
    } finally {
      clear();
    }
  }

  /**
   * 多维表格新增行（完整长文本可写入「多行文本」列，不受群机器人 Webhook 长度限制）。
   * @see https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/batch_create
   */
  async batchCreateBitableRecords(
    appToken: string,
    tableId: string,
    records: Array<{ fields: Record<string, unknown> }>,
  ) {
    const token = await this.getToken();
    const { signal, clear } = withTimeout(DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_create`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ records }),
          signal,
        },
      );
      const data = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; data?: unknown };
      if (!res.ok || Number(data.code) !== 0) {
        throw new Error(`飞书多维表格写入失败: ${data.msg || res.statusText}`);
      }
      return data;
    } finally {
      clear();
    }
  }
}

