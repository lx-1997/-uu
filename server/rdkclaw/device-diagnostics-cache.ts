import { DEVICE_DIAGNOSTICS_CACHE_TTL_MS } from '../constants.js';

const MAX_ENTRIES = 200;
const store = new Map<string, { output: string; at: number }>();

export function getDiagnosticsCache(deviceId: string): string | null {
  const entry = store.get(deviceId);
  if (!entry) return null;
  if (Date.now() - entry.at > DEVICE_DIAGNOSTICS_CACHE_TTL_MS) {
    store.delete(deviceId);
    return null;
  }
  return entry.output;
}

export function setDiagnosticsCache(deviceId: string, output: string): void {
  store.set(deviceId, { output, at: Date.now() });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function deleteDiagnosticsCache(deviceId: string): void {
  store.delete(deviceId);
}
