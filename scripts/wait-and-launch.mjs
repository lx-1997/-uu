/**
 * 等待 Vite 开发服务器就绪后再启动 Electron
 * 避免 ERR_CONNECTION_REFUSED
 */
import { spawn } from 'node:child_process';

const VITE_URL = 'http://localhost:5173';
const MAX_RETRIES = 30;
const RETRY_INTERVAL = 1000;

async function waitForVite() {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const res = await fetch(VITE_URL, { signal: AbortSignal.timeout(1000) });
      if (res.ok || res.status < 500) {
        console.log('[desktop] Vite ready, launching Electron...');
        return true;
      }
    } catch {
      // 还没就绪，继续等
    }
    console.log(`[desktop] Waiting for Vite... (${i + 1}/${MAX_RETRIES})`);
    await new Promise(r => setTimeout(r, RETRY_INTERVAL));
  }
  console.error('[desktop] Vite did not start in time, launching anyway...');
  return false;
}

await waitForVite();

const electronBin = process.platform === 'win32'
  ? 'node_modules\\.bin\\electron.cmd'
  : 'node_modules/.bin/electron';

const child = spawn(electronBin, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, RDK_STUDIO_RENDERER_URL: VITE_URL },
  shell: process.platform === 'win32',
});

child.on('exit', code => process.exit(code ?? 0));
