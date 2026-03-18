export {};

declare global {
  interface Window {
    rdkDesktop?: {
      isDesktop?: boolean;
      platform?: string;
      apiBase?: string;
      openUrl?: (url: string) => void;
      hideUrl?: (url: string) => void;
      closeUrl?: (url: string) => void;
      setActiveUrl?: (url: string | null) => void;
      onSubUrlOpen?: (cb: (url: string) => void) => void;
      onUrlLoadFailed?: (cb: (url: string, errorCode: number, errorDescription: string) => void) => void;
      onUrlLoaded?: (cb: (url: string) => void) => void;
      flashListDrives?: () => Promise<{ ok: boolean; drives?: Array<{ id: string; path: string; label: string; size: string; bus: string }>; error?: string }>;
      flashPickImage?: () => Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
      flashWriteLocal?: (payload: { imagePath: string; drivePath: string }) => Promise<{ ok: boolean; output?: string; error?: string }>;
      launchXburn?: (payload?: { exePath?: string; imagePath?: string }) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
      onFlashProgress?: (cb: (payload: { stage: string; message: string; percent: number }) => void) => void;
    };
  }
}