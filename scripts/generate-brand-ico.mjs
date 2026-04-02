/**
 * 从 public/branding/icon.png 生成 public/branding/icon.ico（与 desktop-icons 算法一致）。
 * 更新主 PNG 后执行: npm run icons:brand-ico
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pngPath = path.join(rootDir, 'public', 'branding', 'icon.png');
const icoPath = path.join(rootDir, 'public', 'branding', 'icon.ico');

if (!fs.existsSync(pngPath)) {
  console.error('[generate-brand-ico] missing:', pngPath);
  process.exit(1);
}

const { default: sharp } = await import('sharp');
const requireRoot = createRequire(path.join(rootDir, 'package.json'));
const toIco = requireRoot('to-ico');
const sizes = [16, 32, 48, 64, 128, 256];
const bg = { r: 0, g: 0, b: 0, alpha: 0 };
const pngBufs = await Promise.all(
  sizes.map((s) =>
    sharp(pngPath).resize(s, s, { fit: 'contain', background: bg }).png().toBuffer(),
  ),
);
const buf = await toIco(pngBufs);
fs.writeFileSync(icoPath, buf);
console.log('[generate-brand-ico] wrote', icoPath, `(${buf.length} bytes)`);
