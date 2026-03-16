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

              resolve(stdout || 'Command completed without output.');
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
  // Use sudo tee via exec to bypass permissions AND ARG_MAX limits by piping to stdin
  return new Promise<void>((resolve, reject) => {
    const client = new Client();
    let resolved = false;

    const doResolve = (output?: string) => {
      if (!resolved) {
        resolved = true;
        client.end();
        resolve();
      }
    };

    const doReject = (err: Error) => {
      if (!resolved) {
        resolved = true;
        client.end();
        reject(err);
      }
    };

    client
      .on('ready', () => {
        // shEscape function logic inline
        const safePath = `'${remotePath.replace(/'/g, `'"'"'`)}'`;
        
        // Pass base64 over stdin to avoid binary corruption during tee, then decode using sudo root
        client.exec(`sudo bash -lc "base64 -d > ${safePath}"`, { env: { TERM: 'xterm', DEBIAN_FRONTEND: 'noninteractive' } }, (err, stream) => {
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
