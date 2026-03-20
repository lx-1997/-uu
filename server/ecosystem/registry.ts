/**
 * Ecosystem Skill Registry — The central brain that holds all discovered skills.
 *
 * Responsibilities:
 *   1. Store skills from all providers (NodeHub, ModelZoo, TROS, OpenClaw, Community)
 *   2. Search / filter by keyword, source, platform, device status
 *   3. Track per-device board status (installed, running)
 *   4. Persist to disk so skills survive restarts
 *   5. Provide AI Dock with context about available capabilities
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  EcoSkill,
  EcoSource,
  EcoProvider,
  EcoSearchQuery,
  EcoSearchResult,
  BoardStatus,
  RdkPlatform,
} from '../../shared/ecosystem-types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const REGISTRY_FILE = path.join(DATA_DIR, 'ecosystem-registry.json');

export class EcosystemRegistry {
  private skills: Map<string, EcoSkill> = new Map();
  private providers: Map<EcoSource, EcoProvider> = new Map();
  private dirty = false;

  constructor() {
    this.loadFromDisk();
  }

  // ─── Provider Management ───

  registerProvider(provider: EcoProvider): void {
    this.providers.set(provider.source, provider);
  }

  // ─── Skill CRUD ───

  upsertSkill(skill: EcoSkill): void {
    const existing = this.skills.get(skill.id);
    if (existing) {
      // Preserve board status from existing record
      skill.boardStatusByDevice = {
        ...existing.boardStatusByDevice,
        ...skill.boardStatusByDevice,
      };
    }
    skill.lastRefreshedAt = new Date().toISOString();
    this.skills.set(skill.id, skill);
    this.dirty = true;
  }

  upsertMany(skills: EcoSkill[]): number {
    for (const skill of skills) {
      this.upsertSkill(skill);
    }
    this.flush();
    return skills.length;
  }

  getSkill(id: string): EcoSkill | undefined {
    return this.skills.get(id);
  }

  removeSkill(id: string): boolean {
    const deleted = this.skills.delete(id);
    if (deleted) {
      this.dirty = true;
      this.flush();
    }
    return deleted;
  }

  getAllSkills(): EcoSkill[] {
    return Array.from(this.skills.values());
  }

  // ─── Search ───

  search(query: EcoSearchQuery): EcoSearchResult {
    let results = Array.from(this.skills.values());

    if (query.source) {
      results = results.filter((s) => s.source === query.source);
    }

    if (query.platform) {
      results = results.filter((s) => s.platforms.includes(query.platform!));
    }

    if (query.category) {
      results = results.filter(
        (s) => s.category.toLowerCase() === query.category!.toLowerCase(),
      );
    }

    if (query.tags?.length) {
      const queryTags = query.tags.map((t) => t.toLowerCase());
      results = results.filter((s) =>
        queryTags.some((qt) => s.tags.some((st) => st.toLowerCase().includes(qt))),
      );
    }

    if (query.keyword) {
      const kw = query.keyword.toLowerCase();
      results = results.filter(
        (s) =>
          s.name.toLowerCase().includes(kw) ||
          s.description.toLowerCase().includes(kw) ||
          s.tags.some((t) => t.toLowerCase().includes(kw)) ||
          s.routingKeywords.some((rk) => rk.toLowerCase().includes(kw)) ||
          s.category.toLowerCase().includes(kw),
      );
    }

    if (query.installedOnDevice) {
      const deviceId = query.installedOnDevice;
      results = results.filter(
        (s) => s.boardStatusByDevice[deviceId]?.installed === true,
      );
    }

    if (query.runningOnDevice) {
      const deviceId = query.runningOnDevice;
      results = results.filter(
        (s) => s.boardStatusByDevice[deviceId]?.running === true,
      );
    }

    const total = results.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    results = results.slice(offset, offset + limit);

    return { skills: results, total };
  }

  // ─── Board Status ───

  updateBoardStatus(
    skillId: string,
    deviceId: string,
    status: Partial<BoardStatus>,
  ): void {
    const skill = this.skills.get(skillId);
    if (!skill) return;
    const existing = skill.boardStatusByDevice[deviceId] ?? {
      installed: false,
      running: false,
      lastSyncAt: new Date().toISOString(),
    };
    skill.boardStatusByDevice[deviceId] = {
      ...existing,
      ...status,
      lastSyncAt: new Date().toISOString(),
    };
    this.dirty = true;
  }

  /**
   * Batch update board status for a device.
   * Called after a full board sync (packages + processes).
   */
  batchUpdateBoardStatus(
    deviceId: string,
    installed: Set<string>,
    running: Set<string>,
  ): number {
    let updated = 0;
    for (const skill of this.skills.values()) {
      const isNodeHub = skill.source === 'nodehub' && 'pkgName' in skill;
      const isModelZoo = skill.source === 'modelzoo' && 'processKey' in skill;
      const isTros = skill.source === 'tros' && 'pkgName' in skill;

      let skillInstalled = false;
      let skillRunning = false;

      if (isNodeHub || isTros) {
        const pkgName = (skill as any).pkgName as string;
        skillInstalled = installed.has(pkgName);
        const processKey = (skill as any).processKey as string | undefined;
        if (processKey) {
          skillRunning = running.has(processKey) ||
            Array.from(running).some((p) => new RegExp(processKey, 'i').test(p));
        }
      } else if (isModelZoo) {
        const modelPath = ((skill as any).modelPath as string).toLowerCase();
        skillInstalled = Array.from(installed).some((p) =>
          p.toLowerCase().includes(modelPath) || modelPath.includes(p.toLowerCase()),
        );
        const processKey = (skill as any).processKey as string;
        if (processKey) {
          skillRunning = Array.from(running).some((p) =>
            new RegExp(processKey, 'i').test(p),
          );
        }
      }

      const prev = skill.boardStatusByDevice[deviceId];
      if (
        !prev ||
        prev.installed !== skillInstalled ||
        prev.running !== skillRunning
      ) {
        skill.boardStatusByDevice[deviceId] = {
          installed: skillInstalled,
          running: skillRunning,
          lastSyncAt: new Date().toISOString(),
        };
        updated++;
      }
    }

    if (updated > 0) {
      this.dirty = true;
      this.flush();
    }
    return updated;
  }

  // ─── Refresh from Providers ───

  async refreshSource(source: EcoSource, platforms?: RdkPlatform[]): Promise<number> {
    const provider = this.providers.get(source);
    if (!provider) return 0;
    const skills = await provider.fetchAll(platforms);
    return this.upsertMany(skills);
  }

  async refreshAll(platforms?: RdkPlatform[]): Promise<Record<string, number>> {
    const results: Record<string, number> = {};
    for (const [source, provider] of this.providers) {
      try {
        const skills = await provider.fetchAll(platforms);
        results[source] = this.upsertMany(skills);
      } catch (err) {
        console.error(`[EcosystemRegistry] refresh ${source} failed:`, err);
        results[source] = 0;
      }
    }
    return results;
  }

  // ─── AI Context Generation ───

  /**
   * Build a concise context string for AI Dock's system prompt.
   * Lists installed / available / running skills for the given device.
   */
  buildAIContext(deviceId: string, platform?: RdkPlatform): string {
    const all = Array.from(this.skills.values()).filter(
      (s) => !platform || s.platforms.includes(platform),
    );

    const installed = all.filter(
      (s) => s.boardStatusByDevice[deviceId]?.installed,
    );
    const running = all.filter(
      (s) => s.boardStatusByDevice[deviceId]?.running,
    );
    const available = all.filter(
      (s) => !s.boardStatusByDevice[deviceId]?.installed,
    );

    const lines: string[] = [];
    if (running.length > 0) {
      lines.push(`运行中: ${running.map((s) => s.name).join(', ')}`);
    }
    if (installed.length > 0) {
      lines.push(`已安装: ${installed.map((s) => s.name).join(', ')}`);
    }
    if (available.length > 0) {
      const top = available.slice(0, 20);
      lines.push(`可用但未安装: ${top.map((s) => s.name).join(', ')}${available.length > 20 ? ` 等共 ${available.length} 个` : ''}`);
    }
    lines.push(`生态资源总数: ${all.length} (NodeHub ${all.filter((s) => s.source === 'nodehub').length} / ModelZoo ${all.filter((s) => s.source === 'modelzoo').length} / TROS ${all.filter((s) => s.source === 'tros').length})`);

    return lines.join('\n');
  }

  /**
   * Find skills relevant to a user query (for AI tool-use / function calling).
   * Returns top-N most relevant skills with their install/run commands.
   */
  findRelevantSkills(
    query: string,
    platform?: RdkPlatform,
    limit = 5,
  ): EcoSkill[] {
    const kw = query.toLowerCase();
    const scored = Array.from(this.skills.values())
      .filter((s) => !platform || s.platforms.includes(platform))
      .map((s) => {
        let score = 0;
        if (s.name.toLowerCase().includes(kw)) score += 10;
        if (s.description.toLowerCase().includes(kw)) score += 5;
        if (s.routingKeywords.some((rk) => kw.includes(rk.toLowerCase()))) score += 8;
        if (s.tags.some((t) => kw.includes(t.toLowerCase()))) score += 3;
        if (s.category.toLowerCase().includes(kw)) score += 2;
        return { skill: s, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map((x) => x.skill);
  }

  // ─── Persistence ───

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(REGISTRY_FILE)) {
        const data = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8')) as EcoSkill[];
        for (const skill of data) {
          this.skills.set(skill.id, skill);
        }
        console.log(`[EcosystemRegistry] loaded ${this.skills.size} skills from disk`);
      }
    } catch (err) {
      console.error('[EcosystemRegistry] failed to load from disk:', err);
    }
  }

  flush(): void {
    if (!this.dirty) return;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const data = Array.from(this.skills.values());
      fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2), 'utf-8');
      this.dirty = false;
    } catch (err) {
      console.error('[EcosystemRegistry] failed to persist:', err);
    }
  }

  get size(): number {
    return this.skills.size;
  }
}
