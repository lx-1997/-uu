/**
 * Device persistence layer with TTL-based read cache.
 *
 * devices.json is the single source of truth for registered boards.
 * A 3-second TTL cache avoids redundant disk I/O when multiple Socket.IO
 * events or API routes call readDevices() within the same request burst.
 * The cache is invalidated on every write to ensure consistency.
 *
 * 写入安全：
 * - 原子写入：先写临时文件再 rename，避免写入中途崩溃导致 JSON 损坏。
 * - 串行写入：通过 Promise 链保证并发 writeDevices 调用按序执行，
 *   避免两个请求同时读-改-写导致后者覆盖前者的修改。
 *
 * In Electron production builds, RDK_DATA_DIR points to the app's
 * user-data directory instead of the project root.
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Device } from '../shared/types.js';

let _legacyMigrated = false;

let _sudoInvokerHomeMemo: string | null | undefined;

/**
 * `sudo npm run desktop` 时 effective uid 为 root，但 `os.homedir()` 会落到 root 的家目录，
 * 与用户在设备管理里保存的 `~/.rdk-studio/data` 不一致。若环境中有 SUDO_USER，则解析其主目录。
 */
function homedirOfSudoInvoker(): string | null {
  if (_sudoInvokerHomeMemo !== undefined) return _sudoInvokerHomeMemo;
  const sudoUser = String(process.env.SUDO_USER ?? '').trim();
  if (!sudoUser || typeof process.getuid !== 'function' || process.getuid() !== 0) {
    _sudoInvokerHomeMemo = null;
    return null;
  }
  try {
    if (process.platform === 'darwin') {
      const out = execFileSync('dscl', ['.', '-read', `/Users/${sudoUser}`, 'NFSHomeDirectory'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const line = out.split('\n').find((l) => /NFSHomeDirectory/i.test(l));
      const home = line?.replace(/^[^:]+:\s*/, '').trim();
      if (home && home.startsWith('/')) {
        _sudoInvokerHomeMemo = home;
        return home;
      }
    } else if (process.platform !== 'win32') {
      const out = execFileSync('getent', ['passwd', sudoUser], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const parts = out.split(':');
      if (parts.length >= 6 && parts[5]?.startsWith('/')) {
        _sudoInvokerHomeMemo = parts[5];
        return parts[5];
      }
    }
  } catch {
    /* dscl/getent 不可用或非标准环境 */
  }
  if (process.platform === 'darwin') {
    _sudoInvokerHomeMemo = path.join('/Users', sudoUser);
    return _sudoInvokerHomeMemo;
  }
  if (process.platform !== 'win32') {
    _sudoInvokerHomeMemo = path.join('/home', sudoUser);
    return _sudoInvokerHomeMemo;
  }
  _sudoInvokerHomeMemo = null;
  return null;
}

export function resolveDataDir() {
  const envDataDir = String(process.env.RDK_DATA_DIR ?? '').trim();
  if (envDataDir) return envDataDir;
  const base = homedirOfSudoInvoker() ?? os.homedir();
  return path.join(base, '.rdk-studio', 'data');
}

/** SSO 会话落盘路径（与 devices.json 同目录，重启后端后可恢复登录态） */
export function getSsoSessionsFilePath() {
  return path.join(resolveDataDir(), 'sso-sessions.json');
}

/**
 * 前端埋点/行为事件 JSONL（每行一条 JSON）。
 * 优先 `RDK_ANALYTICS_JSONL_PATH`（可指向用户工作区下的路径，如 .../workspace/.rdk-studio/analytics-events.jsonl）；
 * 未设置时用 `RDK_DATA_DIR` 或 ~/.rdk-studio/data/analytics-events.jsonl。
 */
export function getAnalyticsEventsFilePath() {
  const override = String(process.env.RDK_ANALYTICS_JSONL_PATH ?? '').trim();
  if (override) return path.resolve(override);
  return path.join(resolveDataDir(), 'analytics-events.jsonl');
}

/** 可选第二份镜像（同一内容再写一份，便于工作区与全局数据目录各留一份） */
export function getAnalyticsEventsMirrorFilePath(): string | undefined {
  const mirror = String(process.env.RDK_ANALYTICS_JSONL_MIRROR ?? '').trim();
  return mirror ? path.resolve(mirror) : undefined;
}

/** 完整对话轮次 JSONL（用户提问 + AI 最终回复）；见 CONVERSATION_LOG_ENABLED */
export function getConversationTurnsFilePath() {
  const override = String(process.env.CONVERSATION_LOG_JSONL_PATH ?? '').trim();
  if (override) return path.resolve(override);
  return path.join(resolveDataDir(), 'conversation-turns.jsonl');
}

function getDataFilePath() {
  const dataDir = resolveDataDir();
  return path.join(dataDir, 'devices.json');
}

/** Windows/索引类软件偶发 EBUSY/EPERM，短重试可提高 rename 成功率 */
async function renameAtomic(tmpPath: string, dataFilePath: string) {
  const max = 6;
  for (let attempt = 0; attempt < max; attempt += 1) {
    try {
      await fs.rename(tmpPath, dataFilePath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (
        (code === 'EBUSY'
          || code === 'EPERM'
          || code === 'EACCES'
          || code === 'UNKNOWN')
        && attempt < max - 1
      ) {
        await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

async function migrateLegacyDataIfNeeded(targetFilePath: string) {
  if (_legacyMigrated) return;
  _legacyMigrated = true;
  if (String(process.env.RDK_DATA_DIR ?? '').trim()) return;

  const legacyPath = path.resolve(process.cwd(), 'data', 'devices.json');
  if (legacyPath === targetFilePath) return;

  const targetExists = await fs.access(targetFilePath).then(() => true).catch(() => false);
  if (targetExists) return;

  const legacyExists = await fs.access(legacyPath).then(() => true).catch(() => false);
  if (!legacyExists) return;

  await fs.mkdir(path.dirname(targetFilePath), { recursive: true });
  await fs.copyFile(legacyPath, targetFilePath);
}

let _deviceCache: { data: Device[]; expiresAt: number } | null = null;
const DEVICE_CACHE_TTL_MS = 3000;

/**
 * 下一轮 `readDevices()` 强制读盘，不返回 TTL 内的内存快照。
 * 供套件端 SSH/SFTP 前使用，避免刚写入的密码等字段仍被短 TTL 挡住。
 */
export function invalidateDevicesReadCache(): void {
  _deviceCache = null;
}

export async function readDevices(): Promise<Device[]> {
  if (_deviceCache && _deviceCache.expiresAt > Date.now()) {
    return _deviceCache.data;
  }
  const dataFilePath = getDataFilePath();
  await migrateLegacyDataIfNeeded(dataFilePath);
  const content = await fs.readFile(dataFilePath, 'utf-8').catch(async (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      await fs.mkdir(path.dirname(dataFilePath), { recursive: true });
      await fs.writeFile(dataFilePath, '[]', 'utf-8');
      return '[]';
    }
    throw error;
  });

  const devices = JSON.parse(content) as Device[];
  _deviceCache = { data: devices, expiresAt: Date.now() + DEVICE_CACHE_TTL_MS };
  return devices;
}

export async function writeDevices(devices: Device[]) {
  _deviceCache = null;
  const dataFilePath = getDataFilePath();
  await migrateLegacyDataIfNeeded(dataFilePath);
  await fs.mkdir(path.dirname(dataFilePath), { recursive: true });
  // 原子写入：先写临时文件再 rename，防止写入中途崩溃导致 JSON 损坏
  const tmpPath = dataFilePath + '.tmp.' + process.pid;
  await fs.writeFile(tmpPath, JSON.stringify(devices, null, 2), 'utf-8');
  await renameAtomic(tmpPath, dataFilePath);
}

/**
 * 串行化写入：保证并发 writeDevices 调用按序执行。
 *
 * 使用场景：多个 Socket.IO 事件或 API 路由同时触发设备状态更新时，
 * 如果不串行化，后一个 writeDevices 可能基于过期数据覆盖前一个的修改。
 *
 * 用法：在需要读-改-写的场景中，用 serializedWriteDevices 替代直接调用 writeDevices。
 * 例如：await serializedWriteDevices(async () => {
 *   const devices = await readDevices();
 *   devices.push(newDevice);
 *   await writeDevices(devices);
 * });
 */
let _writeChain: Promise<void> = Promise.resolve();

export function serializedWriteDevices(fn: () => Promise<void>): Promise<void> {
  const next = _writeChain.then(fn, fn);
  _writeChain = next.catch(() => {});
  return next;
}
