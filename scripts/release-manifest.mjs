import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const rootDir = process.cwd();
const releaseDir = path.join(rootDir, 'release');
const outDir = path.join(rootDir, '.smoke');
const manifestPath = path.join(outDir, 'release-manifest.json');
const hashListPath = path.join(outDir, 'release-sha256.txt');
const artifactExts = new Set(['.appimage', '.deb', '.dmg', '.exe', '.blockmap', '.yml', '.yaml', '.zip', '.pkg']);

function walk(dir) {
  const files = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        const relDir = path.relative(releaseDir, full).replace(/\\/g, '/').toLowerCase();
        // Ignore unpacked app directories to keep manifest stable on CI.
        if (relDir === 'win-unpacked' || relDir.endsWith('.app') || relDir.endsWith('-unpacked')) continue;
        stack.push(full);
      }
      else files.push(full);
    }
  }
  return files;
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

try {
  if (!fs.existsSync(releaseDir)) {
    throw new Error('release 目录不存在，无法生成发布清单');
  }
  const files = walk(releaseDir)
    .filter((item) => artifactExts.has(path.extname(item).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  if (files.length === 0) {
    throw new Error('release 目录中未发现可分发产物，无法生成发布清单');
  }
  fs.mkdirSync(outDir, { recursive: true });

  const manifestItems = [];
  const hashLines = [];
  for (const fullPath of files) {
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    const stat = fs.statSync(fullPath);
    const hash = await sha256(fullPath);
    manifestItems.push({
      path: relPath,
      bytes: stat.size,
      mtimeMs: Math.round(stat.mtimeMs),
      sha256: hash,
    });
    hashLines.push(`${hash}  ${relPath}`);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    fileCount: manifestItems.length,
    files: manifestItems,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2), 'utf-8');
  fs.writeFileSync(hashListPath, `${hashLines.join('\n')}\n`, 'utf-8');
  console.log(`[release:manifest] generated ${manifestItems.length} entries`);
  console.log(`[release:manifest] ${manifestPath}`);
  console.log(`[release:manifest] ${hashListPath}`);
} catch (error) {
  console.error('[release:manifest] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
