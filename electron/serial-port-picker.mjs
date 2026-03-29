/**
 * Electron Web Serial：`navigator.serial.requestPort()` 会触发 session 的 `select-serial-port`。
 * 若不 `preventDefault`，由 Chromium 自带选择器展示；但渲染进程拿到的 `SerialPort.getInfo()` 对蓝牙等常无 VID/PID，
 * 下拉无法显示「COMx」真实名。
 *
 * 此处统一拦截，用主进程提供的 `portName`（Windows 为 COMx）写入 `lastChosenSerialMeta`，
 * 供渲染进程在 `requestPort` resolve 后 `invoke('rdk:serial:consume-last-chosen-meta')` 与 `WeakMap` 关联展示。
 * @see https://www.electronjs.org/docs/latest/tutorial/devices#web-serial-api
 */
import { ipcMain, session } from 'electron';
import { filterRdkSerialPickerPorts } from './serial-port-filter.mjs';

let serialPickerSeq = 0;
/** @type {Map<number, { callback: (portId: string) => void, ports: Array<{ portId: string, portName?: string, displayName?: string, deviceInstanceId?: string }> }>} */
const pendingSerialPickers = new Map();

let lastChosenSerialMeta = null;

export function registerSerialPortPickerHandlers() {
  session.defaultSession.on('select-serial-port', (event, portList, webContents, callback) => {
    if (!portList?.length) {
      callback('');
      return;
    }
    event.preventDefault();
    const portListFiltered = filterRdkSerialPickerPorts(portList);
    if (portListFiltered.length === 1) {
      const chosen = portListFiltered[0];
      lastChosenSerialMeta = {
        portName: chosen.portName || '',
        displayName: chosen.displayName || chosen.portName || '',
      };
      callback(chosen.portId);
      return;
    }
    const reqId = ++serialPickerSeq;
    pendingSerialPickers.set(reqId, { callback, ports: portListFiltered });
    webContents.send('rdk:serial:show-picker', {
      reqId,
      ports: portListFiltered.map((p) => ({
        portId: p.portId,
        portName: p.portName ?? '',
        displayName: p.displayName ?? p.portName ?? '',
        deviceInstanceId: p.deviceInstanceId ?? '',
      })),
    });
  });

  ipcMain.on('rdk:serial:picker-result', (_event, payload) => {
    const reqId = payload?.reqId;
    const portId = payload?.portId;
    const pending = typeof reqId === 'number' ? pendingSerialPickers.get(reqId) : undefined;
    if (!pending) return;
    pendingSerialPickers.delete(reqId);
    const chosen = portId ? pending.ports.find((p) => p.portId === portId) : null;
    if (chosen) {
      lastChosenSerialMeta = {
        portName: chosen.portName || '',
        displayName: chosen.displayName || chosen.portName || '',
      };
    } else {
      lastChosenSerialMeta = null;
    }
    pending.callback(typeof portId === 'string' ? portId : '');
  });

  ipcMain.handle('rdk:serial:consume-last-chosen-meta', () => {
    const m = lastChosenSerialMeta;
    lastChosenSerialMeta = null;
    return m;
  });
}
