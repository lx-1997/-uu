import { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import { listDeviceFiles, readDeviceFile, writeDeviceFile } from '../api';
import { useAppState } from '../hooks/useAppState';

loader.config({ paths: { vs: 'https://fastly.jsdelivr.net/npm/monaco-editor@0.43.0/min/vs' } });

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
            <button
              className="ide-icon-btn"
              onClick={() => refreshList()}
              disabled={loading}
              title="刷新"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </button>
            <button
              className="ide-icon-btn"
              onClick={() => { setShowSearch(!showSearch); setTimeout(() => searchRef.current?.focus(), 50); }}
              title="搜索文件"
            >
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
                title={`${entry.name}${entry.size ? ` · ${entry.size}` : ''}`}
              >
                <span className="ide-file-icon">{getFileIcon(entry.name, entry.isDir)}</span>
                <span className="ide-file-name">{entry.name}</span>
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
      </div>
    </div>
  );
}
