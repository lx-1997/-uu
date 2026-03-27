/**
 * 桌面打包图标统一入口（与 rdkstudio_frontend-master 对齐）
 *
 * 查找顺序：
 * 1. 环境变量 RDK_FRONTEND_DIR（指向前端仓库根目录）
 * 2. <repo>/rdkstudio_frontend-master（.gitignore，本地克隆常用）
 * 3. <repo>/../rdkstudio_frontend-master
 *
 * 在前端仓库内按文件名优先匹配（先找到先用）：
 * - .ico: icon/icon.ico（rdkstudio_frontend-master/icon 常用）, build/icon.ico, …
 * - .png: icon/icon.png, build/icon.png, …
 * - .icns: icon/icon.icns, build/icon.icns, …
 *
 * 若前端缺少某项：用本仓库 public/branding/icon.png（若已有）→ 再退回 bundled noVNC 占位图。
 * 有 PNG 时会同步写入 public/branding/icon.png，供左侧栏等静态引用。
 * Windows 在仅有 PNG 时用 png-to-ico 生成 icon.ico（建议 PNG ≥256×256，否则回退 noVNC .ico）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const ICO_CANDIDATES = [
  'icon/icon.ico',
  'build/icon.ico',
  'resources/icon.ico',
  'public/favicon.ico',
  'electron/icons/icon.ico',
  'electron/build/icon.ico',
  'src-electron/icons/icon.ico',
  'app.ico',
  'src/assets/icon.ico',
];

const PNG_CANDIDATES = [
  'icon/icon.png',
  'build/icon.png',
  'resources/icon.png',
  'public/icon.png',
  'public/icons/icon.png',
  'src/assets/logo.png',
  'src/assets/icon.png',
  'src/assets/icons/icon.png',
  'build/icons/512x512.png',
  'build/icons/icon.png',
  'electron/build/icon.png',
];

const ICNS_CANDIDATES = ['icon/icon.icns', 'build/icon.icns', 'resources/icon.icns'];

const FALLBACK_PNG = (root) => path.join(root, 'public', 'branding', 'icon.png');
const FALLBACK_ICO = (root) => path.join(root, 'public', 'vnc', 'app', 'images', 'icons', 'novnc.ico');
const FALLBACK_IOS_PNG = (root) =>
  path.join(root, 'public', 'vnc', 'app', 'images', 'icons', 'novnc-ios-180.png');

/**
 * @param {string} rootDir - 本仓库根目录（rdk_studio_web）
 * @param {{ quiet?: boolean }} [opts]
 */
export function resolveFrontendRoots(rootDir) {
  const env = String(process.env.RDK_FRONTEND_DIR || '').trim();
  const out = [];
  if (env && fs.existsSync(env)) out.push(path.resolve(env));
  const inner = path.join(rootDir, 'rdkstudio_frontend-master');
  if (fs.existsSync(inner)) out.push(inner);
  const sibling = path.resolve(rootDir, '..', 'rdkstudio_frontend-master');
  if (fs.existsSync(sibling)) out.push(sibling);
  return out;
}

function firstExisting(base, relatives) {
  for (const rel of relatives) {
    const full = path.join(base, rel);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

async function writeIcoFromPng(pngPath, icoPath, log) {
  try {
    const pngToIco = require('png-to-ico');
    const buf = await pngToIco(fs.readFileSync(pngPath));
    fs.writeFileSync(icoPath, buf);
    log(`generated icon.ico from PNG (${path.basename(pngPath)})`);
    return true;
  } catch (e) {
    log(`png-to-ico failed: ${e instanceof Error ? e.message : e}`, 'warn');
    return false;
  }
}

/**
 * @param {string} rootDir
 * @param {{ quiet?: boolean }} [opts]
 */
export async function prepareBuildResources(rootDir, opts = {}) {
  const quiet = Boolean(opts.quiet);
  const log = (msg, level = 'log') => {
    if (quiet && level === 'log') return;
    const p = '[desktop-icons]';
    if (level === 'warn') console.warn(`${p} ${msg}`);
    else console.log(`${p} ${msg}`);
  };

  const outDir = path.join(rootDir, 'build-resources');
  fs.mkdirSync(outDir, { recursive: true });

  const roots = resolveFrontendRoots(rootDir);
  if (roots.length) log(`frontend roots: ${roots.join(' | ')}`);
  else log('no rdkstudio_frontend-master found (set RDK_FRONTEND_DIR or clone beside repo)', 'warn');

  let srcIco = null;
  let srcPng = null;
  let srcIcns = null;
  let srcLabel = '';

  for (const base of roots) {
    const ico = firstExisting(base, ICO_CANDIDATES);
    const png = firstExisting(base, PNG_CANDIDATES);
    const icns = firstExisting(base, ICNS_CANDIDATES);
    if (ico || png || icns) {
      srcIco = ico;
      srcPng = png;
      srcIcns = icns;
      srcLabel = path.relative(rootDir, base) || base;
      break;
    }
  }

  if (srcLabel) log(`using icons from: ${srcLabel}`);

  /** 供 mac/linux 的 PNG：优先前端，否则本仓库 branding，再否则 noVNC 占位 */
  let pngForPack = srcPng;
  if (!pngForPack && fs.existsSync(FALLBACK_PNG(rootDir))) {
    pngForPack = FALLBACK_PNG(rootDir);
    log(`PNG fallback: public/branding/icon.png`);
  }
  if (!pngForPack && fs.existsSync(FALLBACK_IOS_PNG(rootDir))) {
    pngForPack = FALLBACK_IOS_PNG(rootDir);
    log(`PNG fallback: bundled noVNC ios icon`, 'warn');
  }

  /** Windows .ico：优先前端；否则用 png 生成；最后再试 noVNC .ico */
  let icoForWin = srcIco;
  if (!icoForWin && !pngForPack && fs.existsSync(FALLBACK_ICO(rootDir))) {
    icoForWin = FALLBACK_ICO(rootDir);
    log(`ICO-only fallback: bundled noVNC .ico`, 'warn');
  }

  const destPng = path.join(outDir, 'icon.png');
  const destIco = path.join(outDir, 'icon.ico');
  const destIcns = path.join(outDir, 'icon.icns');

  if (pngForPack) {
    fs.copyFileSync(pngForPack, destPng);
    log(`→ build-resources/icon.png`);
    const brandingPng = path.join(rootDir, 'public', 'branding', 'icon.png');
    fs.mkdirSync(path.dirname(brandingPng), { recursive: true });
    fs.copyFileSync(pngForPack, brandingPng);
    log(`→ public/branding/icon.png (左侧栏 / 网页静态资源)`);
  } else {
    log('no icon.png — mac/linux 可能使用默认图标', 'warn');
  }

  if (icoForWin) {
    fs.copyFileSync(icoForWin, destIco);
    log(`→ build-resources/icon.ico`);
  } else if (pngForPack) {
    const ok = await writeIcoFromPng(pngForPack, destIco, log);
    if (!ok && fs.existsSync(FALLBACK_ICO(rootDir))) {
      fs.copyFileSync(FALLBACK_ICO(rootDir), destIco);
      log(`→ build-resources/icon.ico (noVNC, png-to-ico 需 256×256 等尺寸)`, 'warn');
    }
  } else if (fs.existsSync(FALLBACK_ICO(rootDir))) {
    fs.copyFileSync(FALLBACK_ICO(rootDir), destIco);
    log(`→ build-resources/icon.ico (noVNC)`, 'warn');
  }

  if (srcIcns) {
    fs.copyFileSync(srcIcns, destIcns);
    log(`→ build-resources/icon.icns`);
  } else if (fs.existsSync(destIcns)) {
    fs.unlinkSync(destIcns);
  }

  return {
    outDir,
    /** 是否从前端仓解析到任意 ico/png/icns */
    usedFrontendIcons: Boolean(srcLabel),
    /** 是否存在可探测的前端根目录（可能尚未放入图标文件） */
    hasFrontendRoot: roots.length > 0,
    hasPng: fs.existsSync(destPng),
    hasIco: fs.existsSync(destIco),
    hasIcns: fs.existsSync(destIcns),
  };
}
