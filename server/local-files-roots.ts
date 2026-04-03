/**
 * Agent 下载与 `/api/local-files` 可服务文件的根目录集合。
 *
 * 下载目录与 `devices.json` 同属 `resolveDataDir()`（含 sudo→SUDO_USER 对齐、RDK_DATA_DIR），
 * 避免与 `os.homedir()` 下的 `~/.rdkstudio` 分叉；后者若曾被 root 创建会导致 EACCES。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveDataDir } from './storage.js';

/** 历史默认（只读兜底）；新写入统一用 getAgentMediaDownloadDir() */
function getLegacyAgentDownloadsDir(): string {
  return path.join(os.homedir(), '.rdkstudio', 'agent-downloads');
}

export function getAgentMediaDownloadDir(): string {
  return path.join(resolveDataDir(), 'agent-downloads');
}

export function ensureAgentMediaDownloadDir(): void {
  try {
    fs.mkdirSync(getAgentMediaDownloadDir(), { recursive: true, mode: 0o755 });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      console.warn(
        `[local-files] 无法创建 Agent 下载目录 ${getAgentMediaDownloadDir()}（${code}）。请检查目录属主是否为当前运行 Studio 的用户，勿用 root 创建后改回普通用户运行。`,
      );
    }
    throw err;
  }
}

function workspaceLikeRoot(): string {
  const w = process.env.RDK_WORKSPACE_DIR?.trim();
  if (w) return path.resolve(w);
  return path.resolve(process.cwd());
}

/**
 * `/api/local-files/:basename` 按顺序在这些目录中查找同名文件。
 */
export function getLocalFilesServeDirs(): string[] {
  const root = workspaceLikeRoot();
  const canonical = getAgentMediaDownloadDir();
  const legacy = getLegacyAgentDownloadsDir();
  const ordered = [
    canonical,
    ...(path.resolve(legacy) !== path.resolve(canonical) ? [legacy] : []),
    path.join(root, 'workspace', 'downloads'),
    path.join(root, 'downloads'),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of ordered) {
    const n = path.resolve(d);
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

export function isFileUnderLocalFilesServeRoots(absPath: string): boolean {
  let fileReal: string;
  try {
    fileReal = fs.realpathSync(absPath);
  } catch {
    return false;
  }
  for (const dir of getLocalFilesServeDirs()) {
    let rootReal: string;
    try {
      rootReal = fs.realpathSync(dir);
    } catch {
      continue;
    }
    if (fileReal === rootReal) return true;
    const rel = path.relative(rootReal, fileReal);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return true;
  }
  return false;
}
