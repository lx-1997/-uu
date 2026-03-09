import { Client } from 'ssh2';

export interface SshCredentials {
  host: string;
  username: string;
  password: string;
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
        username: credentials.username,
        password: credentials.password,
        readyTimeout: 8000,
      });
  });
}

export function runRemoteCommands(credentials: SshCredentials, commands: string[]) {
  return new Promise<string>((resolve, reject) => {
    const client = new Client();

    client
      .on('ready', () => {
        const fullCommand = commands.filter(Boolean).join(' && ');
        client.exec(fullCommand, (error, stream) => {
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
        username: credentials.username,
        password: credentials.password,
        readyTimeout: 8000,
      });
  });
}