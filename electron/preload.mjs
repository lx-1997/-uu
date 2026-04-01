import { contextBridge, ipcRenderer } from 'electron';

const RDK_SSO_TOKEN = 'rdk:sso:token';

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
  /** IDE/VNC：拆到独立原生窗口或贴回主窗口 */
  setEmbedFloatMode: (url, floating, title) =>
    ipcRenderer.send('rdk:set-embed-float', { url, floating, title }),
  onEmbedFloatDocked: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('rdk:embed-float-docked', h);
    return () => ipcRenderer.removeListener('rdk:embed-float-docked', h);
  },
  updateViewBounds: (bounds) => ipcRenderer.send('rdk:update-view-bounds', { bounds }),

  /** Windows：列出与设备管理器一致的 COM 口（WMI），供 USB 串口标签与 Web Serial VID/PID 对照 */
  listWindowsSerialPorts: () => ipcRenderer.invoke('rdk:serial:list-windows'),

  /** 弹出系统「另存为」并写入文本（用于桌面端导出 JSON 等） */
  saveTextFile: (payload) => ipcRenderer.invoke('rdk:save-text-file', payload),

  /** 主进程拦截串口选择器时推送到渲染进程（多端口时展示真实 COM 名） */
  onSerialPortShowPicker: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('rdk:serial:show-picker', h);
    return () => ipcRenderer.removeListener('rdk:serial:show-picker', h);
  },
  sendSerialPortPickerResult: (payload) => {
    ipcRenderer.send('rdk:serial:picker-result', payload);
  },
  /** `requestPort` resolve 后立即调用，取本次选择的 portName/displayName（一次性消费） */
  consumeLastSerialPortMeta: () => ipcRenderer.invoke('rdk:serial:consume-last-chosen-meta'),

  // 本机烧录能力探测与操作
  flashGetCapabilities: () => ipcRenderer.invoke('rdk:flash:get-capabilities'),
  flashListDrives: () => ipcRenderer.invoke('rdk:flash:list-drives'),
  flashPickImage: (options) => ipcRenderer.invoke('rdk:flash:pick-image', options),
  flashWriteLocal: (payload) => ipcRenderer.invoke('rdk:flash:write-local', payload),
  flashVerifyLocal: (payload) => ipcRenderer.invoke('rdk:flash:verify-local', payload),
  flashBackupLocal: (payload) => ipcRenderer.invoke('rdk:flash:backup-local', payload),
  flashCancelLocal: () => ipcRenderer.invoke('rdk:flash:cancel'),
  flashGetActiveOperation: () => ipcRenderer.invoke('rdk:flash:get-active-op'),
  flashDownloadImage: (payload) => ipcRenderer.invoke('rdk:flash:download-image', payload),
  flashDecompressImage: (payload) => ipcRenderer.invoke('rdk:flash:decompress-image', payload),
  launchXburn: (payload) => ipcRenderer.invoke('rdk:flash:launch-xburn', payload),
  flashGetS100XburnGui: () => ipcRenderer.invoke('rdk:flash:get-s100-xburn-gui'),
  flashPickS100XburnGui: () => ipcRenderer.invoke('rdk:flash:pick-s100-xburn-gui'),
  flashCheckS100XburnEnv: (payload) => ipcRenderer.invoke('rdk:flash:check-s100-xburn-env', payload ?? {}),
  flashS100Xburn: (payload) => ipcRenderer.invoke('rdk:flash:s100-xburn', payload),
  onFlashProgress: (cb) => {
    const wrapped = (_event, payload) => cb(payload);
    ipcRenderer.on('rdk:flash:progress', wrapped);
    return () => ipcRenderer.removeListener('rdk:flash:progress', wrapped);
  },

  prepareSsoEmbedded: () => ipcRenderer.invoke('rdk:sso:prepare-embedded'),
  stopSsoEmbedded: () => ipcRenderer.invoke('rdk:sso:stop-embedded'),
  openSsoLoginWindow: () => ipcRenderer.invoke('rdk:sso:open-login-window'),
  /** 系统默认浏览器打开 SSO（环回回调仍由当前 prepare-embedded 监听，勿先 stop） */
  openSsoExternal: (url) => ipcRenderer.invoke('rdk:sso:open-external', url),
  onSsoToken: (cb) => {
    const wrapped = (_event, payload) => cb(payload);
    ipcRenderer.on(RDK_SSO_TOKEN, wrapped);
    return () => ipcRenderer.removeListener(RDK_SSO_TOKEN, wrapped);
  },

  /** 从内嵌 WebContentsView 抓取 document.body.innerText（需已 rdk:open-url 同 URL） */
  captureEmbeddedPageText: (url) => ipcRenderer.invoke('rdk:capture-embedded-url', { url }),

  /** Agent 抓取：打开独立小悬浮窗（不挡主界面） */
  openFloatingCaptureBrowser: (payload) => ipcRenderer.invoke('rdk:open-floating-capture', payload),

  /** 从抓取悬浮窗取正文（按 captureId） */
  captureFloatingPageText: (captureId) => ipcRenderer.invoke('rdk:capture-floating-url', { captureId }),

  /** 关闭抓取悬浮窗 */
  closeFloatingCapture: (captureId) => ipcRenderer.invoke('rdk:close-floating-capture', { captureId }),

  /** 桌面悬浮球点击：聚焦主窗口并展开 Dock */
  onFloatingBallActivate: (cb) => {
    const wrapped = () => cb();
    ipcRenderer.on('rdk:floating-ball:activate', wrapped);
    return () => ipcRenderer.removeListener('rdk:floating-ball:activate', wrapped);
  },

  getFloatingBallPrefs: () => ipcRenderer.invoke('rdk:floating-ball:get-prefs'),
  setFloatingBallEnabled: (enabled) => ipcRenderer.invoke('rdk:floating-ball:set-enabled', { enabled }),

  onFloatingBallMenu: (cb) => {
    const wrapped = (_e, payload) => cb(payload);
    ipcRenderer.on('rdk:floating-ball:menu', wrapped);
    return () => ipcRenderer.removeListener('rdk:floating-ball:menu', wrapped);
  },

  /** 打开主窗口 Chromium DevTools（开发排查；亦可通过菜单「视图 → 切换开发者工具」） */
  openDevTools: () => ipcRenderer.invoke('rdk:open-devtools'),

  /** 将主窗口一行日志镜像到主进程缓冲（供独立控制台窗口） */
  mirrorStudioLogLine: (line) => ipcRenderer.send('rdk:studio-log-mirror', line),
  /** 主窗口清空日志时同步清空镜像与子窗口 */
  notifyStudioLogClear: () => ipcRenderer.send('rdk:studio-log-clear-mirror'),
  /** 打开原生控制台日志窗口（非浏览器页） */
  openConsoleLogWindow: () => ipcRenderer.invoke('rdk:console-log-open-window'),
});

ipcRenderer.on('rdk:studio-log-clear-ui', () => {
  window.dispatchEvent(new Event('rdk-studio-log-clear-ui'));
});
