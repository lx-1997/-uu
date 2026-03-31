/**
 * 共享：xz 解压进度（根据输出文件增长）与 `xz -l --robot` 读取解压后大小。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';

const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === 'win32';

/**
 * @param {string} inputPath .xz 路径
 * @param {NodeJS.ProcessEnv} env 增强后的 PATH
 * @param {string} [xzExe='xz'] xz 可执行文件
 * @returns {Promise<number|null>} 解压后字节数；失败时为 null
 */
export async function getXzUncompressedSizeBytes(inputPath, env, xzExe = 'xz') {
  try {
    const { stdout } = await execFileAsync(xzExe, ['-l', '--robot', inputPath], {
      env,
      maxBuffer: 65536,
      windowsHide: IS_WIN,
    });
    for (const line of String(stdout).split(/\r?\n/)) {
      if (line.startsWith('totals\t')) {
        const p = line.split('\t');
        const u = parseInt(p[4], 10);
        if (Number.isFinite(u) && u > 0) return u;
      }
    }
  } catch {
    /* 旧版 xz、多流合并包等 */
  }
  return null;
}

/**
 * @param {object} opts
 * @param {string} opts.outputPath
 * @param {number} opts.totalBytes  解压后总字节（来自 getXzUncompressedSizeBytes，未知时可传 0 跳过轮询）
 * @param {(percent: number) => void} opts.onProgress  percent 约 3–99
 * @param {number} [opts.intervalMs]
 * @returns {() => void} stop
 */
export function startXzOutputSizeProgress({ outputPath, totalBytes, onProgress, intervalMs = 500 }) {
  if (!totalBytes || totalBytes <= 0) {
    return () => {};
  }
  let lastPercent = 3;
  let lastEmitAt = 0;
  const tick = () => {
    try {
      const st = fs.statSync(outputPath);
      const pct = Math.min(99, Math.max(3, Math.floor((st.size / totalBytes) * 100)));
      const now = Date.now();
      if (pct > lastPercent || now - lastEmitAt >= intervalMs) {
        if (pct > lastPercent) lastPercent = pct;
        lastEmitAt = now;
        onProgress(lastPercent);
      }
    } catch {
      /* 输出文件尚未创建 */
    }
  };
  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
}
