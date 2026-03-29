/**
 * Runtime environment detection utilities.
 */

/** Whether the app is running inside the Electron desktop shell. */
export const isDesktop = (): boolean =>
  typeof window !== 'undefined' && !!(window as any).rdkDesktop?.isDesktop;

/** Electron 主进程上报的平台，如 darwin / win32 / linux */
export const getDesktopPlatform = (): string | undefined =>
  typeof window !== 'undefined' ? (window as any).rdkDesktop?.platform : undefined;

/** macOS 桌面版：当前未接入本机 USB 串口（Web Serial），与 Windows 桌面版区分 */
export const isDesktopMac = (): boolean => isDesktop() && getDesktopPlatform() === 'darwin';
