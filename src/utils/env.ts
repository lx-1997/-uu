/**
 * Runtime environment detection utilities.
 */

/** Whether the app is running inside the Electron desktop shell. */
export const isDesktop = (): boolean =>
  typeof window !== 'undefined' && !!(window as any).rdkDesktop?.isDesktop;
