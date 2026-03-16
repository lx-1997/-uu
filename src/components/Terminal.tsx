import { useRef, useEffect, useState } from 'react';
import { useAppState } from '../hooks/useAppState';
import { getRememberedDevicePassword } from '../api';
import { TERMINAL_PROFILES, COMMAND_SUGGESTIONS } from '../constants';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import io from 'socket.io-client';
import '@xterm/xterm/css/xterm.css';

export default function Terminal() {
  const {
    currentDevice,
    terminalProfile, setTerminalProfile,
    terminalSessions, activeSessionId, setActiveSessionId,
    createSession, addToast,
  } = useAppState();

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const socketRef = useRef<any>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [terminalPassword, setTerminalPassword] = useState('');
  
  useEffect(() => {
    if (!currentDevice) {
      setTerminalPassword('');
      return;
    }
    const remembered = getRememberedDevicePassword(currentDevice.id);
    if (remembered) {
      setTerminalPassword(remembered);
      return;
    }
    const usernameLower = currentDevice.name.toLowerCase();
    if (usernameLower.includes('sunrise@')) {
      setTerminalPassword('sunrise');
      return;
    }
    if (usernameLower.includes('root@')) {
      setTerminalPassword('root');
      return;
    }
    setTerminalPassword('');
  }, [currentDevice?.id]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      fontFamily: "'JetBrains Mono', 'Menlo', 'Consolas', monospace",
      fontSize: 14,
      theme: {
        background: '#1e1e1e',
        foreground: '#f8fafc',
        cursor: '#f8fafc',
      },
      cursorBlink: true,
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    let socketUrl = window.location.origin;
    if ((import.meta as any).env?.DEV) {
      socketUrl = 'http://localhost:8787';
    }

    const socket = io(socketUrl);
    socketRef.current = socket;

    socket.on('connect', () => {
      term.clear();
      term.writeln('\x1b[32m[Connected to RDK Server, initializing PTY...]\x1b[0m');
      socket.emit('init', {
        deviceId: currentDevice?.id,
        password: terminalPassword || undefined,
        cols: term.cols,
        rows: term.rows
      });
    });

    socket.on('data', (data: string) => {
      term.write(data);
    });

    socket.on('disconnect', () => {
      term.writeln('\x1b[31m\r\n[Disconnected from server]\x1b[0m');
    });

    term.onData((data) => {
      socket.emit('data', data);
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        socket.emit('resize', { cols: term.cols, rows: term.rows });
      } catch (e) {
        // ignore
      }
    });
    resizeObserver.observe(terminalRef.current);

    const handleGlobalSend = (e: any) => {
      const cmd = e.detail;
      if (typeof cmd === 'string' && socketRef.current) {
        socketRef.current.emit('data', cmd + '\n');
      }
    };
    window.addEventListener('xterm-send', handleGlobalSend);

    return () => {
      window.removeEventListener('xterm-send', handleGlobalSend);
      resizeObserver.disconnect();
      socket.disconnect();
      term.dispose();
    };
  }, [currentDevice?.id, terminalPassword]);

  const handleClear = () => {
    xtermRef.current?.clear();
  };

  const copyAllOutput = () => {
    // Basic structural copy for xterm
    if (xtermRef.current && xtermRef.current.hasSelection()) {
      document.execCommand('copy');
      addToast('已复制选择的终端内容', 'success');
    } else {
      addToast('请在终端中用鼠标选择内容后重试哦', 'warning');
    }
  };

  return (
    <div className="uterm">
      {/* Title bar */}
      <div className="uterm-titlebar">
        <div className="uterm-titlebar-left">
          <div className="uterm-dots">
            <span className="uterm-dot red" />
            <span className="uterm-dot yellow" />
            <span className="uterm-dot green" />
          </div>
          <div className="uterm-session-tabs">
            {terminalSessions.map(session => (
              <button key={session.id}
                className={`uterm-stab ${activeSessionId === session.id ? 'active' : ''}`}
                onClick={() => setActiveSessionId(session.id)}>
                {session.name}
              </button>
            ))}
            <button className="uterm-stab uterm-stab-add" onClick={createSession} title="新建会话">+</button>
          </div>
        </div>
        <div className="uterm-titlebar-center">
          <span className="uterm-title-text">{currentDevice ? currentDevice.name : '终端'}</span>
        </div>
        <div className="uterm-titlebar-right">
          <button className="uterm-icon-btn" title="复制全部" onClick={copyAllOutput}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
          <button className="uterm-icon-btn" title="清屏" onClick={handleClear}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>

      {/* Terminal body — native black/white style */}
      <div className="uterm-body" style={{ padding: 0, overflow: 'hidden' }}>
        <div ref={terminalRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
}
