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
  shell: process.platform === 'win32',
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
