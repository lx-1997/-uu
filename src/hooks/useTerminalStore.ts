import React, { createContext, useContext, useCallback, useMemo, useState } from 'react';
import type { TerminalSession } from '../app-types';
import { getTerminalProfileLabel } from '../constants';
import { fillTemplate } from '../i18n/en-extras';
import { translate } from '../i18n/translate';
import { executeDeviceCommand, rememberDevicePassword } from '../api';
import { useToastStore } from './useToastStore';
import { useDeviceStore } from './useDeviceStore';
import { useUIStore } from './useUIStore';
import { readStoredLocale } from '../utils/locale';

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
  /** 替换全部终端标签（如无网络设备时仅保留 USB 串口） */
  replaceTerminalSessions: (sessions: TerminalSession[], activeId: string) => void;
  /** 追加标签（已有设备时再开 USB 串口） */
  appendTerminalSession: (session: TerminalSession) => void;
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
  const { activeTab, language } = useUIStore();
  const isEn = language === 'en';
  const t = (key: string, zh: string) => translate(isEn, key, zh);
  const tf = (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars);

  const [terminalProfile, setTerminalProfile] = useState('shell');
  const [terminalDraft, setTerminalDraft] = useState('');
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>(() => [
    {
      id: 'session-1',
      name: translate(readStoredLocale() === 'en', 'terminal.session.main', '主会话'),
      profile: 'shell',
      status: 'attached',
      lines: ['Welcome to RDK OS.', 'root@rdk:~#'],
      transport: 'ssh',
    },
  ]);
  const [activeSessionId, setActiveSessionId] = useState('session-1');
  const currentSession = terminalSessions.find((s) => s.id === activeSessionId) ?? terminalSessions[0];

  const createSession = useCallback(() => {
    if (!currentDevice) {
      addToast(t('terminal.needDeviceForSshTab', 'SSH 会话需先在左下角连接设备'), 'warning');
      return;
    }
    const nextId = `session-${Date.now()}`;
    const profileLabel = getTerminalProfileLabel(terminalProfile, isEn);
    setTerminalSessions((prev) => [...prev, {
      id: nextId,
      name: `${profileLabel} ${prev.length + 1}`,
      profile: terminalProfile,
      status: 'warm',
      lines: [],
      transport: 'ssh',
    }]);
    setActiveSessionId(nextId);
    addToast(tf('terminal.session.created', '终端会话 "{{name}}" 已创建', { name: profileLabel }), 'success');
    addActivity(tf('terminal.session.activity', '创建终端会话: {{name}}', { name: profileLabel }));
  }, [currentDevice, terminalProfile, addToast, addActivity, tf, t]);

  const removeSession = useCallback((id: string) => {
    setTerminalSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) return prev;
      if (activeSessionId === id) {
        setActiveSessionId(next[next.length - 1].id);
      }
      return next;
    });
  }, [activeSessionId]);

  const replaceTerminalSessions = useCallback((sessions: TerminalSession[], activeId: string) => {
    setTerminalSessions(sessions);
    setActiveSessionId(activeId);
  }, []);

  const appendTerminalSession = useCallback((session: TerminalSession) => {
    setTerminalSessions((prev) => [...prev, session]);
    setActiveSessionId(session.id);
  }, []);

  const runTerminalCommand = useCallback((commandText: string, password?: string) => {
    if (!commandText.trim()) return;
    if (!currentDevice) {
      addToast(t('ui.needDevice', '请先连接真实设备'), 'warning');
      return;
    }

    const nlPatterns: Array<{ match: RegExp; cmd: string }> = [
      { match: /查看.*话题|列出.*topic|list.*topics?|show.*topics?/i, cmd: 'ros2 topic list' },
      { match: /温度|发热|散热|temperature|thermal/i, cmd: 'cat /sys/class/thermal/thermal_zone0/temp' },
      { match: /内存|内存使用|^memory|^ram\b/i, cmd: 'free -h' },
      { match: /磁盘|存储空间|^disk|^storage|^df\b/i, cmd: 'df -h' },
      { match: /进程|正在运行|^processes|^running processes/i, cmd: 'top -bn1 | head -20' },
      { match: /日志|系统日志|^logs?\b|syslog/i, cmd: 'tail -f /var/log/syslog' },
      { match: /网络|ip地址|ip 地址|^ip addr|^network/i, cmd: 'ip addr show' },
      { match: /bpu|推理|加速器/i, cmd: 'hrut_smi' },
    ];
    const nlHit = !commandText.startsWith('/') && !commandText.includes('--')
      ? nlPatterns.find((p) => p.match.test(commandText))
      : undefined;
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

    const prepend = nlHit
      ? [tf('terminal.nl.translate', 'AI 翻译: "{{in}}" → {{out}}', { in: commandText, out: actualCommand })]
      : [];
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
          ? { ...s, status: 'attached', lines: [...s.lines, ...(outputLines.length ? outputLines : [t('terminal.noOutput', '[无输出]')]), 'root@rdk:~#'] }
          : s));
      })
      .catch((error) => {
        const rawMessage = error instanceof Error ? error.message : t('terminal.cmd.fail', '命令执行失败');
        const authFailed = /设备密码缺失|缺少 SSH 密码|Authentication failure|authentication failed|password|auth fail/i.test(rawMessage);
        const message = authFailed
          ? t('terminal.auth.fail', '设备认证失败。请在左侧设备列表中点击该设备，确认用户名和密码是否正确')
          : rawMessage;
        setTerminalSessions((prev) => prev.map((s) => s.id === activeSessionId
          ? { ...s, status: 'attached', lines: [...s.lines, `ERROR: ${message}`, 'root@rdk:~#'] }
          : s));
        addToast(message, 'error');
        if (authFailed) {
          setShowAddDevice(true);
        }
      });

    setTerminalDraft('');
  }, [currentDevice, activeTab, activeSessionId, addToast, setShowAddDevice, t, tf]);

  const runTerminalAIAnalysis = useCallback(() => {
    const lastLines = currentSession.lines.slice(-8).filter(
      (l) => !l.startsWith('root@') && !l.includes('─── AI'),
    );
    const hasError = lastLines.some((l) => /error|fail|denied|not found/i.test(l));
    const analysis = hasError
      ? [
          t('terminal.ai.err.title', '检测到异常输出 — 可能原因:'),
          t('terminal.ai.err.sudo', '   • 权限不足（sudo）'),
          t('terminal.ai.err.deps', '   • 依赖缺失（安装对应软件包）'),
          t('terminal.ai.err.typo', '   • 路径或命令拼写错误'),
          t('terminal.ai.err.hint', '建议: 根据上方真实报错逐条排查'),
        ]
      : [
          t('terminal.ai.ok.title', '终端输出摘要:'),
          tf('terminal.ai.ok.lines', '   • 共 {{n}} 行历史输出', { n: currentSession.lines.length }),
          t('terminal.ai.ok.noKw', '   • 当前片段未检测到明显错误关键字'),
          t('terminal.ai.ok.more', '   • 如需精确结论，请继续执行诊断命令（如 hrut_smi/free -h/df -h）'),
        ];
    const allLines = [t('terminal.ai.header', '─── AI 分析 ───'), ...analysis, '────────────', 'root@rdk:~#'];
    setTerminalSessions((prev) => prev.map((s) => s.id === activeSessionId ? { ...s, lines: [...s.lines, t('terminal.ai.running', '─── AI 分析中… ───')] } : s));
    allLines.forEach((line, i) => {
      setTimeout(() => {
        setTerminalSessions((prev) => prev.map((s) => s.id === activeSessionId ? { ...s, lines: i === 0 ? [...s.lines.slice(0, -1), line] : [...s.lines, line] } : s));
      }, (i + 1) * 200);
    });
    setTimeout(() => addToast(t('terminal.ai.done', 'AI 分析完成'), 'success'), allLines.length * 200 + 100);
  }, [currentSession, activeSessionId, addToast, t, tf]);

  const value = useMemo<TerminalStoreState>(
    () => ({
      terminalProfile, setTerminalProfile, terminalDraft, setTerminalDraft,
      terminalSessions, activeSessionId, setActiveSessionId, currentSession,
      createSession, removeSession, replaceTerminalSessions, appendTerminalSession,
      runTerminalCommand, runTerminalAIAnalysis,
    }),
    [
      terminalProfile, terminalDraft, terminalSessions, activeSessionId, currentSession,
      createSession, removeSession, replaceTerminalSessions, appendTerminalSession,
      runTerminalCommand, runTerminalAIAnalysis,
    ],
  );

  return React.createElement(TerminalContext.Provider, { value }, children);
}
