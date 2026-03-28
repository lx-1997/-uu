/**
 * 与后端 `device.status === 'connected'`、前端规范化后的 `'online'` 对齐。
 * 仅当明确为已连接时才为 true，避免 undefined / 空串 / 旧缓存误显示「在线」。
 */
export function isDeviceSshConnected(status: string | undefined | null): boolean {
  return status === 'online' || status === 'connected';
}
