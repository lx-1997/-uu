/**
 * Windows Type-C 闪连：通过 UAC 提升后执行 netsh（与 server/index.ts 策略一致）。
 * 与内置 API 子进程不同，主进程可稳定弹出管理员授权。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

function psEscapeSingle(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/**
 * 与 server 中 Windows 分支一致：先删其它接口上的同 IP，再删本接口旧 IPv4，再 set static。
 */
export function buildWindowsTypecNetshArgvList(interfaceName, pcIp, mask) {
  const allIfaces = os.networkInterfaces();
  const currentAddrs = allIfaces[interfaceName];
  if (currentAddrs?.some((a) => a.family === 'IPv4' && a.address === pcIp)) {
    return { skip: true, message: `IP ${pcIp} 已配置在 ${interfaceName} 上，无需重复设置` };
  }
  const argvList = [];
  for (const [otherName, otherAddrs] of Object.entries(allIfaces)) {
    if (otherName === interfaceName) continue;
    if (otherAddrs?.some((a) => a.family === 'IPv4' && a.address === pcIp)) {
      argvList.push(['interface', 'ipv4', 'delete', 'address', otherName, pcIp]);
    }
  }
  for (const addr of (currentAddrs ?? []).filter((a) => a.family === 'IPv4')) {
    argvList.push(['interface', 'ipv4', 'delete', 'address', interfaceName, addr.address]);
  }
  argvList.push(['interface', 'ipv4', 'set', 'address', interfaceName, 'static', pcIp, mask]);
  return { skip: false, argvList };
}

function generateNetshWorkPs1(argvList, netshLogPath) {
  const deletes = argvList.slice(0, -1);
  const setCmd = argvList[argvList.length - 1];
  const logLit = psEscapeSingle(netshLogPath);
  // 删除类命令勿用「| Out-Null」管道：在 Windows PowerShell 5.1 下可能干扰 $LASTEXITCODE
  let ps = '$ErrorActionPreference = "Continue"\n';
  for (const args of deletes) {
    const parts = args.map(psEscapeSingle).join(',');
    ps += `$a = @(${parts})\n`;
    ps += '$null = & netsh.exe @a 2>&1\n';
  }
  if (setCmd) {
    const parts = setCmd.map(psEscapeSingle).join(',');
    ps += `$a = @(${parts})\n`;
    ps += `$raw = & netsh.exe @a 2>&1\n`;
    ps += `$code = $LASTEXITCODE\n`;
    ps += `if ($null -eq $code) { $code = 1 }\n`;
    ps += `$text = if ($null -ne $raw) { ($raw | Out-String).Trim() } else { '' }\n`;
    ps += `Set-Content -Path ${logLit} -Value $text -Encoding UTF8\n`;
    ps += `if ($code -ne 0 -and $text) { [Console]::Error.WriteLine($text) }\n`;
    ps += `exit [int]$code\n`;
  } else {
    ps += 'exit 0\n';
  }
  return ps;
}

function getPowerShellExe() {
  const root = process.env.SystemRoot || 'C:\\Windows';
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * 非管理员进程内：用 Start-Process -Verb RunAs 拉起提升后的 PowerShell 执行 work.ps1。
 */
export async function runElevatedWorkPs1(workPs1Content, netshLogPath) {
  const ps = getPowerShellExe();
  const id = randomUUID();
  const workPath = path.join(os.tmpdir(), `rdk-typec-w-${id}.ps1`);
  const wrapPath = path.join(os.tmpdir(), `rdk-typec-u-${id}.ps1`);
  const workLit = workPath.replace(/'/g, "''");
  const wrapContent = `$PS = '${ps.replace(/'/g, "''")}'
$Work = '${workLit}'
$p = Start-Process -FilePath $PS -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File', $Work) -Wait -PassThru
if ($null -eq $p) { exit 3 }
$c = $p.ExitCode
if ($null -eq $c) { exit 1 }
exit [int]$c
`;
  fs.writeFileSync(workPath, workPs1Content, 'utf8');
  fs.writeFileSync(wrapPath, wrapContent, 'utf8');
  try {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapPath], {
        windowsHide: false,
        timeout: 180000,
      });
      let stderr = '';
      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        const readNetshDetail = () => {
          try {
            if (netshLogPath && fs.existsSync(netshLogPath)) {
              const t = fs.readFileSync(netshLogPath, 'utf8').trim();
              return t || '';
            }
          } catch {
            /* noop */
          }
          return '';
        };
        if (code === 3) {
          reject(new Error('已取消管理员授权或 UAC 未通过，无法配置网卡'));
          return;
        }
        if (code !== 0) {
          const detail = readNetshDetail();
          const hint =
            /对象已存在|already exists|object already exists/i.test(detail)
              ? '（常见原因：该 IP 仍被其它网卡占用，或本机路由/策略冲突；可在「网络连接」里暂时禁用其它网卡或改掉冲突 IP 后再试）'
              : /找不到|cannot find|specified file|系统找不到/i.test(detail)
                ? '（常见原因：网卡名称与系统不一致，请点「刷新」后重选「以太网」类接口）'
                : '';
          const main = stderr.trim() || detail || `提权执行 netsh 失败（退出码 ${code}）`;
          reject(new Error(main + hint));
          return;
        }
        resolve(0);
      });
    });
    return exitCode;
  } finally {
    try {
      fs.unlinkSync(workPath);
    } catch {
      /* noop */
    }
    try {
      fs.unlinkSync(wrapPath);
    } catch {
      /* noop */
    }
    try {
      if (netshLogPath) fs.unlinkSync(netshLogPath);
    } catch {
      /* noop */
    }
  }
}

export async function configureWindowsTypecNic(interfaceName, pcIp, mask) {
  const plan = buildWindowsTypecNetshArgvList(interfaceName, pcIp, mask);
  if (plan.skip) {
    return { output: plan.message };
  }
  const netshLogPath = path.join(os.tmpdir(), `rdk-typec-netsh-${randomUUID()}.log`);
  const workPs1 = generateNetshWorkPs1(plan.argvList, netshLogPath);
  await runElevatedWorkPs1(workPs1, netshLogPath);
  return { output: 'netsh 已在提升会话中执行' };
}
