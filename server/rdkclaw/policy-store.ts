import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { RDKClawPolicy } from "./types.js";

const CONFIG_DIR = path.join(os.homedir(), ".rdkstudio");
const POLICY_FILE = path.join(CONFIG_DIR, "rdkclaw-policy.json");

const DEFAULT_POLICY: RDKClawPolicy = {
  approval: {
    mode: "always",
    riskThreshold: "medium",
  },
  delegation: {
    strategy: "hybrid",
    allowBoardAuto: true,
  },
  memory: {
    mainSessionReadsMemory: true,
    sharedSessionBlocksMemory: true,
    dailyMemoryDays: 2,
  },
  scheduler: {
    defaultChannel: "chat",
    allowSecondInterval: true,
  },
};

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
        delegation: { ...DEFAULT_POLICY.delegation, ...(parsed.delegation ?? {}) },
        memory: { ...DEFAULT_POLICY.memory, ...(parsed.memory ?? {}) },
        scheduler: { ...DEFAULT_POLICY.scheduler, ...(parsed.scheduler ?? {}) },
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
      delegation: { ...prev.delegation, ...(patch.delegation ?? {}) },
      memory: { ...prev.memory, ...(patch.memory ?? {}) },
      scheduler: { ...prev.scheduler, ...(patch.scheduler ?? {}) },
    };
    ensureDir();
    fs.writeFileSync(POLICY_FILE, JSON.stringify(next, null, 2), "utf-8");
    return next;
  }
}

