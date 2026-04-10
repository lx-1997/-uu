import { app, dialog, ipcMain } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

/** 启动后延迟再检查，避免与内嵌服务、首屏抢资源 */
const CHECK_DELAY_MS = 12_000;

/**
 * Windows：NSIS + generic（latest.yml）；macOS：zip + generic（latest-mac.yml），需 Developer ID 签名后更新才可靠。
 * 构建时 `package.json` 的 `build.publish.url` 会写入安装包；也可用环境变量 `RDK_STUDIO_UPDATE_BASE_URL` 运行时覆盖。
 */
export function setupDesktopAutoUpdate(getMainWindow) {
  if (!app.isPackaged) return;
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  if (String(process.env.RDK_STUDIO_SMOKE_MODE || '').trim() === '1') return;
  if (String(process.env.RDK_STUDIO_DISABLE_AUTO_UPDATE || '').trim() === '1') return;

  const base = String(process.env.RDK_STUDIO_UPDATE_BASE_URL || '').trim();
  if (base) {
    autoUpdater.setFeedURL({ provider: 'generic', url: base });
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.error('[autoUpdate]', err);
  });

  autoUpdater.on('update-downloaded', async () => {
    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    const bw = win && !win.isDestroyed() ? win : undefined;
    const messageOpts = {
      type: 'info',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
      title: 'RDK Studio 更新',
      message: '新版本已下载完成',
      detail: '重启应用后即可使用新版本。',
    };
    const { response } = bw
      ? await dialog.showMessageBox(bw, messageOpts)
      : await dialog.showMessageBox(messageOpts);
    if (response === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
  });

  ipcMain.handle('rdk:check-for-updates', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        ok: true,
        version: result?.updateInfo?.version ?? null,
        releaseNotes: result?.updateInfo?.releaseNotes ?? null,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[autoUpdate] check-for-updates', e);
      return { ok: false, error: msg };
    }
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((e) => {
      console.error('[autoUpdate] initial checkForUpdates', e);
    });
  }, CHECK_DELAY_MS);
}
