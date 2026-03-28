import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

type Entry = { buf: Buffer; mime: string; exp: number };
const store = new Map<string, Entry>();
const TTL_MS = 8 * 60 * 1000;

export function putWeixinQrPreview(buf: Buffer, mime: string): string {
  prune();
  const id = randomUUID();
  store.set(id, { buf, mime, exp: Date.now() + TTL_MS });
  return id;
}

export function getWeixinQrPreview(id: string): { buf: Buffer; mime: string } | null {
  prune();
  const e = store.get(id);
  if (!e || e.exp < Date.now()) return null;
  return { buf: e.buf, mime: e.mime };
}

function prune() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.exp < now) store.delete(k);
  }
}
