import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('rdkDesktop', {
  isDesktop: true,
  platform: process.platform,

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
});
