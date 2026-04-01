import { execSync, spawn } from 'node:child_process';

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
      console.log(`[dev:client] port ${port} is free`);
      return;
    }

    console.log(`[dev:client] port ${port} occupied, target PIDs: ${beforePids.join(', ')}`);
    const killedPids = [];
    for (const pid of beforePids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        killedPids.push(pid);
      } catch {
        // 进程可能已退出，保持幂等
      }
    }
    console.log(`[dev:client] killed PIDs on port ${port}: ${killedPids.length > 0 ? killedPids.join(', ') : 'none'}`);

    const afterPids = getWindowsPidsOnPort(port);
    if (afterPids.length > 0) {
      console.error(`[dev:client] port ${port} is still occupied by PID(s): ${afterPids.join(', ')}`);
      console.error(`[dev:client] Run: Get-NetTCPConnection -LocalPort ${port} | Select-Object OwningProcess -Unique`);
      console.error(`[dev:client] Then: Stop-Process -Id <PID> -Force`);
      process.exit(1);
    }

    console.log(`[dev:client] port ${port} is now free`);
    return;
  }

  /** macOS 上 `fuser -k PORT/tcp` 常常杀不掉监听进程，改用 lsof（Linux 同样适用） */
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: 'utf8' });
    const pids = [...new Set(out.trim().split(/\n/).filter((x) => /^\d+$/.test(x)))];
    if (pids.length > 0) {
      console.log(`[dev:client] port ${port} occupied, killing PIDs: ${pids.join(', ')}`);
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        } catch {
          // 进程可能已退出
        }
      }
    }
  } catch {
    try {
      execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' });
    } catch {
      // 端口空闲或无法释放
    }
  }
}

killPort(5173);

const viteBin = process.platform === 'win32' ? 'node_modules\\.bin\\vite.cmd' : 'node_modules/.bin/vite';

const child = spawn(viteBin, ['--port', '5173', '--strictPort'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
