/**
 * 按板型将 Studio 内置技能同步到板端 ~/.openclaw/workspace/skills/
 * - RDK X5: rdkx5_skills/ 下全部子目录（含 SKILL.md）
 * - RDK X3 / S100 / Ultra: skills/ 下文档与指南类技能组合（板型专章已并入 rdk-board-knowledge，不再单独同步 rdk-x3-guide / rdk-s100-guide）
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Request, Response } from 'express';
import type { Device } from '../../shared/types.js';
import type { RdkPlatform } from '../../shared/board-types.js';
import {
  buildBoardDetectionCommand,
  parseBoardDetection,
} from '../board/device-profiles.js';

type RunOnDevice = (
  request: Request,
  response: Response,
  id: string,
  commands: string[],
  options?: { timeoutMs?: number },
) => Promise<{ output: string; device?: unknown } | null>;

type ReadDevicesFn = () => Promise<Device[]>;

const SKILLS_ROOT = 'skills';
const RDKX5_SKILLS_ROOT = 'rdkx5_skills';

/** X3：开发者文档 + OpenClaw 协作 + 板卡能力 */
const BUNDLE_X3: string[] = [
  'rdk-developer-docs',
  'rdk-ecosystem',
  'rdk-app-development',
  'rdk-board-knowledge',
  'rdk-hardware',
  'rdk-openclaw-bridge',
  'rdk-openclaw',
  'rdk-rdkclaw-partner-advisory',
  'rdk-device-ops',
  'rdk-terminal',
  'rdk-files',
  'rdk-flash',
  'rdk-dev-efficiency',
];

/** S100 / Ultra：文档型技能包（与 X5 的 rdkx5_skills 互补） */
const BUNDLE_S100_LIKE: string[] = [
  'rdk-developer-docs',
  'rdk-ecosystem',
  'rdk-app-development',
  'rdk-board-knowledge',
  'rdk-hardware',
  'rdk-openclaw-bridge',
  'rdk-openclaw',
  'rdk-rdkclaw-partner-advisory',
  'rdk-device-ops',
  'rdk-terminal',
  'rdk-files',
  'rdk-dev-efficiency',
];

function listRdkX5SkillIds(cwd: string): string[] {
  const root = path.join(cwd, RDKX5_SKILLS_ROOT);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(root, name, 'SKILL.md')))
    .sort();
}

export function resolveSkillBundleForPlatform(platform: RdkPlatform | null): {
  root: typeof SKILLS_ROOT | typeof RDKX5_SKILLS_ROOT;
  skillIds: string[];
} {
  const cwd = process.cwd();
  if (platform === 'rdk-x5') {
    return { root: RDKX5_SKILLS_ROOT, skillIds: listRdkX5SkillIds(cwd) };
  }
  if (platform === 'rdk-x3') {
    return { root: SKILLS_ROOT, skillIds: [...BUNDLE_X3] };
  }
  if (platform === 'rdk-s100' || platform === 'rdk-ultra') {
    return { root: SKILLS_ROOT, skillIds: [...BUNDLE_S100_LIKE] };
  }
  return { root: SKILLS_ROOT, skillIds: [...BUNDLE_S100_LIKE] };
}

function readLocalSkillMd(cwd: string, root: string, skillId: string): string | null {
  const p = path.join(cwd, root, skillId, 'SKILL.md');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

async function deployOneSkill(
  runOnDevice: RunOnDevice,
  request: Request,
  response: Response,
  deviceId: string,
  skillId: string,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const skillDir = `/root/.openclaw/workspace/skills/${skillId}`;
  const contentB64 = Buffer.from(content, 'utf8').toString('base64');
  const writeCmd = `bash -lc "mkdir -p '${skillDir}' && echo '${contentB64}' | base64 -d > '${skillDir}/SKILL.md' && echo OC_SKILL_WRITE_OK"`;
  const second = await runOnDevice(request, response, deviceId, [writeCmd], { timeoutMs: 120_000 });
  if (!second) return { ok: false, error: 'ssh_aborted' };
  const out = String(second.output || '').trim();
  if (!out.includes('OC_SKILL_WRITE_OK')) {
    return { ok: false, error: out.slice(0, 400) };
  }
  return { ok: true };
}

/**
 * POST /api/devices/:id/openclaw/ensure-board-skill-bundle
 */
export async function handleEnsureBoardSkillBundle(
  runOnDevice: RunOnDevice,
  readDevicesFn: ReadDevicesFn,
  request: Request,
  response: Response,
  deviceId: string,
): Promise<void> {
  const devices = await readDevicesFn();
  const device = devices.find((d) => d.id === deviceId);
  if (!device) {
    response.status(404).json({ ok: false, error: '设备不存在' });
    return;
  }

  let platform = device.boardPlatform as RdkPlatform | null | undefined;

  if (!platform) {
    const detectCmd = buildBoardDetectionCommand();
    const executed = await runOnDevice(request, response, deviceId, [`bash -lc ${JSON.stringify(detectCmd)}`], {
      timeoutMs: 45_000,
    });
    if (!executed) return;
    const parsed = parseBoardDetection(executed.output);
    platform = parsed.platform;
  }

  if (!platform) {
    response.json({
      ok: false,
      code: 'BOARD_PLATFORM_UNKNOWN',
      message: '无法识别板型。请先调用 POST /api/devices/:id/board/detect?persist=1 或在设备信息中保存 boardPlatform。',
      deployed: [],
      skipped: [],
    });
    return;
  }

  const { root, skillIds } = resolveSkillBundleForPlatform(platform);
  const cwd = process.cwd();
  const deployed: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const errors: { id: string; message: string }[] = [];

  for (const id of skillIds) {
    const content = readLocalSkillMd(cwd, root, id);
    if (!content) {
      skipped.push({ id, reason: 'local_skill_missing' });
      continue;
    }
    const r = await deployOneSkill(runOnDevice, request, response, deviceId, id, content);
    if (r.ok) deployed.push(id);
    else if (r.error === 'ssh_aborted') return;
    else errors.push({ id, message: r.error || 'write_failed' });
  }

  response.json({
    ok: errors.length === 0,
    platform,
    bundleRoot: root,
    deployed,
    skipped,
    errors,
    message:
      deployed.length > 0
        ? `已同步 ${deployed.length} 个技能到板端（${platform}）`
        : '未写入任何技能（请检查本机 skills / rdkx5_skills 目录）',
  });
}
