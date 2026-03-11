import { useState, useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';

/* -- Mock file-system tree -- */
interface FsNode {
  name: string;
  type: 'dir' | 'file';
  size?: string;
  modified?: string;
  hint?: string;
  children?: FsNode[];
}

const LOCAL_TREE: FsNode[] = [
  { name: 'models', type: 'dir', hint: '2 个待上传', children: [
    { name: 'yolov5s_nv12.bin', type: 'file', size: '14.2 MB', modified: '2024-06-10' },
    { name: 'fcos_512x512.bin', type: 'file', size: '8.7 MB', modified: '2024-06-08' },
  ]},
  { name: 'records', type: 'dir', children: [
    { name: 'rosbag_2024-06-10.bag', type: 'file', size: '120 MB', modified: '2024-06-10' },
  ]},
  { name: 'configs', type: 'dir', children: [
    { name: 'camera.yaml', type: 'file', size: '1.2 KB', modified: '2024-06-09' },
    { name: 'nav_params.yaml', type: 'file', size: '3.4 KB', modified: '2024-06-07' },
  ]},
  { name: 'launch.py', type: 'file', size: '2.1 KB', modified: '2024-06-10', hint: '启动脚本' },
  { name: 'README.md', type: 'file', size: '0.8 KB', modified: '2024-06-05' },
];

const REMOTE_TREE: FsNode[] = [
  { name: 'app', type: 'dir', children: [
    { name: 'main_pipeline', type: 'file', size: '5.4 MB', modified: '2024-06-10' },
    { name: 'config.json', type: 'file', size: '0.5 KB', modified: '2024-06-10' },
  ]},
  { name: 'userdata', type: 'dir', children: [
    { name: 'models', type: 'dir', children: [
      { name: 'yolov5s_nv12.bin', type: 'file', size: '14.2 MB', modified: '2024-06-08' },
    ]},
    { name: 'videos', type: 'dir', children: [] },
  ]},
  { name: 'logs', type: 'dir', hint: '有新内容', children: [
    { name: 'syslog', type: 'file', size: '45 KB', modified: '2024-06-10' },
    { name: 'ros2.log', type: 'file', size: '12 KB', modified: '2024-06-10' },
  ]},
  { name: 'claw_pipeline.yaml', type: 'file', size: '1.8 KB', modified: '2024-06-09', hint: 'OpenClaw 配置' },
  { name: 'start_ros.sh', type: 'file', size: '0.3 KB', modified: '2024-06-06' },
];

/* -- File Pane with folder browsing -- */
function FilePane({ title, rootPath, tree, selected, onSelect, onTransfer, transferLabel }: {
  title: string; rootPath: string; tree: FsNode[];
  selected: Set<string>; onSelect: (path: string) => void;
  onTransfer: () => void; transferLabel: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cwd, setCwd] = useState<string[]>([]);

  const toggleExpand = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const navigateInto = useCallback((dirName: string) => {
    setCwd(prev => [...prev, dirName]);
  }, []);

  const navigateTo = useCallback((index: number) => {
    setCwd(prev => prev.slice(0, index));
  }, []);

  const resolveDir = (path: string[]): FsNode[] => {
    let nodes = tree;
    for (const seg of path) {
      const dir = nodes.find(n => n.name === seg && n.type === 'dir');
      if (dir?.children) nodes = dir.children;
      else return [];
    }
    return nodes;
  };

  const currentNodes = resolveDir(cwd);
  const fullPath = (name: string) => [...cwd, name].join('/');

  const renderNode = (node: FsNode, depth: number = 0) => {
    const path = fullPath(node.name);
    const isSelected = selected.has(path);
    const isDir = node.type === 'dir';
    const isOpen = expanded.has(path);

    return (
      <div key={path}>
        <div
          className={`fm-row ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => onSelect(path)}
          onDoubleClick={() => isDir && navigateInto(node.name)}
        >
          <span className="fm-row-icon">
            {isDir ? (
              <span className="fm-folder-toggle" onClick={e => { e.stopPropagation(); toggleExpand(path); }}>
                {isOpen ? '📂' : '📁'}
              </span>
            ) : '📄'}
          </span>
          <span className="fm-row-name">{node.name}</span>
          {node.size && <span className="fm-row-meta">{node.size}</span>}
          {node.hint && <span className="fm-row-hint">{node.hint}</span>}
          {isDir && (
            <button className="fm-row-enter" onClick={e => { e.stopPropagation(); navigateInto(node.name); }} title="进入目录">
              →
            </button>
          )}
        </div>
        {isDir && isOpen && node.children?.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="panel-card fm-pane">
      <div className="fm-pane-header">
        <div className="fm-pane-title">{title}</div>
        <div className="fm-breadcrumb">
          <span className="fm-crumb-seg clickable" onClick={() => navigateTo(0)}>{rootPath}</span>
          {cwd.map((seg, i) => (
            <span key={i}>
              <span className="fm-crumb-sep">/</span>
              <span className="fm-crumb-seg clickable" onClick={() => navigateTo(i + 1)}>{seg}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="fm-file-list">
        {cwd.length > 0 && (
          <div className="fm-row" onClick={() => setCwd(prev => prev.slice(0, -1))}>
            <span className="fm-row-icon">⬆️</span>
            <span className="fm-row-name" style={{ color: '#94a3b8' }}>..</span>
          </div>
        )}
        {currentNodes.length === 0 && (
          <div className="fm-empty">空目录</div>
        )}
        {currentNodes.map(node => renderNode(node))}
      </div>
      <div className="fm-pane-footer">
        <span className="fm-selected-count">{selected.size > 0 ? `${selected.size} 项已选` : '未选择'}</span>
        <button className="clean-btn outline-btn sm-btn" onClick={onTransfer} disabled={selected.size === 0}>
          {transferLabel}
        </button>
      </div>
    </div>
  );
}

/* -- Main Files component -- */
export default function Files() {
  const { currentDevice, transferQueue, appendTransferTask, addToast, setActiveTab } = useAppState();

  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set());
  const [remoteSelected, setRemoteSelected] = useState<Set<string>>(new Set());

  const completedCount = transferQueue.filter(t => t.status === 'done').length;
  const runningCount = transferQueue.filter(t => t.status !== 'done').length;

  const toggleSelect = (_set: Set<string>, setFn: React.Dispatch<React.SetStateAction<Set<string>>>, path: string) => {
    setFn(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  return (
    <div className="center-stage wide-stage">
      <div className="isolated-widget workflow-widget">
        <div className="widget-header">📁 文件管理</div>
        <div className="desc-text">浏览本地和设备文件夹，双击进入目录，单击选择文件后传输。</div>

        <div className="ai-recommend-strip" style={{ marginBottom: 14 }}>
          <span className="ai-suggest-label">🧠 AI 建议</span>
          <span className="ai-recommend-text">
            检测到远程 <strong>logs/</strong> 目录有新日志 ·
            <strong>models/</strong> 下有未同步的模型文件 ·
            建议:
          </span>
          <button className="clean-btn outline-btn sm-btn" style={{ marginLeft: 8, fontSize: '0.75rem' }} onClick={() => { appendTransferTask(); addToast('AI 自动同步: 下载最新远程日志', 'info'); }}>
            📥 同步日志
          </button>
          <button className="clean-btn outline-btn sm-btn" style={{ fontSize: '0.75rem' }} onClick={() => { appendTransferTask(); addToast('AI 自动同步: 上传本地模型', 'info'); }}>
            📤 同步模型
          </button>
        </div>

        <div className="file-status-strip">
          <span className="card-status-badge ok" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
            <span className="card-status-dot"></span>SFTP
          </span>
          <span className="file-status-text">root@{currentDevice?.ip}:/userdata</span>
          {runningCount > 0 && (
            <span className="file-status-text">{runningCount} 项传输中</span>
          )}
          {completedCount > 0 && (
            <span className="file-status-text" style={{ color: '#16a34a' }}>✅ {completedCount} 项已完成</span>
          )}
        </div>

        <div className="workspace-grid two-column">
          <FilePane
            title="📂 本地工作区"
            rootPath="~/workspace"
            tree={LOCAL_TREE}
            selected={localSelected}
            onSelect={p => toggleSelect(localSelected, setLocalSelected, p)}
            onTransfer={() => { appendTransferTask(); setLocalSelected(new Set()); addToast(`上传 ${localSelected.size} 个文件到设备`, 'info'); }}
            transferLabel="上传所选 →"
          />
          <FilePane
            title={`🛰️ 远程 (${currentDevice?.ip})`}
            rootPath="/userdata"
            tree={REMOTE_TREE}
            selected={remoteSelected}
            onSelect={p => toggleSelect(remoteSelected, setRemoteSelected, p)}
            onTransfer={() => { appendTransferTask(); setRemoteSelected(new Set()); addToast(`下载 ${remoteSelected.size} 个文件到本地`, 'info'); }}
            transferLabel="← 下载所选"
          />
        </div>

        {transferQueue.length > 0 && (
          <div className="transfer-strip">
            <div className="panel-title">传输队列 ({transferQueue.length})</div>
            {transferQueue.map((item) => (
              <div key={item.id} className="transfer-item">
                <div className="transfer-item-head">
                  <span className="transfer-item-name">{item.direction === '上传' ? '⬆️' : '⬇'} {item.name}</span>
                  <span className="transfer-item-status">{item.status === 'done' ? '✅ 完成' : `${item.progress}%`}</span>
                </div>
                <div className="progress-track thin">
                  <div className="progress-fill" style={{ width: `${item.progress}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="chip-btn" onClick={() => addToast('AI 正在同步所有模型文件到设备...', 'info')}>🤖 AI 一键同步模型</button>
          <button className="chip-btn" onClick={() => addToast('AI 正在下载并打包远程日志...', 'info')}>📋 下载全部日志</button>
          <button className="chip-btn" onClick={() => addToast('AI 正在备份远程配置文件...', 'info')}>💾 备份远程配置</button>
          <button className="chip-btn" onClick={() => { setActiveTab('terminal'); addToast('已跳转到终端，可用 scp/rsync 手动操作', 'info'); }}>🖥️ 终端手动操作</button>
        </div>
      </div>
    </div>
  );
}
