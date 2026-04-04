/**
 * 将「应在本机打开的板卡网页 URL」与 devices.json 中当前设备的 SSH host 对齐，
 * 避免模型误写网段 IP（如 192.168.1.100）而实际 SSH 为 192.168.127.x。
 */
import { readDevices } from "./storage.js";

function isRfc1918IPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export async function rewriteUrlForStudioDevice(url: string, studioDeviceId?: string): Promise<string> {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return u;
  if (!studioDeviceId?.trim()) return u;
  try {
    const devices = await readDevices();
    const d = devices.find((x) => x.id === studioDeviceId.trim());
    const host = d?.host?.trim();
    if (!host) return u;
    const parsed = new URL(u);
    const hostname = parsed.hostname;
    if (hostname === host) return u;
    if (/^127\.0\.0\.1$|^localhost$/i.test(hostname)) {
      parsed.hostname = host;
      return parsed.toString();
    }
    if (
      /^\d+\.\d+\.\d+\.\d+$/.test(host)
      && isRfc1918IPv4(hostname)
      && hostname !== host
    ) {
      parsed.hostname = host;
      return parsed.toString();
    }
    return u;
  } catch {
    return u;
  }
}
