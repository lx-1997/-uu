/**
 * 可选：将客户端上报的同一 JSON 体异步转发到你的云端入口（API 网关 / 自建 ingest / 经 Lambda 写 OSS 等）。
 * 失败不影响 200 与本地落盘；仅打 warn 日志。
 *
 * 飞书群「自定义机器人」Webhook：URL 形如
 * https://open.feishu.cn/open-apis/bot/v2/hook/xxxx
 * 需使用 text 消息体，且鉴权在 URL 路径中，不要带 Bearer。
 * 若机器人开启了「签名校验」，配置 ANALYTICS_CLOUD_FEISHU_SIGN_SECRET，将按官方算法附带 timestamp、sign。
 * 设置 ANALYTICS_CLOUD_FEISHU_WEBHOOK=1，或 URL 匹配飞书 hook 时自动按飞书格式封装（过长会截断）。
 */
import { createHmac } from 'node:crypto';

const FORWARD_TIMEOUT_MS = 15_000;

/** 飞书自定义机器人 text 单条不宜过大，留余量避免被拒 */
const FEISHU_TEXT_MAX = 18_000;

function isFeishuBotHookUrl(url: string): boolean {
  return /open\.feishu\.cn\/open-apis\/bot\/v2\/hook\//i.test(url)
    || /open\.larksuite\.com\/open-apis\/bot\/v2\/hook\//i.test(url);
}

/** 飞书开放平台：sign = BASE64(HMAC_SHA256(签名字符串, secret))，签名字符串 = timestamp + "\\n" + secret */
function feishuBotSign(secret: string, timestampSec: string): string {
  const stringToSign = `${timestampSec}\n${secret}`;
  return createHmac('sha256', secret).update(stringToSign).digest('base64');
}

function buildFeishuTextBody(payload: unknown, signSecret?: string): string {
  let raw = '';
  try {
    raw = JSON.stringify(payload);
  } catch {
    raw = String(payload);
  }
  if (raw.length > FEISHU_TEXT_MAX) {
    raw = `${raw.slice(0, FEISHU_TEXT_MAX)}\n…[truncated ${raw.length - FEISHU_TEXT_MAX} chars]`;
  }
  const base: Record<string, unknown> = {
    msg_type: 'text',
    content: { text: raw },
  };
  const sec = String(signSecret ?? '').trim();
  if (sec) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    base.timestamp = timestamp;
    base.sign = feishuBotSign(sec, timestamp);
  }
  return JSON.stringify(base);
}

export type ForwardWebhookOptions = {
  bearerSecret?: string;
  /** 飞书加签密钥；不传则仅用于非飞书 Bearer */
  feishuSignSecret?: string;
  /** 日志前缀，默认 analytics */
  logTag?: string;
  /** 与 URL 无关时强制按飞书 text 封装（兼容旧 env） */
  forceFeishuFormat?: boolean;
};

/**
 * 通用 HTTP 转发（埋点、对话归档等共用）。飞书 URL 自动走 text + 可选加签。
 */
export function forwardWebhookPayload(
  url: string,
  payload: unknown,
  options?: ForwardWebhookOptions,
): void {
  const trimmed = String(url ?? '').trim();
  if (!trimmed) return;

  const feishuMode =
    Boolean(options?.forceFeishuFormat)
    || isFeishuBotHookUrl(trimmed);

  const logTag = options?.logTag ?? 'analytics';

  void (async () => {
    try {
      const bearerSecret = String(options?.bearerSecret ?? '').trim();
      const feishuSignSecret = String(options?.feishuSignSecret ?? '').trim();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      let body: string;
      if (feishuMode) {
        body = buildFeishuTextBody(payload, feishuSignSecret || undefined);
        headers['Content-Type'] = 'application/json; charset=utf-8';
      } else {
        if (bearerSecret) headers.Authorization = `Bearer ${bearerSecret}`;
        body = JSON.stringify(payload);
      }
      const res = await fetch(trimmed, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) {
        console.warn(`[${logTag}] cloud webhook status:`, res.status, text.slice(0, 500));
        return;
      }
      if (feishuMode && text) {
        try {
          const j = JSON.parse(text) as { code?: number; msg?: string };
          if (typeof j.code === 'number' && j.code !== 0) {
            console.warn(`[${logTag}] feishu webhook:`, j.code, j.msg ?? text.slice(0, 200));
          }
        } catch {
          /* 非 JSON 则忽略 */
        }
      }
    } catch (err) {
      console.warn(`[${logTag}] cloud forward failed:`, err instanceof Error ? err.message : err);
    }
  })();
}

export function forwardAnalyticsCloudWebhook(payload: unknown): void {
  const url = String(process.env.ANALYTICS_CLOUD_WEBHOOK_URL ?? '').trim();
  if (!url || process.env.ANALYTICS_CLOUD_FORWARD_ENABLED === '0') return;

  forwardWebhookPayload(url, payload, {
    bearerSecret: String(process.env.ANALYTICS_CLOUD_WEBHOOK_SECRET ?? '').trim() || undefined,
    feishuSignSecret: String(process.env.ANALYTICS_CLOUD_FEISHU_SIGN_SECRET ?? '').trim() || undefined,
    logTag: 'analytics',
    forceFeishuFormat: process.env.ANALYTICS_CLOUD_FEISHU_WEBHOOK === '1',
  });
}
