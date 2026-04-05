import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import { Loader2, RefreshCw, Upload, ArrowLeft, Home, Search, Folder, FileText, FolderOpen, Save } from 'lucide-react';

// 使用国内极速镜像源，避免因为 unpkg 无法连接导致「代码编辑」模块卡白屏加载不到一直启动不了的问题
loader.config({ paths: { vs: 'https://fastly.jsdelivr.net/npm/monaco-editor@0.43.0/min/vs' } });

import { downloadDeviceFile, listDeviceFiles, readDeviceFile, writeDeviceFile, uploadDeviceFile, executeDeviceCommand } from '../api';
import { fillTemplate } from '../i18n/en-extras';
import { useI18n } from '../i18n/use-i18n';
import { useDeviceStore } from '../hooks/useDeviceStore';
import { useToastStore } from '../hooks/useToastStore';
import DeviceGuard from './DeviceGuard';

export default function Files() {
  const { currentDevice } = useDeviceStore();
  const { addToast } = useToastStore();
  const { t, isEn, language } = useI18n();
  const tf = (key: string, zh: string, vars: Record<string, string | number>) => fillTemplate(t(key, zh), vars);
  const locale = isEn ? 'en' : 'zh-Hans-CN';
  const [currentPath, setCurrentPath] = useState('/root');
  const [entries, setEntries] = useState<Array<{ name: string; isDir: boolean; size?: string; date?: string }>>([]);
  const [running, setRunning] = useState(false);
  const [editorFile, setEditorFile] = useState<{ path: string; content: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [searchMatches, setSearchMatches] = useState<Array<{path: string; isDir: boolean}>>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState<'type' | 'name' | 'date'>('type');
  const [showHidden, setShowHidden] = useState(true);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  const [ctxMenu, setCtxMenu] = useState<
    | null
    | { x: number; y: number; target: 'blank' | 'parent' | { name: string; isDir: boolean } }
  >(null);

  const runDownloadRef = useRef<any>(null);

  const deviceRef = useRef(currentDevice);
  useEffect(() => { deviceRef.current = currentDevice; }, [currentDevice]);

  useEffect(() => {
    const handleUploadEvent = () => fileInputRef.current?.click();
    const handleDownloadEvent = async (e: any) => {
      const rawName = e.detail?.trim() || '';
      const fileName = rawName.split('/').pop() || rawName; // 提取纯文件名，忽略包含的路径或波浪号
      if (!fileName) {
        addToast(t('files.download.specify', '请指定要下载的文件名，例如：下载 test.txt'), 'warning');
        return;
      }
      const target = entriesRef.current.find((en) => en.name === fileName);
      if (target) {
        runDownloadRef.current?.(target.name, target.isDir);
      } else {
        if (!deviceRef.current) {
          addToast(t('files.connectFirst', '请先连接设备获取文件'), 'warning');
          return;
        }
        addToast(tf('files.searchDeep', '当前目录未找到，正在全盘深入搜索 {{name}}...', { name: fileName }), 'info');
        try {
          const res = await executeDeviceCommand(deviceRef.current.id, `for p in $(find /userdata /root /home/sunrise /var/log /etc -name ${shellSafe(fileName)} 2>/dev/null | head -n 10); do if [ -d "$p" ]; then echo "DIR:$p"; else echo "FILE:$p"; fi; done`);
          const lines = res.output.split(/\r?\n/).map(l => l.trim().replace(/Command completed without output\.?/i, '')).filter(l => l && (l.startsWith('DIR:/') || l.startsWith('FILE:/')));
          
          if (lines.length === 1) {
            const isDir = lines[0].startsWith('DIR:');
            const foundPath = lines[0].substring(lines[0].indexOf('/'));
            addToast(tf('files.searchAutoPick', '已定位匹配项：{{path}}', { path: foundPath }), 'success');
            runDownloadRef.current?.(foundPath, isDir);
          } else if (lines.length > 1) {
            addToast(tf('files.searchMulti', '找到 {{n}} 个结果，请手动选择', { n: lines.length }), 'info');
            setSearchMatches(lines.map(l => ({
               path: l.substring(l.indexOf('/')),
               isDir: l.startsWith('DIR:')
            })));
          } else {
            addToast(tf('files.searchNotFound', '全盘搜索失败，未找到: {{name}}', { name: fileName }), 'error');
          }
        } catch (err) {
          addToast(t('files.searchError', '全盘搜索发生错误'), 'error');
        }
      }
    };
    window.addEventListener('AI_FILE_UPLOAD', handleUploadEvent);
    window.addEventListener('AI_FILE_DOWNLOAD', handleDownloadEvent);
    return () => {
      window.removeEventListener('AI_FILE_UPLOAD', handleUploadEvent);
      window.removeEventListener('AI_FILE_DOWNLOAD', handleDownloadEvent);
    };
  }, [addToast, language, t, tf]);

  const entriesRef = useRef(entries);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  const ensureDevice = () => {
    if (!currentDevice) {
      addToast(t('files.needDevice', '请先连接真实设备'), 'warning');
      return false;
    }
    return true;
  };

  const parseListOutput = (raw: string) => {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('total '))
      .map((line) => {
        const parts = line.split(/\s+/);
        const mode = parts[0] || '';
        const size = parts[4] || '';
        const date = parts.slice(5, 8).join(' ');
        const name = parts.slice(8).join(' ');
        return { name, isDir: mode.startsWith('d'), size, date };
      })
      .filter((item) => item.name && item.name !== '.' && item.name !== '..');
  };

  const refreshList = (path = currentPath) => {
    if (!ensureDevice() || !currentDevice) return;
    setRunning(true);
    listDeviceFiles(currentDevice.id, path)
      .then((res) => {
        setEntries(parseListOutput(res.output || ''));
        setCurrentPath(path);
        setSelectedName(null);
      })
      .catch((err) => addToast(err instanceof Error ? err.message : t('files.refreshFail', '刷新目录失败'), 'error'))
      .finally(() => setRunning(false));
  };

  useEffect(() => {
    if (currentDevice) {
      refreshList(currentPath);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDevice?.id]);

  const handleNavigate = (folderName: string) => {
    const nextPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
    refreshList(nextPath);
  };

  const handleGoUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length === 0) return;
    const nextPath = parts.length === 1 ? '/' : `/${parts.slice(0, -1).join('/')}`;
    refreshList(nextPath);
  };

  const handleBreadcrumb = (index: number) => {
    const parts = currentPath.split('/').filter(Boolean);
    const nextPath = '/' + parts.slice(0, index + 1).join('/');
    refreshList(nextPath);
  };

  const runDownload = (fileName: string, isFolder: boolean) => {
    if (!ensureDevice() || !currentDevice) return;
    const filePath = fileName.startsWith('/') ? fileName : (currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`);
    const actualName = fileName.split('/').pop() || 'download';
    addToast(isFolder ? t('files.downloadZip', '开始压缩并下载...') : t('files.downloadStart', '开始下载...'), 'info');
    downloadDeviceFile(currentDevice.id, filePath)
      .then((res) => {
        if (!res.contentBase64) {
          addToast(t('files.noContent', '未获取到文件内容'), 'warning');
          return;
        }
        const binary = atob(res.contentBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes]);
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = isFolder ? `${actualName}.tar.gz` : actualName;
        link.click();
        URL.revokeObjectURL(href);
      })
      .catch((err) => addToast(err instanceof Error ? err.message : t('files.downloadFail', '下载文件失败'), 'error'));
  };

  runDownloadRef.current = runDownload;

  const runEdit = (fileName: string) => {
    if (!ensureDevice() || !currentDevice) return;
    const filePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
    setRunning(true);
    readDeviceFile(currentDevice.id, filePath)
      .then((res) => {
         let text = res.output || '';
         if (res.contentBase64) {
           try {
             // Safely decode UTF-8 from Base64
             const binary = atob(res.contentBase64);
             const bytes = new Uint8Array(binary.length);
             for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
             text = new TextDecoder('utf-8').decode(bytes);
           } catch(e) { console.warn('Base64 decode failed', e); }
         }
         setEditorFile({ path: filePath, content: text });
      })
      .catch((err) => addToast(err instanceof Error ? err.message : t('files.readFail', '读取文件失败'), 'error'))
      .finally(() => setRunning(false));
  };

  const runSaveEdit = () => {
    if (!ensureDevice() || !currentDevice || !editorFile) return;
    setRunning(true);
    writeDeviceFile(currentDevice.id, editorFile.path, editorFile.content)
      .then(() => {
        addToast(t('files.saved', '文件已保存'), 'success');
        setEditorFile(null);
        refreshList();
      })
      .catch((err) => addToast(err instanceof Error ? err.message : t('files.saveFail', '保存文件失败'), 'error'))
      .finally(() => setRunning(false));
  };

  const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const b64 = result.split(',')[1];
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleUpload = async (file: File) => {
    if (!ensureDevice() || !currentDevice) return;
    try {
      setRunning(true);
      addToast(tf('files.uploading', '正在上传 {{name}}...', { name: file.name }), 'info');
      const base64 = await toBase64(file);
      const targetPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      await uploadDeviceFile(currentDevice.id, targetPath, base64);
      addToast(t('files.uploadOk', '上传成功'), 'success');
      refreshList();
    } catch (err: any) {
      addToast(err.message || t('files.uploadFail', '上传失败'), 'error');
    } finally {
      setRunning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragActive(true); };
  const onDragLeave = () => setDragActive(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUpload(e.dataTransfer.files[0]);
    }
  };

  const parts = currentPath.split('/').filter(Boolean);
  const inHomePath = currentPath === '/root' || currentPath.startsWith('/root/');
  const displayParts = inHomePath ? parts.slice(1) : parts;

  /** 与「主目录 /root」不重复的常用路径（避免再出现 ~/ 重复） */
  const FILE_QUICK_PATHS: readonly string[] = ['/userdata', '/var/log', '/etc'];

  const visibleEntries = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const base = showHidden ? entries : entries.filter((entry) => !entry.name.startsWith('.'));
    const filtered = q
      ? base.filter((entry) => entry.name.toLowerCase().includes(q))
      : base;

    const parseDate = (value?: string) => {
      if (!value) return 0;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    };

    return [...filtered].sort((a, b) => {
      if (sortBy === 'type') {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, locale, { numeric: true, sensitivity: 'base' });
      }
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name, locale, { numeric: true, sensitivity: 'base' });
      }
      return parseDate(b.date) - parseDate(a.date);
    });
  }, [entries, searchText, sortBy, showHidden, locale]);

  const selectedEntry = selectedName ? entries.find((entry) => entry.name === selectedName) || null : null;

  const shellSafe = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

  const pathForEntry = useCallback(
    (name: string) => (currentPath === '/' ? `/${name}` : `${currentPath}/${name}`),
    [currentPath],
  );

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const openCtxMenu = useCallback((e: React.MouseEvent, target: 'blank' | 'parent' | { name: string; isDir: boolean }) => {
    e.preventDefault();
    e.stopPropagation();
    const pad = 8;
    const mw = 220;
    const mh = 320;
    let x = e.clientX;
    let y = e.clientY;
    if (x + mw > window.innerWidth - pad) x = window.innerWidth - mw - pad;
    if (y + mh > window.innerHeight - pad) y = window.innerHeight - mh - pad;
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    setCtxMenu({ x, y, target });
  }, []);

  useEffect(() => {
    if (!ctxMenu) return;
    const onDoc = (ev: MouseEvent) => {
      if (ctxMenuRef.current?.contains(ev.target as Node)) return;
      setCtxMenu(null);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setCtxMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  const createFolder = async () => {
    if (!ensureDevice() || !currentDevice) return;
    const folderName = window.prompt(t('files.promptFolder', '请输入新文件夹名称'))?.trim();
    if (!folderName) return;
    const targetPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
    setRunning(true);
    try {
      await executeDeviceCommand(currentDevice.id, `mkdir -p ${shellSafe(targetPath)}`);
      addToast(t('files.folderOk', '文件夹创建成功'), 'success');
      refreshList();
    } catch (err) {
      addToast(err instanceof Error ? err.message : t('files.folderFail', '创建文件夹失败'), 'error');
    } finally {
      setRunning(false);
    }
  };

  const copyEntryPath = (name: string) => {
    const p = pathForEntry(name);
    void navigator.clipboard.writeText(p).then(
      () => addToast(t('files.pathCopied', '已复制路径'), 'success'),
      () => addToast(t('files.pathCopied', '已复制路径'), 'info'),
    );
  };

  const deleteEntry = async (name: string) => {
    if (!ensureDevice() || !currentDevice) return;
    const full = pathForEntry(name);
    if (!window.confirm(tf('files.deleteConfirm', '确定永久删除「{{path}}」？此操作不可恢复。', { path: full }))) return;
    setRunning(true);
    try {
      await executeDeviceCommand(currentDevice.id, `rm -rf ${shellSafe(full)}`);
      addToast(t('files.deleteOk', '已删除'), 'success');
      setSelectedName(null);
      refreshList();
    } catch (err) {
      addToast(err instanceof Error ? err.message : t('files.deleteFail', '删除失败'), 'error');
    } finally {
      setRunning(false);
    }
  };

  const renameEntry = async (entryName: string) => {
    if (!ensureDevice() || !currentDevice) return;
    const nextName = window.prompt(t('files.promptRename', '请输入新的名称'), entryName)?.trim();
    if (!nextName || nextName === entryName) return;
    const from = currentPath === '/' ? `/${entryName}` : `${currentPath}/${entryName}`;
    const to = currentPath === '/' ? `/${nextName}` : `${currentPath}/${nextName}`;
    setRunning(true);
    try {
      await executeDeviceCommand(currentDevice.id, `mv ${shellSafe(from)} ${shellSafe(to)}`);
      addToast(t('files.renameOk', '重命名成功'), 'success');
      refreshList();
    } catch (err) {
      addToast(err instanceof Error ? err.message : t('files.renameFail', '重命名失败'), 'error');
    } finally {
      setRunning(false);
    }
  };

  const handleTableContextMenu = useCallback(
    (e: React.MouseEvent<HTMLTableElement>) => {
      const tr = (e.target as HTMLElement).closest('tbody tr');
      if (tr) {
        const key = tr.getAttribute('data-file');
        if (key === '__parent__') {
          openCtxMenu(e, 'parent');
          return;
        }
        if (key === '__empty__') {
          openCtxMenu(e, 'blank');
          return;
        }
        if (key) {
          const entry = entries.find((en) => en.name === key);
          if (entry) openCtxMenu(e, { name: entry.name, isDir: entry.isDir });
        }
        return;
      }
      openCtxMenu(e, 'blank');
    },
    [entries, openCtxMenu],
  );

  useEffect(() => {
    if (editorFile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (!selectedEntry) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        if (selectedEntry.isDir) handleNavigate(selectedEntry.name);
        else runEdit(selectedEntry.name);
        return;
      }
      if (event.key === 'F2') {
        event.preventDefault();
        renameEntry(selectedEntry.name);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editorFile, selectedEntry]);

  if (!currentDevice) {
    return <DeviceGuard feature={t('files.featureName', '文件管理')} />;
  }

  return (
    <div className="center-stage wide-stage tool-page" style={{ minHeight: '82vh', height: '82vh', display: 'flex', flexDirection: 'column' }}>
      <div className="isolated-widget workflow-widget" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="tool-bar files-page-toolbar">
          <div className="tool-bar-left">
            <span className="tool-bar-title">{t('files.title', '资源管理器')}</span>
          </div>
          <div className="tool-bar-right files-page-toolbar__actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm files-page-toolbar__icon-btn"
              onClick={() => refreshList()}
              disabled={running}
              title={t('files.refresh', '刷新')}
              aria-label={t('files.refresh', '刷新')}
            >
              {running ? <Loader2 size={16} className="spinner" /> : <RefreshCw size={16} strokeWidth={2} />}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm files-page-toolbar__upload"
              onClick={() => fileInputRef.current?.click()}
              disabled={running}
            >
              {running ? <Loader2 size={16} className="spinner" /> : <Upload size={16} strokeWidth={2} />}
              <span>{t('files.upload', '上传文件')}</span>
            </button>
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} />
          </div>
        </div>
        
        {editorFile ? (
          <div className="file-editor" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="file-editor-bar" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', flexShrink: 0 }}>
              <button className="btn btn-ghost btn-sm" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }} onClick={() => setEditorFile(null)}>
                <ArrowLeft size={16} /> {t('files.back', '返回')}
              </button>
              <div style={{ width: 1, height: 20, background: 'var(--border-strong)' }}></div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>{editorFile.path.substring(0, editorFile.path.lastIndexOf('/')) || '/'}</span>
                <span style={{ color: 'var(--text-muted)' }}>/</span>
                <span>{editorFile.path.substring(editorFile.path.lastIndexOf('/') + 1)}</span>
              </div>
            </div>
            <div className="file-editor-body" style={{ flex: 1, border: '1px solid var(--border)', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
              <Editor
                height="100%"
                language={((): string => {
                  const ext = editorFile.path.split('.').pop()?.toLowerCase();
                  switch (ext) {
                    case 'py': return 'python';
                    case 'js':
                    case 'jsx': return 'javascript';
                    case 'ts':
                    case 'tsx': return 'typescript';
                    case 'json': return 'json';
                    case 'md': return 'markdown';
                    case 'html': return 'html';
                    case 'css': return 'css';
                    default: return 'shell';
                  }
                })()}
                theme="vs-light"
                value={editorFile.content}
                onChange={(val) => setEditorFile({ ...editorFile, content: val || '' })}
                options={{ minimap: { enabled: false }, fontSize: 14, wordWrap: 'on' }}
              />
            </div>
            <div className="tool-bar" style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
              <div className="tool-bar-right">
                <button className="btn btn-primary btn-sm" style={{ minWidth: 120, padding: '10px 24px', fontSize: 14, background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 8 }} onClick={runSaveEdit} disabled={running}>
                  {running ? (
                    t('files.saving', '保存中...')
                  ) : (
                    <>
                      <Save size={16} strokeWidth={2} aria-hidden style={{ marginRight: 6 }} />
                      {t('files.save', '保存修改')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="files-explorer-nav">
              <div className="files-explorer-nav__main">
                <div className="files-explorer-nav__path">
                  <div className="file-breadcrumb file-breadcrumb--compact">
                    <span
                      className="file-crumb"
                      onClick={() => refreshList(inHomePath ? '/root' : '/')}
                    >
                      {inHomePath ? '~' : '/'}
                    </span>
                    {displayParts.map((p, i) => (
                      <React.Fragment key={i}>
                        <span className="file-crumb-sep">/</span>
                        <span className="file-crumb" onClick={() => handleBreadcrumb(inHomePath ? i + 1 : i)}>
                          {p}
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
                <div className="files-explorer-nav__tools">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm files-explorer-nav__dot-toggle"
                    onClick={() => setShowHidden((v) => !v)}
                    disabled={running}
                    aria-pressed={showHidden}
                    title={showHidden ? t('files.hideDot', '隐藏 .文件') : t('files.showDot', '显示 .文件')}
                  >
                    {showHidden ? t('files.hideDot', '隐藏 .文件') : t('files.showDot', '显示 .文件')}
                  </button>
                  <div className="files-explorer-nav__search-wrap">
                    <Search size={14} className="files-explorer-nav__search-icon" strokeWidth={2} aria-hidden />
                    <input
                      className="input files-explorer-nav__search"
                      ref={searchInputRef}
                      placeholder={t('files.searchPh', '搜索当前目录...')}
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      aria-label={t('files.searchPh', '搜索当前目录...')}
                    />
                  </div>
                  <select
                    className="input files-explorer-nav__sort"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'type' | 'name' | 'date')}
                    aria-label={t('files.sort.type', '按类型')}
                  >
                    <option value="type">{t('files.sort.type', '按类型')}</option>
                    <option value="name">{t('files.sort.name', '按名称')}</option>
                    <option value="date">{t('files.sort.date', '按时间')}</option>
                  </select>
                </div>
              </div>
              <div className="files-explorer-nav__shortcuts">
                <span className="files-explorer-nav__label">{t('files.navPlaces', '快捷')}</span>
                <button
                  type="button"
                  className="files-explorer-chip"
                  onClick={() => refreshList('/root')}
                  disabled={running}
                  title={t('files.home', '~/ 主目录')}
                >
                  <Home size={13} strokeWidth={2} aria-hidden />
                  {t('files.homeShort', '主目录')}
                </button>
                <button
                  type="button"
                  className="files-explorer-chip"
                  onClick={() => refreshList('/')}
                  disabled={running}
                  title={t('files.root', '/ 根目录')}
                >
                  {t('files.rootShort', '根目录')}
                </button>
                {FILE_QUICK_PATHS.map((quickPath) => (
                  <button
                    key={quickPath}
                    type="button"
                    className="files-explorer-chip"
                    title={quickPath}
                    onClick={() => refreshList(quickPath)}
                    disabled={running}
                  >
                    {quickPath.startsWith('/') ? quickPath.slice(1) : quickPath}
                  </button>
                ))}
              </div>
            </div>

            {selectedEntry && (
              <div className="files-selection-bar">
                <div className="files-selection-bar__info files-selection-bar__info--with-icon">
                  <span className="files-row-icon" aria-hidden>
                    {selectedEntry.isDir ? <Folder size={16} strokeWidth={2} /> : <FileText size={16} strokeWidth={2} />}
                  </span>
                  {tf('files.selected', '已选择：{{name}} (Enter 打开 / F2 重命名 / Ctrl+F 搜索)', {
                    name: selectedEntry.name,
                  })}
                </div>
                <div className="files-selection-bar__actions">
                  {selectedEntry.isDir ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleNavigate(selectedEntry.name)}>{t('files.openDir', '打开目录')}</button>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => runEdit(selectedEntry.name)}>{t('files.edit', '编辑')}</button>
                  )}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => runDownload(selectedEntry.name, selectedEntry.isDir)}>{t('files.download', '下载')}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => renameEntry(selectedEntry.name)}>{t('files.rename', '重命名')}</button>
                </div>
              </div>
            )}

            <div 
              className={`tool-content ${dragActive ? 'is-drag-active' : ''}`}
              style={{ 
                flex: 1, 
                minHeight: 0,
                overflow: 'auto', 
                padding: 0, 
                position: 'relative', 
                border: '1px solid var(--border-strong)',
                backgroundColor: dragActive ? 'var(--accent-subtle)' : 'var(--bg-elevated)'
              }}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              {dragActive && (
                <div className="files-drop-overlay" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-overlay)', zIndex: 10, fontSize: 20, color: 'var(--accent)', fontWeight: 600, pointerEvents: 'none' }}>
                  {t('files.drop', '松开鼠标以上传文件至此目录')}
                </div>
              )}
              <table
                className="file-table"
                style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}
                onContextMenu={handleTableContextMenu}
              >
                <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 5, boxShadow: 'var(--shadow-sm)' }}>
                  <tr>
                    <th className="th" style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary)', width: '50%' }}>{t('files.col.name', '文件名称')}</th>
                    <th className="th" style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary)', width: '15%' }}>{t('files.col.size', '大小')}</th>
                    <th className="th" style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary)', width: '20%' }}>{t('files.col.date', '修改日期')}</th>
                    <th className="th" style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary)', width: '15%', textAlign: 'right' }}>{t('files.col.actions', '操作')}</th>
                  </tr>
                </thead>
                <tbody>
                  {currentPath !== '/' && (
                    <tr data-file="__parent__" style={{ borderBottom: '1px solid var(--border)' }}>
                      <td className="td" style={{ padding: '14px 16px', cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 500 }} onClick={handleGoUp}>
                        <span className="files-row-icon" style={{ marginRight: 10 }} aria-hidden>
                          <FolderOpen size={18} strokeWidth={2} />
                        </span>
                        {t('files.parent', '.. (上一级)')}
                      </td>
                      <td className="td"></td><td className="td"></td><td className="td"></td>
                    </tr>
                  )}
                  {visibleEntries.map((entry) => (
                    <tr
                      key={entry.name}
                      data-file={entry.name}
                      className={selectedName === entry.name ? 'selected' : ''}
                      style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s', background: 'var(--bg-elevated)' }}
                      onClick={() => setSelectedName(entry.name)}
                      onDoubleClick={() => entry.isDir ? handleNavigate(entry.name) : runEdit(entry.name)}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = selectedName === entry.name ? 'var(--accent-subtle)' : 'var(--bg-elevated)'}
                    >
                      <td 
                        className="td"
                        style={{ padding: '14px 16px', cursor: entry.isDir ? 'pointer' : 'default', color: entry.isDir ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: entry.isDir ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} 
                        onClick={() => entry.isDir && handleNavigate(entry.name)}
                        title={entry.name}
                      >
                        <span className="files-row-icon" style={{ marginRight: 10 }} aria-hidden>
                          {entry.isDir ? <Folder size={18} strokeWidth={2} /> : <FileText size={18} strokeWidth={2} />}
                        </span>
                        {entry.name}
                      </td>
                      <td className="td mono" style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: 13 }}>{entry.isDir ? '-' : entry.size}</td>
                      <td className="td mono" style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: 13 }}>{entry.date}</td>
                      <td className="td" style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div className="tool-bar-right" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          {!entry.isDir && (
                            <button className="btn btn-ghost btn-sm" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => runEdit(entry.name)}>{t('files.edit', '编辑')}</button>
                          )}
                          <button className="btn btn-ghost btn-sm" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => renameEntry(entry.name)}>{t('files.rename', '重命名')}</button>
                          <button className="btn btn-ghost btn-sm" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => runDownload(entry.name, entry.isDir)}>{t('files.download', '下载')}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {visibleEntries.length === 0 && !running && (
                    <tr data-file="__empty__">
                      <td colSpan={4} className="td" style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 15 }}>
                        {searchText.trim() ? t('files.empty.search', '未找到匹配文件，请调整搜索关键词') : t('files.empty.folder', '此文件夹为空，您可以拖拽文件到此处上传')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {ctxMenu && (() => {
        const { x, y, target } = ctxMenu;
        return (
          <div
            ref={ctxMenuRef}
            className="files-ctx-menu"
            style={{ left: x, top: y }}
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {target === 'blank' && (
              <>
                <button
                  type="button"
                  className="files-ctx-menu__item"
                  onClick={() => {
                    closeCtxMenu();
                    void createFolder();
                  }}
                >
                  {t('files.newFolder', '新建文件夹')}
                </button>
                <button
                  type="button"
                  className="files-ctx-menu__item"
                  onClick={() => {
                    closeCtxMenu();
                    refreshList();
                  }}
                >
                  {t('files.refresh', '刷新')}
                </button>
              </>
            )}
            {target === 'parent' && (
              <>
                <button
                  type="button"
                  className="files-ctx-menu__item"
                  onClick={() => {
                    closeCtxMenu();
                    handleGoUp();
                  }}
                >
                  {t('files.ctx.parent', '返回上一级')}
                </button>
                <button
                  type="button"
                  className="files-ctx-menu__item"
                  onClick={() => {
                    closeCtxMenu();
                    refreshList();
                  }}
                >
                  {t('files.refresh', '刷新')}
                </button>
              </>
            )}
            {target !== 'blank' && target !== 'parent' && (
              <>
                {target.isDir ? (
                  <button
                    type="button"
                    className="files-ctx-menu__item"
                    onClick={() => {
                      closeCtxMenu();
                      handleNavigate(target.name);
                    }}
                  >
                    {t('files.ctx.open', '打开')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="files-ctx-menu__item"
                    onClick={() => {
                      closeCtxMenu();
                      runEdit(target.name);
                    }}
                  >
                    {t('files.ctx.edit', '编辑')}
                  </button>
                )}
                <button
                  type="button"
                  className="files-ctx-menu__item"
                  onClick={() => {
                    closeCtxMenu();
                    runDownload(target.name, target.isDir);
                  }}
                >
                  {t('files.ctx.download', '下载')}
                </button>
                <button
                  type="button"
                  className="files-ctx-menu__item"
                  onClick={() => {
                    closeCtxMenu();
                    void renameEntry(target.name);
                  }}
                >
                  {t('files.ctx.rename', '重命名')}
                </button>
                <button
                  type="button"
                  className="files-ctx-menu__item"
                  onClick={() => {
                    closeCtxMenu();
                    copyEntryPath(target.name);
                  }}
                >
                  {t('files.ctx.copyPath', '复制路径')}
                </button>
                <div className="files-ctx-menu__sep" role="separator" />
                <button
                  type="button"
                  className="files-ctx-menu__item files-ctx-menu__item--danger"
                  onClick={() => {
                    closeCtxMenu();
                    void deleteEntry(target.name);
                  }}
                >
                  {t('files.ctx.delete', '删除')}
                </button>
              </>
            )}
          </div>
        );
      })()}

      {searchMatches.length > 0 && (
        <div className="modal-overlay" onClick={() => setSearchMatches([])}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ width: 480 }}>
            <div className="modal-title">{t('files.modal.title', '发现同名文件/文件夹')}</div>
            <div className="modal-desc" style={{ marginBottom: 16 }}>{tf('files.modal.desc', '在设备中全盘搜寻到了共 {{n}} 个结果，请选择您需要下载的具体路径：', { n: searchMatches.length })}</div>
            <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {searchMatches.map((m, i) => (
                <button
                  key={i}
                  className="btn btn-ghost btn-sm"
                  style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#f8fafc' }}
                  onClick={() => {
                     setSearchMatches([]);
                     runDownloadRef.current?.(m.path, m.isDir);
                  }}
                >
                  <span style={{ wordBreak: 'break-all', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span className="files-row-icon" aria-hidden>
                      {m.isDir ? <Folder size={16} strokeWidth={2} /> : <FileText size={16} strokeWidth={2} />}
                    </span>
                    {m.path}
                  </span>
                  <span style={{ fontSize: 12, color: '#64748b', flexShrink: 0 }}>{m.isDir ? t('files.type.dir', '文件夹') : t('files.type.file', '文件')}</span>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost btn-sm" style={{ width: '100%' }} onClick={() => setSearchMatches([])}>{t('files.modal.cancel', '取消下载')}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
