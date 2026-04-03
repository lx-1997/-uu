import { Client, type ConnectConfig } from 'ssh2';
import {
  appendUtf8WithTailCap,
  DEFAULT_STREAM_OUTPUT_CHAR_LIMIT,
  STDERR_STREAM_CHAR_LIMIT,
} from './utils/stream-output-limit.js';

/** ssh2 在 TCP 连通后等待 SSH 握手完成的最长时间。写盘等高 I/O 场景下 8s 易触发「Timed out while waiting for handshake」。 */
export const SSH_READY_TIMEOUT_MS = 30_000;

/** 与 OpenClawDeploymentManager 对齐，减少 NAT/中间设备 idle 断连 */
export const SSH_KEEPALIVE_INTERVAL_MS = 30_000;
export const SSH_KEEPALIVE_COUNT_MAX = 3;

/**
 * 单条 `exec` 管道默认最长等待（未传 `timeoutMs`）。
 * 板端 pip/npm/wget 常超过数分钟；120s 易误判为「不稳定」。
 */
export const SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;

/** 仅保留产品默认 root；其它常见口令请用 RDK_DEFAULT_PASSWORDS（逗号分隔），避免自动误试锁账户 */
const BUILTIN_DEFAULT_PASSWORDS = ['root'];

/**
 * 板端常见默认口令候选（与 index 中设备发现逻辑一致）。
 * 用于 Agent 侧在已保存密码失效时尝试，避免 RDKClaw 与 HTTP 链路表现不一致。
 */
export function sshPasswordCandidates(username: string): string[] {
  const envExtra = String(process.env.RDK_DEFAULT_PASSWORDS ?? '').trim();
  const extraPasswords = envExtra ? envExtra.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const candidates = [
    username,
    ...BUILTIN_DEFAULT_PASSWORDS,
    ...extraPasswords,
  ].filter(Boolean);
  return Array.from(new Set(candidates));
}

function sshConnectBase(credentials: SshCredentials): ConnectConfig {
  const pwd = credentials.password;
  const kb =
    typeof pwd === 'string' && pwd.length > 0
      ? {
          tryKeyboard: true,
          onKeyboardInteractive: (
            _name: string,
            _instr: string,
            _lang: string,
            prompts: { prompt: string; echo?: boolean }[],
            finish: (responses: string[]) => void,
          ) => {
            if (prompts.length) finish(prompts.map(() => pwd));
            else finish([]);
          },
        }
      : {};
  return {
    host: credentials.host,
    port: credentials.port ?? 22,
    username: credentials.username,
    password: pwd,
    readyTimeout: SSH_READY_TIMEOUT_MS,
    keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
    keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
    ...kb,
  } as ConnectConfig;
}

export interface SshCredentials {
  host: string;
  username: string;
  password: string;
  port?: number;
}

export interface RunRemoteCommandOptions {
  timeoutMs?: number;
  /** 每收到一段远程 stdout/stderr 即回调（用于长命令 UI 进度，不做截断） */
  onStreamChunk?: (text: string, stream: 'stdout' | 'stderr') => void;
}

export interface VerifySshConnectionOptions {
  /** 默认 30s；轮询 ping 等场景用较短值，避免关机后长时间卡在握手 */
  readyTimeoutMs?: number;
}

export function verifySshConnection(credentials: SshCredentials, options?: VerifySshConnectionOptions) {
  const readyTimeout = Number.isFinite(options?.readyTimeoutMs)
    ? Math.max(2000, Number(options?.readyTimeoutMs))
    : SSH_READY_TIMEOUT_MS;

  return new Promise<void>((resolve, reject) => {
    const client = new Client();

    client
      .on('ready', () => {
        client.end();
        resolve();
      })
      .on('error', (error) => {
        reject(error);
      })
      .connect({
        ...sshConnectBase(credentials),
        readyTimeout,
      });
  });
}

export function runRemoteCommands(
  credentials: SshCredentials,
  commands: string[],
  options: RunRemoteCommandOptions = {},
) {
  const onStreamChunk = options.onStreamChunk;
  // Existing function
  return new Promise<string>((resolve, reject) => {
    const client = new Client();
    const timeoutMs = Math.max(5_000, Number(options.timeoutMs ?? SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS));
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      client.end();
      reject(new Error(`SSH 命令执行超时（${timeoutMs}ms）`));
    }, timeoutMs);

    const safeResolve = (output: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(output);
    };

    const safeReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    client
      .on('ready', () => {
        const fullCommand = commands.filter(Boolean).join(' && ');
        client.exec(fullCommand, { env: { TERM: 'xterm', DEBIAN_FRONTEND: 'noninteractive' } }, (error, stream) => {
          if (error) {
            client.end();
            safeReject(error);
            return;
          }

          let stdout = '';
          let stderr = '';
          let stdoutTrunc = false;
          let stderrTrunc = false;

          stream
            .on('close', (code: number | null) => {
              client.end();
              const truncNote =
                (stdoutTrunc || stderrTrunc)
                  ? '\n[OUTPUT TRUNCATED: stdout/stderr exceeded safe limit; tail retained]'
                  : '';
              if (code && code !== 0) {
                safeReject(new Error((stderr + truncNote) || `Remote command failed with exit code ${code}`));
                return;
              }

              safeResolve(stdout + (stdoutTrunc || stderrTrunc ? truncNote : ''));
            })
            .on('data', (chunk: Buffer) => {
              if (onStreamChunk && chunk.length) {
                try {
                  onStreamChunk(chunk.toString('utf8'), 'stdout');
                } catch {
                  /* ignore progress callback errors */
                }
              }
              const r = appendUtf8WithTailCap(stdout, chunk, DEFAULT_STREAM_OUTPUT_CHAR_LIMIT);
              stdout = r.value;
              if (r.truncated) stdoutTrunc = true;
            });

          stream.stderr.on('data', (chunk: Buffer) => {
            if (onStreamChunk && chunk.length) {
              try {
                onStreamChunk(chunk.toString('utf8'), 'stderr');
              } catch {
                /* ignore */
              }
            }
            const r = appendUtf8WithTailCap(stderr, chunk, STDERR_STREAM_CHAR_LIMIT);
            stderr = r.value;
            if (r.truncated) stderrTrunc = true;
          });
        });
      })
      .on('error', (error) => {
        safeReject(error);
      })
      .connect(sshConnectBase(credentials));
  });
}

export interface UploadFileSftpOptions {
  /** 默认与 SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS 一致；大文件 base64 解码写盘可能较慢 */
  timeoutMs?: number;
}

export function uploadFileSftp(
  credentials: SshCredentials,
  remotePath: string,
  buffer: Buffer,
  options: UploadFileSftpOptions = {},
) {
  // Stream base64 over SSH stdin to avoid ARG_MAX limits.
  // Keep command non-interactive to avoid sudo password prompts hanging the stream.
  const uploadTimeoutMs = Math.max(15_000, Number(options.timeoutMs ?? SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS));

  return new Promise<void>((resolve, reject) => {
    const client = new Client();
    let resolved = false;
    const timeout = setTimeout(() => {
      doReject(new Error(`文件上传超时（${uploadTimeoutMs}ms，SSH 通道无响应或解码过慢）`));
    }, uploadTimeoutMs);

    const doResolve = (output?: string) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        client.end();
        resolve();
      }
    };

    const doReject = (err: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        client.end();
        reject(err);
      }
    };

    client
      .on('ready', () => {
        // shEscape function logic inline
        const safePath = `'${remotePath.replace(/'/g, `'"'"'`)}'`;
        
        // Prefer direct write; create parent dir first.
        // Do NOT use interactive sudo here, otherwise it may block waiting for password.
        client.exec(`bash -lc "mkdir -p \\$(dirname ${safePath}) && base64 -d > ${safePath}"`, { env: { TERM: 'xterm', DEBIAN_FRONTEND: 'noninteractive' } }, (err, stream) => {
          if (err) return doReject(err);
          
          let stderr = '';
          let stderrTrunc = false;
          stream.on('close', (code: number | null) => {
            if (code && code !== 0) {
               const note = stderrTrunc ? ' [stderr truncated]' : '';
               doReject(new Error((stderr + note) || `Upload command failed with code ${code}`));
            } else {
               doResolve();
            }
          });
          
          stream.stderr.on('data', (chunk) => {
            const r = appendUtf8WithTailCap(stderr, chunk, STDERR_STREAM_CHAR_LIMIT);
            stderr = r.value;
            if (r.truncated) stderrTrunc = true;
          });
          
          // Write the base64 encoded buffer straight into the process's standard input
          stream.write(buffer.toString('base64'));
          stream.end();
        });
      })
      .on('error', (err: Error) => doReject(err))
      .connect(sshConnectBase(credentials));
  });
}
