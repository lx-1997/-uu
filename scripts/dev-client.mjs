import { execSync, spawn } from 'node:child_process';

function killPort(port) {
  if (process.platform === 'win32') {
    try {
      const output = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: 'utf8' });
      const pids = new Set(
        output
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => /LISTENING/i.test(line))
          .map((line) => line.split(/\s+/).pop())
          .filter((pid) => pid && /^\d+$/.test(pid)),
      );

      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        } catch {
          // ignore
        }
      }
    } catch {
      // no process using this port
    }
    return;
  }

  try {
    execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' });
  } catch {
    // no process using this port
  }
}

killPort(5173);

const viteBin = process.platform === 'win32' ? 'node_modules\\.bin\\vite.cmd' : 'node_modules/.bin/vite';

const child = spawn(viteBin, ['--port', '5173', '--strictPort'], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
