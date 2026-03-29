/**
 * 与后端 `device.status === 'connected'`、前端规范化后的 `'online'` 对齐。
 * `/api/devices/:id/ping` 使用 verifySshConnection，即须能 SSH 登录成功。
 */
export function isDeviceSshConnected(status: string | undefined | null): boolean {
  return status === 'online' || status === 'connected';
}
