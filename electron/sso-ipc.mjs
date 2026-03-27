/**
 * 对齐 rdkstudio_frontend-master：内嵌 webview SSO + 127.0.0.1 环回收 token，
 * 渲染进程再 POST /api/sso/bootstrap 建立 HttpOnly 会话。
 */
import http from 'node:http';
import { BrowserWindow, ipcMain } from 'electron';

export const RDK_SSO_TOKEN_CHANNEL = 'rdk:sso:token';
const RDK_PREPARE_SSO_EMBEDDED = 'rdk:sso:prepare-embedded';
const RDK_STOP_SSO_EMBEDDED = 'rdk:sso:stop-embedded';
const RDK_OPEN_SSO_LOGIN = 'rdk:sso:open-login-window';

const SSO_CALLBACK_PORT_BASE = 38473;

function getSsoBaseUrl() {
  return (process.env.SSO_BASE_URL || 'https://sso.d-robotics.cc').replace(/\/$/, '');
}

function sendTokenToRenderer(getMainWindow, token) {
  if (!token) return;
  const clean = String(token).replace(/^Bearer\s+/i, '').trim();
  if (!clean) return;
  try {
    const win = getMainWindow();
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(RDK_SSO_TOKEN_CHANNEL, { token: clean });
    }
  } catch (e) {
    console.warn('[sso-ipc] send token failed:', e);
  }
}

function attachSsoCallbackServer(getMainWindow, ssoCallbackServer, onToken) {
  ssoCallbackServer.on('request', (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (!req.url?.includes('favicon')) {
      console.log('[sso-ipc] callback', req.method, req.url);
    }
    let token = url.searchParams.get('bearer') || url.searchParams.get('token') || url.searchParams.get('access_token');
    if (token) token = token.replace(/^Bearer\s+/i, '').trim();
    const htmlOk = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;text-align:center;padding:40px;"><p>登录成功，正在进入...</p></body></html>';

    if (token) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlOk);
      try {
        ssoCallbackServer.close();
      } catch (_) { /* ignore */ }
      onToken?.(token);
      sendTokenToRenderer(getMainWindow, token);
      return;
    }

    const port = ssoCallbackServer.address()?.port || SSO_CALLBACK_PORT_BASE;
    const extractHashHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><script>
      var h = location.hash.slice(1);
      var m = h && h.match(/(?:^|&)(?:access_token|bearer|token)=([^&]+)/i);
      var t = m ? decodeURIComponent(m[1]) : '';
      if (t) location.replace('http://127.0.0.1:${port}/callback?bearer=' + encodeURIComponent(t));
      else document.body.innerHTML = '<p>未检测到 Token，请重试</p>';
    </script></head><body><p>正在处理...</p></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(extractHashHtml.replace(/\$\{port\}/g, String(port)));
  });
}

/**
 * @param {{ getMainWindow: () => import('electron').BrowserWindow | null }} opts
 */
export function registerSsoLoginIpc(opts) {
  const { getMainWindow } = opts;
  let embeddedSsoServer = null;

  const stopEmbedded = () => {
    if (embeddedSsoServer) {
      try {
        embeddedSsoServer.close();
      } catch (_) { /* ignore */ }
      embeddedSsoServer = null;
    }
  };

  ipcMain.handle(RDK_PREPARE_SSO_EMBEDDED, async () => {
    stopEmbedded();
    const base = getSsoBaseUrl();
    const ssoCallbackServer = http.createServer();
    attachSsoCallbackServer(getMainWindow, ssoCallbackServer, () => {
      embeddedSsoServer = null;
    });
    embeddedSsoServer = ssoCallbackServer;

    return await new Promise((resolve) => {
      const tryListen = (port) => {
        ssoCallbackServer.listen(port, '127.0.0.1', () => {
          const callbackUrl = `http://127.0.0.1:${port}/callback`;
          const ssoUrl = `${base}/?redirectUrl=${encodeURIComponent(callbackUrl)}`;
          console.log('[sso-ipc] embedded', callbackUrl, '|', ssoUrl);
          resolve({ ok: true, ssoUrl });
        }).once('error', (err) => {
          if (err.code === 'EADDRINUSE' && port < SSO_CALLBACK_PORT_BASE + 10) {
            console.warn('[sso-ipc] port', port, 'in use');
            tryListen(port + 1);
          } else {
            console.error('[sso-ipc] listen failed:', err.message);
            embeddedSsoServer = null;
            try {
              ssoCallbackServer.close();
            } catch (_) { /* ignore */ }
            resolve({ ok: false, error: err.message || 'listen failed' });
          }
        });
      };
      tryListen(SSO_CALLBACK_PORT_BASE);
    });
  });

  ipcMain.handle(RDK_STOP_SSO_EMBEDDED, () => {
    stopEmbedded();
    return { ok: true };
  });

  ipcMain.handle(RDK_OPEN_SSO_LOGIN, () => {
    stopEmbedded();
    const base = getSsoBaseUrl();
    const parent = getMainWindow();
    const loginWin = new BrowserWindow({
      width: 900,
      height: 700,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      modal: false,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const ssoCallbackServer = http.createServer();
    attachSsoCallbackServer(getMainWindow, ssoCallbackServer, () => {
      setTimeout(() => {
        try {
          if (!loginWin.isDestroyed()) loginWin.close();
        } catch (_) { /* ignore */ }
      }, 300);
    });

    const tryListen = (port) => {
      ssoCallbackServer.listen(port, '127.0.0.1', () => {
        const callbackUrl = `http://127.0.0.1:${port}/callback`;
        const ssoUrl = `${base}/?redirectUrl=${encodeURIComponent(callbackUrl)}`;
        console.log('[sso-ipc] popup', callbackUrl);
        loginWin.loadURL(ssoUrl).catch((e) => console.error('[sso-ipc] loadURL', e));
        loginWin.show();
      }).once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port < SSO_CALLBACK_PORT_BASE + 10) {
          tryListen(port + 1);
        } else {
          console.error('[sso-ipc] popup listen failed:', err.message);
          if (!loginWin.isDestroyed()) loginWin.close();
        }
      });
    };
    tryListen(SSO_CALLBACK_PORT_BASE);

    loginWin.on('closed', () => {
      try {
        ssoCallbackServer.close();
      } catch (_) { /* ignore */ }
    });
  });

  return { stopEmbedded };
}
