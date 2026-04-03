import type { Device } from '../app-types';
import { isPrivateIp } from './ip';

/** 经 frp 或公网 IP 连接设备时，IDE/VNC 等需走后端 SSH 隧道而非直连板子端口 */
export function shouldUseSshTunnelForDevice(device: Device | null | undefined): boolean {
  if (!device) return false;
  if (device.sshReachability === 'tunnel') return true;
  return !isPrivateIp(device.ip);
}
