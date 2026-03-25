import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

export type TokenUsageSource = "rdkclaw" | "openclaw";

export interface TokenUsageEntry {
  id: string;
  ts: number;
  source: TokenUsageSource;
  deviceId?: string;
  sessionId?: string;
  model?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
  success: boolean;
}

interface TokenUsageStore {
  entries: TokenUsageEntry[];
}

const MAX_ENTRIES = 4000;
const DATA_DIR = process.env.RDK_DATA_DIR ?? path.resolve(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "llm-token-usage.json");

/**
 * Debounce interval for async persistence.
 * Avoids blocking the event loop with writeFileSync on every token recording —
 * batches rapid writes into a single disk flush.
 */
const PERSIST_DEBOUNCE_MS = 2000;

let loaded = false;
let store: TokenUsageStore = { entries: [] };
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistInFlight = false;

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(STORE_FILE)) {
      store = { entries: [] };
      return;
    }
    const raw = fs.readFileSync(STORE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as TokenUsageStore;
    if (Array.isArray(parsed?.entries)) {
      store = {
        entries: parsed.entries
          .filter((e) => e && typeof e.ts === "number" && typeof e.totalTokens === "number")
          .slice(-MAX_ENTRIES),
      };
    }
  } catch {
    store = { entries: [] };
  }
}

/**
 * Debounced async persistence — replaces the previous synchronous writeFileSync.
 * Multiple rapid recordTokenUsage() calls are batched into one disk write,
 * preventing event-loop blocking under high-frequency token recording.
 */
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (persistInFlight) {
      schedulePersist();
      return;
    }
    persistInFlight = true;
    const dir = path.dirname(STORE_FILE);
    const data = JSON.stringify(store, null, 2);
    const doWrite = async () => {
      try {
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(STORE_FILE, data, "utf-8");
      } catch {
        // persist failures are non-fatal; data remains in memory
      } finally {
        persistInFlight = false;
      }
    };
    void doWrite();
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * CJK character detection via charCode ranges.
 * Uses direct numeric comparison instead of per-character regex — ~3x faster
 * for large strings (CJK detection is hot-path during token estimation).
 */
function isCJK(code: number): boolean {
  return (code >= 0x3000 && code <= 0x9fff) ||
         (code >= 0xac00 && code <= 0xd7af) ||
         (code >= 0xff00 && code <= 0xffef);
}

export function estimateTextTokens(text: string): number {
  if (!text) return 1;
  let cjkChars = 0;
  let otherChars = 0;
  for (let i = 0; i < text.length; i++) {
    if (isCJK(text.charCodeAt(i))) {
      cjkChars++;
    } else {
      otherChars++;
    }
  }
  return Math.max(1, Math.ceil(cjkChars / 1.5) + Math.ceil(otherChars / 4));
}

export function recordTokenUsage(input: {
  source: TokenUsageSource;
  deviceId?: string;
  sessionId?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  promptText?: string;
  completionText?: string;
  success?: boolean;
  estimated?: boolean;
}) {
  ensureLoaded();
  const promptTokens = Math.max(
    0,
    Math.floor(
      input.promptTokens ?? estimateTextTokens(input.promptText || ""),
    ),
  );
  const completionTokens = Math.max(
    0,
    Math.floor(
      input.completionTokens ?? estimateTextTokens(input.completionText || ""),
    ),
  );
  const entry: TokenUsageEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    source: input.source,
    deviceId: input.deviceId || "",
    sessionId: input.sessionId || "",
    model: input.model || "",
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimated: input.estimated !== false,
    success: input.success !== false,
  };
  store.entries.push(entry);
  if (store.entries.length > MAX_ENTRIES) {
    store.entries = store.entries.slice(-MAX_ENTRIES);
  }
  schedulePersist();
}

export function getTokenUsageReport(params?: {
  hours?: number;
  source?: "all" | TokenUsageSource;
  deviceId?: string;
  limit?: number;
}) {
  ensureLoaded();
  const hours = Math.max(1, Math.min(24 * 30, Math.floor(params?.hours ?? 24)));
  const fromTs = Date.now() - hours * 3600 * 1000;
  const source = params?.source || "all";
  const deviceId = (params?.deviceId || "").trim();
  const limit = Math.max(1, Math.min(200, Math.floor(params?.limit ?? 50)));

  const filtered = store.entries.filter((e) => {
    if (e.ts < fromTs) return false;
    if (source !== "all" && e.source !== source) return false;
    if (deviceId && e.deviceId !== deviceId) return false;
    return true;
  });

  const totals = filtered.reduce(
    (acc, e) => {
      acc.promptTokens += e.promptTokens;
      acc.completionTokens += e.completionTokens;
      acc.totalTokens += e.totalTokens;
      acc.runs += 1;
      if (e.success) acc.successRuns += 1;
      return acc;
    },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, runs: 0, successRuns: 0 },
  );

  const bySource: Record<string, { runs: number; totalTokens: number }> = {};
  for (const e of filtered) {
    const k = e.source;
    bySource[k] = bySource[k] || { runs: 0, totalTokens: 0 };
    bySource[k].runs += 1;
    bySource[k].totalTokens += e.totalTokens;
  }

  const byDevice: Record<string, { runs: number; totalTokens: number }> = {};
  for (const e of filtered) {
    if (!e.deviceId) continue;
    byDevice[e.deviceId] = byDevice[e.deviceId] || { runs: 0, totalTokens: 0 };
    byDevice[e.deviceId].runs += 1;
    byDevice[e.deviceId].totalTokens += e.totalTokens;
  }

  return {
    ok: true,
    windowHours: hours,
    source,
    deviceId: deviceId || undefined,
    totals,
    bySource,
    byDevice,
    recent: filtered.slice(-limit).reverse(),
  };
}

export function resetTokenUsage() {
  ensureLoaded();
  store = { entries: [] };
  schedulePersist();
  return { ok: true };
}

export function removeTokenUsageByDevice(deviceId: string) {
  ensureLoaded();
  const id = String(deviceId || '').trim();
  if (!id) return { ok: true, removed: 0 };
  const before = store.entries.length;
  store.entries = store.entries.filter((entry) => (entry.deviceId || '').trim() !== id);
  const removed = before - store.entries.length;
  if (removed > 0) {
    schedulePersist();
  }
  return { ok: true, removed };
}

