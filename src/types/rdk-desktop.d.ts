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

  interface FlashCapabilities {
    supportsDriveScan: boolean;
    supportsDirectWrite: boolean;
    supportsBackup: boolean;
    supportsAutoDecompressXz: boolean;
    supportsVerifyAfterWrite: boolean;
    supportsLaunchThirdPartyTool: boolean;
    thirdPartyToolName?: string;
  }

  interface FlashProgressPayload {
    stage: string;
    message: string;
    percent: number;
  }

  interface FlashActiveOperationSnapshot {
    ok: boolean;
    running: boolean;
    opId?: string;
    lastPayload?: FlashProgressPayload | null;
    logs?: string[];
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
      flashGetCapabilities?: () => Promise<FlashCapabilities>;
      flashListDrives?: () => Promise<{ ok: boolean; drives?: FlashDrive[]; error?: string }>;
      flashPickImage?: (options?: {
        extensions?: string[];
        mode?: 'file' | 'directory';
        pickFolder?: boolean;
        title?: string;
      }) => Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
      flashWriteLocal?: (payload: { imagePath: string; drivePath: string; verifyMode?: 'none' | 'sample'; performanceProfile?: 'balanced' | 'turbo' }) => Promise<{ ok: boolean; output?: string; error?: string; verify?: { ok: boolean; detail: string } }>;
      flashVerifyLocal?: (payload: { imagePath: string; drivePath: string }) => Promise<{ ok: boolean; detail?: string; error?: string }>;
      flashBackupLocal?: (payload: { drivePath: string; destPath?: string }) => Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }>;
      flashCancelLocal?: () => Promise<{ ok: boolean; error?: string }>;
      flashGetActiveOperation?: () => Promise<FlashActiveOperationSnapshot>;
      flashDownloadImage?: (payload: { url: string; destDir: string }) => Promise<{ ok: boolean; path?: string; error?: string }>;
      flashDecompressImage?: (payload: { filePath: string }) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
      launchXburn?: (payload?: { exePath?: string; imagePath?: string }) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
      onFlashProgress?: (cb: (payload: FlashProgressPayload) => void) => (() => void) | void;
      offFlashProgress?: (cb: (payload: FlashProgressPayload) => void) => void;

      prepareSsoEmbedded?: () => Promise<{ ok: boolean; ssoUrl?: string; error?: string }>;
      stopSsoEmbedded?: () => Promise<{ ok: boolean }>;
      openSsoLoginWindow?: () => Promise<void>;
      onSsoToken?: (cb: (payload: { token?: string }) => void) => (() => void) | void;

      /** 抓取内嵌页正文（与 openUrl 的 url 字符串需一致） */
      captureEmbeddedPageText?: (url: string) => Promise<{ ok: boolean; text?: string; error?: string }>;

      /** Agent 抓取：独立悬浮 BrowserWindow */
      openFloatingCaptureBrowser?: (payload: {
        captureId: string;
        url: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      captureFloatingPageText?: (captureId: string) => Promise<{ ok: boolean; text?: string; error?: string }>;
      closeFloatingCapture?: (captureId: string) => Promise<{ ok: boolean; error?: string }>;

      /** 悬浮球点击后主进程通知：应聚焦主窗口并展开 AI Dock */
      onFloatingBallActivate?: (cb: () => void) => (() => void) | void;

      getFloatingBallPrefs?: () => Promise<{ enabled: boolean }>;
      setFloatingBallEnabled?: (enabled: boolean) => Promise<{ ok: boolean }>;
      onFloatingBallMenu?: (
        cb: (payload: { action: string; tab?: string }) => void,
      ) => (() => void) | void;
    };
  }
}