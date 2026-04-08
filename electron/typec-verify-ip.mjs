/**
 * 轮询本机是否已为指定网卡配上目标 IPv4（与 server /api/typec/configure 校验一致）。
 */
import os from 'node:os';

export async function verifyTypecIpOnInterface(interfaceName, pcIp) {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const target = os.networkInterfaces()[interfaceName];
    if (target?.some((a) => a.family === 'IPv4' && a.address === pcIp)) {
      return true;
    }
  }
  return false;
}
