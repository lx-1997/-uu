/**
 * 每设备单例 SSH 交互式 shell（PTY），在同一 bash 中执行命令，保留 cd / export / source。
 * 与「每次 runRemoteCommands 新建 exec」相对，供 device_exec 在默认开启时使用。
 *
 * 禁用：环境变量 RDK_DEVICE_EXEC_PERSISTENT_SHELL=0
 */

import { Client } from 'ssh2';
import { randomBytes } from 'node:crypto';
import type { Duplex } from 'node:stream';
import {
  buildSshConnectConfig,
  SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS,
  type SshCredentials,
} from './ssh.js';
import { appendUtf8WithTailCap, DEFAULT_STREAM_OUTPUT_CHAR_LIMIT } from './utils/stream-output-limit.js';
import { buildSshPasswordCandidatesForDevice } from './device-ssh-credentials.js';
import { invalidateDevicesReadCache, readDevices } from './storage.js';
import { setDevicePasswordCache } from './device-password-cache.js';
import type { Device } from '../shared/types.js';

const READY_TOKEN = '__RDK_SHELL_READY__';
const MAX_SESSION_AGE_MS = 2 * 60 * 60 * 1000;
const IDLE_CLOSE_MS = 45 * 60 * 1000;

/**
 * PTY 常把本端写入的 `eval "$(printf ...` 整行回显到 stdout，且含超长 base64，易占满「最终结果」。
 * 连续剥掉若干行若以该回显开头（偶发重复回显或换行拆分）。
 */
function stripPtyEchoedEvalWrapper(raw: string): string {
  let t = raw.replace(/\r\n/g, '\n');
  while (true) {
    const lines = t.split('\n');
    if (lines.length === 0) break;
    const first = lines[0].trimStart();
    if (first.startsWith('eval "$(printf')) {
      t = lines.slice(1).join('\n').trimStart();
      continue;
    }
    break;
  }
  return t;
}

/** 供 exec 层二次净化；持久 shell 关闭时不会调用 */
export function sanitizePersistentShellOutputForDisplay(text: string): string {
  return stripPtyEchoedEvalWrapper(text);
}

function isTransientSshError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    /timed out|timeout|handshake|econnreset|econnrefused|socket closed|connection reset|connect failed|broken pipe|network|epipe/.test(msg) ||
    /channel closed|connection lost|disconnect|not connected|write econnreset|write epipe|read econnreset|unexpected packet|no response|ssh_exchange/.test(msg) ||
    /connection closed|closed by remote|kex_exchange|mac error|bad packet/.test(msg)
  );
}

function isSshAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /all configured authentication methods failed|permission denied|authentication failure|auth fail/.test(msg);
}

async function getDeviceFresh(deviceId: string): Promise<Device | null> {
  invalidateDevicesReadCache();
  const devices = await readDevices();
  return devices.find((d) => d.id === deviceId) ?? null;
}

class AsyncMutex {
  private tail = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(() => fn());
    this.tail = next.catch(() => {}).then(() => {});
    return next;
  }
}

const mutexByDevice = new Map<string, AsyncMutex>();
function getMutex(deviceId: string): AsyncMutex {
  let m = mutexByDevice.get(deviceId);
  if (!m) {
    m = new AsyncMutex();
    mutexByDevice.set(deviceId, m);
  }
  return m;
}

type SessionState = {
  deviceId: string;
  host: string;
  port: number;
  username: string;
  client: Client;
  stream: Duplex;
  buffer: string;
  /** 当前这条命令执行期间是否发生过输出截断 */
  outputTruncated: boolean;
  password: string;
  createdAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

const sessions = new Map<string, SessionState>();

function clearIdleTimer(s: SessionState) {
  if (s.idleTimer) {
    clearTimeout(s.idleTimer);
    s.idleTimer = null;
  }
}

function scheduleIdleClose(s: SessionState) {
  clearIdleTimer(s);
  s.idleTimer = setTimeout(() => {
    destroySession(s.deviceId);
  }, IDLE_CLOSE_MS);
}

function destroySession(deviceId: string) {
  const s = sessions.get(deviceId);
  if (!s) return;
  clearIdleTimer(s);
  sessions.delete(deviceId);
  try {
    s.stream.destroy();
  } catch {
    /* ignore */
  }
  try {
    s.client.end();
  } catch {
    /* ignore */
  }
}

function shouldRecycleSession(s: SessionState, device: Device): boolean {
  if (s.host !== device.host || s.port !== (device.port ?? 22) || s.username !== device.username) return true;
  if (Date.now() - s.createdAt > MAX_SESSION_AGE_MS) return true;
  return false;
}

/** 在 buffer 上等待子串（由调用方追加 data） */
function waitForSubstringInBuffer(
  getBuffer: () => string,
  token: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const iv = setInterval(() => {
      if (getBuffer().includes(token)) {
        clearInterval(iv);
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(new Error(`SSH shell 等待标记超时（${timeoutMs}ms）：${token}`));
      }
    }, 20);
  });
}

export type RunPersistentShellOptions = {
  timeoutMs?: number;
  onStreamChunk?: (text: string, stream: 'stdout' | 'stderr') => void;
  abortSignal?: AbortSignal;
  rejectOnNonZeroExit?: boolean;
};

/**
 * 在同一持久 bash 中执行一段 shell（可含换行）。返回合并后的 stdout 风格文本。
 */
export async function runPersistentShellCommand(
  deviceId: string,
  command: string,
  options: RunPersistentShellOptions = {},
): Promise<string> {
  const device = await getDeviceFresh(deviceId);
  if (!device) throw new Error(`设备 ${deviceId} 不存在`);

  return getMutex(deviceId).run(() => runPersistentShellCommandLocked(device, command, options));
}

async function runPersistentShellCommandLocked(
  device: Device,
  command: string,
  options: RunPersistentShellOptions,
): Promise<string> {
  const deviceId = device.id;
  const pwdList = buildSshPasswordCandidatesForDevice(device);
  if (pwdList.length === 0) {
    throw new Error('设备 SSH 密码未配置：请在设备管理中重新连接并保存密码，或设置环境变量 RDK_SSH_PASSWORD');
  }

  let lastError: unknown = null;
  for (const pwd of pwdList) {
    try {
      const out = await runWithPassword(device, pwd, command, options);
      setDevicePasswordCache(device.host, device.username, device.port ?? 22, pwd);
      return out;
    } catch (err) {
      lastError = err;
      if (isSshAuthError(err)) break;
      destroySession(deviceId);
      if (!isTransientSshError(err)) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'SSH 持久 shell 失败'));
}

async function runWithPassword(
  device: Device,
  password: string,
  command: string,
  options: RunPersistentShellOptions,
): Promise<string> {
  const deviceId = device.id;
  let s = sessions.get(deviceId);
  if (s && shouldRecycleSession(s, device)) {
    destroySession(deviceId);
    s = undefined;
  }

  if (!s) {
    const creds: SshCredentials = {
      host: device.host,
      port: device.port ?? 22,
      username: device.username,
      password,
    };
    const client = new Client();
    const stream = await new Promise<Duplex>((resolve, reject) => {
      client
        .on('ready', () => {
          client.shell({ cols: 120, rows: 40, term: 'xterm' }, (err, sh) => {
            if (err) {
              try {
                client.end();
              } catch {
                /* ignore */
              }
              reject(err);
              return;
            }
            resolve(sh as Duplex);
          });
        })
        .on('error', (e) => reject(e))
        .connect(buildSshConnectConfig(creds));
    });

    s = {
      deviceId,
      host: device.host,
      port: device.port ?? 22,
      username: device.username,
      client,
      stream,
      buffer: '',
      outputTruncated: false,
      password,
      createdAt: Date.now(),
      idleTimer: null,
    };
    sessions.set(deviceId, s);

    stream.on('data', (chunk: Buffer) => {
      const r = appendUtf8WithTailCap(s!.buffer, chunk, DEFAULT_STREAM_OUTPUT_CHAR_LIMIT * 2);
      s!.buffer = r.value;
      if (r.truncated) s!.outputTruncated = true;
    });
    stream.on('close', () => destroySession(deviceId));

    s.buffer = '';
    const init =
      'unset PROMPT_COMMAND 2>/dev/null; set +o history 2>/dev/null; PS1=""; export PS1=""; echo ' +
      READY_TOKEN +
      '\n';
    stream.write(init);
    await waitForSubstringInBuffer(() => s!.buffer, READY_TOKEN, 15_000);
    const idx = s.buffer.indexOf(READY_TOKEN);
    s.buffer = idx >= 0 ? s.buffer.slice(idx + READY_TOKEN.length) : '';
  }

  clearIdleTimer(s);
  s.outputTruncated = false;
  const timeoutMs = Math.max(5_000, Number(options.timeoutMs ?? SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS));
  const exitId = randomBytes(16).toString('hex');
  const b64 = Buffer.from(command.replace(/\r\n/g, '\n'), 'utf8').toString('base64');
  const b64Esc = b64.replace(/'/g, `'"'"'`);
  /** 先关回显再 eval，减少 PTY 把整行 eval+base64 回灌到捕获缓冲区 */
  const line =
    `stty -echo 2>/dev/null; eval "$(printf '%s' '${b64Esc}' | base64 -d)" 2>&1; EC=$?; stty echo 2>/dev/null; printf '\\n__RDK_EXIT__${exitId}__%s\\n' "$EC"\n`;

  s.stream.write(line);

  const output = await collectUntilExitMarker(s, exitId, timeoutMs, options);
  scheduleIdleClose(s);
  return output;
}

async function collectUntilExitMarker(
  s: SessionState,
  exitId: string,
  timeoutMs: number,
  options: RunPersistentShellOptions,
): Promise<string> {
  const marker = `__RDK_EXIT__${exitId}__`;
  const start = Date.now();

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(iv);
      options.abortSignal?.removeEventListener('abort', abort);
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const abort = () => {
      finish(() => {
        destroySession(s.deviceId);
        reject(new Error('SSH 命令已中止'));
      });
    };

    if (options.abortSignal?.aborted) {
      abort();
      return;
    }
    options.abortSignal?.addEventListener('abort', abort, { once: true });

    const timer = setTimeout(() => {
      finish(() => {
        destroySession(s.deviceId);
        reject(new Error(`SSH 命令执行超时（${timeoutMs}ms）`));
      });
    }, timeoutMs);

    const onCheck = () => {
      const buf = s.buffer;
      const mi = buf.lastIndexOf(marker);
      if (mi < 0) return;
      const tail = buf.slice(mi + marker.length);
      const m = tail.match(/^(\d+)/);
      if (!m) return;
      const code = parseInt(m[1], 10);
      const endPos = mi + marker.length + m[0].length;
      const rawOut = stripPtyEchoedEvalWrapper(buf.slice(0, mi));
      s.buffer = buf.slice(endPos);
      if (options.onStreamChunk && rawOut) {
        try {
          options.onStreamChunk(rawOut, 'stdout');
        } catch {
          /* ignore */
        }
      }
      const truncNote = s.outputTruncated
        ? '\n[OUTPUT TRUNCATED: stdout exceeded safe limit; tail retained]'
        : '';
      const combined = rawOut.trimEnd() + truncNote;
      if (code !== 0) {
        const parts: string[] = [];
        if (combined.trim()) parts.push(combined.trimEnd());
        parts.push(`[exit code: ${code}]`);
        const msg = parts.join('\n\n') || `Remote command failed with exit code ${code}`;
        finish(() => {
          if (options.rejectOnNonZeroExit === false) {
            resolve(msg);
          } else {
            reject(new Error(msg));
          }
        });
        return;
      }
      finish(() => resolve(combined));
    };

    const iv = setInterval(() => {
      if (Date.now() - start > timeoutMs) return;
      try {
        onCheck();
      } catch (e) {
        finish(() => reject(e instanceof Error ? e : new Error(String(e))));
      }
    }, 25);

    onCheck();
  });
}

export function isPersistentShellEnabled(): boolean {
  return String(process.env.RDK_DEVICE_EXEC_PERSISTENT_SHELL ?? '').trim() !== '0';
}
