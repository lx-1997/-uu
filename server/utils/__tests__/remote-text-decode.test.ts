import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import iconv from 'iconv-lite';
import { decodeRemoteStreamBytes } from '../remote-text-decode.js';

describe('decodeRemoteStreamBytes', () => {
  const prev = process.env.RDK_REMOTE_EXEC_ENCODING;

  afterEach(() => {
    if (prev === undefined) delete process.env.RDK_REMOTE_EXEC_ENCODING;
    else process.env.RDK_REMOTE_EXEC_ENCODING = prev;
  });

  it('decodes UTF-8', () => {
    expect(decodeRemoteStreamBytes(Buffer.from('你好 UTF-8', 'utf8'))).toBe('你好 UTF-8');
  });

  it('auto: falls back to GB18030 when bytes are not valid UTF-8', () => {
    delete process.env.RDK_REMOTE_EXEC_ENCODING;
    const gb = iconv.encode('中文SSID', 'gb18030');
    expect(decodeRemoteStreamBytes(gb)).toBe('中文SSID');
  });

  it('forced utf8 ignores invalid sequences as replacement chars', () => {
    process.env.RDK_REMOTE_EXEC_ENCODING = 'utf8';
    const gb = iconv.encode('强制', 'gb18030');
    const s = decodeRemoteStreamBytes(gb);
    expect(s).toContain('\uFFFD');
  });

  it('forced gb18030', () => {
    process.env.RDK_REMOTE_EXEC_ENCODING = 'gb18030';
    const gb = iconv.encode('国标', 'gb18030');
    expect(decodeRemoteStreamBytes(gb)).toBe('国标');
  });
});
