import { fetchApi } from './apiBase';

const AUTH_QUERY_HOSTS = ['forum.d-robotics.cc', 'robogo.d-robotics.cc'];

export function needsDrSsoUrlToken(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return AUTH_QUERY_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/** 浏览器端：为 forum / robogo URL 附加 SSO query（桌面端请用 openDrAuthenticatedPortal → 主窗口内嵌） */
export async function resolveDrExternalOpenUrl(url: string): Promise<string> {
  if (!needsDrSsoUrlToken(url)) return url;
  try {
    const r = await fetchApi(`/api/sso/external-url?url=${encodeURIComponent(url)}`);
    if (!r.ok) return url;
    const data = (await r.json()) as { url?: string };
    return typeof data.url === 'string' ? data.url : url;
  } catch {
    return url;
  }
}

export async function openDrExternalUrl(
  url: string,
  opts?: { onPopupBlocked?: () => void },
): Promise<void> {
  const tab = window.open('about:blank', '_blank');
  if (!tab) {
    opts?.onPopupBlocked?.();
    const finalUrl = await resolveDrExternalOpenUrl(url);
    window.location.assign(finalUrl);
    return;
  }
  try {
    const finalUrl = await resolveDrExternalOpenUrl(url);
    tab.location.replace(finalUrl);
  } catch {
    tab.location.replace(url);
  }
}
