import fs from 'node:fs';
import path from 'node:path';

const target = String(process.argv[2] || '').trim().toLowerCase();
const rootDir = process.cwd();
const currentManifestPath = path.join(rootDir, '.smoke', 'release-manifest.json');
const policyPath = path.join(rootDir, '.ci', 'release-drift-policy.json');
const referencePath = path.join(rootDir, '.ci', 'release-reference-manifests', `${target}.json`);
const outPath = path.join(rootDir, '.smoke', 'release-drift.json');
const strictMode = String(process.env.RDK_DESKTOP_DRIFT_STRICT || '1').trim() !== '0';
const requireReference = String(process.env.RDK_DESKTOP_DRIFT_REQUIRE_REFERENCE || '0').trim() === '1';

if (!target || !['linux', 'mac', 'win'].includes(target)) {
  console.error('[release:drift] usage: node scripts/release-manifest-drift.mjs <linux|mac|win>');
  process.exit(1);
}

function pctDrift(current, baseline) {
  const b = Math.max(1, Number(baseline) || 0);
  const c = Math.max(0, Number(current) || 0);
  return Math.abs(((c - b) / b) * 100);
}

function summarize(manifest) {
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const fileCount = files.length;
  const totalBytes = files.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);
  const largestFileBytes = files.reduce((max, item) => Math.max(max, Number(item.bytes) || 0), 0);
  return { fileCount, totalBytes, largestFileBytes };
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
}

try {
  if (!fs.existsSync(currentManifestPath)) {
    throw new Error(`current manifest missing: ${currentManifestPath}`);
  }
  if (!fs.existsSync(policyPath)) {
    throw new Error(`drift policy missing: ${policyPath}`);
  }
  const policyAll = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));
  const policy = policyAll[target];
  if (!policy) {
    throw new Error(`drift policy missing for target: ${target}`);
  }
  const current = JSON.parse(fs.readFileSync(currentManifestPath, 'utf-8'));
  const currentStats = summarize(current);

  if (!fs.existsSync(referencePath)) {
    const missingRefReport = {
      generatedAt: new Date().toISOString(),
      target,
      status: requireReference ? 'failed' : 'skipped',
      reason: `reference manifest missing: ${referencePath}`,
      strictMode,
      requireReference,
      currentStats,
      policy,
    };
    writeReport(missingRefReport);
    if (requireReference) {
      console.error('[release:drift] failed:', missingRefReport.reason);
      process.exit(1);
    }
    console.warn(`[release:drift] skipped: ${missingRefReport.reason}`);
    process.exit(0);
  }

  const reference = JSON.parse(fs.readFileSync(referencePath, 'utf-8'));
  const refStats = summarize(reference);
  const checks = [
    {
      name: 'file_count_drift_pct',
      driftPct: Number(pctDrift(currentStats.fileCount, refStats.fileCount).toFixed(2)),
      maxPct: Number(policy.maxFileCountDriftPct),
    },
    {
      name: 'total_bytes_drift_pct',
      driftPct: Number(pctDrift(currentStats.totalBytes, refStats.totalBytes).toFixed(2)),
      maxPct: Number(policy.maxTotalBytesDriftPct),
    },
    {
      name: 'largest_file_drift_pct',
      driftPct: Number(pctDrift(currentStats.largestFileBytes, refStats.largestFileBytes).toFixed(2)),
      maxPct: Number(policy.maxLargestFileDriftPct),
    },
  ].map((item) => ({
    ...item,
    ok: item.driftPct <= item.maxPct,
  }));

  const failed = checks.filter((item) => !item.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    target,
    status: failed.length === 0 ? 'ok' : 'failed',
    strictMode,
    requireReference,
    referencePath: path.relative(rootDir, referencePath).replace(/\\/g, '/'),
    currentStats,
    referenceStats: refStats,
    checks,
  };
  writeReport(report);

  if (failed.length > 0 && strictMode) {
    const reason = failed.map((item) => `${item.name}=${item.driftPct}% > ${item.maxPct}%`).join('; ');
    throw new Error(`drift guard failed: ${reason}`);
  }
  if (failed.length > 0) {
    console.warn(`[release:drift] warnings: ${failed.map((item) => item.name).join(', ')}`);
  } else {
    console.log('[release:drift] checks passed');
  }
} catch (error) {
  const report = {
    generatedAt: new Date().toISOString(),
    target,
    status: 'error',
    strictMode,
    requireReference,
    error: error instanceof Error ? error.message : String(error),
  };
  writeReport(report);
  console.error('[release:drift] failed:', report.error);
  process.exit(1);
}
