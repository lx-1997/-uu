/**
 * 与 @tencent-weixin/openclaw-weixin 的 buildCommonHeaders() 对齐：
 * GET ilink/bot/get_bot_qrcode、get_qrcode_status 需带 iLink-App-Id 与编码后的 ClientVersion。
 * @see https://unpkg.com/@tencent-weixin/openclaw-weixin@2.1.1/src/api/api.ts
 */

function buildClientVersionFromSemver(version: string): number {
  const parts = version.split('.').map((p) => parseInt(p, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

/** 与 openclaw-weixin 2.1.1 的 package.json 一致，便于 iLink 侧识别客户端 */
const DEFAULT_ILINK_SEMVER = '2.1.1';

function resolveClientVersionString(): string {
  const raw = process.env.WEIXIN_ILINK_APP_CLIENT_VERSION?.trim();
  if (raw && /^\d+$/.test(raw)) return raw;
  const semver = process.env.WEIXIN_ILINK_CLIENT_SEMVER?.trim() || DEFAULT_ILINK_SEMVER;
  return String(buildClientVersionFromSemver(semver));
}

/**
 * 微信 iLink 扫码 / 状态轮询共用请求头（与官方插件 GET 一致）。
 */
export function getWeixinIlinkCommonHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'iLink-App-Id': process.env.WEIXIN_ILINK_APP_ID?.trim() || 'bot',
    'iLink-App-ClientVersion': resolveClientVersionString(),
  };
  const tag = process.env.WEIXIN_SK_ROUTE_TAG?.trim();
  if (tag) h.SKRouteTag = tag;
  return h;
}
