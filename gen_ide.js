const fs = require('fs');

const ideCode = \import { useState, useEffect } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import { listDeviceFiles, readDeviceFile, writeDeviceFile } from '../api';
import { useAppState } from '../hooks/useAppState';
import { Folder, FileText, ChevronLeft, Save, RefreshCw } from 'lucide-react';

loader.config({ paths: { vs: 'https://fastly.jsdelivr.net/npm/monaco-editor@0.43.0/min/vs' } });

export default function IDE() {
  const { currentDevice, addToast } = useAppState();
  const [currentPath, setCurrentPath] = useState('/root');
  const [entries, setEntries] = useState<Array<{ name: string; isDir: boolean }>>([]);
  const [running, setRunning] = useState(false);
  const [editorFile, setEditorFile] = useState<{ path: string; content: string } | null>(null);

  const parseListOutput = (raw: string) => {
    return raw.split(/\\r?\\n/).map(line => line.trim()).filter(line => line && !line.startsWith('total '))
      .map(line => {
        const parts = line.split(/\\s+/);
        const mode = parts[0] || '';
        const name = parts.slice(8).join(' ');
        return { name, isDir: mode.startsWith('d') };
      })
      .filter(item => item.name && item.name !== '.' && item.name !== '..');
  };

  const refreshList = (path = currentPath) => {
    if (!currentDevice) return;
    setRunning(true);
    listDeviceFiles(currentDevice.id, path)
      .then((res) => {
        setEntries(parseListOutput(res.output || ''));
        setCurrentPath(path);
      })
      .catch((err) => addToast(err instanceof Error ? err.message : 'Failed to refresh', 'error'))
      .finally(() => setRunning(false));
  };

  useEffect(() => {
    if (currentDevice) refreshList(currentPath);
  }, [currentDevice?.id]);

  const handleEntityClick = (name: string, isDir: boolean) => {
    const fullPath = currentPath === '/' ? '/' + name : currentPath + '/' + name;
    if (isDir) {
      refreshList(fullPath);
    } else {
      setRunning(true);
      readDeviceFile(currentDevice!.id, fullPath, 5000)
        .then(res => {
          let text = res.output || '';
          if (res.contentBase64) {
            try { text = new TextDecoder('utf-8').decode(Uint8Array.from(atob(res.contentBase64), c => c.charCodeAt(0))); } catch(e) {}
          }
          setEditorFile({ path: fullPath, content: text });
        })
        .catch(err => addToast(err.message || 'Read failed', 'error'))
        .finally(() => setRunning(false));
    }
  };

  const saveFile = () => {
    if (!currentDevice || !editorFile) return;
    setRunning(true);
    writeDeviceFile(currentDevice.id, editorFile.path, editorFile.content)
      .then(() => addToast('File saved successfully', 'success'))
      .catch((err) => addToast(err.message, 'error'))
      .finally(() => setRunning(false));
  };

  return (
    <div className="center-stage wide-stage" style={{ display: 'flex', gap: '16px', height: '100%', padding: '16px', boxSizing: 'border-box' }}>
      <div className="panel-card" style={{ width: '280px', display: 'flex', flexDirection: 'column', padding: '12px', flexShrink: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ fontWeight: 600, fontSize: '15px' }}>Device Files</div>
          <button className="clean-btn" onClick={() => refreshList()} disabled={running}>
            <RefreshCw size={14} className={running ? 'spin-anim' : ''} />
          </button>
        </div>
        
        <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px', wordBreak: 'break-all' }}>
          {currentPath !== '/' && (
            <span style={{ cursor: 'pointer', color: '#3b82f6', marginRight: '6px' }} onClick={() => {
              const parts = currentPath.split('/').filter(Boolean);
              parts.pop();
              refreshList('/' + parts.join('/'));
            }}>
              <ChevronLeft size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> Back
            </span>
          )}
          {currentPath}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {entries.map(e => (
            <div key={e.name} onClick={() => handleEntityClick(e.name, e.isDir)}
              style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', margin: '2px 0', borderRadius: '4px', cursor: 'pointer', backgroundColor: editorFile?.path.endsWith('/' + e.name) ? '#e0f2fe' : 'transparent', color: '#334155', fontSize: '14px' }}
              onMouseEnter={(ev) => (ev.currentTarget.style.backgroundColor = '#f1f5f9')}
              onMouseLeave={(ev) => (ev.currentTarget.style.backgroundColor = editorFile?.path.endsWith('/' + e.name) ? '#e0f2fe' : 'transparent')}
            >
              {e.isDir ? <Folder size={16} color="#3b82f6" style={{ marginRight: '8px' }}/> : <FileText size={16} color="#64748b" style={{ marginRight: '8px' }}/>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
            </div>
          ))}
          {entries.length === 0 && !running && <div style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', marginTop: '20px' }}>Empty Folder</div>}
        </div>
      </div>

      <div className="panel-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
        {editorFile ? (
          <>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
              <div style={{ fontSize: '14px', fontWeight: 500 }}>{editorFile.path}</div>
              <button className="clean-btn outline-btn" onClick={saveFile} disabled={running} style={{ padding: '4px 12px', height: '28px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Save size={14} /> Save
              </button>
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
              <Editor
                height="100%"
                language={editorFile.path.split('.').pop()?.toLowerCase() === 'ts' ? 'typescript' : 
                         editorFile.path.split('.').pop()?.toLowerCase() === 'js' ? 'javascript' : 
                         editorFile.path.split('.').pop()?.toLowerCase() === 'py' ? 'python' : 
                         editorFile.path.split('.').pop()?.toLowerCase() === 'json' ? 'json' : 'plaintext'}
                theme="vs-light"
                value={editorFile.content}
                onChange={(val) => setEditorFile({ ...editorFile, content: val || '' })}
                options={{ minimap: { enabled: false }, fontSize: 14, wordWrap: 'on' }}
              />
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8' }}>
            <FileText size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
            <div style={{ fontSize: '16px' }}>Select a file from the sidebar to edit</div>
          </div>
        )}
      </div>
    </div>
  );
}
\;

fs.writeFileSync('src/components/IDE.tsx', ideCode, 'utf8');
