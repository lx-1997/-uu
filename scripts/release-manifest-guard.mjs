import fs from 'node:fs';
import path from 'node:path';

const target = String(process.argv[2] || '').trim().toLowerCase();
const rootDir = process.cwd();
const manifestPath = path.join(rootDir, '.smoke', 'release-manifest.json');
const baselinePath = path.join(rootDir, '.ci', 'release-baselines.json');
const outPath = path.join(rootDir, '.smoke', 'release-guard.json');

if (!target || !['linux', 'mac', 'win'].includes(target)) {
  console.error('[release:guard] usage: node scripts/release-manifest-guard.mjs <linux|mac|win>');
  process.exit(1);
}

function fail(message) {
  throw new Error(message);
}

function hasAnyExt(files, ext) {
  const suffix = ext.toLowerCase();
  return files.some((item) => String(item.path || '').toLowerCase().endsWith(suffix));
}

try {
  if (!fs.existsSync(manifestPath)) {
    fail(`manifest not found: ${manifestPath}`);
  }
  if (!fs.existsSync(baselinePath)) {
    fail(`baseline not found: ${baselinePath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const baselines = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  const baseline = baselines[target];
  if (!baseline) {
    fail(`baseline missing for target: ${target}`);
  }

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const fileCount = files.length;
  const totalBytes = files.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);
  const checks = [];

  const assertCheck = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    if (!ok) fail(`${name}: ${detail}`);
  };

  assertCheck(
    'file_count_range',
    fileCount >= Number(baseline.minFileCount) && fileCount <= Number(baseline.maxFileCount),
    `count=${fileCount}, expected=[${baseline.minFileCount}, ${baseline.maxFileCount}]`,
  );
  assertCheck(
    'total_bytes_range',
    totalBytes >= Number(baseline.minTotalBytes) && totalBytes <= Number(baseline.maxTotalBytes),
    `total=${totalBytes}, expected=[${baseline.minTotalBytes}, ${baseline.maxTotalBytes}]`,
  );

  const requiredExtensions = Array.isArray(baseline.requiredExtensions) ? baseline.requiredExtensions : [];
  for (const ext of requiredExtensions) {
    assertCheck(
      `required_ext_${ext}`,
      hasAnyExt(files, String(ext)),
      `missing artifact with extension ${ext}`,
    );
  }

  const largest = files.reduce((max, item) => Math.max(max, Number(item.bytes) || 0), 0);
  assertCheck(
    'single_file_upper_bound',
    largest <= 4_500_000_000,
    `largest_file=${largest} exceeds hard guard`,
  );

  const report = {
    generatedAt: new Date().toISOString(),
    target,
    manifestFileCount: fileCount,
    manifestTotalBytes: totalBytes,
    checks,
    ok: true,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[release:guard] ${target} checks passed`);
} catch (error) {
  const report = {
    generatedAt: new Date().toISOString(),
    target,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  } catch {
    // ignore write error
  }
  console.error('[release:guard] failed:', report.error);
  process.exit(1);
}
