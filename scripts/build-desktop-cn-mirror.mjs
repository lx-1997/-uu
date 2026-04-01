/**
 * 在 GitHub 不可达时，为 electron-builder 设置国内二进制镜像后再执行 build-desktop。
 *
 * 用法（与 build-desktop.mjs 相同）：
 *   node scripts/build-desktop-cn-mirror.mjs win
 *   node scripts/build-desktop-cn-mirror.mjs win zip
 *
 * 若已手动设置 ELECTRON_BUILDER_BINARIES_MIRROR，则不会覆盖。
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const defaultMirror = 'https://npmmirror.com/mirrors/electron-builder-binaries/';
const hadMirror = Boolean(String(process.env.ELECTRON_BUILDER_BINARIES_MIRROR || '').trim());
const mirror = hadMirror
  ? String(process.env.ELECTRON_BUILDER_BINARIES_MIRROR).trim()
  : defaultMirror;
if (!hadMirror) {
  console.log('[build-desktop-cn-mirror] ELECTRON_BUILDER_BINARIES_MIRROR →', mirror);
}

const passArgs = process.argv.slice(2);
const child = spawn(process.execPath, ['scripts/build-desktop.mjs', ...passArgs], {
  env: { ...process.env, ELECTRON_BUILDER_BINARIES_MIRROR: mirror },
  stdio: 'inherit',
  shell: false,
});
child.on('error', (err) => {
  console.error('[build-desktop-cn-mirror]', err);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
