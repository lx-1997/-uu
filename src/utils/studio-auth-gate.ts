/**
 * 与 App 中 SSOGate、DeviceProvider 的「是否必须先登录」一致。
 * 开发态与正式发布均须先登录；仅构建时显式 VITE_ALLOW_ANONYMOUS=true 时允许访客（极少数自动化/离线调试）。
 */

export function isStudioLoginRequired(_ssoRequiredFromServer: boolean): boolean {
  return import.meta.env.VITE_ALLOW_ANONYMOUS !== 'true';
}
