import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

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
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return;

  if (process.platform === 'win32') {
    const beforePids = getWindowsPidsOnPort(p);
    if (beforePids.length === 0) {
      return;
    }
    console.log(`[dev:server] 端口 ${p} 被占用，尝试结束 PID: ${beforePids.join(', ')}`);
    for (const pid of beforePids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      } catch {
        /* 进程可能已退出 */
      }
    }
    const after = getWindowsPidsOnPort(p);
    if (after.length > 0) {
      console.error(
        `[dev:server] 端口 ${p} 仍被占用（PID: ${after.join(', ')}）。请用管理员 PowerShell 执行: Stop-Process -Id <PID> -Force`,
      );
    }
    return;
  }

  // macOS 自带 BSD `fuser`，不支持 `fuser -k <port>/tcp`；Linux 上也可用 `lsof` 精准确认 LISTEN
  try {
    const out = execSync(`lsof -tiTCP:${p} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pids = [...new Set(out.trim().split(/\n/).filter(Boolean))];
    for (const pidStr of pids) {
      const pid = Number(pidStr);
      if (!Number.isInteger(pid)) continue;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // ESRCH: already gone
      }
    }
  } catch (err) {
    const status = err && typeof err === 'object' && 'status' in err ? err.status : null;
    if (status === 1) {
      // lsof：无监听该端口的进程
    } else if (process.platform === 'linux') {
      try {
        execSync(`fuser -k ${p}/tcp`, { stdio: 'ignore' });
      } catch {
        // no process using this port
      }
    }
  }
}

async function main() {
  /** 结束旧监听后略等再拉起，减少 macOS 上偶发的 EADDRINUSE（端口尚未从内核表释放） */
  killPort(API_PORT);
  await new Promise((r) => setTimeout(r, 220));
  killPort(API_PORT);
  await new Promise((r) => setTimeout(r, 120));

  const tsxBin = process.platform === 'win32' ? 'node_modules\\.bin\\tsx.cmd' : 'node_modules/.bin/tsx';

  const bootstrapDefaults = path.join(repoRoot, 'config', 'rdkclaw-provider.defaults.json');
  const childEnv = {
    ...process.env,
    PORT: String(API_PORT),
    ...(fs.existsSync(bootstrapDefaults) ? { RDK_PROVIDER_BOOTSTRAP_FILE: bootstrapDefaults } : {}),
  };

  const child = spawn(tsxBin, ['watch', 'server/index.ts'], {
    stdio: 'inherit',
    cwd: repoRoot,
    env: childEnv,
    shell: process.platform === 'win32',
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error('[dev:server]', err);
  process.exit(1);
});
