/**
 * 设备端文本文件解码（对齐 VS Code「自动猜测编码」的核心策略）：
 * - **优先严格 UTF-8**：合法 UTF-8 字节序列一律按 UTF-8 解码，避免误用 GB18030 解 UTF-8 导致「涓/缂€」类乱码。
 * - UTF-8 BOM、UTF-16 LE/BE（含 BOM）。
 * - 仅当 **fatal UTF-8 失败** 时再尝试 GB18030（兼容 Windows GBK/板端 ANSI 保存的中文）。
 */
import iconv from 'iconv-lite';

const utf8Fatal = new TextDecoder('utf-8', { fatal: true });
const utf8Lenient = new TextDecoder('utf-8', { fatal: false });

function tryDecodeUtf8Strict(buf: Buffer): string | null {
  try {
    return utf8Fatal.decode(buf);
  } catch {
    return null;
  }
}

/** 非 UTF-8 时的回退：GB18030 → 宽松 UTF-8 */
function decodeNonUtf8Body(body: Buffer): string {
  try {
    return iconv.decode(body, 'gb18030');
  } catch {
    return utf8Lenient.decode(body);
  }
}

export function decodeDeviceFileBuffer(buffer: Buffer): string {
  if (buffer.length === 0) return '';

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    const body = buffer.subarray(3);
    const strict = tryDecodeUtf8Strict(body);
    if (strict !== null) return strict;
    return decodeNonUtf8Body(body);
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const b = buffer.subarray(2);
    const evenLen = b.length & ~1;
    const swapped = Buffer.alloc(evenLen);
    for (let i = 0; i < evenLen; i += 2) {
      swapped[i] = b[i + 1]!;
      swapped[i + 1] = b[i]!;
    }
    return swapped.toString('utf16le');
  }

  const strict = tryDecodeUtf8Strict(buffer);
  if (strict !== null) return strict;
  return decodeNonUtf8Body(buffer);
}

/** 判断是否为不适合在 Monaco 中当作文本编辑的内容（二进制、压缩包头等） */
export function isLikelyBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 65536));

  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true;
  }

  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) return true;
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) return true;
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return true;

  let ctrl = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i]!;
    if (b < 9 || (b > 13 && b < 32 && b !== 27)) ctrl++;
  }
  if (ctrl / sample.length > 0.12) return true;

  return false;
}
