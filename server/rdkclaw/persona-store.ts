import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { PersonaProfile, UserProfile } from "./types.js";

const CONFIG_DIR = path.join(os.homedir(), ".rdkstudio");
const PERSONA_FILE = path.join(CONFIG_DIR, "rdkclaw-persona.json");
const USERS_FILE = path.join(CONFIG_DIR, "rdkclaw-users.json");
const LEGACY_DEFAULT_PERSONA_NAME = "RDKClaw";

const DEFAULT_PERSONA: PersonaProfile = {
  name: "小地瓜",
  extraInstructions: "",
  riskLevel: "balanced",
  /** 默认 Studio 优先：先由 RDKClaw 本地/SSH 收敛，确有必要再协同套件端 OpenClaw */
  delegationBias: "local-first",
  autonomyLevel: "assisted",
};

function normalizeLegacyPersona(input: Partial<PersonaProfile>): Partial<PersonaProfile> {
  const next = { ...input };
  if (next.name?.trim() === LEGACY_DEFAULT_PERSONA_NAME) {
    next.name = DEFAULT_PERSONA.name;
  }
  const legacy = input as Record<string, unknown>;
  if (legacy.stylePrompt && !next.extraInstructions) {
    next.extraInstructions = String(legacy.stylePrompt);
  }
  delete (next as Record<string, unknown>).stylePrompt;
  delete (next as Record<string, unknown>).boardDelegationBias;
  delete (next as Record<string, unknown>).notifyStyle;
  delete (next as Record<string, unknown>).tone;
  delete (next as Record<string, unknown>).riskBoundary;
  return next;
}

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export class PersonaStore {
  getPersona(): PersonaProfile {
    try {
      if (!fs.existsSync(PERSONA_FILE)) return DEFAULT_PERSONA;
      const raw = fs.readFileSync(PERSONA_FILE, "utf-8");
      const parsed = normalizeLegacyPersona(JSON.parse(raw) as Partial<PersonaProfile>);
      return {
        ...DEFAULT_PERSONA,
        ...parsed,
      };
    } catch {
      return DEFAULT_PERSONA;
    }
  }

  savePersona(patch: Partial<PersonaProfile>): PersonaProfile {
    const next = { ...this.getPersona(), ...patch };
    ensureConfigDir();
    fs.writeFileSync(PERSONA_FILE, JSON.stringify(next, null, 2), "utf-8");
    return next;
  }

  listUsers(): UserProfile[] {
    try {
      if (!fs.existsSync(USERS_FILE)) return [];
      const raw = fs.readFileSync(USERS_FILE, "utf-8");
      const parsed = JSON.parse(raw) as UserProfile[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  getUser(userId: string): UserProfile | null {
    return this.listUsers().find((u) => u.userId === userId) ?? null;
  }

  saveUserProfile(user: UserProfile): UserProfile {
    const users = this.listUsers();
    const next = [user, ...users.filter((u) => u.userId !== user.userId)];
    ensureConfigDir();
    fs.writeFileSync(USERS_FILE, JSON.stringify(next, null, 2), "utf-8");
    return user;
  }
}

