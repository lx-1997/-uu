import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const target = String(process.argv[2] || '').trim();
const mode = String(process.argv[3] || '').trim().toLowerCase();
const platform = process.platform;
const rootDir = process.cwd();
const releaseDir = path.join(rootDir, 'release');
const cleanReleaseDir = String(process.env.RDK_DESKTOP_CLEAN_RELEASE || '1').trim() !== '0';
const buildStartedAt = Date.now();

const supportedTargets = new Set(['win', 'mac', 'linux']);
if (!supportedTargets.has(target)) {
  console.error(`[build:desktop] Invalid target: ${target || '<empty>'}`);
  console.error('[build:desktop] Usage: node scripts/build-desktop.mjs <win|mac|linux> [dir]');
  process.exit(1);
}
if (mode && !(target === 'win' && mode === 'dir')) {
  console.error(`[build:desktop] Unsupported mode "${mode}" for target "${target}"`);
  process.exit(1);
}

const expectedPlatform = {
  win: 'win32',
  mac: 'darwin',
  linux: 'linux',
}[target];

if (platform !== expectedPlatform) {
  console.error(
    `[build:desktop] Target "${target}" must be built on ${expectedPlatform}, current platform is ${platform}.`,
  );
  console.error('[build:desktop] To keep artifacts stable, cross-platform packaging is disabled by policy.');
  process.exit(1);
}

const buildResourcesDir = path.join(rootDir, 'build-resources');
const packageJsonPath = path.join(rootDir, 'package.json');
const strictResourceCheck = String(process.env.RDK_DESKTOP_STRICT_RESOURCES || '').trim() === '1';
function ensureBuildResourcesPrepared() {
  fs.mkdirSync(buildResourcesDir, { recursive: true });
}

function validateBuildResources() {
  const requiredByTarget = {
    win: ['icon.ico'],
    mac: ['icon.png'],
    linux: ['icon.png'],
  };
  const required = requiredByTarget[target] || [];
  const missing = required.filter((name) => !fs.existsSync(path.join(buildResourcesDir, name)));
  if (missing.length > 0) {
    const message = `[build:desktop] build-resources 缺少必要文件: ${missing.join(', ')}`;
    if (strictResourceCheck) {
      throw new Error(`${message}（strict mode）`);
    }
    console.warn(`${message}，将继续尝试打包`);
  }
}

function validateBuildConfig() {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const build = pkg?.build ?? {};
  const outputDir = String(build?.directories?.output || '').trim();
  if (!outputDir) {
    throw new Error('package.json 缺少 build.directories.output 配置');
  }

  const hasTarget = (section, expected) => {
    const target = section?.target;
    const arr = Array.isArray(target) ? target : [];
    return arr.some((item) => {
      if (typeof item === 'string') return item.toLowerCase() === expected.toLowerCase();
      const name = String(item?.target || '').toLowerCase();
      return name === expected.toLowerCase();
    });
  };

  if (target === 'linux') {
    if (!hasTarget(build?.linux, 'AppImage') || !hasTarget(build?.linux, 'deb')) {
      throw new Error('build.linux.target 配置不完整，必须同时包含 AppImage 与 deb');
    }
  }
  if (target === 'mac') {
    if (!hasTarget(build?.mac, 'dmg')) {
      throw new Error('build.mac.target 缺少 dmg');
    }
  }
  if (target === 'win') {
    if (!hasTarget(build?.win, 'nsis') || !hasTarget(build?.win, 'portable')) {
      throw new Error('build.win.target 配置不完整，必须同时包含 nsis 与 portable');
    }
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: platform === 'win32',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} failed with exit code ${code ?? 'null'}`));
    });
  });
}
function runWithEnv(cmd, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: platform === 'win32',
      env: { ...process.env, ...(extraEnv || {}) },
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} failed with exit code ${code ?? 'null'}`));
    });
  });
}

const npmCmd = platform === 'win32' ? 'npm.cmd' : 'npm';
const builderBin = platform === 'win32' ? 'node_modules\\.bin\\electron-builder.cmd' : 'node_modules/.bin/electron-builder';

try {
  ensureBuildResourcesPrepared();
  validateBuildResources();
  validateBuildConfig();
  if (cleanReleaseDir) {
    fs.rmSync(releaseDir, { recursive: true, force: true });
    console.log('[build:desktop] cleaned release directory');
  }
  await run(npmCmd, ['run', 'build']);
  if (target === 'win') {
    await run(npmCmd, ['run', 'clean:win-unpacked']);
  }
  const builderArgs = target === 'win' && mode === 'dir'
    ? ['--win', 'dir']
    : [`--${target}`];
  await run(builderBin, builderArgs);
  await runWithEnv(
    process.execPath,
    ['scripts/desktop-smoke-check.mjs', target],
    {
      RDK_DESKTOP_BUILD_STARTED_AT: String(buildStartedAt),
      ...(target === 'win' && mode === 'dir' ? { RDK_DESKTOP_WIN_DIR_MODE: '1' } : {}),
    },
  );
  console.log(`[build:desktop] ${target}${mode ? `:${mode}` : ''} packaging completed successfully.`);
} catch (error) {
  console.error('[build:desktop] Packaging failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
