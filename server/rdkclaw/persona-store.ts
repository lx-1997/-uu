import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { PersonaProfile, UserProfile } from "./types.js";

const CONFIG_DIR = path.join(os.homedir(), ".rdkstudio");
const PERSONA_FILE = path.join(CONFIG_DIR, "rdkclaw-persona.json");
const USERS_FILE = path.join(CONFIG_DIR, "rdkclaw-users.json");

const DEFAULT_PERSONA: PersonaProfile = {
  name: "RDKClaw",
  tone: "mentor",
  stylePrompt:
    "你是 RDKClaw，RDK Studio 的统一智能中枢。优先给出可执行方案；涉及板端真实操作时，主动委派板端 Agent 并解释结果。",
  riskLevel: "balanced",
  boardDelegationBias: "high",
  delegationBias: "board-first",
  autonomyLevel: "assisted",
  riskBoundary: "moderate",
  notifyStyle: "detailed",
};

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
      const parsed = JSON.parse(raw) as Partial<PersonaProfile>;
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

