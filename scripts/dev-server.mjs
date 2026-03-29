import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DEFAULT_API_PORT = Number.parseInt(String(process.env.PORT || '8787'), 10);
const API_PORT = Number.isFinite(DEFAULT_API_PORT) && DEFAULT_API_PORT > 0 ? DEFAULT_API_PORT : 8787;

function getWindowsPidsOnPort(port) {
  try {
    const output = execSync(
      `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) -join ' '"`,
      { encoding: 'utf8' },
    );
    return String(output)
      .trim()
      .split(/\s+/)
      .filter((pid) => /^\d+$/.test(pid) && pid !== '0');
  } catch {
    return [];
  }
}

function killPort(port) {
  if (process.platform === 'win32') {
    const beforePids = getWindowsPidsOnPort(port);
    if (beforePids.length === 0) {
      return;
    }
    console.log(`[dev:server] 端口 ${port} 被占用，尝试结束 PID: ${beforePids.join(', ')}`);
    for (const pid of beforePids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      } catch {
        /* 进程可能已退出 */
      }
    }
    const after = getWindowsPidsOnPort(port);
    if (after.length > 0) {
      console.error(
        `[dev:server] 端口 ${port} 仍被占用（PID: ${after.join(', ')}）。请用管理员 PowerShell 执行: Stop-Process -Id <PID> -Force`,
      );
    }
    return;
  }

  try {
    execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' });
  } catch {
    // no process using this port
  }
}

killPort(API_PORT);

const tsxBin = process.platform === 'win32' ? 'node_modules\\.bin\\tsx.cmd' : 'node_modules/.bin/tsx';

const child = spawn(tsxBin, ['watch', 'server/index.ts'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(API_PORT) },
  shell: process.platform === 'win32',
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
