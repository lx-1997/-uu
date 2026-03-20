import React, { createContext, useContext, useState } from 'react';
import type { TerminalSession } from '../app-types';
import { TERMINAL_PROFILES } from '../constants';
import { executeDeviceCommand, rememberDevicePassword } from '../api';
import { useToastStore } from './useToastStore';
import { useDeviceStore } from './useDeviceStore';
import { useUIStore } from './useUIStore';

export interface TerminalStoreState {
  terminalProfile: string;
  setTerminalProfile: (v: string) => void;
  terminalDraft: string;
  setTerminalDraft: (v: string) => void;
  terminalSessions: TerminalSession[];
  activeSessionId: string;
  setActiveSessionId: (v: string) => void;
  currentSession: TerminalSession;
  createSession: () => void;
  removeSession: (id: string) => void;
  runTerminalCommand: (cmd: string, password?: string) => void;
  runTerminalAIAnalysis: () => void;
}

const TerminalContext = createContext<TerminalStoreState | null>(null);

export function useTerminalStore(): TerminalStoreState {
  const ctx = useContext(TerminalContext);
  if (!ctx) throw new Error('useTerminalStore must be used within TerminalProvider');
  return ctx;
}

export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const { addToast, addActivity } = useToastStore();
  const { currentDevice, setShowAddDevice } = useDeviceStore();
  const { activeTab } = useUIStore();

  const [terminalProfile, setTerminalProfile] = useState('shell');
  const [terminalDraft, setTerminalDraft] = useState('');
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([
    { id: 'session-1', name: '主会话', profile: 'shell', status: 'attached', lines: ['Welcome to RDK OS.', 'root@rdk:~#'] },
  ]);
  const [activeSessionId, setActiveSessionId] = useState('session-1');
  const currentSession = terminalSessions.find((s) => s.id === activeSessionId) ?? terminalSessions[0];

  const createSession = () => {
    const nextId = `session-${Date.now()}`;
    const profileLabel = TERMINAL_PROFILES.find((p) => p.id === terminalProfile)?.label ?? '系统 Shell';
    setTerminalSessions((prev) => [...prev, { id: nextId, name: `${profileLabel} ${prev.length + 1}`, profile: terminalProfile, status: 'warm', lines: [] }]);
    setActiveSessionId(nextId);
    addToast(`终端会话 "${profileLabel}" 已创建`, 'success');
    addActivity(`创建终端会话: ${profileLabel}`);
  };

  const removeSession = (id: string) => {
    setTerminalSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) return prev;
      if (activeSessionId === id) {
        setActiveSessionId(next[next.length - 1].id);
      }
      return next;
    });
  };

  const runTerminalCommand = (commandText: string, password?: string) => {
    if (!commandText.trim()) return;
    if (!currentDevice) {
      addToast('请先连接真实设备', 'warning');
      return;
    }

    const nlPatterns: Array<{ match: RegExp; cmd: string }> = [
      { match: /查看.*话题|列出.*topic/i, cmd: 'ros2 topic list' },
      { match: /温度|发热|散热/i, cmd: 'cat /sys/class/thermal/thermal_zone0/temp' },
      { match: /内存|内存使用/i, cmd: 'free -h' },
      { match: /磁盘|存储空间/i, cmd: 'df -h' },
      { match: /进程|正在运行/i, cmd: 'top -bn1 | head -20' },
      { match: /日志|系统日志/i, cmd: 'tail -f /var/log/syslog' },
      { match: /网络|ip地址|ip 地址/i, cmd: 'ip addr show' },
      { match: /bpu|推理|加速器/i, cmd: 'hrut_smi' },
    ];
    const isNL = /[\u4e00-\u9fff]/.test(commandText) && !commandText.startsWith('/') && !commandText.includes('--');
    const nlHit = isNL ? nlPatterns.find((p) => p.match.test(commandText)) : null;
    const actualCommand = nlHit?.cmd ?? commandText;

    if (activeTab === 'terminal') {
      window.dispatchEvent(new CustomEvent('xterm-send', { detail: actualCommand }));
      return;
    }

    if (actualCommand.trim() === 'clear') {
      setTerminalSessions((prev) => prev.map((s) => s.id === activeSessionId
        ? { ...s, status: 'attached', lines: [] }
        : s));
      setTerminalDraft('');
      return;
    }

    const prepend = nlHit ? [`✨ AI 翻译: "${commandText}" → ${actualCommand}`] : [];
    setTerminalSessions((prev) => prev.map((s) => s.id === activeSessionId
      ? { ...s, status: 'running', lines: [...s.lines, ...prepend, `root@rdk:~# ${actualCommand}`] }
      : s));

    executeDeviceCommand(currentDevice.id, actualCommand, password)
      .then((result) => {
        if (password?.trim()) {
          rememberDevicePassword(currentDevice.id, password.trim());
        }
        const outputLines = result.output
          .split(/\r?\n/)
          .map((line) => line.trimEnd())
          .filter((line) => line.length > 0);
        setTerminalSessions((prev) => prev.map((s) => s.id === activeSessionId
          ? { ...s, status: 'attached', lines: [...s.lines, ...(outputLines.length ? outputLines : ['[无输出]']), 'root@rdk:~#'] }
          : s));
      })
      .catch((error) => {
        const rawMessage = error instanceof Error ? error.message : '命令执行失败';
        const message = /设备密码缺失|缺少 SSH 密码|Authentication failure/i.test(rawMessage)
          ? '设备认证失败，请在设备管理中重新连接并更新账号密码'
          : rawMessage;
        setTerminalSessions((prev) => prev.map((s) => s.id === activeSessionId
          ? { ...s, status: 'attached', lines: [...s.lines, `ERROR: ${message}`, 'root@rdk:~#'] }
          : s));
        addToast(message, 'error');
        if (/设备认证失败/.test(message)) {
          setShowAddDevice(true);
        }
      });

    setTerminalDraft('');
  };

  const runTerminalAIAnalysis = () => {
    const lastLines = currentSession.lines.slice(-8).filter((l) => !l.startsWith('root@') && !l.startsWith('🤖'));
    const hasError = lastLines.some((l) => /error|fail|denied|not found/i.test(l));
    const analysis = hasError
      ? ['🔍 检测到异常输出，可能原因:', '   • 权限不足（sudo）', '   • 依赖缺失（安装对应软件包）', '   • 路径或命令拼写错误', '💡 建议: 根据上方真实报错逐条排查']
      : ['🔍 终端输出分析:', `   • 共 ${currentSession.lines.length} 行历史输出`, '   • 当前片段未检测到明显错误关键字', '   • 如需精确结论，请继续执行诊断命令（如 hrut_smi/free -h/df -h）'];
    const allLines = ['🤖 ─── AI 分析 ───', ...analysis, '────────────', 'root@rdk:~#'];
    setTerminalSessions((prev) => prev.map((s) => s.id === activeSessionId ? { ...s, lines: [...s.lines, '🤖 ─── AI 分析中... ───'] } : s));
    allLines.forEach((line, i) => {
      setTimeout(() => {
        setTerminalSessions((prev) => prev.map((s) => s.id === activeSessionId ? { ...s, lines: i === 0 ? [...s.lines.slice(0, -1), line] : [...s.lines, line] } : s));
      }, (i + 1) * 200);
    });
    setTimeout(() => addToast('AI 分析完成', 'success'), allLines.length * 200 + 100);
  };

  const value: TerminalStoreState = {
    terminalProfile, setTerminalProfile, terminalDraft, setTerminalDraft,
    terminalSessions, activeSessionId, setActiveSessionId, currentSession,
    createSession, removeSession, runTerminalCommand, runTerminalAIAnalysis,
  };

  return React.createElement(TerminalContext.Provider, { value }, children);
}
