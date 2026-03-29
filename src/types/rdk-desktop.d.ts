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
    /** Windows / macOS：S100 xburn 命令行一键烧写 */
    supportsS100XburnCli?: boolean;
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
        mode?: 'file' | 'directory' | 's100-unified';
        pickFolder?: boolean;
        title?: string;
        /** Win：选目录对话框标题（s100-unified 先目录后 zip） */
        titleDirectory?: string;
        /** 在类型筛选后追加「所有文件」（与 Imager S100 / 通用镜像一致） */
        appendAllFilesFilter?: boolean;
        dialogFilters?: { name: string; extensions: string[] }[];
      }) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
      flashWriteLocal?: (payload: { imagePath: string; drivePath: string; verifyMode?: 'none' | 'sample'; performanceProfile?: 'balanced' | 'turbo' }) => Promise<{ ok: boolean; output?: string; error?: string; verify?: { ok: boolean; detail: string } }>;
      flashVerifyLocal?: (payload: { imagePath: string; drivePath: string }) => Promise<{ ok: boolean; detail?: string; error?: string }>;
      flashBackupLocal?: (payload: { drivePath: string; destPath?: string }) => Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }>;
      flashCancelLocal?: () => Promise<{ ok: boolean; error?: string }>;
      flashGetActiveOperation?: () => Promise<FlashActiveOperationSnapshot>;
      flashDownloadImage?: (payload: { url: string; destDir: string }) => Promise<{ ok: boolean; path?: string; error?: string }>;
      flashDecompressImage?: (payload: { filePath: string }) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
      launchXburn?: (payload?: { exePath?: string; imagePath?: string }) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
      /** 读取已缓存的 S100 xburn-gui 路径（存在且文件仍在则返回） */
      flashGetS100XburnGui?: () => Promise<{ ok: boolean; path?: string }>;
      /** 弹出系统框选择 xburn-gui 并写入缓存（与固件路径无关） */
      flashPickS100XburnGui?: () => Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
      /** S100：烧写前短跑 xburn 探测（与 Imager CHECK_XBURN_S100_ENV 对齐） */
      flashCheckS100XburnEnv?: (payload?: { xburnGuiPath?: string }) => Promise<{
        ok: boolean;
        xburnPath?: string | null;
        checks?: Array<{ id?: string; pass?: boolean; scenario?: string; message?: string }>;
        rawLog?: string;
        exitCode?: number | null;
        timedOut?: boolean;
      }>;
      /** S100：固件目录或 product.zip + xburn CLI（Win：需 xburnGuiPath/缓存；Mac：自动 /Applications、PATH 或下载 DMG；mac 上 sudo -A） */
      flashS100Xburn?: (payload: {
        imagePath: string;
        xburnGuiPath?: string;
        skipAdbReboot?: boolean;
      }) => Promise<{
        ok: boolean;
        canceled?: boolean;
        error?: string;
        code?: string;
        logTail?: string;
        /** false = 进程 0 退出但未识别到日志「写盘完成」强依据，勿当已成功 */
        completedBurnEvidence?: boolean;
      }>;
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