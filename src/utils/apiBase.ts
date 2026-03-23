/** 与 src/api.ts 中桌面端逻辑一致，供非 request() 场景的 fetch 使用 */
export function resolveApiUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  const apiBase = (window as unknown as { rdkDesktop?: { apiBase?: string } }).rdkDesktop?.apiBase;
  if (apiBase) return `${apiBase}${path}`;
  return path;
}
