/**
 * Ecosystem Module — Unified entry point.
 *
 * Initializes the registry, registers all providers, exposes Express routes,
 * and starts periodic refresh.
 *
 * Usage in server/index.ts:
 *   import { createEcosystemRouter, initEcosystem } from './ecosystem/index.js';
 *   const eco = initEcosystem();
 *   app.use('/api/ecosystem', createEcosystemRouter(eco, runOnDeviceFn));
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { RdkPlatform, EcoSearchQuery } from '../../shared/ecosystem-types.js';

/** Safely extract a single string from Express query params. */
const qs = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : Array.isArray(v) ? String(v[0]) : undefined;
const qp = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));
import { EcosystemRegistry } from './registry.js';
import { NodeHubProvider } from './providers/nodehub.js';
import { ModelZooProvider } from './providers/modelzoo.js';
import { TrosProvider } from './providers/tros.js';
import { OpenClawSkillProvider } from './providers/openclaw-skills.js';
import { buildSyncCommand, applyBoardSync } from './board-sync.js';
import {
  generateSkillMd,
  buildProvisionCommands,
  buildDeprovisionCommands,
  validateProvision,
} from './skill-provisioner.js';
import {
  buildBoardDetectionCommand,
  parseBoardDetection,
  getDeviceProfile,
} from './device-profiles.js';

export interface EcosystemContext {
  registry: EcosystemRegistry;
}

/**
 * Initialize the ecosystem: create registry, register providers, do first refresh.
 */
export function initEcosystem(): EcosystemContext {
  const registry = new EcosystemRegistry();

  registry.registerProvider(new NodeHubProvider());
  registry.registerProvider(new ModelZooProvider());
  registry.registerProvider(new TrosProvider());
  registry.registerProvider(new OpenClawSkillProvider());

  // Initial load (async, non-blocking)
  registry.refreshAll().then((counts) => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`[Ecosystem] initialized with ${total} skills:`, counts);
  });

  // Periodic refresh every 6 hours
  setInterval(
    () => {
      registry.refreshAll().catch((err) => {
        console.error('[Ecosystem] periodic refresh failed:', err);
      });
    },
    6 * 60 * 60 * 1000,
  );

  return { registry };
}

/**
 * Callback type for running commands on a device.
 * Matches the existing `runOnDevice` pattern in server/index.ts.
 */
type RunOnDeviceFn = (
  deviceId: string,
  commands: string[],
) => Promise<{ output: string } | null>;

/**
 * Create Express router with all ecosystem API endpoints.
 */
export function createEcosystemRouter(
  ctx: EcosystemContext,
  runOnDevice: RunOnDeviceFn,
): Router {
  const router = Router();
  const { registry } = ctx;

  // ─── Search ───
  router.get('/search', (req: Request, res: Response) => {
    const tagsRaw = qs(req.query.tags);
    const query: EcoSearchQuery = {
      keyword: qs(req.query.q),
      source: qs(req.query.source) as any,
      category: qs(req.query.category),
      platform: qs(req.query.platform) as RdkPlatform | undefined,
      tags: tagsRaw ? tagsRaw.split(',') : undefined,
      installedOnDevice: qs(req.query.installedOn),
      runningOnDevice: qs(req.query.runningOn),
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    };

    const result = registry.search(query);
    res.json(result);
  });

  // ─── Get single skill ───
  router.get('/skills/:id', (req: Request, res: Response) => {
    const skill = registry.getSkill(qp(req.params.id));
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }
    res.json({ skill });
  });

  // ─── Refresh from providers ───
  router.post('/refresh', async (_req: Request, res: Response) => {
    try {
      const counts = await registry.refreshAll();
      res.json({ ok: true, counts, total: registry.size });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Refresh failed',
      });
    }
  });

  // ─── Board sync ───
  router.post('/sync/:deviceId', async (req: Request, res: Response) => {
    const deviceId = qp(req.params.deviceId);
    try {
      const result = await runOnDevice(deviceId, [buildSyncCommand()]);
      if (!result) {
        res.status(500).json({ error: '板端同步命令执行失败' });
        return;
      }
      const syncResult = applyBoardSync(deviceId, result.output, registry);
      res.json({ ok: true, ...syncResult });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : '板端同步失败',
      });
    }
  });

  // ─── Detect board platform ───
  router.post('/detect/:deviceId', async (req: Request, res: Response) => {
    const deviceId = qp(req.params.deviceId);
    try {
      const result = await runOnDevice(deviceId, [buildBoardDetectionCommand()]);
      if (!result) {
        res.status(500).json({ error: '设备检测失败' });
        return;
      }
      const detection = parseBoardDetection(result.output);
      const profile = detection.platform
        ? getDeviceProfile(detection.platform)
        : null;
      res.json({
        ok: true,
        platform: detection.platform,
        model: detection.model,
        osVersion: detection.osVersion,
        profile,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : '设备检测失败',
      });
    }
  });

  // ─── Install skill on device ───
  router.post('/skills/:id/install', async (req: Request, res: Response) => {
    const skill = registry.getSkill(qp(req.params.id));
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    const { deviceId } = req.body as { deviceId?: string };
    if (!deviceId) {
      res.status(400).json({ error: 'deviceId 不能为空' });
      return;
    }

    try {
      const result = await runOnDevice(deviceId, [
        `bash -lc '${skill.installCmd}'`,
      ]);
      if (!result) {
        res.status(500).json({ error: '安装命令执行失败' });
        return;
      }

      registry.updateBoardStatus(skill.id, deviceId, { installed: true });
      registry.flush();

      res.json({
        ok: true,
        skillId: skill.id,
        output: result.output,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : '安装失败',
      });
    }
  });

  // ─── Run skill on device ───
  router.post('/skills/:id/run', async (req: Request, res: Response) => {
    const skill = registry.getSkill(qp(req.params.id));
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    const { deviceId } = req.body as { deviceId?: string };
    if (!deviceId) {
      res.status(400).json({ error: 'deviceId 不能为空' });
      return;
    }

    try {
      const result = await runOnDevice(deviceId, [
        `bash -lc '${skill.runCmd}'`,
      ]);
      if (!result) {
        res.status(500).json({ error: '运行命令执行失败' });
        return;
      }

      registry.updateBoardStatus(skill.id, deviceId, {
        installed: true,
        running: true,
      });
      registry.flush();

      res.json({
        ok: true,
        skillId: skill.id,
        output: result.output,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : '运行失败',
      });
    }
  });

  // ─── Stop skill on device ───
  router.post('/skills/:id/stop', async (req: Request, res: Response) => {
    const skill = registry.getSkill(qp(req.params.id));
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    const { deviceId } = req.body as { deviceId?: string };
    if (!deviceId) {
      res.status(400).json({ error: 'deviceId 不能为空' });
      return;
    }

    const stopCmd = skill.stopCmd || `echo "No stop command for ${skill.name}"`;
    try {
      const result = await runOnDevice(deviceId, [
        `bash -lc '${stopCmd}'`,
      ]);

      registry.updateBoardStatus(skill.id, deviceId, { running: false });
      registry.flush();

      res.json({
        ok: true,
        skillId: skill.id,
        output: result?.output ?? '',
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : '停止失败',
      });
    }
  });

  // ─── Uninstall skill from device ───
  router.post('/skills/:id/uninstall', async (req: Request, res: Response) => {
    const skill = registry.getSkill(qp(req.params.id));
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    const { deviceId } = req.body as { deviceId?: string };
    if (!deviceId) {
      res.status(400).json({ error: 'deviceId 不能为空' });
      return;
    }

    const uninstallCmd = skill.uninstallCmd || `echo "No uninstall command"`;
    try {
      const result = await runOnDevice(deviceId, [
        `bash -lc '${uninstallCmd}'`,
      ]);

      registry.updateBoardStatus(skill.id, deviceId, {
        installed: false,
        running: false,
      });
      registry.flush();

      res.json({
        ok: true,
        skillId: skill.id,
        output: result?.output ?? '',
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : '卸载失败',
      });
    }
  });

  // ─── Provision skill as OpenClaw skill on board ───
  router.post(
    '/skills/:id/provision',
    async (req: Request, res: Response) => {
      const skill = registry.getSkill(qp(req.params.id));
      if (!skill) {
        res.status(404).json({ error: 'Skill not found' });
        return;
      }

      const { deviceId, platform, targetPath } = req.body as {
        deviceId?: string;
        platform?: string;
        targetPath?: string;
      };
      if (!deviceId) {
        res.status(400).json({ error: 'deviceId 不能为空' });
        return;
      }

      if (platform) {
        const validation = validateProvision(skill, platform);
        if (!validation.valid) {
          res.status(400).json({ error: validation.reason });
          return;
        }
      }

      const commands = buildProvisionCommands(skill, targetPath);
      try {
        const result = await runOnDevice(deviceId, commands);
        if (!result) {
          res.status(500).json({ error: 'Skill 注入命令执行失败' });
          return;
        }

        res.json({
          ok: true,
          skillId: skill.id,
          deviceId,
          message: `${skill.name} 已注册为 OpenClaw Skill`,
          output: result.output,
        });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Skill 注入失败',
        });
      }
    },
  );

  // ─── De-provision skill from board ───
  router.post(
    '/skills/:id/deprovision',
    async (req: Request, res: Response) => {
      const { deviceId, targetPath } = req.body as {
        deviceId?: string;
        targetPath?: string;
      };
      if (!deviceId) {
        res.status(400).json({ error: 'deviceId 不能为空' });
        return;
      }

      const commands = buildDeprovisionCommands(qp(req.params.id), targetPath);
      try {
        const result = await runOnDevice(deviceId, commands);
        res.json({
          ok: true,
          skillId: qp(req.params.id),
          deviceId,
          message: 'Skill 已从板端移除',
          output: result?.output ?? '',
        });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Skill 移除失败',
        });
      }
    },
  );

  // ─── AI Context (for AI Dock system prompt injection) ───
  router.get('/ai-context/:deviceId', (req: Request, res: Response) => {
    const deviceId = qp(req.params.deviceId);
    const platform = qs(req.query.platform) as RdkPlatform | undefined;
    const context = registry.buildAIContext(deviceId, platform);
    const qStr = qs(req.query.q);
    const relevant = qStr
      ? registry.findRelevantSkills(
          qStr,
          platform,
          Number(req.query.limit ?? 5),
        )
      : [];

    res.json({ context, relevant });
  });

  // ─── Stats ───
  router.get('/stats', (_req: Request, res: Response) => {
    const all = registry.getAllSkills();
    const bySource: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const byPlatform: Record<string, number> = {};

    for (const skill of all) {
      bySource[skill.source] = (bySource[skill.source] ?? 0) + 1;
      byCategory[skill.category] = (byCategory[skill.category] ?? 0) + 1;
      for (const p of skill.platforms) {
        byPlatform[p] = (byPlatform[p] ?? 0) + 1;
      }
    }

    res.json({ total: all.length, bySource, byCategory, byPlatform });
  });

  return router;
}

export { EcosystemRegistry } from './registry.js';
export { buildSyncCommand, applyBoardSync } from './board-sync.js';
export {
  generateSkillMd,
  buildProvisionCommands,
  validateProvision,
} from './skill-provisioner.js';
export {
  DEVICE_PROFILES,
  detectPlatform,
  getDeviceProfile,
  buildBoardDetectionCommand,
  parseBoardDetection,
} from './device-profiles.js';
