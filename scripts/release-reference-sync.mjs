import fs from 'node:fs';
import path from 'node:path';

const target = String(process.argv[2] || '').trim().toLowerCase();
const mode = String(process.argv[3] || 'init').trim().toLowerCase();
const rootDir = process.cwd();
const smokeManifestPath = path.join(rootDir, '.smoke', 'release-manifest.json');
const referenceDir = path.join(rootDir, '.ci', 'release-reference-manifests');
const targetPath = path.join(referenceDir, `${target}.json`);

if (!target || !['linux', 'mac', 'win'].includes(target)) {
  console.error('[release:reference] usage: node scripts/release-reference-sync.mjs <linux|mac|win> [init|update]');
  process.exit(1);
}
if (!['init', 'update'].includes(mode)) {
  console.error('[release:reference] mode must be init or update');
  process.exit(1);
}

function validateManifest(manifest) {
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  if (files.length === 0) throw new Error('manifest files is empty');
  const fileCount = Number(manifest?.fileCount || 0);
  if (fileCount <= 0) throw new Error('manifest fileCount is invalid');
}

try {
  if (!fs.existsSync(smokeManifestPath)) {
    throw new Error(`source manifest not found: ${smokeManifestPath}`);
  }
  const source = JSON.parse(fs.readFileSync(smokeManifestPath, 'utf-8'));
  validateManifest(source);

  fs.mkdirSync(referenceDir, { recursive: true });
  const exists = fs.existsSync(targetPath);

  if (mode === 'init' && exists) {
    throw new Error(`reference already exists: ${targetPath} (use mode=update)`);
  }
  if (mode === 'update' && !exists) {
    throw new Error(`reference not found: ${targetPath} (use mode=init)`);
  }

  const next = {
    ...source,
    referenceTarget: target,
    referenceUpdatedAt: new Date().toISOString(),
    referenceMode: mode,
  };
  fs.writeFileSync(targetPath, JSON.stringify(next, null, 2), 'utf-8');
  console.log(`[release:reference] ${mode} completed: ${targetPath}`);
} catch (error) {
  console.error('[release:reference] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
