/**
 * macOS Type-C 闪连（Electron 主进程 IPC 使用）。
 * 与 server/typec-configure-darwin.ts 保持逻辑一致（修改时请同步）。
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import { verifyTypecIpOnInterface } from './typec-verify-ip.mjs';

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

const DARWIN_TYPEC_ADMIN_PROMPT =
  'RDK Studio 需要为本机 Type-C 虚拟网卡设置静态 IP，请输入管理员密码。';

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
  const escaped = shellCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedPrompt = DARWIN_TYPEC_ADMIN_PROMPT.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const appleScript = `do shell script "${escaped}" with administrator privileges with prompt "${escapedPrompt}"`;
  const second = await execFileWithTimeout('osascript', ['-e', appleScript], 120000);
  if (second.code === 0) return second.stdout;
  const combined = `${second.stderr}\n${second.stdout}`.trim();
  if (/user canceled|用户已取消|-128|错误代码：-128/i.test(combined)) {
    throw new Error('已取消管理员授权，无法为本机网卡设置 IP');
  }
  throw new Error(combined || `osascript exit ${second.code}`);
}

export { verifyTypecIpOnInterface as verifyDarwinTypecIp };
