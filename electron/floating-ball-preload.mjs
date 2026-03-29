import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('rdkFloatingBall', {
  /** 欢迎气泡收起后缩回 72×72，右下角锚点不变 */
  welcomeDismissed: () => ipcRenderer.send('rdk:floating-ball:welcome-dismissed'),
  /** 单击（未拖动）：聚焦主窗口并通知渲染层展开 Dock */
  notifyClick: () => ipcRenderer.send('rdk:floating-ball:click'),
  /** 拖动窗口（相对上一帧的屏幕坐标增量，px；旧版保留，拖动已改用主进程全局光标轮询） */
  moveBy: (dx, dy) => ipcRenderer.send('rdk:floating-ball:move-by', { dx, dy }),
  /** 开始拖动：主进程按 screen.getCursorScreenPoint() 移动窗口，避免指针移出小窗后无法拖动 */
  dragStart: () => ipcRenderer.send('rdk:floating-ball:drag-start'),
  dragEnd: () => ipcRenderer.send('rdk:floating-ball:drag-end'),
  /** 在悬浮球窗口坐标系内弹出系统右键菜单 */
  showContextMenu: (clientX, clientY) =>
    ipcRenderer.send('rdk:floating-ball:context-menu', { clientX, clientY }),
});
