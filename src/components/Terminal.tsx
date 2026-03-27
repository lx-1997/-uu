import { useRef, useEffect, useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { useI18n } from '../i18n/use-i18n';
import { getRememberedDevicePassword } from '../api';
import { resolveSocketUrl, socketIoClientOptions } from '../utils/socket';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import io from 'socket.io-client';
import '@xterm/xterm/css/xterm.css';

interface TermData {
  term: XTerm;
  socket: ReturnType<typeof io>;
  fitAddon: FitAddon;
  el: HTMLDivElement;
}

function spawnTerm(
  host: HTMLDivElement,
  deviceId: string | undefined,
  password: string | undefined,
): TermData {
  const el = document.createElement('div');
  el.style.cssText = 'width:100%;height:100%';
  host.appendChild(el);

  const term = new XTerm({
    fontFamily: "'JetBrains Mono', 'Menlo', 'Consolas', monospace",
    fontSize: 14,
    theme: { background: '#1e1e1e', foreground: '#f8fafc', cursor: '#f8fafc' },
    cursorBlink: true,
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(el);
  requestAnimationFrame(() => { try { fitAddon.fit(); } catch { /* noop */ } });

  const socket = io(resolveSocketUrl(), socketIoClientOptions);
  socket.on('connect', () => {
    term.clear();
    term.writeln('\x1b[32m[Connected to RDK Server, initializing PTY...]\x1b[0m');
    socket.emit('init', {
      deviceId,
      password: password || undefined,
      cols: term.cols,
      rows: term.rows,
    });
  });
  socket.on('data', (data: string) => term.write(data));
  socket.on('disconnect', () => term.writeln('\x1b[31m\r\n[Disconnected from server]\x1b[0m'));
  term.onData((data) => socket.emit('data', data));

  return { term, socket, fitAddon, el };
}

function killTerm(d: TermData) {
  try {
    d.socket.removeAllListeners();
    if (d.socket.connected) {
      d.socket.disconnect();
    } else {
      // 握手未完成时走 Manager.close，减少 “WebSocket is closed before established” 控制台噪音
      const mgr = (d.socket as unknown as { io?: { close?: () => void } }).io;
      if (typeof mgr?.close === 'function') mgr.close();
      else d.socket.disconnect();
    }
  } catch {
    try {
      d.socket.disconnect();
    } catch {
      /* noop */
    }
  }
  try {
    d.term.dispose();
  } catch {
    /* noop */
  }
  try {
    d.el.remove();
  } catch {
    /* noop */
  }
}

export default function Terminal() {
  const {
    currentDevice,
    terminalSessions, activeSessionId, setActiveSessionId,
    createSession, removeSession, addToast,
  } = useAppState();
  const { t } = useI18n();

  const hostRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef(new Map<string, TermData>());
  const deviceIdRef = useRef<string | undefined>(undefined);
  const passwordRef = useRef('');
  const [terminalPassword, setTerminalPassword] = useState('');
  const [terminalContextMenu, setTerminalContextMenu] = useState<{ x: number; y: number } | null>(null);

  // ── resolve device password ──
  useEffect(() => {
    if (!currentDevice) { setTerminalPassword(''); return; }
    const remembered = getRememberedDevicePassword(currentDevice.id);
    if (remembered) { setTerminalPassword(remembered); return; }
    const lower = currentDevice.name.toLowerCase();
    if (lower.includes('sunrise@')) { setTerminalPassword('sunrise'); return; }
    if (lower.includes('root@')) { setTerminalPassword('root'); return; }
    setTerminalPassword('');
  }, [currentDevice?.id]);

  // ── stable session-ID list for dependency comparison ──
  const sessionIds = terminalSessions.map(s => s.id).join(',');

  // ── core sync: create / destroy / show / hide ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const pool = poolRef.current;

    const deviceChanged =
      currentDevice?.id !== deviceIdRef.current ||
      terminalPassword !== passwordRef.current;
    deviceIdRef.current = currentDevice?.id;
    passwordRef.current = terminalPassword;

    if (deviceChanged) {
      for (const d of pool.values()) killTerm(d);
      pool.clear();
    }

    const validIds = new Set(terminalSessions.map(s => s.id));

    for (const session of terminalSessions) {
      if (!pool.has(session.id)) {
        const d = spawnTerm(host, currentDevice?.id, terminalPassword);
        pool.set(session.id, d);
      }
    }

    for (const [id, d] of pool) {
      if (!validIds.has(id)) { killTerm(d); pool.delete(id); }
    }

    for (const [id, d] of pool) {
      if (id === activeSessionId) {
        d.el.style.display = '';
        requestAnimationFrame(() => {
          try { d.fitAddon.fit(); d.term.focus(); } catch { /* noop */ }
        });
      } else {
        d.el.style.display = 'none';
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIds, activeSessionId, currentDevice?.id, terminalPassword]);

  // ── unmount cleanup ──
  useEffect(() => () => {
    for (const d of poolRef.current.values()) killTerm(d);
    poolRef.current.clear();
  }, []);

  // ── resize observer (active session only) ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      const d = poolRef.current.get(activeSessionId);
      if (d) {
        try {
          d.fitAddon.fit();
          d.socket.emit('resize', { cols: d.term.cols, rows: d.term.rows });
        } catch { /* noop */ }
      }
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [activeSessionId]);

  // ── global xterm-send event → active session ──
  useEffect(() => {
    const handler = (e: any) => {
      const d = poolRef.current.get(activeSessionId);
      if (typeof e.detail === 'string' && d) d.socket.emit('data', e.detail + '\n');
    };
    window.addEventListener('xterm-send', handler);
    return () => window.removeEventListener('xterm-send', handler);
  }, [activeSessionId]);

  useEffect(() => {
    if (!terminalContextMenu) return;
    const close = () => setTerminalContextMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTerminalContextMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [terminalContextMenu]);

  // ── actions ──
  const handleClear = () => poolRef.current.get(activeSessionId)?.term.clear();

  const copySelection = () => {
    const d = poolRef.current.get(activeSessionId);
    if (d?.term.hasSelection()) {
      document.execCommand('copy');
      addToast(t('terminal.ui.copyOk', '已复制选择的终端内容'), 'success');
    } else {
      addToast(t('terminal.ui.copyNeedSelect', '请在终端中用鼠标选择内容后重试'), 'warning');
    }
  };

  const pasteClipboard = async () => {
    const d = poolRef.current.get(activeSessionId);
    if (!d) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) d.socket.emit('data', text);
    } catch {
      addToast(t('terminal.ui.pasteFail', '无法读取剪贴板，请使用系统快捷键粘贴'), 'warning');
    }
  };

  const selectAllTerminal = () => {
    const d = poolRef.current.get(activeSessionId);
    if (!d) return;
    d.term.selectAll();
    addToast(t('terminal.ui.selectAllOk', '已全选当前终端内容'), 'info');
  };

  const handleCloseSession = (id: string) => {
    const d = poolRef.current.get(id);
    if (d) { killTerm(d); poolRef.current.delete(id); }
    removeSession(id);
  };

  if (!currentDevice) {
    return (
      <div className="immersive">
        <div className="immersive-bar">
          <div className="immersive-bar-left"><span className="immersive-bar-title">{t('terminal.ui.title', '终端')}</span></div>
        </div>
        <div className="immersive-viewport">
          <div className="immersive-welcome">
            <div className="immersive-welcome-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3" /><rect x="2.25" y="4.5" width="19.5" height="15" rx="2.25" />
              </svg>
            </div>
            <h2 className="immersive-welcome-title">{t('terminal.ui.remoteTitle', '远程终端')}</h2>
            <p className="immersive-welcome-desc">{t('terminal.ui.remoteDesc', '请先在左下角连接一台 RDK 设备，即可打开 SSH 终端会话。')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="immersive">
      <div className="immersive-bar">
        <div className="immersive-bar-left">
          <div className="immersive-tabs">
            {terminalSessions.map(session => (
              <button
                key={session.id}
                className={`immersive-tab${activeSessionId === session.id ? ' active' : ''}`}
                onClick={() => setActiveSessionId(session.id)}
              >
                {session.name}
                {terminalSessions.length > 1 && (
                  <span
                    className="immersive-tab-close"
                    onClick={(e) => { e.stopPropagation(); handleCloseSession(session.id); }}
                  >
                    ×
                  </span>
                )}
              </button>
            ))}
            <button className="immersive-tab immersive-tab-add" onClick={createSession} title={t('terminal.ui.newTab', '新建会话')}>+</button>
          </div>
        </div>
        <div className="immersive-bar-center">
          <span className="immersive-bar-meta">{currentDevice.name}</span>
        </div>
        <div className="immersive-bar-right">
          <button className="btn-icon" title={t('terminal.ui.copyTitle', '复制选中')} onClick={copySelection}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          </button>
          <button className="btn-icon" title={t('terminal.ui.clearTitle', '清屏')} onClick={handleClear}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
          </button>
        </div>
      </div>

      <div
        className="immersive-viewport"
        ref={hostRef}
        style={{ padding: 0, overflow: 'hidden' }}
        onContextMenu={(e) => {
          e.preventDefault();
          setTerminalContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {terminalContextMenu && (
          <div
            className="immersive-context-menu"
            style={{ left: terminalContextMenu.x, top: terminalContextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" onClick={() => { copySelection(); setTerminalContextMenu(null); }}>{t('terminal.ui.ctx.copy', '复制')}</button>
            <button type="button" onClick={() => { void pasteClipboard(); setTerminalContextMenu(null); }}>{t('terminal.ui.ctx.paste', '粘贴')}</button>
            <button type="button" onClick={() => { selectAllTerminal(); setTerminalContextMenu(null); }}>{t('terminal.ui.ctx.selectAll', '全选')}</button>
            <button type="button" onClick={() => { handleClear(); setTerminalContextMenu(null); }}>{t('terminal.ui.ctx.clear', '清屏')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
