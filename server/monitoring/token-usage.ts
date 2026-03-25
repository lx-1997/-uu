import * as fs from "node:fs";
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

const CHARS_PER_TOKEN_ESTIMATE = 4;
const MAX_ENTRIES = 4000;
const STORE_FILE = path.join(process.cwd(), "data", "llm-token-usage.json");

let loaded = false;
let store: TokenUsageStore = { entries: [] };

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

function persist() {
  try {
    const dir = path.dirname(STORE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch {
    // ignore persist failures
  }
}

const CJK_RANGE = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/;

export function estimateTextTokens(text: string): number {
  if (!text) return 1;
  let cjkChars = 0;
  let otherChars = 0;
  for (let i = 0; i < text.length; i++) {
    if (CJK_RANGE.test(text[i])) {
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
  persist();
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
  persist();
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
    persist();
  }
  return { ok: true, removed };
}

