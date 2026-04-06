/**
 * 将 Studio 仓库内 skills/ 与 rdkx5_skills/ 同步到套件端 OpenClaw 工作区
 * ~/.openclaw/workspace/skills/<skillId>/（与 OpenClaw 默认技能目录一致）
 */
import type { Client, SFTPWrapper } from 'ssh2';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SKIP_DIR = new Set(['node_modules', '.git', '__pycache__', '.clawhub']);
const MAX_FILE_BYTES = 2_500_000;

export function boardOpenclawRemoteSkillsDir(userName: string): string {
  const u = String(userName || 'root').trim() || 'root';
  if (u === 'root') return '/root/.openclaw/workspace/skills';
  return `/home/${u}/.openclaw/workspace/skills`;
}

function listSkillSubdirsWithSkillMd(rootAbs: string): string[] {
  if (!fs.existsSync(rootAbs)) return [];
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const skillPath = path.join(rootAbs, e.name);
    if (fs.existsSync(path.join(skillPath, 'SKILL.md'))) {
      out.push(e.name);
    }
  }
  return out.sort();
}

/** 合并 skills/ 与 rdkx5_skills/：同名目录以 skills/ 为准 */
export function collectBuiltinSkillSyncTargets(
  studioCwd: string,
  options?: { includeRdkx5Skills?: boolean },
): Array<{ skillId: string; localRoot: string }> {
  const cwd = path.resolve(studioCwd);
  const mainSkills = path.join(cwd, 'skills');
  const x5Skills = path.join(cwd, 'rdkx5_skills');
  const includeRdkx5Skills = options?.includeRdkx5Skills !== false;
  const byId = new Map<string, string>();
  if (includeRdkx5Skills) {
    for (const id of listSkillSubdirsWithSkillMd(x5Skills)) {
      byId.set(id, path.join(x5Skills, id));
    }
  }
  for (const id of listSkillSubdirsWithSkillMd(mainSkills)) {
    byId.set(id, path.join(mainSkills, id));
  }
  return [...byId.entries()]
    .map(([skillId, localRoot]) => ({ skillId, localRoot }))
    .sort((a, b) => a.skillId.localeCompare(b.skillId));
}

function listFilesUnderSkillRoot(localRoot: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || SKIP_DIR.has(e.name)) continue;
        walk(full);
        continue;
      }
      if (e.name.startsWith('.')) continue;
      try {
        const st = fs.statSync(full);
        if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
        files.push(full);
      } catch {
        /* skip */
      }
    }
  };
  walk(localRoot);
  return files;
}

function sftpMkdirQuiet(sftp: SFTPWrapper, dirPath: string): Promise<void> {
  return new Promise((resolve) => {
    sftp.mkdir(dirPath, (err) => {
      if (!err) {
        resolve();
        return;
      }
      sftp.stat(dirPath, (e2, st) => {
        if (!e2 && st && (st as { isDirectory?: () => boolean }).isDirectory?.()) resolve();
        else resolve();
      });
    });
  });
}

async function sftpMkdirp(sftp: SFTPWrapper, absolutePosixPath: string): Promise<void> {
  const norm = path.posix.normalize(absolutePosixPath.replace(/\\/g, '/'));
  const parts = norm.split('/').filter(Boolean);
  if (parts.length === 0) return;
  const isAbs = norm.startsWith('/');
  for (let i = 0; i < parts.length; i++) {
    const cur = isAbs ? `/${parts.slice(0, i + 1).join('/')}` : parts.slice(0, i + 1).join('/');
    await sftpMkdirQuiet(sftp, cur);
  }
}

function sftpFastPut(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (err) => (err ? reject(err) : resolve()));
  });
}

export async function syncBuiltinStudioSkillsOverSftp(
  client: Client,
  remoteSkillsBase: string,
  studioCwd: string,
  onLog: (msg: string) => void,
  options?: { includeRdkx5Skills?: boolean },
): Promise<{ ok: boolean; skillCount: number; fileCount: number; error?: string }> {
  const includeRdkx5Skills = options?.includeRdkx5Skills !== false;
  const targets = collectBuiltinSkillSyncTargets(studioCwd, { includeRdkx5Skills });
  if (targets.length === 0) {
    onLog('[Studio] 未找到本地 skills/ 目录，跳过同步\n');
    return { ok: true, skillCount: 0, fileCount: 0 };
  }

  onLog(
    `[Studio] 正在同步内置 skills（${targets.length} 个目录，${
      includeRdkx5Skills ? '包含' : '不包含'
    } rdkx5_skills）→ ${remoteSkillsBase}\n`,
  );

  let fileCount = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err || !sftp) {
          reject(err ?? new Error('SFTP 不可用'));
          return;
        }
        void (async () => {
          try {
            await sftpMkdirp(sftp, remoteSkillsBase);
            for (const { skillId, localRoot } of targets) {
              const remoteSkillRoot = path.posix.join(remoteSkillsBase.replace(/\\/g, '/'), skillId);
              const localFiles = listFilesUnderSkillRoot(localRoot);
              if (localFiles.length === 0) continue;
              await sftpMkdirp(sftp, remoteSkillRoot);
              for (const absLocal of localFiles) {
                const rel = path.relative(localRoot, absLocal);
                const posixRel = rel.split(path.sep).join('/');
                const remoteFile = path.posix.join(remoteSkillRoot, posixRel);
                await sftpMkdirp(sftp, path.posix.dirname(remoteFile));
                await sftpFastPut(sftp, absLocal, remoteFile);
                fileCount += 1;
              }
            }
            sftp.end();
            resolve();
          } catch (e) {
            try {
              sftp.end();
            } catch {
              /* ignore */
            }
            reject(e);
          }
        })();
      });
    });
    onLog(`[Studio] 内置技能同步完成：${targets.length} 个技能，${fileCount} 个文件 → ${remoteSkillsBase}\n`);
    return { ok: true, skillCount: targets.length, fileCount };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    onLog(`[Studio] 内置技能同步失败: ${msg}\n`);
    return { ok: false, skillCount: targets.length, fileCount, error: msg };
  }
}
