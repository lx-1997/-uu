import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Device } from '../shared/types.js';

const dataFilePath = path.resolve(process.cwd(), 'data/devices.json');

export async function readDevices(): Promise<Device[]> {
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
  await fs.mkdir(path.dirname(dataFilePath), { recursive: true });
  await fs.writeFile(dataFilePath, JSON.stringify(devices, null, 2), 'utf-8');
}