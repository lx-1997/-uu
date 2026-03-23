/**
 * OpenClaw 一键部署状态轮询：挂在全局，避免离开 OpenClaw 页面后 unmount 导致轮询被清掉、任务无后续。
 */
import { resolveApiUrl } from './apiBase';

export type DeployStepName = 'check' | 'prepare' | 'install' | 'config';
export type DeployStepState = 'pending' | 'running' | 'done' | 'error';

export interface OpenClawDeployJobPayload {
  id: string;
  deviceId: string;
  status: 'running' | 'done' | 'error';
  steps: Record<DeployStepName, DeployStepState>;
  output?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

type JobListener = (job: OpenClawDeployJobPayload) => void;

const listeners = new Set<JobListener>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let activeDeviceId = '';
let activeJobId = '';
let lastEmittedTerminal: string | null = null;

export function deployJobStorageKey(deviceId: string) {
  return `oc-deploy-job-${deviceId}`;
}

export function subscribeOpenClawDeployJob(listener: JobListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(job: OpenClawDeployJobPayload) {
  listeners.forEach((fn) => {
    try {
      fn(job);
    } catch {
      /* ignore */
    }
  });
}

export async function fetchOpenClawDeployJob(
  deviceId: string,
  jobId: string,
): Promise<OpenClawDeployJobPayload | null> {
  const url = resolveApiUrl(
    `/api/devices/${encodeURIComponent(deviceId)}/openclaw/deploy/status?jobId=${encodeURIComponent(jobId)}`,
  );
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { ok?: boolean; job?: OpenClawDeployJobPayload };
  if (!data?.ok || !data.job) return null;
  return data.job;
}

async function fetchJobStatus(): Promise<OpenClawDeployJobPayload | null> {
  return fetchOpenClawDeployJob(activeDeviceId, activeJobId);
}

function clearTimer() {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

async function tick() {
  const job = await fetchJobStatus();
  if (!job) return;
  emit(job);
  if (job.status === 'running') return;

  clearTimer();
  try {
    localStorage.removeItem(deployJobStorageKey(activeDeviceId));
  } catch {
    /* ignore */
  }

  const sig = `${job.id}:${job.status}`;
  if (lastEmittedTerminal !== sig) {
    lastEmittedTerminal = sig;
    window.dispatchEvent(
      new CustomEvent('rdk-oc-deploy-finished', {
        detail: { status: job.status, error: job.error, job },
      }),
    );
  }
}

/** 开始或继续轮询（与 OpenClaw 页内 beginDeployPolling 行为一致） */
export function startOpenClawDeployPoll(deviceId: string, jobId: string) {
  if (!deviceId || !jobId) return;
  clearTimer();
  activeDeviceId = deviceId;
  activeJobId = jobId;
  lastEmittedTerminal = null;
  void tick();
  intervalId = setInterval(() => {
    void tick();
  }, 2500);
}

/** 根据 localStorage 恢复轮询（设备切换时调用） */
export function syncOpenClawDeployPollFromStorage(deviceId: string) {
  if (!deviceId) {
    clearTimer();
    activeDeviceId = '';
    activeJobId = '';
    return;
  }
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(deployJobStorageKey(deviceId));
  } catch {
    saved = null;
  }
  if (saved?.trim()) {
    startOpenClawDeployPoll(deviceId, saved.trim());
  } else {
    clearTimer();
    activeDeviceId = '';
    activeJobId = '';
  }
}

export function stopOpenClawDeployPoll() {
  clearTimer();
  activeDeviceId = '';
  activeJobId = '';
}
