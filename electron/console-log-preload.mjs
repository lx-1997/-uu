import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('rdkConsoleLogNative', {
  getSnapshot: () => ipcRenderer.invoke('rdk:console-log-snapshot'),
  requestClearFromWindow: () => ipcRenderer.send('rdk:console-log-clear-request'),
  subscribe: (callbacks) => {
    const onAppend = (_e, line) => {
      try {
        callbacks?.onAppend?.(line);
      } catch {
        /* noop */
      }
    };
    const onClear = () => {
      try {
        callbacks?.onClear?.();
      } catch {
        /* noop */
      }
    };
    ipcRenderer.on('rdk:console-log-append', onAppend);
    ipcRenderer.on('rdk:console-log-clear', onClear);
    return () => {
      ipcRenderer.removeListener('rdk:console-log-append', onAppend);
      ipcRenderer.removeListener('rdk:console-log-clear', onClear);
    };
  },
});
