/**
 * RoboBot 应用中心 — 数据模型与存储
 *
 * 机器人（RoboBot）是一个可配置的 AI Agent 预设，包含：
 * - 独立人格配置（persona override）
 * - 绑定的知识空间（Knowledge Space）
 * - 绑定的 Skill 列表
 * - 文档优先策略（是否保留 RDK 官方文档）
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import type { PersonaProfile } from "./types.js";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type DocPriority = "bot-first" | "rdk-first" | "merged";
export type BotVisibility = "private" | "shared";

export interface RoboBotPersona {
  /** 自定义系统提示词片段（追加到默认 persona，不替换） */
  systemPromptOverride?: string;
  extraInstructions: string;
  delegationBias?: PersonaProfile["delegationBias"];
  autonomyLevel?: PersonaProfile["autonomyLevel"];
  riskLevel?: PersonaProfile["riskLevel"];
}

export interface RoboBot {
  id: string;
  name: string;
  icon?: string;
  description: string;
  createdAt: number;
  updatedAt: number;

  persona: RoboBotPersona;

  /** 绑定的知识空间 ID 列表 */
  knowledgeSpaceIds: string[];
  /** 绑定的 Skill ID 列表 */
  skillIds: string[];

  /** 是否同时使用 RDK 官方文档（默认 true） */
  includeRdkOfficialDocs: boolean;
  /** 文档冲突时优先策略 */
  docPriority: DocPriority;

  visibility: BotVisibility;
  tags: string[];
}

export interface RoboBotRegistry {
  bots: RoboBot[];
  activeBotId?: string;
}

// ---------------------------------------------------------------------------
//  Paths
// ---------------------------------------------------------------------------

const CONFIG_DIR = path.join(os.homedir(), ".rdkstudio");
const BOTS_DIR = path.join(CONFIG_DIR, "bots");
const REGISTRY_FILE = path.join(BOTS_DIR, "registry.json");

function ensureBotsDir(): void {
  if (!fs.existsSync(BOTS_DIR)) {
    fs.mkdirSync(BOTS_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
//  BotStore
// ---------------------------------------------------------------------------

export class BotStore {
  private cache: RoboBotRegistry | null = null;

  /** 读取注册表（带内存缓存） */
  getRegistry(): RoboBotRegistry {
    if (this.cache) return this.cache;
    try {
      if (!fs.existsSync(REGISTRY_FILE)) return { bots: [] };
      const raw = fs.readFileSync(REGISTRY_FILE, "utf-8");
      const parsed = JSON.parse(raw) as RoboBotRegistry;
      this.cache = parsed;
      return parsed;
    } catch {
      return { bots: [] };
    }
  }

  /** 持久化注册表 */
  private persist(registry: RoboBotRegistry): void {
    ensureBotsDir();
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), "utf-8");
    this.cache = registry;
  }

  /** 列出所有机器人 */
  listBots(): RoboBot[] {
    return this.getRegistry().bots;
  }

  /** 根据 ID 获取 */
  getBot(id: string): RoboBot | undefined {
    return this.getRegistry().bots.find((b) => b.id === id);
  }

  /** 根据名称获取（模糊匹配） */
  getBotByName(name: string): RoboBot | undefined {
    const lower = name.toLowerCase().trim();
    return this.getRegistry().bots.find(
      (b) => b.name.toLowerCase() === lower || b.name.toLowerCase().includes(lower),
    );
  }

  /** 获取当前激活的 Bot ID */
  getActiveBotId(): string | undefined {
    return this.getRegistry().activeBotId;
  }

  /** 设置激活的 Bot（传 undefined 回到默认） */
  setActiveBot(botId: string | undefined): void {
    const reg = this.getRegistry();
    if (botId && !reg.bots.some((b) => b.id === botId)) {
      throw new Error(`Bot '${botId}' not found`);
    }
    this.persist({ ...reg, activeBotId: botId });
  }

  /** 创建新机器人 */
  createBot(input: Omit<RoboBot, "id" | "createdAt" | "updatedAt">): RoboBot {
    const now = Date.now();
    const bot: RoboBot = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const reg = this.getRegistry();
    reg.bots.push(bot);
    this.persist(reg);
    return bot;
  }

  /** 更新机器人 */
  updateBot(id: string, patch: Partial<Omit<RoboBot, "id" | "createdAt">>): RoboBot | undefined {
    const reg = this.getRegistry();
    const idx = reg.bots.findIndex((b) => b.id === id);
    if (idx < 0) return undefined;
    reg.bots[idx] = { ...reg.bots[idx], ...patch, updatedAt: Date.now() };
    this.persist(reg);
    return reg.bots[idx];
  }

  /** 删除机器人 */
  deleteBot(id: string): boolean {
    const reg = this.getRegistry();
    const before = reg.bots.length;
    reg.bots = reg.bots.filter((b) => b.id !== id);
    if (reg.activeBotId === id) reg.activeBotId = undefined;
    if (reg.bots.length < before) {
      this.persist(reg);
      return true;
    }
    return false;
  }

  /** 清除内存缓存（测试用） */
  resetCache(): void {
    this.cache = null;
  }
}
