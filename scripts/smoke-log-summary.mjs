import fs from 'node:fs';
import path from 'node:path';

const logDir = path.resolve(process.cwd(), '.smoke');
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
const files = fs.existsSync(logDir)
  ? fs.readdirSync(logDir).filter((name) => name.endsWith('.log')).map((name) => path.join(logDir, name))
  : [];

function parseLog(content) {
  const lines = String(content || '').split(/\r?\n/);
  const first = Object.create(null);
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (!first[key]) first[key] = line.slice(idx + 1).trim();
  }
  return {
    time: first.time || '',
    status: first.status || 'unknown',
    target: first.target || 'unknown',
    runtimeEnabled: first.runtime_enabled || '',
    error: first.error || '',
    processOutput: lines
      .filter((line) => line.startsWith('[app:stderr]') || line.startsWith('[app:stdout]'))
      .slice(-5),
  };
}

const records = files.map((file) => {
  const content = fs.readFileSync(file, 'utf-8');
  const parsed = parseLog(content);
  return { file, ...parsed };
});
const hashListPath = path.join(logDir, 'release-sha256.txt');
const guardPath = path.join(logDir, 'release-guard.json');
const driftPath = path.join(logDir, 'release-drift.json');
const baselineSuggestionFiles = fs.existsSync(logDir)
  ? fs.readdirSync(logDir)
    .filter((name) => /^release-baseline-suggested-(linux|mac|win)\.json$/i.test(name))
    .map((name) => path.join(logDir, name))
  : [];

const lines = [];
lines.push('## Desktop Smoke Summary');
if (records.length === 0) {
  lines.push('');
  lines.push('- No smoke logs found in `.smoke/`.');
} else {
  lines.push('');
  lines.push('| target | status | runtime | time | log |');
  lines.push('|---|---|---|---|---|');
  for (const rec of records) {
    const name = path.basename(rec.file);
    lines.push(`| ${rec.target} | ${rec.status} | ${rec.runtimeEnabled === '1' ? 'on' : 'off'} | ${rec.time || '-'} | \`${name}\` |`);
    if (rec.error) {
      lines.push(`| ↳ error | \`${rec.error.replace(/\|/g, '\\|')}\` |  |  |  |`);
      if (rec.processOutput.length > 0) {
        for (const out of rec.processOutput) {
          lines.push(`| ↳ output | \`${out.replace(/\|/g, '\\|')}\` |  |  |  |`);
        }
      }
    }
  }
}
lines.push('');
if (fs.existsSync(guardPath)) {
  const guard = JSON.parse(fs.readFileSync(guardPath, 'utf-8'));
  lines.push('### Release Guard');
  lines.push('');
  lines.push(`- target: \`${guard.target || 'unknown'}\``);
  lines.push(`- status: \`${guard.ok ? 'ok' : 'failed'}\``);
  if (guard.error) {
    lines.push(`- error: \`${String(guard.error).replace(/\|/g, '\\|')}\``);
  }
  if (Array.isArray(guard.checks) && guard.checks.length > 0) {
    lines.push('');
    lines.push('| check | ok | detail |');
    lines.push('|---|---|---|');
    for (const check of guard.checks) {
      lines.push(`| ${check.name || '-'} | ${check.ok ? 'yes' : 'no'} | ${(check.detail || '').replace(/\|/g, '\\|')} |`);
    }
  }
  lines.push('');
}

if (fs.existsSync(driftPath)) {
  const drift = JSON.parse(fs.readFileSync(driftPath, 'utf-8'));
  lines.push('### Release Drift');
  lines.push('');
  lines.push(`- target: \`${drift.target || 'unknown'}\``);
  lines.push(`- status: \`${drift.status || 'unknown'}\``);
  if (typeof drift.requireReference === 'boolean') {
    lines.push(`- requireReference: \`${drift.requireReference ? 'yes' : 'no'}\``);
  }
  if (drift.reason) {
    lines.push(`- reason: \`${String(drift.reason).replace(/\|/g, '\\|')}\``);
  }
  if (drift.error) {
    lines.push(`- error: \`${String(drift.error).replace(/\|/g, '\\|')}\``);
  }
  if (Array.isArray(drift.checks) && drift.checks.length > 0) {
    lines.push('');
    lines.push('| check | drift | max | ok |');
    lines.push('|---|---|---|---|');
    for (const check of drift.checks) {
      lines.push(`| ${check.name || '-'} | ${check.driftPct ?? '-'}% | ${check.maxPct ?? '-'}% | ${check.ok ? 'yes' : 'no'} |`);
    }
  }
  lines.push('');
}

lines.push('');
if (fs.existsSync(hashListPath)) {
  const hashLines = fs.readFileSync(hashListPath, 'utf-8').split(/\r?\n/).filter(Boolean).slice(0, 10);
  lines.push('### Release SHA256 (Top 10)');
  lines.push('');
  if (hashLines.length === 0) {
    lines.push('- No hash entries found.');
  } else {
    lines.push('```text');
    lines.push(...hashLines);
    lines.push('```');
  }
  lines.push('');
}

if (baselineSuggestionFiles.length > 0) {
  lines.push('### Baseline Suggestions');
  lines.push('');
  for (const file of baselineSuggestionFiles) {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    lines.push(`- target: \`${data.target}\` from \`${path.basename(file)}\``);
    if (data.diff) {
      lines.push(`  - minFileCount: \`${data.diff.minFileCount?.[0]}\` -> \`${data.diff.minFileCount?.[1]}\``);
      lines.push(`  - maxFileCount: \`${data.diff.maxFileCount?.[0]}\` -> \`${data.diff.maxFileCount?.[1]}\``);
      lines.push(`  - minTotalBytes: \`${data.diff.minTotalBytes?.[0]}\` -> \`${data.diff.minTotalBytes?.[1]}\``);
      lines.push(`  - maxTotalBytes: \`${data.diff.maxTotalBytes?.[0]}\` -> \`${data.diff.maxTotalBytes?.[1]}\``);
      lines.push(`  - requiredExtensions: \`${JSON.stringify(data.diff.requiredExtensions?.[0] || [])}\` -> \`${JSON.stringify(data.diff.requiredExtensions?.[1] || [])}\``);
    }
  }
  lines.push('');
}

const output = `${lines.join('\n')}\n`;
if (summaryPath) {
  fs.appendFileSync(summaryPath, output, 'utf-8');
}
process.stdout.write(output);
