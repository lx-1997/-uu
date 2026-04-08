/**
 * 在打包输出目录写入 RELEASES.json（兼容 Electron Forge maker-zip 的 currentRelease + releases 结构，
 * 并增加 artifacts 列表便于镜像站/内网分发）。
 *
 * 旧版参考：stuido0.3.16 中 @electron-forge/maker-zip 生成的 zip/darwin/arm64/RELEASES.json
 */
import fs from 'node:fs';
import path from 'node:path';

function kindFromName(lower) {
  if (lower.endsWith('.dmg')) return 'dmg';
  if (lower.endsWith('.exe')) return lower.includes('portable') ? 'portable-exe' : 'setup-exe';
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.appimage')) return 'AppImage';
  if (lower.endsWith('.deb')) return 'deb';
  if (lower.endsWith('.blockmap')) return 'blockmap';
  if (lower === 'latest.yml' || lower === 'latest-mac.yml' || lower.endsWith('.yml') || lower.endsWith('.yaml')) {
    return 'metadata';
  }
  return 'other';
}

/**
 * @param {object} pkg package.json 解析结果
 * @param {{ variant?: string; platform?: string; arch?: string }} meta
 * @param {Array<{ file: string; kind: string; bytes: number }>} artifacts
 * @param {{ stub?: boolean }} opts
 */
function buildReleasesManifest(pkg, meta, artifacts, opts = {}) {
  const version = String(pkg.version || '').trim() || '0.0.0';
  const productName = String(pkg.build?.productName || pkg.name || 'app').trim();
  const pubDate = new Date().toISOString();
  const primary =
    artifacts.find((a) => ['dmg', 'setup-exe', 'zip', 'AppImage', 'deb'].includes(a.kind)) || artifacts[0];

  const updateTo = {
    name: `${productName} v${version}`,
    version,
    pub_date: pubDate,
    url: primary ? primary.file : '',
    notes: '',
  };

  const manifest = {
    currentRelease: version,
    releases: [
      {
        version,
        variant: meta.variant ?? '',
        platform: meta.platform ?? '',
        arch: meta.arch ?? '',
        updateTo,
      },
    ],
    artifacts,
    generatedAt: pubDate,
    productName,
  };
  if (opts.stub) {
    manifest.artifactsNote =
      'afterPack 阶段尚未生成安装包文件列表；完整 artifacts 见输出目录旁 RELEASES.json，构建结束后会同步到本文件。';
  }
  return manifest;
}

/**
 * afterPack 时写入应用 resources/RELEASES.json（安装包内可见；artifacts 可能为空）。
 *
 * @param {string} appOutDir electron-builder 的 appOutDir（win 为 win-unpacked，darwin 为 .app/Contents）
 * @param {string} rootDir 项目根
 * @param {string} electronPlatformName darwin | win32 | linux
 * @param {{ variant?: string; platform?: string; arch?: string }} meta
 */
export function writeStubReleasesIntoAppOutDir(appOutDir, rootDir, electronPlatformName, meta = {}) {
  if (!appOutDir || !fs.existsSync(appOutDir)) return;
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const manifest = buildReleasesManifest(pkg, meta, [], { stub: true });
  const dest = releasesJsonPathUnderAppOutDir(appOutDir, electronPlatformName);
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log('[write-desktop-releases] afterPack 已写入', path.relative(rootDir, dest));
  } catch (e) {
    console.warn('[write-desktop-releases] afterPack 写入失败', dest, e instanceof Error ? e.message : e);
  }
}

/** @param {string} electronPlatformName */
function releasesJsonPathUnderAppOutDir(appOutDir, electronPlatformName) {
  const p = String(electronPlatformName || '').toLowerCase();
  if (p === 'darwin') {
    return path.join(appOutDir, 'Resources', 'RELEASES.json');
  }
  return path.join(appOutDir, 'resources', 'RELEASES.json');
}

/**
 * @param {string} outputDir electron-builder 实际输出目录（含 dmg/exe 等）
 * @param {string} rootDir 仓库根（读 package.json）
 * @param {{ variant?: string; platform?: string; arch?: string }} meta
 */
export function writeDesktopReleasesJson(outputDir, rootDir, meta = {}) {
  if (!fs.existsSync(outputDir)) {
    console.warn('[write-desktop-releases] 输出目录不存在，跳过 RELEASES.json:', outputDir);
    return null;
  }
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  const names = fs.readdirSync(outputDir).filter((n) => {
    const low = n.toLowerCase();
    if (n.startsWith('.')) return false;
    if (low === 'builder-debug.yml' || low === 'builder-effective-config.yaml') return false;
    return true;
  });

  const artifacts = [];
  for (const name of names) {
    const full = path.join(outputDir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const low = name.toLowerCase();
    if (
      !/\.(dmg|exe|zip|deb|appimage|blockmap|yml|yaml)$/i.test(name)
      && !/^latest/i.test(name)
    ) {
      continue;
    }
    artifacts.push({
      file: name,
      kind: kindFromName(low),
      bytes: st.size,
    });
  }

  const manifest = buildReleasesManifest(pkg, meta, artifacts, {});

  const outFile = path.join(outputDir, 'RELEASES.json');
  fs.writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log('[write-desktop-releases] 已写入', path.relative(rootDir, outFile));
  copyReleasesIntoUnpackedPackages(outputDir, outFile, rootDir);
  return outFile;
}

/**
 * 将 RELEASES.json 同步到 electron-builder 解包目录（安装包/应用包内的 resources），
 * 与输出根目录的 RELEASES.json 内容一致。
 */
function copyReleasesIntoUnpackedPackages(outputDir, srcFile, rootDir) {
  if (!fs.existsSync(srcFile)) return;

  const copyTo = (dest) => {
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(srcFile, dest);
      console.log('[write-desktop-releases] 已复制到安装包目录', path.relative(rootDir, dest));
    } catch (e) {
      console.warn('[write-desktop-releases] 复制失败', dest, e instanceof Error ? e.message : e);
    }
  };

  const winResources = path.join(outputDir, 'win-unpacked', 'resources');
  if (fs.existsSync(path.join(outputDir, 'win-unpacked'))) {
    copyTo(path.join(winResources, 'RELEASES.json'));
  }

  const linuxResources = path.join(outputDir, 'linux-unpacked', 'resources');
  if (fs.existsSync(path.join(outputDir, 'linux-unpacked'))) {
    copyTo(path.join(linuxResources, 'RELEASES.json'));
  }

  for (const appPath of findMainAppBundles(outputDir)) {
    copyTo(path.join(appPath, 'Contents', 'Resources', 'RELEASES.json'));
  }
}

/** 仅收集输出目录下「主应用」.app（跳过 Helper、不深入 Frameworks） */
function findMainAppBundles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const name of fs.readdirSync(root)) {
    if (name.endsWith('.app')) {
      if (!name.includes('Helper')) out.push(path.join(root, name));
      continue;
    }
    const full = path.join(root, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory() || name.startsWith('.')) continue;
    if (name === 'win-unpacked' || name === 'linux-unpacked') continue;
    try {
      for (const sub of fs.readdirSync(full)) {
        if (!sub.endsWith('.app') || sub.includes('Helper')) continue;
        out.push(path.join(full, sub));
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}
