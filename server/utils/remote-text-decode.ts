/**
 * 远端 SSH/子进程字节流解码：默认 UTF-8；非法 UTF-8 或显式配置时可按 GB18030（兼容 GBK）解码。
 * 浏览器与 JSON API 仍以 UTF-8 为主；本模块仅用于 Node 侧还原套件端/旧系统 ANSI 输出。
 */
import iconv from 'iconv-lite';

export type RemoteExecEncoding = 'auto' | 'utf8' | 'gb18030' | 'gbk';

function parseEnvEncoding(): RemoteExecEncoding {
  const v = process.env.RDK_REMOTE_EXEC_ENCODING?.trim().toLowerCase();
  if (!v || v === 'auto') return 'auto';
  if (v === 'utf8' || v === 'utf-8') return 'utf8';
  if (v === 'gb18030') return 'gb18030';
  if (v === 'gbk' || v === 'gb2312') return 'gbk';
  return 'auto';
}

/**
 * 将一段完整远端输出按当前策略解码为 JavaScript 字符串（合法 Unicode）。
 *
 * - `auto`：优先严格 UTF-8；失败则按 GB18030（国标扩展，覆盖 GBK/常见 GB2312 字汇）。
 * - 环境变量 `RDK_REMOTE_EXEC_ENCODING`：`utf8` | `gb18030` | `gbk` | `auto`（默认 auto）。
 */
export function decodeRemoteStreamBytes(buf: Buffer): string {
  if (!buf.length) return '';
  const mode = parseEnvEncoding();
  if (mode === 'utf8') {
    return buf.toString('utf8');
  }
  if (mode === 'gb18030') {
    return iconv.decode(buf, 'gb18030');
  }
  if (mode === 'gbk') {
    return iconv.decode(buf, 'gbk');
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return buf.toString('utf8');
  } catch {
    return iconv.decode(buf, 'gb18030');
  }
}
