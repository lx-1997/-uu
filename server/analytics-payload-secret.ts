/**
 * 与前端 `payload-crypto.ts` 内嵌及 VITE_ANALYTICS_PAYLOAD_SECRET 一致；可用环境变量覆盖。
 */
const EMBEDDED_ANALYTICS_PAYLOAD_SECRET = 'rdk-studio-analytics-payload-v1-shared';

export function getAnalyticsPayloadSecret(): string {
  return String(process.env.ANALYTICS_PAYLOAD_SECRET ?? '').trim() || EMBEDDED_ANALYTICS_PAYLOAD_SECRET;
}
