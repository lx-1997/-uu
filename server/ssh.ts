import { Client } from 'ssh2';
import {
  appendUtf8WithTailCap,
  DEFAULT_STREAM_OUTPUT_CHAR_LIMIT,
  STDERR_STREAM_CHAR_LIMIT,
} from './utils/stream-output-limit.js';

export interface SshCredentials {
  host: string;
  username: string;
  password: string;
  port?: number;
}

export interface RunRemoteCommandOptions {
  timeoutMs?: number;
}

export function verifySshConnection(credentials: SshCredentials) {
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
        host: credentials.host,
        port: credentials.port ?? 22,
        username: credentials.username,
        password: credentials.password,
        readyTimeout: 8000,
      });
  });
}

export function runRemoteCommands(
  credentials: SshCredentials,
  commands: string[],
  options: RunRemoteCommandOptions = {},
) {
  // Existing function
  return new Promise<string>((resolve, reject) => {
    const client = new Client();
    const timeoutMs = Math.max(5_000, Number(options.timeoutMs ?? 120_000));
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
              const r = appendUtf8WithTailCap(stdout, chunk, DEFAULT_STREAM_OUTPUT_CHAR_LIMIT);
              stdout = r.value;
              if (r.truncated) stdoutTrunc = true;
            });

          stream.stderr.on('data', (chunk: Buffer) => {
            const r = appendUtf8WithTailCap(stderr, chunk, STDERR_STREAM_CHAR_LIMIT);
            stderr = r.value;
            if (r.truncated) stderrTrunc = true;
          });
        });
      })
      .on('error', (error) => {
        safeReject(error);
      })
      .connect({
        host: credentials.host,
        port: credentials.port ?? 22,
        username: credentials.username,
        password: credentials.password,
        readyTimeout: 8000,
      });
  });
}
export function uploadFileSftp(credentials: SshCredentials, remotePath: string, buffer: Buffer) {
  // Stream base64 over SSH stdin to avoid ARG_MAX limits.
  // Keep command non-interactive to avoid sudo password prompts hanging the stream.
  return new Promise<void>((resolve, reject) => {
    const client = new Client();
    let resolved = false;
    const timeout = setTimeout(() => {
      doReject(new Error('文件上传超时（SSH 通道无响应）'));
    }, 25000);

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
      .connect({
        host: credentials.host,
        port: credentials.port ?? 22,
        username: credentials.username,
        password: credentials.password,
        readyTimeout: 10000,
      });
  });
}
