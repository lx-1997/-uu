/**
 * Device persistence layer with TTL-based read cache.
 *
 * devices.json is the single source of truth for registered boards.
 * A 3-second TTL cache avoids redundant disk I/O when multiple Socket.IO
 * events or API routes call readDevices() within the same request burst.
 * The cache is invalidated on every write to ensure consistency.
 *
 * In Electron production builds, RDK_DATA_DIR points to the app's
 * user-data directory instead of the project root.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Device } from '../shared/types.js';

let _legacyMigrated = false;

export function resolveDataDir() {
  const envDataDir = String(process.env.RDK_DATA_DIR ?? '').trim();
  if (envDataDir) return envDataDir;
  return path.join(os.homedir(), '.rdk-studio', 'data');
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
  await fs.writeFile(dataFilePath, JSON.stringify(devices, null, 2), 'utf-8');
}
