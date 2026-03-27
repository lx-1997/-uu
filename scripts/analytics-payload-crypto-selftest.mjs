/**
 * 自测：Web Crypto 加密 → Node 解密（与浏览器 /api/analytics/events 一致）
 */
import { webcrypto } from 'node:crypto';
import { decryptAnalyticsEnvelope } from '../dist-server/server/analytics-payload-crypto.js';

const subtle = webcrypto.subtle;
const secret = 'test-shared-secret-for-analytics';

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    bin += String.fromCharCode.apply(null, Array.from(sub));
  }
  return Buffer.from(bin, 'binary').toString('base64');
}

const keyMaterial = await subtle.digest('SHA-256', new TextEncoder().encode(secret));
const key = await subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['encrypt']);
const iv = webcrypto.getRandomValues(new Uint8Array(12));
const inner = { schema: 'rdk.studio.analytics.v1', clientSessionId: 's_test', consent: {}, events: [{ type: 'ui_action', ts: 1 }] };
const plaintext = new TextEncoder().encode(JSON.stringify(inner));
const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, plaintext);
const combined = new Uint8Array(ciphertext);
const ivB64 = bytesToBase64(iv);
const payloadB64 = bytesToBase64(combined);

const out = decryptAnalyticsEnvelope(ivB64, payloadB64, secret);
const parsed = JSON.parse(out);
if (JSON.stringify(parsed) !== JSON.stringify(inner)) {
  console.error('mismatch', parsed, inner);
  process.exit(1);
}
console.log('analytics payload crypto selftest: ok');
