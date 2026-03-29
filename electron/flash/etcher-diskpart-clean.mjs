/**
 * 自 balena Etcher 的 etcher-sdk `build/diskpart.js` 中 `clean()` 逻辑移植（Apache-2.0）。
 *
 * 完整引入 `etcher-sdk` 会拉取 @ronomon/direct-io、lzma-native 等大量需 node-gyp 的原生依赖，
 * 在 Electron 打包与无 Python/VS 构建链环境下难以安装；故仅复用与烧录强相关的 diskpart 行为。
 *
 * 参考：etcher-master `lib/util/child-writer.ts` 写盘前由 BlockDevice._open 调用 diskpart.clean。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);

const DISKPART_DELAY_MS = 2000;
const DISKPART_RETRIES = 5;
const PATTERN = /PHYSICALDRIVE(\d+)/i;

function diskpartExe() {
  if (process.platform !== 'win32') return 'diskpart';
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'diskpart.exe');
}

/** 与 etcher-sdk 一致：串行化 diskpart，避免并发脚本冲突 */
let diskpartChain = Promise.resolve();

function runDiskpartSerialized(fn) {
  const next = diskpartChain.then(() => fn());
  diskpartChain = next.catch(() => {});
  return next;
}

async function runDiskpartCommands(commands) {
  if (process.platform !== 'win32') return '';
  const scriptPath = path.join(os.tmpdir(), `rdk-diskpart-${crypto.randomUUID()}.txt`);
  const body = commands.join('\r\n');
  fs.writeFileSync(scriptPath, body, 'utf8');
  try {
    const { stdout } = await execFileAsync(diskpartExe(), ['/s', scriptPath], {
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    return String(stdout || '');
  } finally {
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      /* ignore */
    }
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function prepareDeviceId(device) {
  const m = String(device).match(PATTERN);
  if (!m) {
    throw new Error(`Invalid device: "${device}"`);
  }
  return m[1];
}

/**
 * 磁盘离线时无法 clean，etcher-sdk 将 VDS_E_DISK_IS_OFFLINE 视为可继续烧录（跳过 clean）。
 */
function isOfflineDiskOk(error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  if (code === 0x8004280a) return true;
  const msg = `${error && error.message ? error.message : error} ${error && error.stderr ? error.stderr : ''}`;
  if (/0x8004280a|VDS_E_DISK_IS_OFFLINE|disk.*offline|处于脱机|脱机状态/i.test(msg)) {
    return true;
  }
  return false;
}

/**
 * 与 etcher-sdk `exports.clean` 对齐：`select disk` → `clean` → `rescan`，带重试与互斥。
 *
 * @param {string} devicePath 例如 `\\\\.\\PhysicalDrive2`
 */
export async function etcherStyleDiskpartClean(devicePath) {
  if (process.platform !== 'win32') return;

  let deviceId;
  try {
    deviceId = prepareDeviceId(devicePath);
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }

  let errorCount = 0;
  while (errorCount <= DISKPART_RETRIES) {
    try {
      await runDiskpartSerialized(() =>
        runDiskpartCommands([`select disk ${deviceId}`, 'clean', 'rescan']),
      );
      return;
    } catch (error) {
      if (isOfflineDiskOk(error)) {
        return;
      }
      errorCount += 1;
      if (errorCount <= DISKPART_RETRIES) {
        await delay(DISKPART_DELAY_MS);
      } else {
        const em = error instanceof Error ? error.message : String(error);
        const code = error && typeof error === 'object' ? error.code : '';
        throw new Error(`Couldn't clean the drive: ${em}${code !== '' && code !== undefined ? ` (code ${code})` : ''}`);
      }
    }
  }
}
