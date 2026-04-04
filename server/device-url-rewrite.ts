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

/** 文档/示例里常见的占位 IP，只要已绑定设备就必须换成真实 SSH host */
const DOC_PLACEHOLDER_IPV4 = new Set([
  "192.168.1.100",
  "192.168.1.1",
  "192.168.0.1",
  "10.0.0.1",
]);

async function resolveDeviceHost(studioDeviceId?: string): Promise<string | undefined> {
  const devices = await readDevices();
  const id = studioDeviceId?.trim();
  if (id) {
    const d = devices.find((x) => x.id === id);
    const h = d?.host?.trim();
    if (h) return h;
  }
  /** 会话未注入 deviceId 时：仅一台已登记设备则用于 LAN 预览 URL 修正（常见误打开 192.168.1.100） */
  if (devices.length === 1 && devices[0].host?.trim()) {
    return devices[0].host.trim();
  }
  return undefined;
}

export async function rewriteUrlForStudioDevice(url: string, studioDeviceId?: string): Promise<string> {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return u;
  const host = await resolveDeviceHost(studioDeviceId);
  if (!host) return u;
  try {
    const parsed = new URL(u);
    const hostname = parsed.hostname;
    if (hostname === host) return u;
    if (/^127\.0\.0\.1$|^localhost$/i.test(hostname)) {
      parsed.hostname = host;
      return parsed.toString();
    }
    if (DOC_PLACEHOLDER_IPV4.has(hostname)) {
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
