import crypto from 'node:crypto';

const GCM_TAG_LEN = 16;
const IV_LEN = 12;

function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

/** 与浏览器 Web Crypto AES-GCM（tag 128bit，密文与 tag 拼接）一致 */
export function decryptAnalyticsEnvelope(
  ivB64: string,
  payloadB64: string,
  secret: string,
): string {
  const key = deriveKey(secret);
  const iv = Buffer.from(ivB64, 'base64');
  if (iv.length !== IV_LEN) {
    throw new Error('invalid_iv');
  }
  const combined = Buffer.from(payloadB64, 'base64');
  if (combined.length <= GCM_TAG_LEN) {
    throw new Error('invalid_payload');
  }
  const enc = combined.subarray(0, combined.length - GCM_TAG_LEN);
  const tag = combined.subarray(combined.length - GCM_TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_LEN });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export function isEncryptedAnalyticsBody(body: unknown): body is { v: number; iv: string; payload: string } {
  if (!body || typeof body !== 'object') return false;
  const o = body as Record<string, unknown>;
  return o.v === 1 && typeof o.iv === 'string' && typeof o.payload === 'string';
}
