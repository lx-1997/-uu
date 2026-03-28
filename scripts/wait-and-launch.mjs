/**
 * 等待 Vite 开发服务器就绪后再启动 Electron
 * 避免 ERR_CONNECTION_REFUSED
 */
import { spawn } from 'node:child_process';

const VITE_URL = 'http://localhost:5173';
const apiPortRaw = Number.parseInt(String(process.env.PORT || '8787'), 10);
const API_PORT = Number.isFinite(apiPortRaw) && apiPortRaw > 0 ? apiPortRaw : 8787;
const API_HEALTH_URL = `http://localhost:${API_PORT}/api/health`;
const MAX_RETRIES = 30;
const API_MAX_RETRIES = 90;
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

/**
 * 等待本地 Express（tsx watch 首次编译可能较慢）。仅等 Vite 就打开窗口会导致
 * 渲染进程大量连 8787 失败（ERR_CONNECTION_REFUSED）。
 */
async function waitForApiServer() {
  for (let i = 0; i < API_MAX_RETRIES; i++) {
    try {
      const res = await fetch(API_HEALTH_URL, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json().catch(() => ({}));
      if (data && data.ok === true) {
        console.log(`[desktop] API server is ready (http://localhost:${API_PORT})`);
        return { ok: true };
      }
    } catch {
      // 尚未监听或仍在启动
    }
    console.log(`[desktop] Waiting for API server :${API_PORT}... (${i + 1}/${API_MAX_RETRIES})`);
    if (i === 9 || i === 29) {
      console.warn(
        '[desktop] 与是否连接开发板无关：需本机 API 先启动。请使用 npm run desktop（同时拉起 dev:server），或另开终端执行 npm run dev:server',
      );
    }
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL));
  }
  return { ok: false, reason: 'api-timeout' };
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

const apiWait = await waitForApiServer();
if (!apiWait.ok) {
  console.error('[desktop] API server on :8787 did not become ready in time. Abort launching Electron.');
  console.error('[desktop] Ensure `npm run desktop` runs dev:server, or start: npm run dev:server');
  console.error(`[desktop] Diagnose: Get-NetTCPConnection -LocalPort ${API_PORT} | Select-Object OwningProcess -Unique`);
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
