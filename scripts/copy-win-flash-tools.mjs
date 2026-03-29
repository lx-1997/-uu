/**
 * 将 Git for Windows 自带的 GNU dd/ls 及 msys*.dll 复制到 electron/resources/flash/win32/x64，
 * 与 rdkstudio_frontend 捆绑工具行为一致，便于离线打包。
 *
 * 若本机未安装 Git，跳过（不失败）；已存在 dd.exe 且未传 --force 时可跳过。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const dstDir = path.join(rootDir, 'electron', 'resources', 'flash', 'win32', 'x64');

const GIT_BIN_CANDIDATES = [
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Git', 'usr', 'bin'),
].filter(Boolean);

function findGitUsrBin() {
  for (const p of GIT_BIN_CANDIDATES) {
    if (fs.existsSync(path.join(p, 'dd.exe')) && fs.existsSync(path.join(p, 'ls.exe'))) {
      return p;
    }
  }
  return null;
}

/**
 * @param {{ force?: boolean }} [opts]
 * @returns {{ ok: boolean; skipped?: boolean; src?: string; dst?: string; reason?: string; copied?: number }}
 */
export function copyWinFlashToolsFromGit(opts = {}) {
  const force = opts.force === true;
  if (process.platform !== 'win32') {
    return { ok: false, reason: 'not-win32' };
  }
  const src = findGitUsrBin();
  if (!src) {
    return { ok: false, reason: 'git-usr-bin-not-found' };
  }
  fs.mkdirSync(dstDir, { recursive: true });
  const ddDst = path.join(dstDir, 'dd.exe');
  const msysDst = path.join(dstDir, 'msys-2.0.dll');
  if (!force && fs.existsSync(ddDst) && fs.existsSync(msysDst)) {
    return { ok: true, skipped: true, src, dst: dstDir };
  }

  let copied = 0;
  const copyFile = (name) => {
    const from = path.join(src, name);
    const to = path.join(dstDir, name);
    if (!fs.existsSync(from)) {
      return;
    }
    fs.copyFileSync(from, to);
    copied += 1;
  };

  copyFile('dd.exe');
  copyFile('ls.exe');
  try {
    const names = fs.readdirSync(src);
    for (const n of names) {
      if (n.startsWith('msys-') && n.endsWith('.dll')) {
        copyFile(n);
      }
    }
  } catch {
    /* ignore */
  }
  copyFile('winpty.dll');

  return { ok: true, src, dst: dstDir, copied };
}

function main() {
  const force = process.argv.includes('--force');
  const r = copyWinFlashToolsFromGit({ force });
  if (!r.ok && r.reason === 'not-win32') {
    console.log('[copy-win-flash-tools] skip (not Windows)');
    process.exit(0);
  }
  if (!r.ok) {
    console.warn('[copy-win-flash-tools] skip:', r.reason, '(install Git for Windows or copy dd.exe/ls.exe manually)');
    process.exit(0);
  }
  if (r.skipped) {
    console.log('[copy-win-flash-tools] already present, use --force to refresh:', r.dst);
    process.exit(0);
  }
  console.log('[copy-win-flash-tools] copied', r.copied, 'files from', r.src, '->', r.dst);
}

try {
  const selfPath = fileURLToPath(import.meta.url);
  const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(selfPath);
  if (invoked) {
    main();
  }
} catch {
  /* not main */
}
