import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { RDKClawPolicy } from "./types.js";

const CONFIG_DIR = path.join(os.homedir(), ".rdkstudio");
const POLICY_FILE = path.join(CONFIG_DIR, "rdkclaw-policy.json");

const DEFAULT_POLICY: RDKClawPolicy = {
  approval: {
    mode: "auto",
    riskThreshold: "high",
  },
  permission: {
    workspaceBoundaryEnabled: true,
    devicePathBoundaryEnabled: true,
    hostMutationGuardEnabled: true,
    commandDangerGuardEnabled: true,
    auditLogEnabled: true,
  },
  memory: {
    mainSessionReadsMemory: true,
    sharedSessionBlocksMemory: true,
    dailyMemoryDays: 2,
  },
  network: {
    enabled: true,
    maxFetchChars: 16000,
    requireApproval: false,
  },
  context: {
    contextTokens: 128000,
    maxHistoryShare: 0.5,
    softTrimRatio: 0.3,
    hardClearRatio: 0.5,
    keepLastAssistants: 3,
  },
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(Number(value))));
}

function clampFloat(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export class RDKClawPolicyStore {
  getPolicy(): RDKClawPolicy {
    try {
      if (!fs.existsSync(POLICY_FILE)) return DEFAULT_POLICY;
      const raw = fs.readFileSync(POLICY_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Partial<RDKClawPolicy>;
      return {
        ...DEFAULT_POLICY,
        ...parsed,
        approval: { ...DEFAULT_POLICY.approval, ...(parsed.approval ?? {}) },
        permission: { ...DEFAULT_POLICY.permission, ...(parsed.permission ?? {}) },
        memory: { ...DEFAULT_POLICY.memory, ...(parsed.memory ?? {}) },
        network: { ...DEFAULT_POLICY.network, ...(parsed.network ?? {}) },
        context: {
          ...DEFAULT_POLICY.context,
          ...(parsed.context ?? {}),
        },
      };
    } catch {
      return DEFAULT_POLICY;
    }
  }

  savePolicy(patch: Partial<RDKClawPolicy>): RDKClawPolicy {
    const prev = this.getPolicy();
    const next: RDKClawPolicy = {
      ...prev,
      ...patch,
      approval: { ...prev.approval, ...(patch.approval ?? {}) },
      permission: { ...prev.permission, ...(patch.permission ?? {}) },
      memory: { ...prev.memory, ...(patch.memory ?? {}) },
      network: { ...prev.network, ...(patch.network ?? {}) },
      context: { ...prev.context, ...(patch.context ?? {}) },
    };
    next.context.contextTokens = clampInt(next.context.contextTokens, DEFAULT_POLICY.context.contextTokens, 16000, 256000);
    next.context.keepLastAssistants = clampInt(next.context.keepLastAssistants, DEFAULT_POLICY.context.keepLastAssistants, 0, 20);
    next.context.maxHistoryShare = clampFloat(next.context.maxHistoryShare, DEFAULT_POLICY.context.maxHistoryShare, 0.1, 0.95);
    next.context.softTrimRatio = clampFloat(next.context.softTrimRatio, DEFAULT_POLICY.context.softTrimRatio, 0.1, 0.98);
    next.context.hardClearRatio = clampFloat(next.context.hardClearRatio, DEFAULT_POLICY.context.hardClearRatio, 0.1, 0.99);
    if (next.context.softTrimRatio > next.context.hardClearRatio) {
      next.context.softTrimRatio = next.context.hardClearRatio;
    }
    ensureDir();
    fs.writeFileSync(POLICY_FILE, JSON.stringify(next, null, 2), "utf-8");
    return next;
  }
}

