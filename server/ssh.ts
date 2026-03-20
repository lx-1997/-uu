import { Client } from 'ssh2';

export interface SshCredentials {
  host: string;
  username: string;
  password: string;
  port?: number;
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

export function runRemoteCommands(credentials: SshCredentials, commands: string[]) {
  // Existing function
  return new Promise<string>((resolve, reject) => {
    // ...

    const client = new Client();

    client
      .on('ready', () => {
        const fullCommand = commands.filter(Boolean).join(' && ');
        client.exec(fullCommand, { env: { TERM: 'xterm', DEBIAN_FRONTEND: 'noninteractive' } }, (error, stream) => {
          if (error) {
            client.end();
            reject(error);
            return;
          }

          let stdout = '';
          let stderr = '';

          stream
            .on('close', (code: number | null) => {
              client.end();
              if (code && code !== 0) {
                reject(new Error(stderr || `Remote command failed with exit code ${code}`));
                return;
              }

              resolve(stdout);
            })
            .on('data', (chunk: Buffer) => {
              stdout += chunk.toString();
            });

          stream.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
          });
        });
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
          stream.on('close', (code: number | null) => {
            if (code && code !== 0) {
               doReject(new Error(stderr || `Upload command failed with code ${code}`));
            } else {
               doResolve();
            }
          });
          
          stream.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
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
