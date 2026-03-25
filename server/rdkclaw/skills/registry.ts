import * as fs from "node:fs";
import * as path from "node:path";
import type { RDKClawSkillMeta, SkillPermission } from "../types.js";

interface SkillRegistryOptions {
  workspaceDir: string;
  extraDirs?: string[];
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const map: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    map[k] = v;
  }
  return map;
}

function parseList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parsePermissions(raw?: string): SkillPermission {
  const perms = new Set(parseList(raw).map((s) => s.toLowerCase()));
  return {
    workspaceRead: perms.has("workspace_read"),
    workspaceWrite: perms.has("workspace_write"),
    deviceExec: perms.has("device_exec"),
    network: perms.has("network"),
  };
}

function collectSkillFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSkillFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.toUpperCase() === "SKILL.MD") {
      out.push(full);
    }
  }
  return out;
}

export class SkillRegistry {
  private workspaceDir: string;
  private extraDirs: string[];
  private cache: RDKClawSkillMeta[] = [];
  private lastLoadedAt = 0;

  constructor(opts: SkillRegistryOptions) {
    this.workspaceDir = opts.workspaceDir;
    this.extraDirs = opts.extraDirs ?? [];
  }

  addExtraDir(dir: string): void {
    if (!this.extraDirs.includes(dir)) {
      this.extraDirs.push(dir);
      this.lastLoadedAt = 0;
    }
  }

  loadAll(force = false): RDKClawSkillMeta[] {
    const now = Date.now();
    if (!force && now - this.lastLoadedAt < 3000 && this.cache.length > 0) {
      return this.cache;
    }
    const sources = [
      path.join(this.workspaceDir, "skills"),
      path.join(this.workspaceDir, "agent", "skills"),
      path.join(this.workspaceDir, ".cursor", "skills"),
      ...this.extraDirs,
    ];
    const files = sources.flatMap((d) => collectSkillFiles(d));
    const metas: RDKClawSkillMeta[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, "utf-8");
        const fm = parseFrontmatter(raw);
        const name = fm.name || path.basename(path.dirname(file));
        const desc = fm.description || "RDKClaw skill";
        const risk = (fm.risk as "low" | "medium" | "high") || "medium";
        metas.push({
          name,
          description: desc,
          sourcePath: file,
          version: fm.version || "0.1.0",
          tags: parseList(fm.tags),
          trigger: parseList(fm.trigger || fm.triggers),
          risk,
          permissions: parsePermissions(fm.permissions),
          runtimePolicy: {
            delegatePreference: (fm.delegate_preference as "local" | "board" | "hybrid") || "hybrid",
            requiresBoard: fm.requires_board === "true",
            approvalLevel: (fm.approval_level as "none" | "confirm" | "strict") || "confirm",
            cooldownSeconds: Number(fm.cooldown ?? fm.cooldown_seconds ?? "0") || undefined,
            schedulerTemplate: fm.scheduler_template || undefined,
          },
          enabled: fm.enabled !== "false",
          updatedAt: fs.statSync(file).mtimeMs,
        });
      } catch {
        // ignore invalid skill files
      }
    }
    this.cache = metas.sort((a, b) => b.updatedAt - a.updatedAt);
    this.lastLoadedAt = now;
    return this.cache;
  }

  list(): RDKClawSkillMeta[] {
    return this.loadAll();
  }

  reload(): RDKClawSkillMeta[] {
    return this.loadAll(true);
  }

  matchByText(text: string): RDKClawSkillMeta[] {
    const q = text.toLowerCase();
    return this.list().filter((s) => {
      if (!s.enabled) return false;
      if (s.name.toLowerCase().includes(q)) return true;
      if (s.description.toLowerCase().includes(q)) return true;
      return s.trigger.some((t) => q.includes(t.toLowerCase()));
    });
  }
}

