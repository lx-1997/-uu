import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('rdkFloatingBall', {
  /** 单击（未拖动）：聚焦主窗口并通知渲染层展开 Dock */
  notifyClick: () => ipcRenderer.send('rdk:floating-ball:click'),
  /** 拖动窗口（相对上一帧的屏幕坐标增量，px） */
  moveBy: (dx, dy) => ipcRenderer.send('rdk:floating-ball:move-by', { dx, dy }),
  /** 在悬浮球窗口坐标系内弹出系统右键菜单 */
  showContextMenu: (clientX, clientY) =>
    ipcRenderer.send('rdk:floating-ball:context-menu', { clientX, clientY }),
});
