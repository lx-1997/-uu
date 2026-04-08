import os from 'node:os';

/**
 * 与 electron/typec-verify-ip.mjs 保持同步：轮询本机是否已为指定网卡配上目标 IPv4。
 * Windows/macOS 在 netsh/ifconfig 后，os.networkInterfaces() 可能延迟数秒才更新，故拉长窗口。
 */
export const TYPEC_VERIFY_ATTEMPTS = 35;
export const TYPEC_VERIFY_INTERVAL_MS = 500;

export async function verifyTypecIpOnInterface(interfaceName: string, pcIp: string): Promise<boolean> {
  for (let i = 0; i < TYPEC_VERIFY_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, TYPEC_VERIFY_INTERVAL_MS));
    const target = os.networkInterfaces()[interfaceName];
    if (target?.some((a) => a.family === 'IPv4' && a.address === pcIp)) {
      return true;
    }
  }
  return false;
}
