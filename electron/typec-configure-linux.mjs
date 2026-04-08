/**
 * Linux Type-C 闪连：通过 pkexec 图形提权执行 ip/ifconfig（与 server/index.ts 策略一致）。
 */
import fs, { accessSync, constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

function ipv4NetmaskPrefixBits(mask) {
  const parts = mask.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return 24;
  const v = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  let c = 0;
  for (let i = 31; i >= 0; i--) {
    if ((v >>> i) & 1) c++;
    else break;
  }
  const expected = c === 0 ? 0 : c === 32 ? 0xffffffff : (0xffffffff << (32 - c)) >>> 0;
  if (v !== expected) return 24;
  return c;
}

function shSingleQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function resolvePkexec() {
  const cands = ['/usr/bin/pkexec', '/bin/pkexec'];
  for (const p of cands) {
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * 生成与 configureLinuxTypecNic 等价的 bash 脚本（单文件便于 pkexec 执行）。
 */
export function buildLinuxTypecScript(interfaceName, pcIp, mask) {
  const cidr = ipv4NetmaskPrefixBits(mask);
  const ifacesNow = os.networkInterfaces();
  const lines = ['#!/bin/bash', 'set -e', `IFC=${shSingleQuote(interfaceName)}`, `IPC=${shSingleQuote(pcIp)}`, `MASK=${shSingleQuote(mask)}`];
  for (const [name, addrs] of Object.entries(ifacesNow)) {
    if (name === interfaceName) continue;
    if (!addrs?.some((a) => a.family === 'IPv4' && a.address === pcIp)) continue;
    const n = shSingleQuote(name);
    lines.push(
      `(/sbin/ip addr del ${shSingleQuote(`${pcIp}/${cidr}`)} dev ${n} 2>/dev/null) || (/usr/sbin/ip addr del ${shSingleQuote(`${pcIp}/${cidr}`)} dev ${n} 2>/dev/null) || true`,
    );
  }
  lines.push('for B in /sbin/ifconfig /usr/sbin/ifconfig; do');
  lines.push('  if [ -x "$B" ]; then');
  lines.push('    exec "$B" "$IFC" "$IPC" netmask "$MASK" up');
  lines.push('  fi');
  lines.push('done');
  lines.push(`echo '未找到 ifconfig' >&2`);
  lines.push('exit 1');
  return `${lines.join('\n')}\n`;
}

export async function configureLinuxTypecPkexec(interfaceName, pcIp, mask) {
  const pk = resolvePkexec();
  if (!pk) {
    throw new Error('未找到 pkexec（PolicyKit）。请安装 policykit-1 / polkit，或使用 sudo 启动 RDK Studio。');
  }
  const script = buildLinuxTypecScript(interfaceName, pcIp, mask);
  const tmp = path.join(os.tmpdir(), `rdk-typec-${randomUUID()}.sh`);
  fs.writeFileSync(tmp, script, 'utf8');
  fs.chmodSync(tmp, 0o700);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(pk, [tmp], {
        timeout: 120000,
        env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
      });
      let stderr = '';
      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
      child.stdout?.on('data', () => {
        /* drain */
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `pkexec 退出码 ${code}`));
      });
    });
    return '已在提升会话中配置网卡';
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* noop */
    }
  }
}
