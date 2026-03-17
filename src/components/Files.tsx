import React, { useState, useEffect, useRef } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import { Loader2, RefreshCw, Upload, ArrowLeft } from 'lucide-react';

// 使用国内极速镜像源，避免因为 unpkg 无法连接导致「代码编辑」模块卡白屏加载不到一直启动不了的问题
loader.config({ paths: { vs: 'https://fastly.jsdelivr.net/npm/monaco-editor@0.43.0/min/vs' } });

import { downloadDeviceFile, listDeviceFiles, readDeviceFile, writeDeviceFile, uploadDeviceFile, executeDeviceCommand } from '../api';
import { useAppState } from '../hooks/useAppState';

export default function Files() {
  const { currentDevice, addToast } = useAppState();
  const [currentPath, setCurrentPath] = useState('/root');
  const [entries, setEntries] = useState<Array<{ name: string; isDir: boolean; size?: string; date?: string }>>([]);
  const [running, setRunning] = useState(false);
  const [editorFile, setEditorFile] = useState<{ path: string; content: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [searchMatches, setSearchMatches] = useState<Array<{path: string; isDir: boolean}>>([]);

  const runDownloadRef = useRef<any>(null);

  const deviceRef = useRef(currentDevice);
  useEffect(() => { deviceRef.current = currentDevice; }, [currentDevice]);

  useEffect(() => {
    const handleUploadEvent = () => fileInputRef.current?.click();
    const handleDownloadEvent = async (e: any) => {
      const rawName = e.detail?.trim() || '';
      const fileName = rawName.split('/').pop() || rawName; // 提取纯文件名，忽略包含的路径或波浪号
      if (!fileName) {
        addToast('请指定要下载的文件名，例如：下载 test.txt', 'warning');
        return;
      }
      const target = entriesRef.current.find((en) => en.name === fileName);
      if (target) {
        runDownloadRef.current?.(target.name, target.isDir);
      } else {
        if (!deviceRef.current) {
          addToast('请先连接设备获取文件', 'warning');
          return;
        }
        addToast(`当前目录未找到，正在全盘深入搜索 ${fileName}...`, 'info');
        try {
          const res = await executeDeviceCommand(deviceRef.current.id, `for p in $(find /userdata /root /home/sunrise /var/log /etc -name "${fileName}" 2>/dev/null | head -n 10); do if [ -d "$p" ]; then echo "DIR:$p"; else echo "FILE:$p"; fi; done`);
          const lines = res.output.split(/\\r?\\n/).map(l => l.trim().replace(/Command completed without output\\.?/i, '')).filter(l => l && (l.startsWith('DIR:/') || l.startsWith('FILE:/')));
          
          if (lines.length === 1) {
            const isDir = lines[0].startsWith('DIR:');
            const foundPath = lines[0].substring(lines[0].indexOf('/'));
            addToast(`🔍 自动获取匹配项：${foundPath}`, 'success');
            runDownloadRef.current?.(foundPath, isDir);
          } else if (lines.length > 1) {
            addToast(`🔍 找到 ${lines.length} 个结果，请手动选择`, 'info');
            setSearchMatches(lines.map(l => ({
               path: l.substring(l.indexOf('/')),
               isDir: l.startsWith('DIR:')
            })));
          } else {
            addToast(`全盘搜索失败，未找到: ${fileName}`, 'error');
          }
        } catch (err) {
          addToast('全盘搜索发生错误', 'error');
        }
      }
    };
    window.addEventListener('AI_FILE_UPLOAD', handleUploadEvent);
    window.addEventListener('AI_FILE_DOWNLOAD', handleDownloadEvent);
    return () => {
      window.removeEventListener('AI_FILE_UPLOAD', handleUploadEvent);
      window.removeEventListener('AI_FILE_DOWNLOAD', handleDownloadEvent);
    };
  }, []);

  const entriesRef = useRef(entries);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  const ensureDevice = () => {
    if (!currentDevice) {
      addToast('请先连接真实设备', 'warning');
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
      })
      .catch((err) => addToast(err instanceof Error ? err.message : '刷新目录失败', 'error'))
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

  const handleBreadcrumb = (index: number) => {
    const parts = currentPath.split('/').filter(Boolean);
    const nextPath = '/' + parts.slice(0, index + 1).join('/');
    refreshList(nextPath);
  };

  const runDownload = (fileName: string, isFolder: boolean) => {
    if (!ensureDevice() || !currentDevice) return;
    const filePath = fileName.startsWith('/') ? fileName : (currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`);
    const actualName = fileName.split('/').pop() || 'download';
    addToast(isFolder ? '开始压缩并下载...' : '开始下载...', 'info');
    downloadDeviceFile(currentDevice.id, filePath)
      .then((res) => {
        if (!res.contentBase64) {
          addToast('未获取到文件内容', 'warning');
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
      .catch((err) => addToast(err instanceof Error ? err.message : '下载文件失败', 'error'));
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
      .catch((err) => addToast(err instanceof Error ? err.message : '读取文件失败', 'error'))
      .finally(() => setRunning(false));
  };

  const runSaveEdit = () => {
    if (!ensureDevice() || !currentDevice || !editorFile) return;
    setRunning(true);
    writeDeviceFile(currentDevice.id, editorFile.path, editorFile.content)
      .then(() => {
        addToast('文件已保存', 'success');
        setEditorFile(null);
        refreshList();
      })
      .catch((err) => addToast(err instanceof Error ? err.message : '保存文件失败', 'error'))
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
      addToast(`正在上传 ${file.name}...`, 'info');
      const base64 = await toBase64(file);
      const targetPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      await uploadDeviceFile(currentDevice.id, targetPath, base64);
      addToast('上传成功', 'success');
      refreshList();
    } catch (err: any) {
      addToast(err.message || '上传失败', 'error');
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

  return (
    <div className="center-stage wide-stage" style={{ minHeight: '82vh', height: '82vh', display: 'flex', flexDirection: 'column' }}>
      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      <div className="isolated-widget workflow-widget" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="widget-header">
          📁 资源管理器
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, fontSize: 13, fontWeight: 'normal' }}>
            <button className="clean-btn outline-btn" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6, transition: 'background-color 0.2s' }} onClick={() => refreshList()} disabled={running} onMouseEnter={(e) => !running && (e.currentTarget.style.backgroundColor = '#f1f5f9')} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ''}>
              {running ? <Loader2 size={16} key="spin" style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={16} />}
              刷新
            </button>
            <button className="clean-btn" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6, transition: 'background-color 0.2s', backgroundColor: '#0284c7', color: '#fff' }} onClick={() => fileInputRef.current?.click()} disabled={running} onMouseEnter={(e) => !running && (e.currentTarget.style.backgroundColor = '#0369a1')} onMouseLeave={(e) => !running && (e.currentTarget.style.backgroundColor = '#0284c7')}>
              {running ? <Loader2 size={16} key="spin" style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={16} />}
              上传文件
            </button>
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} />
          </div>
        </div>
        
        {editorFile ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="panel-card" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', flexShrink: 0 }}>
              <button className="clean-btn outline-btn" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }} onClick={() => setEditorFile(null)}>
                <ArrowLeft size={16} /> 返回
              </button>
              <div style={{ width: 1, height: 20, background: '#cbd5e1' }}></div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#334155', display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: '#94a3b8' }}>{editorFile.path.substring(0, editorFile.path.lastIndexOf('/')) || '/'}</span>
                <span style={{ color: '#94a3b8' }}>/</span>
                <span>{editorFile.path.substring(editorFile.path.lastIndexOf('/') + 1)}</span>
              </div>
            </div>
            <div style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
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
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
              <button className="clean-btn" style={{ minWidth: 120, padding: '10px 24px', fontSize: 14, background: '#0284c7', color: '#fff', border: 'none', borderRadius: 8 }} onClick={runSaveEdit} disabled={running}>
                {running ? '保存中...' : '💾 保存修改'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="panel-card" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 8, flexWrap: 'wrap', background: '#f8fafc', border: '1px solid #e2e8f0', flexShrink: 0 }}>
              <button className="clean-btn outline-btn" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => refreshList('/root')} disabled={running}>🏠 Home</button>
              <button className="clean-btn outline-btn" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => refreshList('/')} disabled={running}>/ 根目录</button>
              <div style={{ flex: 1, marginLeft: 10, display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
                <span style={{ cursor: 'pointer', color: '#0284c7', fontWeight: 500 }} onClick={() => refreshList('/')}>Root</span>
                {parts.map((p, i) => (
                  <React.Fragment key={i}>
                    <span style={{ color: '#94a3b8' }}>/</span>
                    <span style={{ cursor: 'pointer', color: '#0284c7', fontWeight: 500 }} onClick={() => handleBreadcrumb(i)}>{p}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>

            <div 
              className="panel-card" 
              style={{ 
                flex: 1, 
                minHeight: 0,
                overflow: 'auto', 
                padding: 0, 
                position: 'relative', 
                border: '1px solid #cbd5e1',
                backgroundColor: dragActive ? '#f0f9ff' : '#ffffff'
              }}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              {dragActive && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(240, 249, 255, 0.8)', zIndex: 10, fontSize: 20, color: '#0284c7', fontWeight: 600, pointerEvents: 'none' }}>
                  松开鼠标以长传文件至此目录
                </div>
              )}
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
                <thead style={{ position: 'sticky', top: 0, background: '#f1f5f9', zIndex: 5, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                  <tr>
                    <th style={{ padding: '14px 16px', fontWeight: 600, color: '#475569', width: '50%' }}>文件名称</th>
                    <th style={{ padding: '14px 16px', fontWeight: 600, color: '#475569', width: '15%' }}>大小</th>
                    <th style={{ padding: '14px 16px', fontWeight: 600, color: '#475569', width: '20%' }}>修改日期</th>
                    <th style={{ padding: '14px 16px', fontWeight: 600, color: '#475569', width: '15%', textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {currentPath !== '/' && (
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '14px 16px', cursor: 'pointer', color: '#1e293b', fontWeight: 500 }} onClick={() => handleNavigate('..')}>
                        <span style={{ marginRight: 10, fontSize: 18 }}>📂</span>.. (上一级)
                      </td>
                      <td></td><td></td><td></td>
                    </tr>
                  )}
                  {entries.map((entry) => (
                    <tr key={entry.name} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.2s', background: '#ffffff' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = '#ffffff'}>
                      <td 
                        style={{ padding: '14px 16px', cursor: entry.isDir ? 'pointer' : 'default', color: entry.isDir ? '#0f172a' : '#334155', fontWeight: entry.isDir ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} 
                        onClick={() => entry.isDir && handleNavigate(entry.name)}
                        title={entry.name}
                      >
                        <span style={{ marginRight: 10, fontSize: 18 }}>{entry.isDir ? '📁' : '📄'}</span>
                        {entry.name}
                      </td>
                      <td style={{ padding: '14px 16px', color: '#64748b', fontSize: 13 }}>{entry.isDir ? '-' : entry.size}</td>
                      <td style={{ padding: '14px 16px', color: '#64748b', fontSize: 13 }}>{entry.date}</td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          {!entry.isDir && (
                            <button className="clean-btn outline-btn" style={{ padding: '4px 10px', fontSize: 12, background: '#fff' }} onClick={() => runEdit(entry.name)}>编辑</button>
                          )}
                          <button className="clean-btn outline-btn" style={{ padding: '4px 10px', fontSize: 12, background: '#fff' }} onClick={() => runDownload(entry.name, entry.isDir)}>下载</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {entries.length === 0 && !running && (
                    <tr>
                      <td colSpan={4} style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 15 }}>此文件夹为空，您可以拖拽文件到此处上传</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {searchMatches.length > 0 && (
        <div className="modal-overlay" onClick={() => setSearchMatches([])}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ width: 480 }}>
            <div className="modal-title">发现同名文件/文件夹</div>
            <div className="modal-desc" style={{ marginBottom: 16 }}>在设备中全盘搜寻到了共 {searchMatches.length} 个结果，请选择您需要下载的具体路径：</div>
            <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {searchMatches.map((m, i) => (
                <button
                  key={i}
                  className="clean-btn outline-btn"
                  style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#f8fafc' }}
                  onClick={() => {
                     setSearchMatches([]);
                     runDownloadRef.current?.(m.path, m.isDir);
                  }}
                >
                  <span style={{ wordBreak: 'break-all' }}>📄 {m.path}</span>
                  <span style={{ fontSize: 12, color: '#64748b', flexShrink: 0 }}>{m.isDir ? '文件夹' : '文件'}</span>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="clean-btn outline-btn" style={{ width: '100%' }} onClick={() => setSearchMatches([])}>取消下载</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
