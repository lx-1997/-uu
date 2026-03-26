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

function resolveDataDir() {
  const envDataDir = String(process.env.RDK_DATA_DIR ?? '').trim();
  if (envDataDir) return envDataDir;
  return path.join(os.homedir(), '.rdk-studio', 'data');
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
