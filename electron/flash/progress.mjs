/**
 * Unified flash progress emitter.
 *
 * Wraps the BrowserWindow webContents IPC channel so adapters
 * can emit progress without importing Electron directly.
 */

let _sender = null;

export function setProgressSender(webContentsSend) {
  _sender = webContentsSend;
}

export function emitFlashProgress(payload) {
  if (typeof _sender === 'function') {
    _sender('rdk:flash:progress', payload);
  }
}

export function makeResult(ok, data) {
  if (ok) return { ok: true, ...data };
  const { error, code, ...rest } = data || {};
  return { ok: false, error: error || '未知错误', code, ...rest };
}
