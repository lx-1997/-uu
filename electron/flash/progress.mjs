/**
 * Unified flash progress emitter.
 *
 * Wraps the BrowserWindow webContents IPC channel so adapters
 * can emit progress without importing Electron directly.
 */

let _sender = null;
let _lastPayload = null;
let _history = [];
let _lastHistoryMessage = '';
let _lastHistoryAt = 0;

const MAX_PROGRESS_HISTORY = 400;

export function setProgressSender(webContentsSend) {
  _sender = webContentsSend;
}

export function resetFlashProgressHistory() {
  _lastPayload = null;
  _history = [];
  _lastHistoryMessage = '';
  _lastHistoryAt = 0;
}

export function getFlashProgressSnapshot() {
  return {
    lastPayload: _lastPayload,
    logs: _history,
  };
}

export function emitFlashProgress(payload) {
  _lastPayload = payload;
  if (payload?.message) {
    const now = Date.now();
    const message = String(payload.message);
    const shouldRecord = message !== _lastHistoryMessage || now - _lastHistoryAt >= 1000;
    if (shouldRecord) {
      _lastHistoryMessage = message;
      _lastHistoryAt = now;
      const time = new Date().toLocaleTimeString();
      _history.push(`[${time}] ${message}`);
      if (_history.length > MAX_PROGRESS_HISTORY) {
        _history = _history.slice(-MAX_PROGRESS_HISTORY);
      }
    }
  }
  if (typeof _sender === 'function') {
    _sender('rdk:flash:progress', payload);
  }
}

export function makeResult(ok, data) {
  if (ok) return { ok: true, ...data };
  const { error, code, ...rest } = data || {};
  return { ok: false, error: error || '未知错误', code, ...rest };
}
