import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';

const target = String(process.argv[2] || '').trim();
const rootDir = process.cwd();
/** 与 build-desktop 分段输出一致：默认检查 release/desktop/<variant>/；未设置时回退 release/ 根目录 */
const rawReleaseOut = String(process.env.RDK_DESKTOP_RELEASE_OUT || '').trim();
const releaseDir = rawReleaseOut ? path.resolve(rawReleaseOut) : path.join(rootDir, 'release');
if (rawReleaseOut) {
  console.log(`[desktop:smoke] 检查产物目录（分段）: ${releaseDir}`);
}
const runtimeCheckEnabled = String(process.env.RDK_DESKTOP_SMOKE_RUNTIME || '').trim() === '1';
const RUNTIME_HEALTH_RETRIES = Number.parseInt(String(process.env.RDK_DESKTOP_SMOKE_HEALTH_RETRIES || '40'), 10) || 40;
const DESKTOP_SERVER_PORT = 8787;
const DESKTOP_SERVER_PORT_FALLBACK_SPAN = 10;
const smokeLogFile = String(process.env.RDK_DESKTOP_SMOKE_LOG_FILE || '').trim();
const buildStartedAt = Number.parseInt(String(process.env.RDK_DESKTOP_BUILD_STARTED_AT || '0'), 10) || 0;
const winDirMode = String(process.env.RDK_DESKTOP_WIN_DIR_MODE || '').trim() === '1';
const winZipMode = String(process.env.RDK_DESKTOP_WIN_ZIP_MODE || '').trim() === '1';
const processOutputLines = [];

function getCandidatePorts() {
  return Array.from({ length: DESKTOP_SERVER_PORT_FALLBACK_SPAN + 1 }, (_v, index) => DESKTOP_SERVER_PORT + index);
}

function nowIso() {
  return new Date().toISOString();
}

function logInfo(message) {
  console.log(`[desktop:smoke] ${message}`);
}

function logError(message) {
  console.error(`[desktop:smoke] ${message}`);
}

function trackProcessOutput(prefix, chunk) {
  const text = String(chunk || '').trim();
  if (!text) return;
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    processOutputLines.push(`${prefix} ${line}`);
    if (processOutputLines.length > 300) {
      processOutputLines.shift();
    }
  }
}

const supportedTargets = new Set(['win', 'mac', 'linux']);
if (!supportedTargets.has(target)) {
  console.error(`[desktop:smoke] Invalid target: ${target || '<empty>'}`);
  console.error('[desktop:smoke] Usage: node scripts/desktop-smoke-check.mjs <win|mac|linux>');
  process.exit(1);
}

function listReleaseEntries() {
  if (!fs.existsSync(releaseDir)) return [];
  return fs.readdirSync(releaseDir).map((name) => ({
    name,
    fullPath: path.join(releaseDir, name),
    isDir: fs.statSync(path.join(releaseDir, name)).isDirectory(),
  }));
}

function ensureArtifacts() {
  const entries = listReleaseEntries();
  if (entries.length === 0) {
    throw new Error('release 目录为空，未发现打包产物');
  }
  const freshEnough = entries.some((entry) => {
    if (!buildStartedAt) return true;
    try {
      const stat = fs.statSync(entry.fullPath);
      return stat.mtimeMs >= buildStartedAt - 3_000;
    } catch {
      return false;
    }
  });
  if (!freshEnough) {
    throw new Error('release 目录中的产物疑似不是本次构建生成（mtime 早于本轮构建时间）');
  }
  const names = entries.map((entry) => entry.name.toLowerCase());
  if (target === 'win') {
    const hasExe = names.some((name) => name.endsWith('.exe'));
    const hasUnpacked = names.some((name) => name === 'win-unpacked');
    if (winDirMode) {
      if (!hasUnpacked) {
        throw new Error('Windows dir 产物不完整：需要至少包含 win-unpacked');
      }
    } else if (winZipMode) {
      const hasZip = names.some((name) => name.endsWith('.zip'));
      if (!hasZip || !hasUnpacked) {
        throw new Error('Windows zip 产物不完整：需要至少包含 .zip 与 win-unpacked');
      }
    } else if (!hasExe || !hasUnpacked) {
      throw new Error('Windows 产物不完整：需要至少包含 .exe 与 win-unpacked');
    }
  }
  if (target === 'mac') {
    const hasDmg = names.some((name) => name.endsWith('.dmg'));
    if (!hasDmg) {
      throw new Error('macOS 产物不完整：未发现 .dmg');
    }
  }
  if (target === 'linux') {
    const hasAppImage = names.some((name) => name.endsWith('.appimage'));
    const hasDeb = names.some((name) => name.endsWith('.deb'));
    if (!hasAppImage || !hasDeb) {
      throw new Error('Linux 产物不完整：需要同时包含 .AppImage 与 .deb');
    }
  }
}

function walkFiles(dir) {
  const files = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else files.push(fullPath);
    }
  }
  return files;
}

function resolveRuntimeExecutable() {
  if (target === 'win') {
    const unpackedDir = path.join(releaseDir, 'win-unpacked');
    const exes = walkFiles(unpackedDir).filter((item) => item.toLowerCase().endsWith('.exe'));
    const preferred = exes.find((item) => !item.toLowerCase().includes('uninstall'));
    return preferred || exes[0] || '';
  }
  if (target === 'mac') {
    const appDirs = walkFiles(releaseDir)
      .filter((item) => item.includes('.app\\Contents\\MacOS\\') || item.includes('.app/Contents/MacOS/'));
    return appDirs[0] || '';
  }
  const appImage = listReleaseEntries()
    .map((entry) => entry.fullPath)
    .find((item) => item.toLowerCase().endsWith('.appimage'));
  return appImage || '';
}

async function probeHealth(url, retries = 30, intervalMs = 1_000) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      if (res.ok) return true;
    } catch {
      // keep retrying
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function healthUrlForPort(port) {
  return `http://127.0.0.1:${port}/api/health`;
}

async function detectHealthyPorts(ports) {
  const healthy = new Set();
  for (const port of ports) {
    if (await probeHealth(healthUrlForPort(port), 1, 50)) {
      healthy.add(port);
    }
  }
  return healthy;
}

async function waitForNewHealthyPort(ports, occupiedBefore, retries, intervalMs) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    for (const port of ports) {
      if (occupiedBefore.has(port)) continue;
      if (await probeHealth(healthUrlForPort(port), 1, 50)) {
        return port;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return 0;
}

async function runRuntimeSmoke() {
  if (!runtimeCheckEnabled) {
    logInfo('Runtime smoke skipped (set RDK_DESKTOP_SMOKE_RUNTIME=1 to enable).');
    return;
  }

  if (target === 'win' && process.platform !== 'win32') {
    throw new Error('Runtime smoke for win target must run on Windows');
  }
  if (target === 'mac' && process.platform !== 'darwin') {
    throw new Error('Runtime smoke for mac target must run on macOS');
  }
  if (target === 'linux' && process.platform !== 'linux') {
    throw new Error('Runtime smoke for linux target must run on Linux');
  }

  const candidatePorts = getCandidatePorts();
  const occupiedBefore = await detectHealthyPorts(candidatePorts);
  if (occupiedBefore.size > 0) {
    logInfo(`Runtime smoke 检测到已有健康端口：${Array.from(occupiedBefore).join(', ')}；将验证新实例是否自动回退到其它端口。`);
  } else {
    logInfo(`Runtime smoke enabled, checking health endpoints: ${candidatePorts.join(', ')}`);
  }

  const execPath = resolveRuntimeExecutable();
  if (!execPath || !fs.existsSync(execPath)) {
    throw new Error('未找到可执行桌面产物，无法执行 runtime smoke');
  }

  if (target === 'linux') {
    try {
      fs.chmodSync(execPath, 0o755);
    } catch {
      // ignore chmod failures
    }
  }

  const child = spawn(execPath, [], {
    cwd: releaseDir,
    env: {
      ...process.env,
      RDK_STUDIO_SMOKE_MODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    detached: false,
  });
  child.stdout?.on('data', (chunk) => trackProcessOutput('[app:stdout]', chunk));
  child.stderr?.on('data', (chunk) => trackProcessOutput('[app:stderr]', chunk));
  let exited = false;
  let exitCode = null;
  let exitSignal = null;
  child.on('exit', (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });

  const cleanup = async () => {
    if (!exited && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    await waitForChildExit(child, 4_000).catch(() => {
      if (!exited) {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    });
  };

  const startedPort = await waitForNewHealthyPort(candidatePorts, occupiedBefore, RUNTIME_HEALTH_RETRIES, 1_000);
  logInfo(`Runtime health probe finished: ${startedPort ? `ready on ${startedPort}` : 'not ready'}`);
  await cleanup();
  if (!startedPort) {
    if (exited) {
      throw new Error(`Runtime smoke 失败：桌面进程提前退出（code=${exitCode ?? 'null'} signal=${exitSignal ?? 'null'}）`);
    }
    throw new Error(`Runtime smoke 失败：应用启动后未在 ${candidatePorts[0]}-${candidatePorts[candidatePorts.length - 1]} 范围内发现新的健康端口`);
  }
  // Ensure the port claimed by this runtime smoke is actually torn down after cleanup.
  const released = !(await probeHealth(healthUrlForPort(startedPort), 6, 300));
  if (!released) {
    const owners = getPortOwners(startedPort);
    throw new Error(`Runtime smoke 收尾失败：退出后端口 ${startedPort} 仍在监听${owners ? `\n${owners}` : ''}`);
  }
  logInfo(`Runtime smoke cleanup finished, port ${startedPort} released.`);
}

function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (ok) resolve();
      else reject(new Error('child process exit timeout'));
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', () => finish(true));
    if (child.exitCode !== null || child.signalCode) {
      finish(true);
    }
  });
}

function getPortOwners(port) {
  try {
    if (process.platform === 'win32') {
      const output = execSync(
        `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object OwningProcess,LocalAddress,LocalPort,State -Unique | ConvertTo-Json -Depth 2)"`,
        { encoding: 'utf8' },
      ).trim();
      return output ? `[desktop:smoke] 端口占用详情（Windows）: ${output}` : '';
    }
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const output = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).trim();
      return output ? `[desktop:smoke] 端口占用详情（lsof）:\n${output}` : '';
    }
  } catch {
    // ignore diagnostics failures
  }
  try {
    const fallback = execSync(`ss -lntp "( sport = :${port} )"`, { encoding: 'utf8' }).trim();
    return fallback ? `[desktop:smoke] 端口占用详情（ss）:\n${fallback}` : '';
  } catch {
    return '';
  }
}

function writeSmokeLog(status, errorMessage = '') {
  if (!smokeLogFile) return;
  try {
    const dir = path.dirname(smokeLogFile);
    fs.mkdirSync(dir, { recursive: true });
    const content = [
      `time=${nowIso()}`,
      `status=${status}`,
      `target=${target}`,
      `runtime_enabled=${runtimeCheckEnabled ? '1' : '0'}`,
      `health_retries=${RUNTIME_HEALTH_RETRIES}`,
      ...(errorMessage ? [`error=${errorMessage}`] : []),
      ...(processOutputLines.length > 0
        ? ['process_output_begin', ...processOutputLines, 'process_output_end']
        : ['process_output=empty']),
      '',
    ].join('\n');
    fs.writeFileSync(smokeLogFile, content, 'utf-8');
  } catch (error) {
    logError(`failed to write smoke log: ${error instanceof Error ? error.message : String(error)}`);
  }
}

try {
  ensureArtifacts();
  await runRuntimeSmoke();
  writeSmokeLog('ok');
  logInfo(`${target} smoke checks passed.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeSmokeLog('failed', message);
  logError(`Failed: ${message}`);
  process.exit(1);
}
