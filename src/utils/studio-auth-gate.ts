/**
 * 与 App 中 SSOGate、DeviceProvider 的「是否必须先登录」一致。
 * 默认跟随后端返回的 ssoRequired；构建时显式 VITE_ALLOW_ANONYMOUS=true 时强制允许访客，
 * 供极少数自动化 / 离线调试场景使用。
 */

export function isStudioLoginRequired(ssoRequiredFromServer: boolean): boolean {
  if (import.meta.env.VITE_ALLOW_ANONYMOUS === 'true') {
    return false;
  }
  return !!ssoRequiredFromServer;
}
