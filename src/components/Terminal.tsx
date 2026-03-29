import { useRef, useEffect, useState, useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';
import { useI18n } from '../i18n/use-i18n';
import { fillTemplate } from '../i18n/en-extras';
import { getRememberedDevicePassword } from '../api';
import { resolveSocketUrl, socketIoClientOptions } from '../utils/socket';
import {
  canUseWebSerial,
  getSerialConnectBlockedReason,
  getSerialDriverHint,
  requestAndOpenSerialPort,
  RDK_DEFAULT_SERIAL_BAUD,
  RDK_DEVELOPER_RESOURCE_URL,
  RDK_OPEN_USB_SERIAL_EVENT,
  SERIAL_BAUD_OPTIONS,
  type SerialPortListMode,
} from '../utils/web-serial';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import io from 'socket.io-client';
import '@xterm/xterm/css/xterm.css';

interface TermDataSsh {
  kind: 'ssh';
  term: XTerm;
  socket: ReturnType<typeof io>;
  fitAddon: FitAddon;
  el: HTMLDivElement;
}

interface TermDataSerial {
  kind: 'serial';
  term: XTerm;
  fitAddon: FitAddon;
  el: HTMLDivElement;
  port: SerialPort;
  closeSerial: () => Promise<void>;
}

type TermData = TermDataSsh | TermDataSerial;

function spawnSshTerm(
  host: HTMLDivElement,
  deviceId: string | undefined,
  password: string | undefined,
): TermDataSsh {
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

  return { kind: 'ssh', term, socket, fitAddon, el };
}

function spawnSerialTerm(host: HTMLDivElement, port: SerialPort): TermDataSerial {
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

  term.writeln('\x1b[32m[USB Serial]\x1b[0m RDK 调试口默认 115200 8N1（可在工具栏切换波特率后重新连接）');
  term.writeln('');

  const readerRef: { current: ReadableStreamDefaultReader<Uint8Array> | null } = { current: null };
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const readLoop = async () => {
    if (!port.readable) return;
    const reader = port.readable.getReader();
    readerRef.current = reader;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.byteLength) {
          term.write(decoder.decode(value, { stream: true }));
        }
      }
    } catch {
      /* 端口关闭或 cancel */
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* noop */
      }
      readerRef.current = null;
    }
  };
  void readLoop();

  term.onData((data) => {
    if (!port.writable) return;
    const writer = port.writable.getWriter();
    writer.write(encoder.encode(data)).finally(() => writer.releaseLock());
  });

  const closeSerial = async () => {
    try {
      await readerRef.current?.cancel();
    } catch {
      /* noop */
    }
    try {
      await port.close();
    } catch {
      /* noop */
    }
  };

  return { kind: 'serial', term, fitAddon, el, port, closeSerial };
}

function killSshTerm(d: TermDataSsh) {
  try {
    d.socket.removeAllListeners();
    if (d.socket.connected) {
      d.socket.disconnect();
    } else {
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

async function killTermData(d: TermData) {
  if (d.kind === 'ssh') {
    killSshTerm(d);
  } else {
    await d.closeSerial();
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
}

export default function Terminal() {
  const {
    currentDevice,
    terminalSessions, activeSessionId, setActiveSessionId,
    createSession, removeSession, addToast,
    replaceTerminalSessions, appendTerminalSession,
    setActiveTab,
  } = useAppState();
  const { t, isEn } = useI18n();

  const hostRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef(new Map<string, TermData>());
  const deviceIdRef = useRef<string | undefined>(undefined);
  const passwordRef = useRef('');
  const pendingSerialPortsRef = useRef(new Map<string, SerialPort>());
  const [terminalPassword, setTerminalPassword] = useState('');
  const [terminalContextMenu, setTerminalContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [usbBaudRate, setUsbBaudRate] = useState(RDK_DEFAULT_SERIAL_BAUD);
  /** 与 ESP Web Flasher 等一致：默认列出全部串口，跨 Windows/macOS 最稳 */
  const [usbSerialListMode, setUsbSerialListMode] = useState<SerialPortListMode>('all');
  const [usbSerialConnecting, setUsbSerialConnecting] = useState(false);
  const usbSerialConnectLockRef = useRef(false);

  const hasSerialTab = terminalSessions.some((s) => s.transport === 'serial');
  const allowTerminalUi = Boolean(currentDevice) || hasSerialTab;

  const connectUsbSerial = useCallback(async () => {
    const blocked = getSerialConnectBlockedReason(isEn);
    if (blocked) {
      addToast(blocked, 'warning');
      return;
    }
    if (usbSerialConnectLockRef.current) return;
    usbSerialConnectLockRef.current = true;
    setUsbSerialConnecting(true);
    try {
      const port = await requestAndOpenSerialPort(usbBaudRate, usbSerialListMode);
      const id = `serial-${Date.now()}`;
      pendingSerialPortsRef.current.set(id, port);
      const name = t('terminal.session.serial', 'USB 串口');
      const session = {
        id,
        name,
        profile: 'serial',
        status: 'attached' as const,
        lines: [] as string[],
        transport: 'serial' as const,
        baudRate: usbBaudRate,
      };
      if (!currentDevice) {
        replaceTerminalSessions([session], id);
      } else {
        appendTerminalSession(session);
      }
      setActiveTab('terminal');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return;
      const msg = e instanceof Error ? e.message : String(e);
      addToast(fillTemplate(t('terminal.serial.openFail', '无法打开串口：{{msg}}'), { msg }), 'error');
    } finally {
      usbSerialConnectLockRef.current = false;
      setUsbSerialConnecting(false);
    }
  }, [addToast, appendTerminalSession, currentDevice, isEn, replaceTerminalSessions, setActiveTab, t, usbBaudRate, usbSerialListMode]);

  const connectUsbSerialRef = useRef(connectUsbSerial);
  connectUsbSerialRef.current = connectUsbSerial;
  useEffect(() => {
    const onOpenFromNav = () => void connectUsbSerialRef.current();
    window.addEventListener(RDK_OPEN_USB_SERIAL_EVENT, onOpenFromNav);
    return () => window.removeEventListener(RDK_OPEN_USB_SERIAL_EVENT, onOpenFromNav);
  }, []);

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

  const sessionIds = terminalSessions.map((s) => `${s.id}:${s.transport ?? 'ssh'}`).join(',');

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
      for (const [id, d] of [...pool.entries()]) {
        if (d.kind === 'ssh') {
          killSshTerm(d);
          pool.delete(id);
        }
      }
    }

    const validIds = new Set(terminalSessions.map((s) => s.id));

    for (const session of terminalSessions) {
      if (!pool.has(session.id)) {
        if (session.transport === 'serial') {
          const port = pendingSerialPortsRef.current.get(session.id);
          if (port) {
            pool.set(session.id, spawnSerialTerm(host, port));
            pendingSerialPortsRef.current.delete(session.id);
          }
        } else if (currentDevice) {
          pool.set(session.id, spawnSshTerm(host, currentDevice.id, terminalPassword));
        }
      }
    }

    void (async () => {
      for (const [id, d] of [...pool.entries()]) {
        if (!validIds.has(id)) {
          await killTermData(d);
          pool.delete(id);
        }
      }
    })();

    for (const [id, d] of pool) {
      if (id === activeSessionId) {
        d.el.style.display = '';
        requestAnimationFrame(() => {
          try {
            d.fitAddon.fit();
            d.term.focus();
          } catch {
            /* noop */
          }
        });
      } else {
        d.el.style.display = 'none';
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIds, activeSessionId, currentDevice?.id, terminalPassword]);

  // ── unmount cleanup ──
  useEffect(() => () => {
    void (async () => {
      for (const d of poolRef.current.values()) {
        await killTermData(d);
      }
      poolRef.current.clear();
    })();
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
          if (d.kind === 'ssh') {
            d.socket.emit('resize', { cols: d.term.cols, rows: d.term.rows });
          }
        } catch {
          /* noop */
        }
      }
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [activeSessionId]);

  // ── global xterm-send event → active session ──
  useEffect(() => {
    const handler = (e: Event) => {
      const d = poolRef.current.get(activeSessionId);
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail !== 'string' || !d) return;
      const line = `${detail}\n`;
      if (d.kind === 'ssh') {
        d.socket.emit('data', line);
      } else {
        const enc = new TextEncoder();
        if (d.port.writable) {
          const w = d.port.writable.getWriter();
          w.write(enc.encode(line)).finally(() => w.releaseLock());
        }
      }
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
      if (!text) return;
      if (d.kind === 'ssh') {
        d.socket.emit('data', text);
      } else {
        d.term.paste(text);
      }
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
    void (async () => {
      const d = poolRef.current.get(id);
      if (d) {
        await killTermData(d);
        poolRef.current.delete(id);
      }
      removeSession(id);
    })();
  };

  if (!allowTerminalUi) {
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
            {canUseWebSerial() ? (
              <div className="terminal-serial-welcome" style={{ marginTop: 20, maxWidth: 420, textAlign: 'left' as const }}>
                <p className="immersive-welcome-desc" style={{ marginBottom: 12 }}>
                  {t('terminal.serial.hint', '或使用 USB 调试串口（Chrome / Edge，本地直连，无需设备 IP）：')}
                </p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const }}>
                  <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('terminal.serial.baudLabel', '波特率')}</label>
                  <select
                    className="select"
                    value={usbBaudRate}
                    onChange={(e) => setUsbBaudRate(Number(e.target.value))}
                  >
                    {SERIAL_BAUD_OPTIONS.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                  <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('terminal.serial.listModeLabel', '串口列表')}</label>
                  <select
                    className="select"
                    title={t('terminal.serial.listModeTitle', '「全部」与常见 Web 烧录工具一致，兼容 Windows/macOS 各类 COM/cu 口；若列表过长可改为仅常见 USB 芯片。')}
                    value={usbSerialListMode}
                    onChange={(e) => setUsbSerialListMode(e.target.value as SerialPortListMode)}
                  >
                    <option value="all">{t('terminal.serial.listModeAll', '全部（推荐）')}</option>
                    <option value="common">{t('terminal.serial.listModeCommon', '仅常见 USB 转串口')}</option>
                  </select>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={usbSerialConnecting}
                    onClick={() => void connectUsbSerial()}
                  >
                    {usbSerialConnecting
                      ? t('terminal.serial.connecting', '正在打开串口…')
                      : t('terminal.serial.connectBtn', '连接 USB 串口')}
                  </button>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
                  {t('terminal.serial.rdkNote', 'RDK 官方调试口默认 115200 8N1，无流控。')}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  {getSerialDriverHint(isEn)}{' '}
                  <a
                    href={RDK_DEVELOPER_RESOURCE_URL}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent)' }}
                  >
                    {t('terminal.serial.driverResourceLink', '驱动下载：地瓜资源中心')}
                  </a>
                </p>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 16 }}>
                {getSerialConnectBlockedReason(isEn) ?? ''}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const barMeta = currentDevice?.name ?? t('terminal.ui.serialOnlyMeta', 'USB 串口（本地）');

  return (
    <div className="immersive">
      <div className="immersive-bar">
        <div className="immersive-bar-left">
          <div className="immersive-tabs">
            {terminalSessions.map((session) => (
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
            <button
              className="immersive-tab immersive-tab-add"
              onClick={createSession}
              title={t('terminal.ui.newTab', '新建会话')}
            >
              +
            </button>
            {canUseWebSerial() && (
              <>
                <select
                  className="select"
                  style={{ marginLeft: 6, maxWidth: 110, fontSize: 12, height: 28 }}
                  value={usbBaudRate}
                  onChange={(e) => setUsbBaudRate(Number(e.target.value))}
                  title={t('terminal.serial.baudTitle', '新 USB 串口会话的波特率（RDK 默认 115200）')}
                >
                  {SERIAL_BAUD_OPTIONS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <select
                  className="select"
                  style={{ maxWidth: 130, fontSize: 12, height: 28 }}
                  value={usbSerialListMode}
                  onChange={(e) => setUsbSerialListMode(e.target.value as SerialPortListMode)}
                  title={t('terminal.serial.listModeTitle', '「全部」与常见 Web 烧录工具一致，兼容 Windows/macOS 各类 COM/cu 口；若列表过长可改为仅常见 USB 芯片。')}
                >
                  <option value="all">{t('terminal.serial.listShortAll', '全部')}</option>
                  <option value="common">{t('terminal.serial.listShortCommon', '常见 USB')}</option>
                </select>
                <button
                  type="button"
                  className="immersive-tab immersive-tab-add"
                  style={{ minWidth: 'auto', padding: '0 10px' }}
                  disabled={usbSerialConnecting}
                  onClick={() => void connectUsbSerial()}
                  title={
                    usbSerialConnecting
                      ? t('terminal.serial.connecting', '正在打开串口…')
                      : t('terminal.serial.connectTitle', '新建 USB 串口会话')
                  }
                >
                  {usbSerialConnecting ? '…' : 'USB'}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="immersive-bar-center">
          <span className="immersive-bar-meta">{barMeta}</span>
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
