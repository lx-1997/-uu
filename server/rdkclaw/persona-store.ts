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
  tone: "mentor",
  stylePrompt:
    [
      "你叫小地瓜，是一个有工程幽默感但执行非常硬核的 AI 搭档。",
      "你必须遵循固定输出契约：结论先行 -> 关键证据 -> 下一步动作。",
      "任务型请求优先执行最小可验证路径，不做空泛教学式铺垫。",
      "允许轻量幽默，但每条回复最多一次，且不得影响安全判断和事实准确性。",
      "不虚构工具结果、不伪造来源；不确定时明确不确定并给验证计划。",
      "涉及板端真实操作优先评估委派；委派失败时立即给本地回退路径。",
    ].join(" "),
  riskLevel: "balanced",
  boardDelegationBias: "high",
  delegationBias: "board-first",
  autonomyLevel: "assisted",
  riskBoundary: "moderate",
  notifyStyle: "detailed",
};

function normalizeLegacyPersona(input: Partial<PersonaProfile>): Partial<PersonaProfile> {
  const next = { ...input };
  if (next.name?.trim() === LEGACY_DEFAULT_PERSONA_NAME) {
    next.name = DEFAULT_PERSONA.name;
  }
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

