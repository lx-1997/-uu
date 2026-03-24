import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('rdkDesktop', {
  isDesktop: true,
  platform: process.platform,
  // 打包后前端通过此字段拼接 API base URL（file:// 协议下相对路径失效）
  apiBase: 'http://localhost:8787',

  // 在主窗口内嵌入一个 WebContentsView（用于 code-server / noVNC）
  openUrl: (url) => ipcRenderer.send('rdk:open-url', { url }),

  // 隐藏（不销毁）嵌入页面
  hideUrl: (url) => ipcRenderer.send('rdk:hide-url', { url }),

  // 关闭并销毁嵌入页面
  closeUrl: (url) => ipcRenderer.send('rdk:close-url', { url }),

  // 监听子页面弹出的新窗口事件
  onSubUrlOpen: (cb) => {
    ipcRenderer.on('rdk:sub-url-open', (_event, url) => cb(url));
  },

  // 监听嵌入页面加载失败事件
  onUrlLoadFailed: (cb) => {
    ipcRenderer.on('rdk:url-load-failed', (_event, { url, errorCode, errorDescription }) => cb(url, errorCode, errorDescription));
  },

  // 监听嵌入页面加载成功事件
  onUrlLoaded: (cb) => {
    ipcRenderer.on('rdk:url-loaded', (_event, { url }) => cb(url));
  },

  // 通知主进程当前活跃的嵌入 URL（tab 切换时调用，null 表示无嵌入视图）
  setActiveUrl: (url) => ipcRenderer.send('rdk:set-active-url', { url }),
  updateViewBounds: (bounds) => ipcRenderer.send('rdk:update-view-bounds', { bounds }),

  // 本机烧录能力探测与操作
  flashGetCapabilities: () => ipcRenderer.invoke('rdk:flash:get-capabilities'),
  flashListDrives: () => ipcRenderer.invoke('rdk:flash:list-drives'),
  flashPickImage: (options) => ipcRenderer.invoke('rdk:flash:pick-image', options),
  flashWriteLocal: (payload) => ipcRenderer.invoke('rdk:flash:write-local', payload),
  flashVerifyLocal: (payload) => ipcRenderer.invoke('rdk:flash:verify-local', payload),
  flashBackupLocal: (payload) => ipcRenderer.invoke('rdk:flash:backup-local', payload),
  flashCancelLocal: () => ipcRenderer.invoke('rdk:flash:cancel'),
  flashDownloadImage: (payload) => ipcRenderer.invoke('rdk:flash:download-image', payload),
  flashDecompressImage: (payload) => ipcRenderer.invoke('rdk:flash:decompress-image', payload),
  launchXburn: (payload) => ipcRenderer.invoke('rdk:flash:launch-xburn', payload),
  onFlashProgress: (cb) => {
    ipcRenderer.on('rdk:flash:progress', (_event, payload) => cb(payload));
  },
});
