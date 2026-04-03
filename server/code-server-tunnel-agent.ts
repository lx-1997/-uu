import http from 'node:http';
import type { Client } from 'ssh2';
import { forwardOutRemoteTcp } from './ssh.js';

/**
 * 将 HTTP 请求通过 SSH direct-tcpip 转发到板端 127.0.0.1:remotePort（与 code-server 监听一致）。
 */
export class SshTunnelHttpAgent extends http.Agent {
  constructor(
    private readonly getClient: () => Promise<Client>,
    private readonly remotePort: number,
  ) {
    super();
  }

  override createConnection(
    options: unknown,
    cb: (err: Error | null, stream?: NodeJS.ReadWriteStream) => void,
  ): void {
    void this.getClient()
      .then((client) => forwardOutRemoteTcp(client, '127.0.0.1', this.remotePort))
      .then((stream) => cb(null, stream))
      .catch((e) => cb(e instanceof Error ? e : new Error(String(e))));
  }
}
