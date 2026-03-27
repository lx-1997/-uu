import { prepareBuildResources } from './desktop-icons.mjs';

const rootDir = process.cwd();

try {
  const r = await prepareBuildResources(rootDir);
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
