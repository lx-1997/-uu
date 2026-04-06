import http from 'node:http';
import { PassThrough, type Duplex } from 'node:stream';
import type { Client } from 'ssh2';
import { forwardOutRemoteTcp } from './ssh.js';

/**
 * 将 HTTP 请求通过 SSH direct-tcpip 转发到套件端 127.0.0.1:remotePort（与 code-server 监听一致）。
 */
export class SshTunnelHttpAgent extends http.Agent {
  constructor(
    private readonly getClient: () => Promise<Client>,
    private readonly remotePort: number,
  ) {
    super();
  }

  override createConnection(
    _options: http.ClientRequestArgs,
    cb?: (err: Error | null, stream: Duplex) => void,
  ): Duplex | null | undefined {
    void this.getClient()
      .then((client) => forwardOutRemoteTcp(client, '127.0.0.1', this.remotePort))
      .then((stream) => cb?.(null, stream))
      .catch((e) => {
        const err = e instanceof Error ? e : new Error(String(e));
        const stream = new PassThrough();
        stream.destroy(err);
        cb?.(err, stream);
      });
    return undefined;
  }
}
