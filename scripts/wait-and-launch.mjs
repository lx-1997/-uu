/**
 * 等待 Vite 开发服务器就绪后再启动 Electron
 * 避免 ERR_CONNECTION_REFUSED
 */
import { spawn } from 'node:child_process';

const VITE_URL = 'http://localhost:5173';
const MAX_RETRIES = 30;
const RETRY_INTERVAL = 1000;

function isRdkPage(html) {
  const text = String(html || '').toLowerCase();
  const hasRoot = text.includes('id="root"') || text.includes("id='root'");
  const hasRdkTitle = text.includes('<title>rdk studio</title>');
  const hasMainEntry = text.includes('/src/main.tsx') || text.includes('/src/main.jsx');
  return hasRoot && (hasRdkTitle || hasMainEntry);
}

function isForeignPage(html) {
  const text = String(html || '').toLowerCase();
  const dressupFingerprints = [
    'dressup studio',
    '<div id="app"></div>',
    "<div id='app'></div>",
    '/src/main.js',
  ];
  return dressupFingerprints.some((fingerprint) => text.includes(fingerprint));
}

async function waitForVite() {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const res = await fetch(VITE_URL, { signal: AbortSignal.timeout(1000) });
      if (res.ok || res.status < 500) {
        const html = await res.text();
        if (isRdkPage(html)) {
          console.log('[desktop] RDK Vite page is ready, launching Electron...');
          return { ok: true };
        }
        if (isForeignPage(html)) {
          return { ok: false, reason: 'foreign-page' };
        }
        console.log(`[desktop] Vite is reachable but not RDK page yet... (${i + 1}/${MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, RETRY_INTERVAL));
        continue;
      }
    } catch {
      // 还没就绪，继续等
    }
    console.log(`[desktop] Waiting for Vite... (${i + 1}/${MAX_RETRIES})`);
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL));
  }
  return { ok: false, reason: 'timeout' };
}

const waitResult = await waitForVite();
if (!waitResult.ok) {
  if (waitResult.reason === 'foreign-page') {
    console.error('[desktop] Detected non-RDK page on http://localhost:5173. Abort launching Electron.');
    console.error('[desktop] Another project is likely using port 5173.');
  } else {
    console.error('[desktop] RDK Vite page did not become ready in time. Abort launching Electron.');
  }
  console.error('[desktop] Diagnose with: Get-NetTCPConnection -LocalPort 5173 | Select-Object OwningProcess -Unique');
  console.error('[desktop] Then stop process: Stop-Process -Id <PID> -Force');
  process.exit(1);
}

const electronBin = process.platform === 'win32'
  ? 'node_modules\\.bin\\electron.cmd'
  : 'node_modules/.bin/electron';

const child = spawn(electronBin, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, RDK_STUDIO_RENDERER_URL: VITE_URL },
  shell: process.platform === 'win32',
});

child.on('exit', code => process.exit(code ?? 0));
