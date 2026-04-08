/**
 * 轮询本机是否已为指定网卡配上目标 IPv4（与 server/typec-verify-ip.ts 校验一致）。
 * 系统接口枚举可能晚于 netsh/ifconfig 生效，窗口需足够长。
 */
import os from 'node:os';

/** 与 server/typec-verify-ip.ts 保持同步 */
const TYPEC_VERIFY_ATTEMPTS = 35;
const TYPEC_VERIFY_INTERVAL_MS = 500;

export async function verifyTypecIpOnInterface(interfaceName, pcIp) {
  for (let i = 0; i < TYPEC_VERIFY_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, TYPEC_VERIFY_INTERVAL_MS));
    const target = os.networkInterfaces()[interfaceName];
    if (target?.some((a) => a.family === 'IPv4' && a.address === pcIp)) {
      return true;
    }
  }
  return false;
}
