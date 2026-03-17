import { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import { listDeviceFiles, readDeviceFile, writeDeviceFile, executeDeviceCommand } from '../api';
import { useAppState } from '../hooks/useAppState';
import { getRememberedDevicePassword } from '../api';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import io from 'socket.io-client';
import '@xterm/xterm/css/xterm.css';

loader.config({ paths: { vs: 'https://fastly.jsdelivr.net/npm/monaco-editor@0.43.0/min/vs' } });

// ── 右键菜单类型 ──
interface ContextMenu {
  x: number;
  y: number;
  entry: FileEntry;
  fullPath: string;
}

// ── 文件图标映射 ──
const EXT_ICONS: Record<string, string> = {
  py: '🐍', js: '📜', ts: '📘', tsx: '⚛️', jsx: '⚛️',
  json: '📋', md: '📝', html: '🌐', css: '🎨', sh: '⚙️',
  yaml: '📄', yml: '📄', toml: '📄', txt: '📄', log: '📃',
  c: '🔧', cpp: '🔧', h: '🔧', rs: '🦀', go: '🐹',
};
const getFileIcon = (name: string, isDir: boolean) => {
  if (isDir) return '📁';
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return EXT_ICONS[ext] || '📄';
};

// ── 语言检测 ──
const detectLang = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    json: 'json', md: 'markdown', html: 'html', css: 'css', scss: 'scss',
    sh: 'shell', bash: 'shell', yaml: 'yaml', yml: 'yaml', toml: 'ini',
    xml: 'xml', sql: 'sql', c: 'c', cpp: 'cpp', h: 'c', rs: 'rust', go: 'go',
    java: 'java', rb: 'ruby', lua: 'lua', dockerfile: 'dockerfile',
  };
  return map[ext || ''] || 'plaintext';
};

// ── 文件条目类型 ──
interface FileEntry {
  name: string;
  isDir: boolean;
  size?: string;
  date?: string;
}

// ── 编辑标签页 ──
interface EditorTab {
  path: string;
  content: string;
  originalContent: string; // 用于检测是否修改
  lang: string;
}

export default function IDE() {
  const { currentDevice, addToast } = useAppState();

  // 内嵌终端状态
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const socketRef = useRef<any>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const termDragging = useRef(false);
  const termDragStartY = useRef(0);
  const termDragStartH = useRef(0);

  // 文件树状态
  const [currentPath, setCurrentPath] = useState('/root');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [treeWidth, setTreeWidth] = useState(260);

  // 编辑器标签页
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const activeTab = tabs.find(t => t.path === activeTabPath) || null;

  // 搜索
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // 新建文件/文件夹
  const [showNewInput, setShowNewInput] = useState<'file' | 'folder' | null>(null);
  const [newName, setNewName] = useState('');
  const newInputRef = useRef<HTMLInputElement>(null);

  // 光标位置（状态栏用）
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const editorRef = useRef<any>(null);

  // 右键菜单
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 关闭右键菜单
  useEffect(() => {
    const handler = () => setContextMenu(null);
    if (contextMenu) window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  // 右键菜单操作
  const handleContextAction = (action: string) => {
    if (!contextMenu || !currentDevice) return;
    const { entry, fullPath } = contextMenu;
    setContextMenu(null);

    if (action === 'copy-path') {
      navigator.clipboard.writeText(fullPath);
      addToast(`已复制路径: ${fullPath}`, 'success');
    } else if (action === 'rename') {
      setRenameTarget(fullPath);
      setRenameValue(entry.name);
      setTimeout(() => renameInputRef.current?.focus(), 50);
    } else if (action === 'delete') {
      const cmd = entry.isDir ? `rm -rf "${fullPath}"` : `rm -f "${fullPath}"`;
      executeDeviceCommand(currentDevice.id, cmd)
        .then(() => {
          addToast(`已删除 ${entry.name}`, 'success');
          closeTab(fullPath);
          refreshList();
        })
        .catch(err => addToast(err instanceof Error ? err.message : '删除失败', 'error'));
    } else if (action === 'open-terminal') {
      setShowTerminal(true);
      // 发送 cd 命令到终端
      const dir = entry.isDir ? fullPath : currentPath;
      setTimeout(() => socketRef.current?.emit('data', `cd "${dir}"\n`), 300);
    }
  };

  const handleRename = () => {
    if (!renameTarget || !renameValue.trim() || !currentDevice) {
      setRenameTarget(null);
      return;
    }
    const dir = renameTarget.split('/').slice(0, -1).join('/');
    const newPath = dir + '/' + renameValue.trim();
    executeDeviceCommand(currentDevice.id, `mv "${renameTarget}" "${newPath}"`)
      .then(() => {
        addToast(`已重命名为 ${renameValue.trim()}`, 'success');
        // 更新已打开的标签页路径
        setTabs(prev => prev.map(t =>
          t.path === renameTarget ? { ...t, path: newPath } : t
        ));
        if (activeTabPath === renameTarget) setActiveTabPath(newPath);
        refreshList();
      })
      .catch(err => addToast(err instanceof Error ? err.message : '重命名失败', 'error'))
      .finally(() => setRenameTarget(null));
  };

  // ── 新建文件/文件夹 ──
  const handleCreateNew = () => {
    if (!currentDevice || !newName.trim()) { setShowNewInput(null); return; }
    const fullPath = currentPath === '/' ? '/' + newName.trim() : currentPath + '/' + newName.trim();
    if (showNewInput === 'folder') {
      // mkdir via writeDeviceFile trick: write empty file then remove, or use exec
      import('../api').then(({ executeDeviceCommand }) => {
        executeDeviceCommand(currentDevice.id, `mkdir -p "${fullPath}"`)
          .then(() => { addToast(`已创建文件夹 ${newName.trim()}`, 'success'); refreshList(); })
          .catch(err => addToast(err instanceof Error ? err.message : '创建失败', 'error'));
      });
    } else {
      writeDeviceFile(currentDevice.id, fullPath, '')
        .then(() => { addToast(`已创建文件 ${newName.trim()}`, 'success'); refreshList(); })
        .catch(err => addToast(err instanceof Error ? err.message : '创建失败', 'error'));
    }
    setShowNewInput(null);
    setNewName('');
  };

  // 拖拽调整面板宽度
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const handleDragStart = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = treeWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      setTreeWidth(Math.max(180, Math.min(450, dragStartWidth.current + delta)));
    };
    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // ── 解析 ls -la 输出 ──
  const parseListOutput = (raw: string): FileEntry[] => {
    return raw.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('total '))
      .map(line => {
        const parts = line.split(/\s+/);
        const mode = parts[0] || '';
        const size = parts[4] || '';
        const date = parts.slice(5, 8).join(' ');
        const name = parts.slice(8).join(' ');
        return { name, isDir: mode.startsWith('d'), size, date };
      })
      .filter(item => item.name && item.name !== '.' && item.name !== '..');
  };

  // ── 刷新目录 ──
  const refreshList = useCallback((path = currentPath) => {
    if (!currentDevice) return;
    setLoading(true);
    listDeviceFiles(currentDevice.id, path)
      .then(res => {
        const parsed = parseListOutput(res.output || '');
        // 排序：文件夹在前，然后按名称
        parsed.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setEntries(parsed);
        setCurrentPath(path);
      })
      .catch(err => addToast(err instanceof Error ? err.message : '刷新失败', 'error'))
      .finally(() => setLoading(false));
  }, [currentDevice, currentPath, addToast]);

  useEffect(() => {
    if (currentDevice) refreshList(currentPath);
  }, [currentDevice?.id]);

  // ── 打开文件 ──
  const openFile = (name: string, isDir: boolean) => {
    const fullPath = currentPath === '/' ? '/' + name : currentPath + '/' + name;
    if (isDir) {
      refreshList(fullPath);
      return;
    }
    // 检查是否已打开
    const existing = tabs.find(t => t.path === fullPath);
    if (existing) {
      setActiveTabPath(fullPath);
      return;
    }
    setLoading(true);
    readDeviceFile(currentDevice!.id, fullPath, 5000)
      .then(res => {
        let text = res.output || '';
        if (res.contentBase64) {
          try {
            const binary = atob(res.contentBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            text = new TextDecoder('utf-8').decode(bytes);
          } catch { /* ignore */ }
        }
        const newTab: EditorTab = {
          path: fullPath,
          content: text,
          originalContent: text,
          lang: detectLang(fullPath),
        };
        setTabs(prev => [...prev, newTab]);
        setActiveTabPath(fullPath);
      })
      .catch(err => addToast(err instanceof Error ? err.message : '读取失败', 'error'))
      .finally(() => setLoading(false));
  };

  // ── 关闭标签页 ──
  const closeTab = (path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setTabs(prev => {
      const next = prev.filter(t => t.path !== path);
      if (activeTabPath === path) {
        const idx = prev.findIndex(t => t.path === path);
        const newActive = next[Math.min(idx, next.length - 1)]?.path || null;
        setActiveTabPath(newActive);
      }
      return next;
    });
  };

  // ── 保存文件 ──
  const saveFile = () => {
    if (!currentDevice || !activeTab) return;
    setLoading(true);
    writeDeviceFile(currentDevice.id, activeTab.path, activeTab.content)
      .then(() => {
        addToast(`已保存 ${activeTab.path.split('/').pop()}`, 'success');
        setTabs(prev => prev.map(t =>
          t.path === activeTab.path ? { ...t, originalContent: t.content } : t
        ));
      })
      .catch(err => addToast(err instanceof Error ? err.message : '保存失败', 'error'))
      .finally(() => setLoading(false));
  };

  // ── 更新编辑器内容 ──
  const updateContent = (val: string | undefined) => {
    if (!activeTabPath) return;
    setTabs(prev => prev.map(t =>
      t.path === activeTabPath ? { ...t, content: val || '' } : t
    ));
  };

  // ── 内嵌终端初始化 ──
  useEffect(() => {
    if (!showTerminal || !terminalRef.current || !currentDevice) return;

    const term = new XTerm({
      fontFamily: "'JetBrains Mono', 'Menlo', 'Consolas', monospace",
      fontSize: 13,
      theme: { background: '#1a1a2e', foreground: '#f8fafc', cursor: '#ff6b00' },
      cursorBlink: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    let socketUrl = window.location.origin;
    if ((import.meta as any).env?.DEV) socketUrl = 'http://localhost:8787';

    const remembered = getRememberedDevicePassword(currentDevice.id);
    const socket = io(socketUrl);
    socketRef.current = socket;

    socket.on('connect', () => {
      term.clear();
      term.writeln('\x1b[38;5;208m[IDE Terminal]\x1b[0m 已连接');
      socket.emit('init', {
        deviceId: currentDevice.id,
        password: remembered || undefined,
        cols: term.cols,
        rows: term.rows,
      });
    });
    socket.on('data', (data: string) => term.write(data));
    socket.on('disconnect', () => term.writeln('\x1b[31m\r\n[断开连接]\x1b[0m'));
    term.onData((data) => socket.emit('data', data));

    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); socket.emit('resize', { cols: term.cols, rows: term.rows }); } catch {}
    });
    ro.observe(terminalRef.current);

    return () => { ro.disconnect(); socket.disconnect(); term.dispose(); };
  }, [showTerminal, currentDevice?.id]);

  // ── 终端面板拖拽调整高度 ──
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!termDragging.current) return;
      const delta = termDragStartY.current - e.clientY;
      setTerminalHeight(Math.max(100, Math.min(500, termDragStartH.current + delta)));
    };
    const onUp = () => { termDragging.current = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const handleTermDragStart = (e: React.MouseEvent) => {
    termDragging.current = true;
    termDragStartY.current = e.clientY;
    termDragStartH.current = terminalHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  // ── 快捷键 ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchRef.current?.focus(), 50);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setShowTerminal(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTab, currentDevice]);

  // ── 面包屑 ──
  const pathParts = currentPath.split('/').filter(Boolean);

  // ── 过滤文件列表 ──
  const filteredEntries = searchQuery
    ? entries.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : entries;

  const isModified = (path: string) => {
    const tab = tabs.find(t => t.path === path);
    return tab ? tab.content !== tab.originalContent : false;
  };

  return (
    <div className="ide-container">
      {/* ── 文件树面板 ── */}
      <div className="ide-sidebar" style={{ width: treeWidth }}>
        {/* 侧栏头部 */}
        <div className="ide-sidebar-header">
          <span className="ide-sidebar-title">资源管理器</span>
          <div className="ide-sidebar-actions">
            <button className="ide-icon-btn" onClick={() => { setShowNewInput('file'); setNewName(''); setTimeout(() => newInputRef.current?.focus(), 50); }} title="新建文件">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
            </button>
            <button className="ide-icon-btn" onClick={() => { setShowNewInput('folder'); setNewName(''); setTimeout(() => newInputRef.current?.focus(), 50); }} title="新建文件夹">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
              </svg>
            </button>
            <button className="ide-icon-btn" onClick={() => refreshList()} disabled={loading} title="刷新">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </button>
            <button className="ide-icon-btn" onClick={() => { setShowSearch(!showSearch); setTimeout(() => searchRef.current?.focus(), 50); }} title="搜索文件 (Ctrl+P)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>
          </div>
        </div>

        {/* 搜索框 */}
        {showSearch && (
          <div className="ide-search-box">
            <input
              ref={searchRef}
              type="text"
              placeholder="搜索文件..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setShowSearch(false); setSearchQuery(''); } }}
              className="ide-search-input"
            />
          </div>
        )}

        {/* 面包屑导航 */}
        <div className="ide-breadcrumb">
          <span className="ide-crumb" onClick={() => refreshList('/')}>~</span>
          {pathParts.map((part, i) => (
            <span key={i}>
              <span className="ide-crumb-sep">/</span>
              <span
                className="ide-crumb"
                onClick={() => refreshList('/' + pathParts.slice(0, i + 1).join('/'))}
              >
                {part}
              </span>
            </span>
          ))}
        </div>

        {/* 新建文件/文件夹输入 */}
        {showNewInput && (
          <div className="ide-new-input-row">
            <span className="ide-file-icon">{showNewInput === 'folder' ? '📁' : '📄'}</span>
            <input
              ref={newInputRef}
              className="ide-new-input"
              placeholder={showNewInput === 'folder' ? '文件夹名称...' : '文件名称...'}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreateNew();
                if (e.key === 'Escape') { setShowNewInput(null); setNewName(''); }
              }}
              onBlur={() => { if (!newName.trim()) { setShowNewInput(null); setNewName(''); } }}
            />
          </div>
        )}

        {/* 文件列表 */}
        <div className="ide-file-list">
          {currentPath !== '/' && (
            <div
              className="ide-file-item"
              onClick={() => {
                const parts = currentPath.split('/').filter(Boolean);
                parts.pop();
                refreshList('/' + parts.join('/'));
              }}
            >
              <span className="ide-file-icon">📂</span>
              <span className="ide-file-name">..</span>
            </div>
          )}
          {filteredEntries.map(entry => {
            const fullPath = currentPath === '/' ? '/' + entry.name : currentPath + '/' + entry.name;
            const isActive = activeTabPath === fullPath;
            const isOpen = tabs.some(t => t.path === fullPath);
            return (
              <div
                key={entry.name}
                className={`ide-file-item ${isActive ? 'active' : ''} ${isOpen ? 'open' : ''}`}
                onClick={() => openFile(entry.name, entry.isDir)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, entry, fullPath });
                }}
                title={`${entry.name}${entry.size ? ` · ${entry.size}` : ''}`}
              >
                <span className="ide-file-icon">{getFileIcon(entry.name, entry.isDir)}</span>
                {renameTarget === fullPath ? (
                  <input
                    ref={renameInputRef}
                    className="ide-rename-input"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRename();
                      if (e.key === 'Escape') setRenameTarget(null);
                      e.stopPropagation();
                    }}
                    onBlur={handleRename}
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <span className="ide-file-name">{entry.name}</span>
                )}
                {entry.size && !entry.isDir && (
                  <span className="ide-file-size">{entry.size}</span>
                )}
              </div>
            );
          })}
          {filteredEntries.length === 0 && !loading && (
            <div className="ide-empty">
              {searchQuery ? '无匹配文件' : '空目录'}
            </div>
          )}
          {loading && (
            <div className="ide-loading">
              <div className="ide-loading-spinner" />
              <span>加载中...</span>
            </div>
          )}
        </div>
      </div>

      {/* ── 拖拽分隔条 ── */}
      <div className="ide-resizer" onMouseDown={handleDragStart} />

      {/* ── 编辑器主区域 ── */}
      <div className="ide-main">
        {/* 标签栏 */}
        {tabs.length > 0 && (
          <div className="ide-tabs">
            <div className="ide-tabs-scroll">
              {tabs.map(tab => {
                const fileName = tab.path.split('/').pop() || tab.path;
                const modified = isModified(tab.path);
                return (
                  <div
                    key={tab.path}
                    className={`ide-tab ${tab.path === activeTabPath ? 'active' : ''} ${modified ? 'modified' : ''}`}
                    onClick={() => setActiveTabPath(tab.path)}
                    title={tab.path}
                  >
                    <span className="ide-tab-icon">{getFileIcon(fileName, false)}</span>
                    <span className="ide-tab-name">{fileName}</span>
                    {modified && <span className="ide-tab-dot" />}
                    <button
                      className="ide-tab-close"
                      onClick={e => closeTab(tab.path, e)}
                      title="关闭"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
            {/* 工具栏 */}
            <div className="ide-toolbar">
              {activeTab && isModified(activeTab.path) && (
                <button className="ide-save-btn" onClick={saveFile} disabled={loading}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
                    <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
                  </svg>
                  保存
                </button>
              )}
              <span className="ide-shortcut-hint">Ctrl+S 保存 · Ctrl+P 搜索</span>
            </div>
          </div>
        )}

        {/* 编辑器区域 */}
        {activeTab ? (
          <div className="ide-editor-wrap">
            {/* 文件路径栏 */}
            <div className="ide-path-bar">
              {activeTab.path.split('/').filter(Boolean).map((seg, i, arr) => (
                <span key={i}>
                  {i > 0 && <span className="ide-path-sep">›</span>}
                  <span className={i === arr.length - 1 ? 'ide-path-current' : 'ide-path-seg'}>{seg}</span>
                </span>
              ))}
              <span className="ide-lang-badge">{activeTab.lang}</span>
            </div>
            <div className="ide-editor">
              <Editor
                height="100%"
                language={activeTab.lang}
                theme="vs-dark"
                value={activeTab.content}
                onChange={updateContent}
                onMount={(editor) => {
                  editorRef.current = editor;
                  editor.onDidChangeCursorPosition((e) => {
                    setCursorPos({ line: e.position.lineNumber, col: e.position.column });
                  });
                }}
                options={{
                  minimap: { enabled: true, maxColumn: 80 },
                  fontSize: 14,
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
                  fontLigatures: true,
                  wordWrap: 'on',
                  lineNumbers: 'on',
                  renderLineHighlight: 'all',
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  cursorBlinking: 'smooth',
                  cursorSmoothCaretAnimation: 'on',
                  bracketPairColorization: { enabled: true },
                  padding: { top: 12 },
                  suggest: { showKeywords: true },
                }}
              />
            </div>
          </div>
        ) : (
          <div className="ide-welcome">
            <div className="ide-welcome-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
              </svg>
            </div>
            <h3 className="ide-welcome-title">RDK Code Editor</h3>
            <p className="ide-welcome-sub">从左侧文件树选择文件开始编辑</p>
            <div className="ide-welcome-shortcuts">
              <div className="ide-shortcut-item">
                <kbd>Ctrl</kbd>+<kbd>S</kbd>
                <span>保存文件</span>
              </div>
              <div className="ide-shortcut-item">
                <kbd>Ctrl</kbd>+<kbd>P</kbd>
                <span>搜索文件</span>
              </div>
              <div className="ide-shortcut-item">
                <kbd>Ctrl</kbd>+<kbd>`</kbd>
                <span>切换终端</span>
              </div>
            </div>
          </div>
        )}

        {/* ── 内嵌终端面板 ── */}
        {showTerminal && (
          <>
            <div className="ide-term-resizer" onMouseDown={handleTermDragStart} />
            <div className="ide-term-panel" style={{ height: terminalHeight }}>
              <div className="ide-term-header">
                <span className="ide-term-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                  终端
                </span>
                <button className="ide-icon-btn" onClick={() => setShowTerminal(false)} title="关闭终端">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div ref={terminalRef} style={{ flex: 1, overflow: 'hidden' }} />
            </div>
          </>
        )}

        {/* 终端切换按钮 */}
        {!showTerminal && (
          <div className="ide-term-toggle" onClick={() => setShowTerminal(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            <span>终端</span>
            <kbd style={{ fontSize: '0.7rem', opacity: 0.6, marginLeft: 'auto' }}>Ctrl+`</kbd>
          </div>
        )}

        {/* ── 底部状态栏 ── */}
        {/* 右键菜单 */}
        {contextMenu && (
          <div
            className="ide-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={e => e.stopPropagation()}
          >
            {!contextMenu.entry.isDir && (
              <div className="ide-ctx-item" onClick={() => { openFile(contextMenu.entry.name, false); setContextMenu(null); }}>
                <span className="ide-ctx-icon">📄</span>打开文件
              </div>
            )}
            <div className="ide-ctx-item" onClick={() => handleContextAction('rename')}>
              <span className="ide-ctx-icon">✏️</span>重命名
            </div>
            <div className="ide-ctx-item" onClick={() => handleContextAction('copy-path')}>
              <span className="ide-ctx-icon">📋</span>复制路径
            </div>
            <div className="ide-ctx-item" onClick={() => handleContextAction('open-terminal')}>
              <span className="ide-ctx-icon">⌨️</span>在终端中打开
            </div>
            <div className="ide-ctx-sep" />
            <div className="ide-ctx-item danger" onClick={() => handleContextAction('delete')}>
              <span className="ide-ctx-icon">🗑️</span>删除
            </div>
          </div>
        )}

        <div className="ide-statusbar">
          <div className="ide-statusbar-left">
            {currentDevice && (
              <span className="ide-statusbar-item">
                <span className="ide-statusbar-dot connected" />
                {currentDevice.name}
              </span>
            )}
            <span className="ide-statusbar-item">{currentPath}</span>
          </div>
          <div className="ide-statusbar-right">
            {activeTab && (
              <>
                <span className="ide-statusbar-item">行 {cursorPos.line}, 列 {cursorPos.col}</span>
                <span className="ide-statusbar-item">{activeTab.lang}</span>
                <span className="ide-statusbar-item">UTF-8</span>
                {isModified(activeTab.path) && <span className="ide-statusbar-item modified">● 已修改</span>}
              </>
            )}
            <span className="ide-statusbar-item">{tabs.length} 个文件</span>
          </div>
        </div>
      </div>
    </div>
  );
}
