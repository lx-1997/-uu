import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { prepareBuildResources } from './desktop-icons.mjs';

const target = String(process.argv[2] || '').trim();
const mode = String(process.argv[3] || '').trim().toLowerCase();
const platform = process.platform;
const rootDir = process.cwd();
const releaseDir = path.join(rootDir, 'release');
/** 默认清空 release/；设 RDK_DESKTOP_CLEAN_RELEASE=0 则保留已有文件（新增/覆盖并存，见下方 ARTIFACT_STAMP）。 */
const cleanReleaseDir = String(process.env.RDK_DESKTOP_CLEAN_RELEASE || '1').trim() !== '0';
/** 设 RDK_DESKTOP_ARTIFACT_STAMP=1 时为本次构建的 mac dmg 追加时间戳文件名，避免与 release/ 内旧版同名冲突。 */
const artifactStampRaw = String(process.env.RDK_DESKTOP_ARTIFACT_STAMP || '').trim();
const artifactStamp = artifactStampRaw === '1' || artifactStampRaw.toLowerCase() === 'true';
const skipNpmBuild = String(process.env.RDK_DESKTOP_SKIP_NPM_BUILD || '').trim() === '1';
const explicitCrossPackaging = String(process.env.RDK_DESKTOP_ALLOW_CROSS_PACKAGING || '').trim() === '1';
/** 仅 zip/dir 时 electron-builder 不传 NSIS，跨平台构建通常可行，故默认放行。 */
const winZipDirCross =
  target === 'win' && (mode === 'zip' || mode === 'dir');
const allowCrossPackaging = explicitCrossPackaging || winZipDirCross;
const buildStartedAt = Date.now();

const supportedTargets = new Set(['win', 'mac', 'linux']);
if (!supportedTargets.has(target)) {
  console.error(`[build:desktop] Invalid target: ${target || '<empty>'}`);
  console.error(
    '[build:desktop] Usage: node scripts/build-desktop.mjs <win|mac|linux> [dir|zip|local|arm64|x64|intel]',
  );
  process.exit(1);
}
const macLocalSign = target === 'mac' && mode === 'local';
const macArm64 = target === 'mac' && mode === 'arm64';
const macX64 = target === 'mac' && (mode === 'x64' || mode === 'intel');
/**
 * 默认：产物写入 release/desktop/<variant>/（与 stuido0.3.16 中 Forge maker-zip 的 zip/darwin/arm64 分层类似），
 * 并在该目录生成 RELEASES.json（Electron Forge 兼容：currentRelease + releases + 本地 artifacts 列表）。
 * 恢复旧扁平布局（全部在 release/ 根目录）：RDK_DESKTOP_RELEASE_FLAT=1
 *
 * 命令 → variant 目录（package.json build.* 目标见下文）：
 * - node scripts/build-desktop.mjs win              → win-x64（nsis + portable + zip，arch x64）
 * - node scripts/build-desktop.mjs win zip|dir      → win-x64
 * - node scripts/build-desktop.mjs mac              → darwin-arm64（package.json：dmg + zip，zip 供 electron-updater）
 * - node scripts/build-desktop.mjs mac arm64        → darwin-arm64
 * - node scripts/build-desktop.mjs mac x64|intel    → darwin-x64
 * - node scripts/build-desktop.mjs linux            → linux-x64（AppImage + deb）
 */
const releaseFlat = String(process.env.RDK_DESKTOP_RELEASE_FLAT || '').trim() === '1';

function computeDesktopVariant() {
  if (target === 'win') return 'win-x64';
  if (target === 'linux') return 'linux-x64';
  if (target === 'mac') {
    if (macArm64) return 'darwin-arm64';
    if (macX64) return 'darwin-x64';
    return 'darwin-arm64';
  }
  return 'unknown';
}

function variantMeta(variant) {
  const [os, arch] = variant.split('-');
  const platform =
    os === 'darwin' ? 'darwin' : os === 'win' ? 'win32' : os === 'linux' ? 'linux' : '';
  return { platform, arch: arch || '' };
}

const desktopVariant = computeDesktopVariant();
const segmentedReleaseDir = path.join(releaseDir, 'desktop', desktopVariant);
const electronBuilderOutputDir = releaseFlat ? releaseDir : segmentedReleaseDir;

/** 默认 ad-hoc；对外 Developer ID 分发时设 RDK_DESKTOP_MAC_USE_DEVELOPER_ID=1 */
const macUseDeveloperId =
  target === 'mac' &&
  String(process.env.RDK_DESKTOP_MAC_USE_DEVELOPER_ID || '').trim() === '1';
if (
  mode &&
  !(target === 'win' && (mode === 'dir' || mode === 'zip')) &&
  !macLocalSign &&
  !macArm64 &&
  !macX64
) {
  console.error(`[build:desktop] Unsupported mode "${mode}" for target "${target}"`);
  process.exit(1);
}

const expectedPlatform = {
  win: 'win32',
  mac: 'darwin',
  linux: 'linux',
}[target];

if (platform !== expectedPlatform) {
  if (!allowCrossPackaging) {
    console.error(
      `[build:desktop] Target "${target}" must be built on ${expectedPlatform}, current platform is ${platform}.`,
    );
    console.error('[build:desktop] 在 macOS/Linux 上打 Windows 包可以：');
    console.error(
      '[build:desktop]   npm run build:desktop:win:zip   # 或 :win:dir（zip/dir 交叉打包已默认允许）',
    );
    console.error(
      '[build:desktop]   RDK_DESKTOP_ALLOW_CROSS_PACKAGING=1 npm run build:desktop:win   # 含 NSIS/portable，本机常需 Wine，建议在 Windows 或 CI 上构建/复测',
    );
    process.exit(1);
  }
  if (winZipDirCross) {
    console.warn(
      `[build:desktop] Windows ${mode} 交叉打包：${platform} → ${expectedPlatform}（未打 NSIS；请在 Windows 上验证产物）。`,
    );
  } else {
    console.warn(
      `[build:desktop] 已开启交叉打包：${platform} → ${expectedPlatform}（RDK_DESKTOP_ALLOW_CROSS_PACKAGING=1）；请在目标系统上验证产物。`,
    );
  }
}

const buildResourcesDir = path.join(rootDir, 'build-resources');
const packageJsonPath = path.join(rootDir, 'package.json');
const strictResourceCheck = String(process.env.RDK_DESKTOP_STRICT_RESOURCES || '').trim() === '1';

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

function validateWinFlashBundleForPackaging() {
  const flashDir = path.join(rootDir, 'electron', 'resources', 'flash', 'win32', 'x64');
  const dd = path.join(flashDir, 'dd.exe');
  const ls = path.join(flashDir, 'ls.exe');
  const msys = path.join(flashDir, 'msys-2.0.dll');
  const ok = fs.existsSync(dd) && fs.existsSync(ls) && fs.existsSync(msys);
  if (!ok) {
    const msg =
      '[build:desktop] Windows 烧录资源不完整：缺少 electron/resources/flash/win32/x64 下的 dd.exe、ls.exe 或 msys-2.0.dll。' +
      ' 请在 Windows 上执行: npm run copy:win-flash（需已安装 Git for Windows），再重新打包。';
    if (String(process.env.RDK_DESKTOP_STRICT_WIN_FLASH || '').trim() === '1') {
      throw new Error(msg);
    }
    console.warn(msg);
    console.warn('[build:desktop] 安装包仍可生成，但 TF 卡烧录将回退到经典模式（需管理员 + .NET）。');
    return false;
  }
  console.log('[build:desktop] Windows flash bundle OK:', flashDir);
  return true;
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
    if (!hasTarget(build?.mac, 'zip')) {
      throw new Error('build.mac.target 缺少 zip（electron-updater 在 macOS 上需 zip 才能自动更新）');
    }
  }
  if (target === 'win') {
    if (
      !hasTarget(build?.win, 'nsis') ||
      !hasTarget(build?.win, 'portable') ||
      !hasTarget(build?.win, 'zip')
    ) {
      throw new Error('build.win.target 配置不完整，必须同时包含 nsis、portable 与 zip（x64 压缩包）');
    }
  }
}

/** Windows 上直接 spawn .cmd 且 shell:false 会 EINVAL；仅对 *.cmd 启用 shell。 */
function useShellForCmd(cmd) {
  return platform === 'win32' && typeof cmd === 'string' && /\.cmd$/i.test(cmd);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const shell = useShellForCmd(cmd);
    const child = spawn(cmd, args, {
      cwd: rootDir,
      stdio: 'inherit',
      // node.exe 路径含空格时勿对 node 开 shell；*.cmd 必须 shell 或会 EINVAL
      shell,
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
    const shell = useShellForCmd(cmd);
    const child = spawn(cmd, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell,
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

async function cleanReleaseDirWithRetry(dir, maxRetries = 6, delayMs = 3000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // rmSync may throw on locked files even with force: true
    }
    if (!fs.existsSync(dir)) {
      console.log(`[build:desktop] cleaned release directory${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
      return;
    }
    if (attempt === maxRetries) {
      console.warn(`[build:desktop] release dir still locked after ${maxRetries} retries, moving aside...`);
      const stale = `${dir}-stale-${Date.now()}`;
      try {
        fs.renameSync(dir, stale);
        console.log(`[build:desktop] moved locked dir → ${path.basename(stale)} (can be deleted later)`);
        return;
      } catch {
        // rename also failed — skip cleanup entirely and let electron-builder overwrite in-place
        console.warn(`[build:desktop] cannot move release dir either, skipping cleanup (electron-builder will overwrite)`);
        return;
      }
    }
    console.warn(`[build:desktop] release dir locked, retrying in ${delayMs / 1000}s... (${attempt}/${maxRetries})`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

try {
  await prepareBuildResources(rootDir);
  if (target === 'win') {
    const { copyWinFlashToolsFromGit } = await import('./copy-win-flash-tools.mjs');
    const copyResult = copyWinFlashToolsFromGit();
    if (copyResult.ok && !copyResult.skipped) {
      console.log('[build:desktop] win flash tools copied:', copyResult.copied, 'files →', copyResult.dst);
    } else if (!copyResult.ok && copyResult.reason === 'git-usr-bin-not-found') {
      console.warn(
        '[build:desktop] 未检测到 Git usr\\bin（无法自动复制 dd/ls）。若需插件同款烧录，请先安装 Git for Windows 后执行 npm run copy:win-flash',
      );
    }
    validateWinFlashBundleForPackaging();
  }
  validateBuildResources();
  validateBuildConfig();
  const cleanTargetDir = releaseFlat ? releaseDir : segmentedReleaseDir;
  if (cleanReleaseDir) {
    if (releaseFlat) {
      console.log('[build:desktop] 清空整个 release/（RDK_DESKTOP_RELEASE_FLAT=1）');
    } else {
      console.log(`[build:desktop] 清空本 variant 输出目录: release/desktop/${desktopVariant}/`);
    }
    await cleanReleaseDirWithRetry(cleanTargetDir);
  } else {
    console.log(
      '[build:desktop] RDK_DESKTOP_CLEAN_RELEASE=0：保留已有输出目录中的文件。',
    );
    console.log(
      '[build:desktop] 同名产物（同版本）仍会被 electron-builder 覆盖；若需每次生成新文件名，请设 RDK_DESKTOP_ARTIFACT_STAMP=1。',
    );
  }
  if (skipNpmBuild) {
    console.log('[build:desktop] RDK_DESKTOP_SKIP_NPM_BUILD=1, skipping npm run build');
    // Freshness guard: warn if any server/ source file is newer than dist-server/
    const distServerDir = path.join(rootDir, 'dist-server');
    const serverDir = path.join(rootDir, 'server');
    if (fs.existsSync(distServerDir) && fs.existsSync(serverDir)) {
      let distMtime = 0;
      try {
        const walk = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); } else {
              const mt = fs.statSync(full).mtimeMs;
              if (mt > distMtime) distMtime = mt;
            }
          }
        };
        walk(distServerDir);
      } catch { /* best-effort */ }
      let srcNewerCount = 0;
      try {
        const checkSrc = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { checkSrc(full); } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
              if (fs.statSync(full).mtimeMs > distMtime) srcNewerCount++;
            }
          }
        };
        checkSrc(serverDir);
      } catch { /* best-effort */ }
      if (srcNewerCount > 0) {
        console.warn(
          `\x1b[33m[build:desktop] WARNING: ${srcNewerCount} server/ source file(s) are newer than dist-server/. ` +
          `The packaged build may contain stale server code. Run 'npm run build' first or remove RDK_DESKTOP_SKIP_NPM_BUILD.\x1b[0m`,
        );
      }
    } else if (!fs.existsSync(distServerDir)) {
      console.error('[build:desktop] ERROR: dist-server/ does not exist. Cannot skip build.');
      process.exit(1);
    }
  } else {
    await run(npmCmd, ['run', 'build']);
  }
  if (target === 'win') {
    process.env.RDK_DESKTOP_WIN_UNPACKED_PATH = path.join(electronBuilderOutputDir, 'win-unpacked');
    await run(npmCmd, ['run', 'clean:win-unpacked']);
    delete process.env.RDK_DESKTOP_WIN_UNPACKED_PATH;
  }
  if (!releaseFlat) {
    console.log(`[build:desktop] electron-builder directories.output → ${electronBuilderOutputDir}`);
  } else {
    console.log('[build:desktop] electron-builder 输出目录: release/（根目录，RDK_DESKTOP_RELEASE_FLAT=1）');
  }
  const builderBaseArgs =
    target === 'win' && mode === 'dir'
      ? ['--win', 'dir']
      : target === 'win' && mode === 'zip'
        ? ['--win', 'zip']
        : [`--${target}`];
  /** 与 package.json build.win 一致为 x64；在 arm64 Mac 上若省略则会误打 win-arm64。 */
  let builderArgs = target === 'win' ? [...builderBaseArgs, '--x64'] : builderBaseArgs;
  if (macArm64) {
    builderArgs = [...builderArgs, '--arm64'];
  }
  if (macX64) {
    builderArgs = [...builderArgs, '--x64'];
  }
  if (target === 'mac' && !macUseDeveloperId) {
    console.warn(
      '[build:desktop] mac：ad-hoc 签名（-c.mac.identity=-），公证已关闭；对外分发若需 Developer ID 请设 RDK_DESKTOP_MAC_USE_DEVELOPER_ID=1。',
    );
    console.warn(
      '[build:desktop] 经浏览器/AirDrop 可能带隔离属性；可右键「打开」或 xattr -dr com.apple.quarantine <路径>。',
    );
    builderArgs = [
      ...builderArgs,
      '-c.mac.identity=-',
      '-c.mac.notarize=false',
    ];
  }
  if (artifactStamp && target === 'mac') {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'z');
    builderArgs = [
      ...builderArgs,
      `-c.mac.artifactName=\${productName}-\${version}-\${arch}-${stamp}.dmg`,
    ];
    console.log(`[build:desktop] RDK_DESKTOP_ARTIFACT_STAMP=1：dmg 将带时间戳后缀（${stamp}）。`);
  }
  if (!releaseFlat) {
    /** 勿用单独的 -o（与 electron-builder 的 --mac 短选项冲突）；使用 -c.directories.output= */
    builderArgs = [...builderArgs, `-c.directories.output=${electronBuilderOutputDir}`];
  }
  await run(builderBin, builderArgs);
  const { writeDesktopReleasesJson } = await import('./write-desktop-releases.mjs');
  writeDesktopReleasesJson(electronBuilderOutputDir, rootDir, {
    variant: desktopVariant,
    ...variantMeta(desktopVariant),
  });
  await runWithEnv(
    process.execPath,
    ['scripts/desktop-smoke-check.mjs', target],
    {
      RDK_DESKTOP_BUILD_STARTED_AT: String(buildStartedAt),
      RDK_DESKTOP_RELEASE_OUT: electronBuilderOutputDir,
      ...(target === 'win' && mode === 'dir' ? { RDK_DESKTOP_WIN_DIR_MODE: '1' } : {}),
      ...(target === 'win' && mode === 'zip' ? { RDK_DESKTOP_WIN_ZIP_MODE: '1' } : {}),
    },
  );
  console.log(`[build:desktop] ${target}${mode ? `:${mode}` : ''} packaging completed successfully.`);
} catch (error) {
  console.error('[build:desktop] Packaging failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
