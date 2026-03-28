/**
 * Studio 侧：通过 SSH exec 与板端 oc-bridge.mjs 的 NDJSON 双工通道。
 */
import type { Readable, Writable } from 'node:stream';
import type { Client } from 'ssh2';

export interface OcBridgeLine {
  v?: number;
  type: string;
  [k: string]: unknown;
}

export class OcBridgeTransport {
  private buf = '';
  private lineHandlers: Array<(line: OcBridgeLine) => void> = [];
  private stderrBuf = '';

  constructor(
    private stream: Readable & Writable & { stderr?: Readable },
    private onClosed: () => void,
  ) {
    stream.on('data', (d: Buffer) => {
      this.buf += d.toString('utf8');
      this.flushLines();
    });
    stream.stderr?.on('data', (d: Buffer) => {
      this.stderrBuf += d.toString('utf8');
      const tail = this.stderrBuf.slice(-800);
      if (tail.length > 0 && process.env.RDK_OC_BRIDGE_DEBUG === '1') {
        console.warn('[oc-bridge stderr]', tail);
      }
    });
    stream.on('close', () => {
      this.onClosed();
    });
  }

  private flushLines(): void {
    for (;;) {
      const idx = this.buf.indexOf('\n');
      if (idx < 0) break;
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let obj: OcBridgeLine;
      try {
        obj = JSON.parse(line) as OcBridgeLine;
      } catch {
        continue;
      }
      for (const h of this.lineHandlers) {
        try {
          h(obj);
        } catch {
          /* ignore */
        }
      }
    }
  }

  onLine(handler: (line: OcBridgeLine) => void): () => void {
    this.lineHandlers.push(handler);
    return () => {
      this.lineHandlers = this.lineHandlers.filter((h) => h !== handler);
    };
  }

  send(obj: Record<string, unknown>): void {
    (this.stream as Writable).write(`${JSON.stringify(obj)}\n`);
  }

  waitForBridgeReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('oc-bridge ready timeout'));
      }, timeoutMs);
      let unsub: (() => void) | null = null;
      const cleanup = () => {
        clearTimeout(timer);
        try {
          unsub?.();
        } catch {
          /* ignore */
        }
      };
      unsub = this.onLine((line) => {
        if (line.type === 'bridge' && line.ready === true && line.ws === true) {
          cleanup();
          resolve();
          return;
        }
        if (line.type === 'fatal') {
          cleanup();
          reject(new Error(String(line.message || 'fatal')));
          return;
        }
        if (line.type === 'bridge' && line.ready === false && line.message) {
          cleanup();
          reject(new Error(String(line.message)));
        }
      });
    });
  }

  destroy(): void {
    try {
      (this.stream as Writable & { destroy?: () => void }).destroy?.();
    } catch {
      try {
        (this.stream as Writable).end();
      } catch {
        /* ignore */
      }
    }
  }
}

export async function startOcBridgeRemote(
  client: Client,
  remoteCmd: string,
  onTransportClose: () => void,
): Promise<OcBridgeTransport | null> {
  return new Promise((resolve) => {
    client.exec(remoteCmd, { pty: false }, (err, stream) => {
      if (err || !stream) {
        resolve(null);
        return;
      }
      const t = new OcBridgeTransport(stream as any, onTransportClose);
      resolve(t);
    });
  });
}
