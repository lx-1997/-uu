import fs from 'node:fs';
import path from 'node:path';
import { prepareBuildResources } from './desktop-icons.mjs';

const rootDir = process.cwd();

try {
  const r = await prepareBuildResources(rootDir);
  const ocSrc = path.join(rootDir, 'server/resources/openclaw/oc-bridge.mjs');
  const ocDstDir = path.join(r.outDir || path.join(rootDir, 'build-resources'), 'openclaw');
  const ocDst = path.join(ocDstDir, 'oc-bridge.mjs');
  if (fs.existsSync(ocSrc)) {
    fs.mkdirSync(ocDstDir, { recursive: true });
    fs.copyFileSync(ocSrc, ocDst);
    console.log('[prepare:build-resources] oc-bridge.mjs ->', ocDst);
  }
  console.log('[prepare:build-resources] ready:', r.outDir, {
    hasPng: r.hasPng,
    hasIco: r.hasIco,
    hasIcns: r.hasIcns,
    usedFrontendIcons: r.usedFrontendIcons,
    hasFrontendRoot: r.hasFrontendRoot,
  });
} catch (error) {
  console.error('[prepare:build-resources] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
