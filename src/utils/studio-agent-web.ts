/** RDKClaw / Agent 通过 Socket 请求在主窗口打开网页时派发，供 App 同步 setActiveUrl（避免被 useDesktopTabSync 误隐藏） */
export const STUDIO_AGENT_WEB_OPEN = 'rdk-studio-agent-web-open';

export function dispatchStudioAgentWebOpen(url: string): void {
  const u = String(url || '').trim();
  if (!u) return;
  window.dispatchEvent(new CustomEvent(STUDIO_AGENT_WEB_OPEN, { detail: { url: u } }));
}
