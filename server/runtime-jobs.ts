import { promises as fs } from 'node:fs';
import path from 'node:path';

export type OpenClawDeployStepName = 'check' | 'prepare' | 'install' | 'config';
export type OpenClawDeployStepState = 'pending' | 'running' | 'done' | 'error';

export type OpenClawDeployJob = {
  id: string;
  deviceId: string;
  status: 'running' | 'done' | 'error';
  steps: Record<OpenClawDeployStepName, OpenClawDeployStepState>;
  output: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};

export type FlashBackupJob = {
  id: string;
  deviceId: string;
  status: 'running' | 'done' | 'error';
  outputPath?: string;
  output?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};

export const openClawDeployJobs = new Map<string, OpenClawDeployJob>();
export const flashBackupJobs = new Map<string, FlashBackupJob>();

export const OPENCLAW_DEPLOY_JOB_TTL_MS = 6 * 60 * 60 * 1000;
export const FLASH_BACKUP_JOB_TTL_MS = 24 * 60 * 60 * 1000;
export const RUNTIME_JOBS_STATE_FILE = 'runtime-jobs.json';

let runtimeJobsPersistTimer: ReturnType<typeof setTimeout> | null = null;

/** 供 HTTP 路由在返回前做 GC，与 persist 内联清理逻辑一致 */
export function cleanupOpenClawDeployJobs(now = Date.now()) {
  let changed = false;
  for (const [jobId, job] of openClawDeployJobs.entries()) {
    const doneAt = job.finishedAt ?? job.startedAt;
    if (now - doneAt > OPENCLAW_DEPLOY_JOB_TTL_MS) {
      openClawDeployJobs.delete(jobId);
      changed = true;
    }
  }
  if (changed) schedulePersistRuntimeJobs();
}

export function cleanupFlashBackupJobs(now = Date.now()) {
  let changed = false;
  for (const [jobId, job] of flashBackupJobs.entries()) {
    const doneAt = job.finishedAt ?? job.startedAt;
    if (now - doneAt > FLASH_BACKUP_JOB_TTL_MS) {
      flashBackupJobs.delete(jobId);
      changed = true;
    }
  }
  if (changed) schedulePersistRuntimeJobs();
}

function runtimeJobsStatePath() {
  const dataDir = process.env.RDK_DATA_DIR ?? path.resolve(process.cwd(), 'data');
  return path.join(dataDir, RUNTIME_JOBS_STATE_FILE);
}

export function schedulePersistRuntimeJobs() {
  if (runtimeJobsPersistTimer) return;
  runtimeJobsPersistTimer = setTimeout(() => {
    runtimeJobsPersistTimer = null;
    void persistRuntimeJobsState();
  }, 200);
}

async function persistRuntimeJobsState() {
  cleanupOpenClawDeployJobs();
  cleanupFlashBackupJobs();
  const snapshot = {
    updatedAt: Date.now(),
    openClawDeployJobs: Array.from(openClawDeployJobs.values()),
    flashBackupJobs: Array.from(flashBackupJobs.values()),
  };
  try {
    const target = runtimeJobsStatePath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(snapshot, null, 2), 'utf-8');
  } catch (error) {
    console.warn('[jobs] persist state failed:', error instanceof Error ? error.message : error);
  }
}

export async function restoreRuntimeJobsState() {
  try {
    const target = runtimeJobsStatePath();
    const raw = await fs.readFile(target, 'utf-8');
    const parsed = JSON.parse(raw) as {
      openClawDeployJobs?: OpenClawDeployJob[];
      flashBackupJobs?: FlashBackupJob[];
    };
    const now = Date.now();

    for (const item of parsed.openClawDeployJobs ?? []) {
      if (!item?.id || !item.deviceId) continue;
      const normalized: OpenClawDeployJob = {
        ...item,
        status: item.status === 'running' ? 'error' : item.status,
        error: item.status === 'running'
          ? '服务重启后任务中断，请重新发起部署'
          : item.error,
        finishedAt: item.status === 'running' ? now : item.finishedAt,
      };
      openClawDeployJobs.set(normalized.id, normalized);
    }

    for (const item of parsed.flashBackupJobs ?? []) {
      if (!item?.id || !item.deviceId) continue;
      const normalized: FlashBackupJob = {
        ...item,
        status: item.status === 'running' ? 'error' : item.status,
        error: item.status === 'running'
          ? '服务重启后任务中断，请重新发起备份'
          : item.error,
        finishedAt: item.status === 'running' ? now : item.finishedAt,
      };
      flashBackupJobs.set(normalized.id, normalized);
    }

    cleanupOpenClawDeployJobs(now);
    cleanupFlashBackupJobs(now);
    console.log(`[jobs] restored deploy=${openClawDeployJobs.size} backup=${flashBackupJobs.size}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      console.warn('[jobs] restore state failed:', error instanceof Error ? error.message : error);
    }
  }
}

export function appendDeployOutput(job: OpenClawDeployJob, chunk: string) {
  job.output += chunk;
  if (job.output.length > 250_000) {
    job.output = job.output.slice(job.output.length - 250_000);
  }
  schedulePersistRuntimeJobs();
}

/** 设备移除时清理与该设备关联的运行中任务记录 */
export function purgeRuntimeJobsForDevice(deviceId: string): { removedDeployJobs: number; removedFlashJobs: number } {
  let removedDeployJobs = 0;
  for (const [jobId, job] of openClawDeployJobs.entries()) {
    if (job.deviceId === deviceId) {
      openClawDeployJobs.delete(jobId);
      removedDeployJobs += 1;
    }
  }
  let removedFlashJobs = 0;
  for (const [jobId, job] of flashBackupJobs.entries()) {
    if (job.deviceId === deviceId) {
      flashBackupJobs.delete(jobId);
      removedFlashJobs += 1;
    }
  }
  if (removedDeployJobs > 0 || removedFlashJobs > 0) {
    schedulePersistRuntimeJobs();
  }
  return { removedDeployJobs, removedFlashJobs };
}
