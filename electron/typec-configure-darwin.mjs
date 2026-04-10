/**
 * macOS Type-C 闪连（Electron 主进程 IPC 使用）。
 * 与 server/typec-configure-darwin.ts 保持逻辑一致（修改时请同步）。
 * 提权与烧录一致：`sudo --askpass` + 打包 JXA，可与启动预授权共用 sudo 时间戳。
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import { verifyTypecIpOnInterface } from './typec-verify-ip.mjs';
import { runDarwinSudoAskpassShell } from './flash/darwin-sudo-shell.mjs';

function isIfconfigPermissionDenied(msg) {
  const m = (msg || '').trim();
  if (!m) return false;
  return (
    /permission denied|operation not permitted|not authorized|must be root|super-user|EPERM/i.test(m)
    || /\bSIOC[A-Z]+\b.*not permitted/i.test(m)
  );
}

function execFileWithTimeout(file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        done({ code: 127, stdout: '', stderr: err.message });
      } else if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

const DARWIN_TYPEC_MSG =
  'RDK Studio 需要为本机 Type-C 虚拟网卡设置静态 IP，将使用与烧录相同的 sudo 密码框。';

export async function configureDarwinTypecNic(interfaceName, pcIp, mask) {
  const ifaces = os.networkInterfaces();
  const deleteParts = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (name === interfaceName) continue;
    if (!addrs?.some((a) => a.family === 'IPv4' && a.address === pcIp)) continue;
    deleteParts.push(`/sbin/ifconfig ${name} inet ${pcIp} delete`);
  }
  const setPart = `/sbin/ifconfig ${interfaceName} ${pcIp} netmask ${mask} up`;
  const shellCmd = [...deleteParts, setPart].join('; ');

  const first = await execFileWithTimeout('sh', ['-c', shellCmd], 25000);
  if (first.code === 0) return [first.stdout, first.stderr].filter(Boolean).join('\n').trim();
  const firstCombined = `${first.stderr}\n${first.stdout}`.trim();
  const errLine = firstCombined || `exit code ${first.code}`;
  if (!isIfconfigPermissionDenied(firstCombined)) {
    throw new Error(errLine);
  }

  try {
    return await runDarwinSudoAskpassShell(shellCmd, {
      title: '需要管理员权限',
      message: DARWIN_TYPEC_MSG,
      timeoutMs: 120000,
    });
  } catch (sudoErr) {
    const msg = sudoErr instanceof Error ? sudoErr.message : String(sudoErr);
    if (/sudo 认证失败|已取消|取消/i.test(msg)) {
      throw new Error('已取消管理员授权或 sudo 未通过，无法为本机网卡设置 IP');
    }
    throw sudoErr instanceof Error ? sudoErr : new Error(msg);
  }
}

export { verifyTypecIpOnInterface as verifyDarwinTypecIp };
