import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const buildResourcesDir = path.join(rootDir, 'build-resources');

const resourcesPlan = [
  {
    source: path.join(rootDir, 'public', 'vnc', 'app', 'images', 'icons', 'novnc.ico'),
    target: path.join(buildResourcesDir, 'icon.ico'),
    description: 'Windows icon',
  },
  {
    source: path.join(rootDir, 'public', 'vnc', 'app', 'images', 'icons', 'novnc-ios-180.png'),
    target: path.join(buildResourcesDir, 'icon.png'),
    description: 'Linux/mac base icon',
  },
];

function copyIfNeeded(source, target, description) {
  if (!fs.existsSync(source)) {
    throw new Error(`missing source for ${description}: ${source}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

try {
  fs.mkdirSync(buildResourcesDir, { recursive: true });
  for (const item of resourcesPlan) {
    copyIfNeeded(item.source, item.target, item.description);
  }
  console.log('[prepare:build-resources] ready:', buildResourcesDir);
} catch (error) {
  console.error('[prepare:build-resources] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
