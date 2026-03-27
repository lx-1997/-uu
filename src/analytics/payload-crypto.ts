/**
 * 与 server/analytics-payload-crypto.ts 解密格式一致（AES-256-GCM，SHA-256 派生密钥）。
 * 密钥需与 ANALYTICS_PAYLOAD_SECRET / VITE_ANALYTICS_PAYLOAD_SECRET 一致。
 */
/** 与 server/analytics-payload-secret.ts 默认一致；发版前可改为独立长密钥 */
const EMBEDDED_ANALYTICS_PAYLOAD_SECRET = 'rdk-studio-analytics-payload-v1-shared';

function getSecret(): string {
  try {
    const v = import.meta.env.VITE_ANALYTICS_PAYLOAD_SECRET;
    if (typeof v === 'string' && v.trim()) return v.trim();
  } catch {
    /* ignore */
  }
  return EMBEDDED_ANALYTICS_PAYLOAD_SECRET.trim();
}

export function hasAnalyticsPayloadSecret(): boolean {
  return getSecret().length > 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    bin += String.fromCharCode.apply(null, Array.from(sub) as number[]);
  }
  return btoa(bin);
}

export async function encryptAnalyticsEnvelope(data: unknown, secret: string): Promise<{ v: 1; iv: string; payload: string }> {
  const keyMaterial = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    plaintext,
  );
  const combined = new Uint8Array(ciphertext);
  return {
    v: 1,
    iv: bytesToBase64(iv),
    payload: bytesToBase64(combined),
  };
}

export async function buildAnalyticsRequestBody(data: unknown): Promise<string> {
  const secret = getSecret();
  if (!secret) {
    return JSON.stringify(data);
  }
  const enc = await encryptAnalyticsEnvelope(data, secret);
  return JSON.stringify(enc);
}
