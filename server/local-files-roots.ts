/**
 * Agent 下载与 `/api/local-files` 可服务文件的根目录集合。
 * 默认落盘目录为 ~/.rdkstudio/agent-downloads，避免污染用户工程目录。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function getAgentMediaDownloadDir(): string {
  return path.join(os.homedir(), '.rdkstudio', 'agent-downloads');
}

export function ensureAgentMediaDownloadDir(): void {
  fs.mkdirSync(getAgentMediaDownloadDir(), { recursive: true });
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
  const ordered = [
    getAgentMediaDownloadDir(),
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
