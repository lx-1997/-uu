import { useRef, useEffect, useState, useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';
import { useI18n } from '../i18n/use-i18n';
import { fillTemplate } from '../i18n/en-extras';
import { getRememberedDevicePassword } from '../api';
import { resolveSocketUrl, socketIoClientOptions } from '../utils/socket';
import { isDesktopMac } from '../utils/env';
import {
  canUseWebSerial,
  formatSerialPortLabel,
  getSerialConnectBlockedReason,
  openSerialPortWithOptions,
  requestAndOpenSerialPort,
  requestSerialPortGrant,
  RDK_DEFAULT_SERIAL_BAUD,
  RDK_OPEN_USB_SERIAL_EVENT,
  SERIAL_BAUD_OPTIONS,
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
  /** 当前页已授权的本地串口（navigator.serial.getPorts），下拉即选设备 */
  const [usbPorts, setUsbPorts] = useState<SerialPort[]>([]);
  const [usbPortIndex, setUsbPortIndex] = useState(-1);
  const [usbSerialConnecting, setUsbSerialConnecting] = useState(false);
  const usbSerialConnectLockRef = useRef(false);

  const refreshUsbPorts = useCallback(async () => {
    if (!canUseWebSerial()) return;
    try {
      const list = await navigator.serial.getPorts();
      setUsbPorts(list);
      setUsbPortIndex((prev) => {
        if (prev >= 0 && prev < list.length) return prev;
        return list.length === 1 ? 0 : -1;
      });
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    if (!canUseWebSerial()) return;
    void refreshUsbPorts();
    const serial = navigator.serial as unknown as EventTarget;
    const onChange = () => {
      void refreshUsbPorts();
    };
    serial.addEventListener('connect', onChange);
    serial.addEventListener('disconnect', onChange);
    return () => {
      serial.removeEventListener('connect', onChange);
      serial.removeEventListener('disconnect', onChange);
    };
  }, [refreshUsbPorts]);

  const addUsbPortFromPicker = useCallback(async () => {
    const blocked = getSerialConnectBlockedReason(isEn);
    if (blocked) {
      addToast(blocked, 'warning');
      return;
    }
    try {
      const granted = await requestSerialPortGrant('all');
      const list = await navigator.serial.getPorts();
      setUsbPorts(list);
      const idx = list.indexOf(granted);
      setUsbPortIndex(idx >= 0 ? idx : list.length ? list.length - 1 : -1);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return;
      const msg = e instanceof Error ? e.message : String(e);
      addToast(fillTemplate(t('terminal.serial.openFail', '无法打开串口：{{msg}}'), { msg }), 'error');
    }
  }, [addToast, isEn, t]);

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
      let port: SerialPort;
      if (usbPortIndex >= 0 && usbPorts[usbPortIndex]) {
        port = usbPorts[usbPortIndex];
        await openSerialPortWithOptions(port, usbBaudRate);
      } else {
        port = await requestAndOpenSerialPort(usbBaudRate, 'all');
        await refreshUsbPorts();
      }
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
  }, [
    addToast,
    appendTerminalSession,
    currentDevice,
    isEn,
    refreshUsbPorts,
    replaceTerminalSessions,
    setActiveTab,
    t,
    usbBaudRate,
    usbPortIndex,
    usbPorts,
  ]);

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

  /** 下拉 = 本页已授权串口（getPorts）；「添加」= requestPort；未选时「连接」打开系统选择器 */
  const renderUsbSerialControls = (variant: 'welcome' | 'bar') => (
    <div
      className={
        variant === 'welcome'
          ? 'immersive-serial-bar immersive-serial-bar--welcome'
          : 'immersive-serial-bar'
      }
    >
      <div className="immersive-serial-bar-main">
        <span className="immersive-serial-bar-label">{t('terminal.serial.sectionLabel', 'USB 串口')}</span>
        <select
          className="select immersive-serial-port-select"
          value={usbPortIndex < 0 ? '' : String(usbPortIndex)}
          onChange={(e) => {
            const v = e.target.value;
            setUsbPortIndex(v === '' ? -1 : Number.parseInt(v, 10));
          }}
          title={t(
            'terminal.serial.portSelectTitle',
            'RDK Studio：已授权的 USB 串口；列表为空时请点「添加」在系统对话框中选择设备。',
          )}
          disabled={usbSerialConnecting}
        >
          <option value="">{t('terminal.serial.portPlaceholder', '请选择串口…')}</option>
          {usbPorts.map((p, i) => (
            <option key={`${i}-${formatSerialPortLabel(p, i)}`} value={String(i)}>
              {formatSerialPortLabel(p, i)}
            </option>
          ))}
        </select>
        <select
          className="select immersive-serial-baud-select"
          value={usbBaudRate}
          onChange={(e) => setUsbBaudRate(Number(e.target.value))}
          title={t('terminal.serial.baudTitle', '波特率（RDK 调试口默认 115200）')}
          disabled={usbSerialConnecting}
        >
          {SERIAL_BAUD_OPTIONS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void refreshUsbPorts()}
          title={t('terminal.serial.refreshPorts', '刷新串口列表')}
          disabled={usbSerialConnecting}
        >
          {t('terminal.serial.refreshPorts', '刷新')}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void addUsbPortFromPicker()}
          title={t('terminal.serial.addPortTitle', '在系统对话框中选择并授权串口')}
          disabled={usbSerialConnecting}
        >
          {t('terminal.serial.addPort', '添加')}
        </button>
      </div>
      <div className="immersive-serial-bar-connect">
        <button
          type="button"
          className="btn btn-primary btn-sm immersive-serial-connect-btn"
          onClick={() => void connectUsbSerial()}
          disabled={usbSerialConnecting}
        >
          {usbSerialConnecting
            ? t('terminal.serial.connecting', '正在打开串口…')
            : t('terminal.serial.connectBtn', '连接')}
        </button>
      </div>
    </div>
  );

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
            <h2 className="immersive-welcome-title">{t('terminal.ui.remoteTitle', 'RDK Studio 终端')}</h2>
            <p className="immersive-welcome-desc">
              {isDesktopMac()
                ? t('terminal.ui.remoteDescMac', '在左下角连接 RDK 设备后可使用网络 SSH。')
                : t('terminal.ui.remoteDesc', '在左下角连接 RDK 设备后可使用网络 SSH；亦可在下方使用本机 USB 串口调试。')}
            </p>
            {canUseWebSerial() ? (
              <div className="terminal-serial-welcome">
                <p className="terminal-serial-welcome-lead">
                  {t('terminal.serial.rdkStudioLead', '选择串口与波特率后点「连接」；列表为空时请先点「添加」。默认 115200 8N1。')}
                </p>
                {renderUsbSerialControls('welcome')}
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

  const barMeta = currentDevice?.name ?? t('terminal.ui.serialOnlyMeta', 'RDK Studio · USB 串口');

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

      {canUseWebSerial() && renderUsbSerialControls('bar')}

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
