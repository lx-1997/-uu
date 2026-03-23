import fs from 'node:fs';
import path from 'node:path';

const target = String(process.argv[2] || '').trim().toLowerCase();
const rootDir = process.cwd();
const manifestPath = path.join(rootDir, '.smoke', 'release-manifest.json');
const baselinePath = path.join(rootDir, '.ci', 'release-baselines.json');
const outPath = path.join(rootDir, '.smoke', `release-baseline-suggested-${target}.json`);

if (!target || !['linux', 'mac', 'win'].includes(target)) {
  console.error('[release:baseline] usage: node scripts/release-baseline-suggest.mjs <linux|mac|win>');
  process.exit(1);
}

function fail(message) {
  throw new Error(message);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function suggestFromManifest(files) {
  const fileCount = files.length;
  const totalBytes = files.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);

  const extCandidates = files
    .map((item) => String(item.path || '').toLowerCase())
    .map((p) => {
      if (p.endsWith('.appimage')) return '.appimage';
      if (p.endsWith('.deb')) return '.deb';
      if (p.endsWith('.dmg')) return '.dmg';
      if (p.endsWith('.exe')) return '.exe';
      return '';
    })
    .filter(Boolean);

  const requiredExtensionsByTarget = {
    linux: uniq(extCandidates.filter((ext) => ext === '.appimage' || ext === '.deb')),
    mac: ['.dmg'],
    win: ['.exe'],
  };

  return {
    requiredExtensions: requiredExtensionsByTarget[target],
    minFileCount: Math.max(1, Math.floor(fileCount * 0.8)),
    maxFileCount: Math.max(5, Math.ceil(fileCount * 1.5)),
    minTotalBytes: Math.max(1_000_000, Math.floor(totalBytes * 0.7)),
    maxTotalBytes: Math.max(10_000_000, Math.ceil(totalBytes * 1.6)),
  };
}

try {
  if (!fs.existsSync(manifestPath)) fail(`manifest not found: ${manifestPath}`);
  if (!fs.existsSync(baselinePath)) fail(`baseline not found: ${baselinePath}`);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const baselines = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (files.length === 0) fail('manifest files is empty');

  const suggested = suggestFromManifest(files);
  const current = baselines[target] || {};
  const report = {
    generatedAt: new Date().toISOString(),
    target,
    current,
    suggested,
    diff: {
      minFileCount: [current.minFileCount, suggested.minFileCount],
      maxFileCount: [current.maxFileCount, suggested.maxFileCount],
      minTotalBytes: [current.minTotalBytes, suggested.minTotalBytes],
      maxTotalBytes: [current.maxTotalBytes, suggested.maxTotalBytes],
      requiredExtensions: [current.requiredExtensions || [], suggested.requiredExtensions],
    },
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[release:baseline] suggestion generated: ${outPath}`);
} catch (error) {
  console.error('[release:baseline] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
