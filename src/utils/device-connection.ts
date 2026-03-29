import type { Device } from '../app-types';

/**
 * 与后端 `device.status === 'connected'`、前端规范化后的 `'online'` 对齐。
 * `/api/devices/:id/ping` 使用 verifySshConnection，即须能 SSH 登录成功。
 */
export function isDeviceSshConnected(status: string | undefined | null): boolean {
  return status === 'online' || status === 'connected';
}

/**
 * 工作台/侧栏「设备在线」：须同时满足已验证过 SSH 且当前 status 为在线。
 * 避免刚进应用尚未 ping 时显示在线。
 */
export function isDeviceShownOnline(dev: Device | undefined | null): boolean {
  if (!dev?.sshSessionVerified) return false;
  return isDeviceSshConnected(dev.status);
}
