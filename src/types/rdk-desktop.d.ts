export {};

declare global {
  interface FlashDrive {
    id: string;
    path: string;
    label: string;
    size: string;
    sizeBytes?: number;
    bus: string;
    mediaType?: string;
    removable?: boolean;
  }

  interface FlashProgressPayload {
    stage: string;
    message: string;
    percent: number;
  }

  interface Window {
    rdkDesktop?: {
      isDesktop?: boolean;
      platform?: string;
      apiBase?: string;
      openUrl?: (url: string) => void;
      hideUrl?: (url: string) => void;
      closeUrl?: (url: string) => void;
      setActiveUrl?: (url: string | null) => void;
      updateViewBounds?: (bounds: { x: number; y: number; width: number; height: number }) => void;
      onSubUrlOpen?: (cb: (url: string) => void) => void;
      onUrlLoadFailed?: (cb: (url: string, errorCode: number, errorDescription: string) => void) => void;
      onUrlLoaded?: (cb: (url: string) => void) => void;
      flashListDrives?: () => Promise<{ ok: boolean; drives?: FlashDrive[]; error?: string }>;
      flashPickImage?: (options?: { extensions?: string[] }) => Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
      flashWriteLocal?: (payload: { imagePath: string; drivePath: string; verifyMode?: 'none' | 'sample' }) => Promise<{ ok: boolean; output?: string; error?: string; verify?: { ok: boolean; detail: string } }>;
      flashVerifyLocal?: (payload: { imagePath: string; drivePath: string }) => Promise<{ ok: boolean; detail?: string; error?: string }>;
      flashBackupLocal?: (payload: { drivePath: string; destPath?: string }) => Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }>;
      flashCancelLocal?: () => Promise<{ ok: boolean; error?: string }>;
      flashDownloadImage?: (payload: { url: string; destDir: string }) => Promise<{ ok: boolean; path?: string; error?: string }>;
      flashDecompressImage?: (payload: { filePath: string }) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
      launchXburn?: (payload?: { exePath?: string; imagePath?: string }) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
      onFlashProgress?: (cb: (payload: FlashProgressPayload) => void) => (() => void) | void;
      offFlashProgress?: (cb: (payload: FlashProgressPayload) => void) => void;
    };
  }
}