import type { Device } from '../app-types';

/** 从 Device 取 SSH 用户名（优先 API 字段，其次从 `user@host:port` 解析） */
export function deriveDeviceSshUsername(device: Device): string {
  const fromField = device.sshUsername?.trim();
  if (fromField) return fromField;
  const name = device.name?.trim() ?? '';
  const i = name.indexOf('@');
  if (i > 0) return name.slice(0, i);
  return '';
}

function usernameSortRank(username: string): number {
  const lower = username.toLowerCase();
  if (lower === 'root') return 0;
  if (lower === 'sunrise') return 2;
  return 1;
}

/**
 * 同一 IP/端口多账号时：列表与默认选中优先 root，sunrise 排在同类账号最后，
 * 避免 AI 条与后台探测默认落到套件端普通用户账号。
 */
export function orderDevicesForStudio(devices: Device[]): Device[] {
  return [...devices].sort((a, b) => {
    const hostA = a.ip || '';
    const hostB = b.ip || '';
    if (hostA !== hostB) return hostA.localeCompare(hostB);
    const portA = a.port ?? 22;
    const portB = b.port ?? 22;
    if (portA !== portB) return portA - portB;
    const ua = deriveDeviceSshUsername(a);
    const ub = deriveDeviceSshUsername(b);
    const ra = usernameSortRank(ua);
    const rb = usernameSortRank(ub);
    if (ra !== rb) return ra - rb;
    return ua.localeCompare(ub);
  });
}

/**
 * 同机已保存 root（或其它非-sunrise 账号）时，不把「当前选中」停留在 sunrise 上。
 */
export function preferRootOverSunriseOnSameHost(devices: Device[], activeId: string): string {
  const current = devices.find((d) => d.id === activeId);
  if (!current) return activeId;
  if (deriveDeviceSshUsername(current).toLowerCase() !== 'sunrise') return activeId;
  const port = current.port ?? 22;
  const host = current.ip;
  const alt = devices.find(
    (d) =>
      d.id !== current.id
      && d.ip === host
      && (d.port ?? 22) === port
      && deriveDeviceSshUsername(d).toLowerCase() !== 'sunrise',
  );
  return alt?.id ?? activeId;
}

/**
 * 后台健康 ping 会走 SSH；同 host:port 已有其它账号时，未选中的 sunrise 不再反复握手。
 */
export function shouldDeferSunriseBackgroundPing(
  device: Device,
  snapshot: Device[],
  activeDeviceId: string,
): boolean {
  if (deriveDeviceSshUsername(device).toLowerCase() !== 'sunrise') return false;
  if (activeDeviceId === device.id) return false;
  const port = device.port ?? 22;
  const host = device.ip;
  return snapshot.some(
    (d) =>
      d.id !== device.id
      && d.ip === host
      && (d.port ?? 22) === port
      && deriveDeviceSshUsername(d).toLowerCase() !== 'sunrise',
  );
}
