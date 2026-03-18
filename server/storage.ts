import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Device } from '../shared/types.js';

// 打包后优先使用 RDK_DATA_DIR 环境变量（由 electron/main.mjs 注入）
// 开发模式下使用项目根目录的 data/
function getDataFilePath() {
  const dataDir = process.env.RDK_DATA_DIR ?? path.resolve(process.cwd(), 'data');
  return path.join(dataDir, 'devices.json');
}

export async function readDevices(): Promise<Device[]> {
  const dataFilePath = getDataFilePath();
  const content = await fs.readFile(dataFilePath, 'utf-8').catch(async (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      await fs.mkdir(path.dirname(dataFilePath), { recursive: true });
      await fs.writeFile(dataFilePath, '[]', 'utf-8');
      return '[]';
    }
    throw error;
  });

  return JSON.parse(content) as Device[];
}

export async function writeDevices(devices: Device[]) {
  const dataFilePath = getDataFilePath();
  await fs.mkdir(path.dirname(dataFilePath), { recursive: true });
  await fs.writeFile(dataFilePath, JSON.stringify(devices, null, 2), 'utf-8');
}
