/**
 * OpenClaw 一键部署状态：SSE 实时日志 + 轮询兜底（离开 OpenClaw 页后仍由全局 Host 续跑）。
 */
import { resolveApiUrl, resolveOpenClawDeployStreamUrl } from './apiBase';

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
let consecutiveFailures = 0;

/** 无 SSE 时较快轮询，便于网络差时仍能更新 */
const POLL_MS_NO_SSE = 800;
/** SSE 已连接时降低轮询频率，仅作状态兜底 */
const POLL_MS_WITH_SSE = 4500;
const POLL_REQUEST_TIMEOUT_MS = 6000;
const MAX_CONSECUTIVE_FAILURES = 6;

let deployEventSource: EventSource | null = null;
/** 与 SSE log 事件合并用的最新任务快照 */
let sseJobMergeRef: OpenClawDeployJobPayload | null = null;

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), POLL_REQUEST_TIMEOUT_MS);
  const res = await fetch(url, { signal: controller.signal, credentials: 'include' }).finally(() =>
    clearTimeout(timeout),
  );
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

function closeDeployEventSource() {
  if (deployEventSource) {
    deployEventSource.onopen = null;
    deployEventSource.onmessage = null;
    deployEventSource.onerror = null;
    deployEventSource.close();
    deployEventSource = null;
  }
  sseJobMergeRef = null;
}

function restartPollInterval(ms: number) {
  clearTimer();
  intervalId = setInterval(() => {
    void tick();
  }, ms);
}

async function tick() {
  let job: OpenClawDeployJobPayload | null = null;
  let failed = false;
  try {
    job = await fetchJobStatus();
  } catch {
    failed = true;
  }
  if (!job) {
    if (!failed) failed = true;
    if (failed) consecutiveFailures += 1;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      clearTimer();
      closeDeployEventSource();
      window.dispatchEvent(
        new CustomEvent('rdk-oc-deploy-finished', {
          detail: {
            status: 'error',
            error: 'oc.deployPoll.interrupted',
          },
        }),
      );
    }
    return;
  }
  consecutiveFailures = 0;
  sseJobMergeRef = job;
  emit(job);
  if (job.status === 'running') return;

  clearTimer();
  closeDeployEventSource();
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
  closeDeployEventSource();
  clearTimer();
  activeDeviceId = deviceId;
  activeJobId = jobId;
  lastEmittedTerminal = null;
  consecutiveFailures = 0;
  void tick();
  restartPollInterval(POLL_MS_NO_SSE);

  const streamUrl = resolveOpenClawDeployStreamUrl(deviceId, jobId);
  deployEventSource = new EventSource(streamUrl);
  deployEventSource.onmessage = (ev: MessageEvent) => {
    try {
      const d = JSON.parse(ev.data) as { type?: string; text?: string; job?: OpenClawDeployJobPayload };
      if (d.type === 'job' && d.job) {
        sseJobMergeRef = d.job;
        emit(d.job);
        return;
      }
      if (d.type === 'log' && typeof d.text === 'string' && sseJobMergeRef) {
        sseJobMergeRef = { ...sseJobMergeRef, output: (sseJobMergeRef.output || '') + d.text };
        emit(sseJobMergeRef);
      }
    } catch {
      /* ignore */
    }
  };
  deployEventSource.onopen = () => {
    restartPollInterval(POLL_MS_WITH_SSE);
  };
  deployEventSource.onerror = () => {
    const keepPolling =
      sseJobMergeRef?.status !== 'done' && sseJobMergeRef?.status !== 'error';
    closeDeployEventSource();
    if (keepPolling && activeDeviceId && activeJobId) {
      restartPollInterval(POLL_MS_NO_SSE);
    }
  };
}

/** 根据 localStorage 恢复轮询（设备切换时调用） */
export function syncOpenClawDeployPollFromStorage(deviceId: string) {
  if (!deviceId) {
    clearTimer();
    closeDeployEventSource();
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
    closeDeployEventSource();
    activeDeviceId = '';
    activeJobId = '';
  }
}

export function stopOpenClawDeployPoll() {
  clearTimer();
  closeDeployEventSource();
  activeDeviceId = '';
  activeJobId = '';
  consecutiveFailures = 0;
}
