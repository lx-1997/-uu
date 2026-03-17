import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAppState } from '../hooks/useAppState';
import { executeDeviceCommand, fetchRosTopics, getRememberedDevicePassword } from '../api';

/* ── Types ── */
interface RosTopic { name: string; type: string; hz: number; }
interface RosNode { name: string; status: 'active' | 'inactive'; }
interface DisplayItem {
  id: string; name: string; icon: string; enabled: boolean;
  type: string; expanded: boolean;
  properties?: { key: string; value: string }[];
}
type ToolId = 'move' | 'select' | 'pose' | 'goal' | 'point' | 'measure';
type PanelTab = 'displays' | 'topics' | 'nodes' | 'services' | 'params';

/* ═══════════════════════════════════════
   Sub-components (defined before main)
   ═══════════════════════════════════════ */

/* ── 3D Viewport ── */
function Viewport3D({ gridVisible, tfVisible, topics, nodes, activeTool, selectedTopic }: {
  gridVisible: boolean; tfVisible: boolean; topics: RosTopic[]; nodes: RosNode[];
  activeTool: string; selectedTopic: string;
}) {
  return (
    <div className="rv2-viewport">
      <svg className="rv2-grid-svg" viewBox="-500 -500 1000 1000" preserveAspectRatio="xMidYMid meet">
        {gridVisible && (
          <g opacity="0.3">
            {Array.from({ length: 21 }, (_, i) => {
              const pos = (i - 10) * 50;
              return (
                <React.Fragment key={i}>
                  <line x1={pos} y1={-500} x2={pos} y2={500} stroke="#555" strokeWidth="0.5" />
                  <line x1={-500} y1={pos} x2={500} y2={pos} stroke="#555" strokeWidth="0.5" />
                </React.Fragment>
              );
            })}
            <line x1="0" y1="0" x2="120" y2="0" stroke="#e74c3c" strokeWidth="2" />
            <line x1="0" y1="0" x2="0" y2="-120" stroke="#2ecc71" strokeWidth="2" />
            <text x="125" y="5" fill="#e74c3c" fontSize="12">X</text>
            <text x="5" y="-125" fill="#2ecc71" fontSize="12">Y</text>
          </g>
        )}
        {tfVisible && (
          <g>
            <circle cx="0" cy="0" r="6" fill="#f39c12" opacity="0.8" />
            <text x="10" y="4" fill="#f39c12" fontSize="10" opacity="0.7">map</text>
            <line x1="0" y1="0" x2="60" y2="-40" stroke="#f39c12" strokeWidth="1" strokeDasharray="4" opacity="0.5" />
            <circle cx="60" cy="-40" r="4" fill="#3498db" opacity="0.8" />
            <text x="68" y="-36" fill="#3498db" fontSize="10" opacity="0.7">base_link</text>
            <line x1="60" y1="-40" x2="120" y2="-80" stroke="#3498db" strokeWidth="1" strokeDasharray="4" opacity="0.5" />
            <circle cx="120" cy="-80" r="3" fill="#9b59b6" opacity="0.8" />
            <text x="128" y="-76" fill="#9b59b6" fontSize="9" opacity="0.7">camera_link</text>
          </g>
        )}
      </svg>
      <div className="rv2-viewport-info">
        <div className="rv2-vp-badge">Tool: {activeTool}</div>
        {selectedTopic && <div className="rv2-vp-badge active">Echo: {selectedTopic}</div>}
        <div className="rv2-vp-badge">Topics: {topics.length} | Nodes: {nodes.length}</div>
      </div>
      <div className="rv2-viewport-hint">Scroll to zoom · Right-drag to pan · Left-drag to rotate</div>
    </div>
  );
}

/* ── Views Panel ── */
function ViewsPanel() {
  const rows = [
    ['Type', 'rviz_default_plugins/Orbit'], ['Target Frame', '<Fixed Frame>'],
    ['Distance', '10.0'], ['Yaw', '0.785'], ['Pitch', '0.785'],
    ['Focal Point', '0; 0; 0'], ['Near Clip', '0.01'], ['Focal Shape Size', '0.05'],
  ];
  return (
    <div className="rv2-views-body">
      {rows.map(([k, v], i) => (
        <div key={i} className="rv2-tree-row rv2-tree-global">
          <span className="rv2-tree-key">{k}</span>
          <span className="rv2-tree-val">{v}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Displays Panel ── */
function DisplaysPanel({ displays, toggleDisplay, toggleExpand }: {
  displays: DisplayItem[]; toggleDisplay: (id: string) => void; toggleExpand: (id: string) => void;
}) {
  return (
    <div className="rv2-display-tree">
      <div className="rv2-tree-header"><span>Global Options</span></div>
      <div className="rv2-tree-row rv2-tree-global">
        <span className="rv2-tree-key">Fixed Frame</span><span className="rv2-tree-val">map</span>
      </div>
      <div className="rv2-tree-row rv2-tree-global">
        <span className="rv2-tree-key">Background Color</span>
        <span className="rv2-tree-val rv2-color-swatch" style={{ background: '#303030' }} />
      </div>
      <div className="rv2-tree-row rv2-tree-global">
        <span className="rv2-tree-key">Frame Rate</span><span className="rv2-tree-val">30</span>
      </div>
      <div className="rv2-tree-sep" />
      {displays.map(d => (
        <div key={d.id} className="rv2-display-item">
          <div className="rv2-display-row" onClick={() => toggleExpand(d.id)}>
            <span className={`rv2-tree-arrow ${d.expanded ? 'open' : ''}`}>▶</span>
            <input type="checkbox" checked={d.enabled} className="rv2-display-check"
              onChange={() => toggleDisplay(d.id)} onClick={e => e.stopPropagation()} />
            <span className="rv2-display-icon">{d.icon}</span>
            <span className={`rv2-display-name ${d.enabled ? '' : 'disabled'}`}>{d.name}</span>
            <span className="rv2-display-type">{d.type.split('/')[1]}</span>
          </div>
          {d.expanded && d.properties && (
            <div className="rv2-display-props">
              {d.properties.map((p, i) => (
                <div key={i} className="rv2-tree-row rv2-prop-row">
                  <span className="rv2-tree-key">{p.key}</span>
                  <span className="rv2-tree-val">{p.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <button className="rv2-add-display-btn">+ Add Display</button>
    </div>
  );
}

/* ── Topic List Panel ── */
function TopicListPanel({ topics, selectedTopic, echoTopic, loading }: {
  topics: RosTopic[]; selectedTopic: string; echoTopic: (t: string) => void; loading: boolean;
}) {
  const [filter, setFilter] = useState('');
  const filtered = topics.filter(t => t.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="rv2-list-panel">
      <div className="rv2-list-search">
        <input className="rv2-list-search-input" placeholder="Filter topics..."
          value={filter} onChange={e => setFilter(e.target.value)} />
      </div>
      <div className="rv2-list-body">
        {filtered.length === 0 && !loading && <div className="rv2-list-empty">No topics found</div>}
        {loading && filtered.length === 0 && <div className="rv2-list-empty">Scanning...</div>}
        {filtered.map(t => (
          <div key={t.name} className={`rv2-list-item ${selectedTopic === t.name ? 'active' : ''}`}
            onClick={() => echoTopic(t.name)}>
            <span className="rv2-list-icon">📡</span>
            <div className="rv2-list-info">
              <div className="rv2-list-name">{t.name}</div>
              <div className="rv2-list-meta">{t.type}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Node List Panel ── */
function NodeListPanel({ nodes }: { nodes: RosNode[] }) {
  return (
    <div className="rv2-list-panel">
      <div className="rv2-list-body">
        {nodes.length === 0 && <div className="rv2-list-empty">No active nodes</div>}
        {nodes.map(n => (
          <div key={n.name} className="rv2-list-item">
            <span className="rv2-list-icon">🔗</span>
            <div className="rv2-list-info">
              <div className="rv2-list-name">{n.name}</div>
              <div className="rv2-list-meta">{n.status}</div>
            </div>
            <span className={`rv2-node-dot ${n.status}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Service List Panel ── */
function ServiceListPanel({ services, deviceId, pw }: { services: string[]; deviceId: string; pw: string }) {
  const [info, setInfo] = useState('');
  const queryType = async (svc: string) => {
    try {
      const res = await executeDeviceCommand(deviceId,
        `ros2 service type ${svc} 2>/dev/null || rosservice type ${svc} 2>/dev/null`, pw);
      setInfo(`${svc}\nType: ${res.output.trim()}`);
    } catch (_) { setInfo('Query failed'); }
  };
  return (
    <div className="rv2-list-panel">
      <div className="rv2-list-body">
        {services.length === 0 && <div className="rv2-list-empty">No services</div>}
        {services.map((s, i) => (
          <div key={i} className="rv2-list-item" onClick={() => queryType(s)}>
            <span className="rv2-list-icon">🔧</span>
            <div className="rv2-list-info"><div className="rv2-list-name">{s}</div></div>
          </div>
        ))}
      </div>
      {info && <pre className="rv2-list-info-box">{info}</pre>}
    </div>
  );
}

/* ── Param List Panel ── */
function ParamListPanel({ params }: { params: string[] }) {
  return (
    <div className="rv2-list-panel">
      <div className="rv2-list-body">
        {params.length === 0 && <div className="rv2-list-empty">No parameters</div>}
        {params.map((p, i) => (
          <div key={i} className="rv2-list-item">
            <span className="rv2-list-icon">⚙️</span>
            <div className="rv2-list-info"><div className="rv2-list-name">{p}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════
   Default display items
   ═══════════════════════════════════════ */
const DEFAULT_DISPLAYS: DisplayItem[] = [
  { id: 'grid', name: 'Grid', icon: '▦', enabled: true, type: 'rviz_default_plugins/Grid', expanded: false,
    properties: [
      { key: 'Reference Frame', value: '<Fixed Frame>' }, { key: 'Plane Cell Count', value: '10' },
      { key: 'Cell Size', value: '1' }, { key: 'Color', value: '160; 160; 164' }, { key: 'Line Style', value: 'Lines' },
    ]},
  { id: 'tf', name: 'TF', icon: '🔀', enabled: true, type: 'rviz_default_plugins/TF', expanded: false,
    properties: [
      { key: 'Show Names', value: 'true' }, { key: 'Show Axes', value: 'true' },
      { key: 'Show Arrows', value: 'true' }, { key: 'Marker Scale', value: '1' },
    ]},
  { id: 'robotmodel', name: 'RobotModel', icon: '🤖', enabled: false, type: 'rviz_default_plugins/RobotModel', expanded: false,
    properties: [
      { key: 'Description Source', value: 'Topic' }, { key: 'Description Topic', value: '/robot_description' },
    ]},
  { id: 'pointcloud', name: 'PointCloud2', icon: '☁️', enabled: false, type: 'rviz_default_plugins/PointCloud2', expanded: false,
    properties: [
      { key: 'Topic', value: '/points' }, { key: 'Size (m)', value: '0.01' }, { key: 'Style', value: 'Flat Squares' },
    ]},
  { id: 'image', name: 'Image', icon: '🖼️', enabled: false, type: 'rviz_default_plugins/Image', expanded: false,
    properties: [{ key: 'Topic', value: '/image_raw' }, { key: 'Transport Hint', value: 'raw' }]},
  { id: 'laserscan', name: 'LaserScan', icon: '📡', enabled: false, type: 'rviz_default_plugins/LaserScan', expanded: false,
    properties: [{ key: 'Topic', value: '/scan' }, { key: 'Size (m)', value: '0.05' }]},
  { id: 'map', name: 'Map', icon: '🗺️', enabled: false, type: 'rviz_default_plugins/Map', expanded: false,
    properties: [{ key: 'Topic', value: '/map' }, { key: 'Alpha', value: '0.7' }]},
  { id: 'marker', name: 'MarkerArray', icon: '📌', enabled: false, type: 'rviz_default_plugins/MarkerArray', expanded: false,
    properties: [{ key: 'Topic', value: '/visualization_marker_array' }]},
];

const TOOLS: { id: ToolId; icon: string; label: string; shortcut?: string }[] = [
  { id: 'move', icon: '🖱️', label: 'Move Camera', shortcut: 'M' },
  { id: 'select', icon: '⬜', label: 'Select', shortcut: 'S' },
  { id: 'pose', icon: '🟢', label: '2D Pose Estimate', shortcut: 'P' },
  { id: 'goal', icon: '🔴', label: '2D Nav Goal', shortcut: 'G' },
  { id: 'point', icon: '📍', label: 'Publish Point' },
  { id: 'measure', icon: '📏', label: 'Measure' },
];

/* ═══════════════════════════════════════
   Main RViz2 Component
   ═══════════════════════════════════════ */
export default function Ros() {
  const { currentDevice } = useAppState();
  const [topics, setTopics] = useState<RosTopic[]>([]);
  const [nodes, setNodes] = useState<RosNode[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [params, setParams] = useState<string[]>([]);
  const [selectedTopic, setSelectedTopic] = useState('');
  const [echoLines, setEchoLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeTool, setActiveTool] = useState<ToolId>('move');
  const [leftTab, setLeftTab] = useState<PanelTab>('displays');
  const [showViews, setShowViews] = useState(true);
  const [cmdOutput, setCmdOutput] = useState('');
  const [customCmd, setCustomCmd] = useState('');
  const [showTerminal, setShowTerminal] = useState(false);
  const [gridVisible] = useState(true);
  const [tfVisible] = useState(true);
  const [statusMsg, setStatusMsg] = useState('Ready');
  const [displays, setDisplays] = useState<DisplayItem[]>(DEFAULT_DISPLAYS);
  const echoRef = useRef<HTMLPreElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const deviceId = currentDevice?.id ?? '';
  const pw = deviceId ? getRememberedDevicePassword(deviceId) : '';

  const toggleDisplay = (id: string) => setDisplays(ds => ds.map(d => d.id === id ? { ...d, enabled: !d.enabled } : d));
  const toggleExpand = (id: string) => setDisplays(ds => ds.map(d => d.id === id ? { ...d, expanded: !d.expanded } : d));

  /* ── Data fetching ── */
  const scanTopics = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const res = await fetchRosTopics(deviceId, pw);
      if (res.ok && res.topics) {
        setTopics(res.topics.map(t => {
          const parts = t.split(/\s+/);
          return { name: parts[0] || t, type: parts[1] || 'unknown', hz: 0 };
        }));
      }
    } catch (_) {}
    setLoading(false);
  }, [deviceId, pw]);

  const scanNodes = useCallback(async () => {
    if (!deviceId) return;
    try {
      const res = await executeDeviceCommand(deviceId, 'ros2 node list 2>/dev/null || rosnode list 2>/dev/null', pw);
      if (res.ok) setNodes(res.output.split('\n').filter(l => l.trim().startsWith('/')).map(n => ({ name: n.trim(), status: 'active' as const })));
    } catch (_) {}
  }, [deviceId, pw]);

  const loadServices = useCallback(async () => {
    if (!deviceId) return;
    try {
      const res = await executeDeviceCommand(deviceId, 'ros2 service list 2>/dev/null || rosservice list 2>/dev/null', pw);
      if (res.ok) setServices(res.output.split('\n').filter(Boolean));
    } catch (_) {}
  }, [deviceId, pw]);

  const loadParams = useCallback(async () => {
    if (!deviceId) return;
    try {
      const res = await executeDeviceCommand(deviceId, 'ros2 param list 2>/dev/null || rosparam list 2>/dev/null', pw);
      if (res.ok) setParams(res.output.split('\n').filter(Boolean));
    } catch (_) {}
  }, [deviceId, pw]);

  const echoTopic = useCallback(async (topicName: string) => {
    if (!deviceId || !topicName) return;
    setSelectedTopic(topicName); setEchoLines(['# Subscribing...']); setShowTerminal(true);
    try {
      const res = await executeDeviceCommand(deviceId,
        `timeout 2 ros2 topic echo ${topicName} --once 2>/dev/null || timeout 2 rostopic echo ${topicName} -n 1 2>/dev/null`, pw);
      setEchoLines(res.ok ? res.output.split('\n') : ['# No messages received']);
    } catch (_) { setEchoLines(['# Echo failed']); }
  }, [deviceId, pw]);

  const runCustom = useCallback(async () => {
    if (!deviceId || !customCmd.trim()) return;
    setCmdOutput('$ ' + customCmd + '\n\nExecuting...');
    try {
      const res = await executeDeviceCommand(deviceId, customCmd, pw);
      setCmdOutput('$ ' + customCmd + '\n\n' + (res.output || (res.ok ? '(no output)' : 'Command failed')));
    } catch (_) { setCmdOutput('$ ' + customCmd + '\n\nExecution failed'); }
  }, [deviceId, pw, customCmd]);

  useEffect(() => {
    if (!deviceId) return;
    scanTopics(); scanNodes(); loadServices(); loadParams();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [deviceId, scanTopics, scanNodes, loadServices, loadParams]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoRefresh && deviceId) timerRef.current = setInterval(scanTopics, 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, deviceId, scanTopics]);

  useEffect(() => {
    if (echoRef.current) echoRef.current.scrollTop = echoRef.current.scrollHeight;
  }, [echoLines]);

  if (!currentDevice) {
    return (
      <div className="rv2-shell">
        <div className="rv2-empty">
          <div style={{ fontSize: 48, marginBottom: 16 }}>🤖</div>
          <h2 style={{ color: '#d4d4d4', margin: '0 0 8px' }}>RViz2</h2>
          <p style={{ color: '#808080', fontSize: 14, maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>
            请先在左侧连接一台 RDK 设备，即可使用 RViz 风格的 ROS 诊断与可视化工具
          </p>
        </div>
      </div>
    );
  }

  const now = new Date();
  const rosTime = `${Math.floor(now.getTime() / 1000)}.${String(now.getMilliseconds()).padStart(3, '0')}`;
  const wallTime = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="rv2-shell">
      {/* Menu Bar */}
      <div className="rv2-menubar">
        <div className="rv2-menu-items">
          <span className="rv2-menu-item">File</span>
          <span className="rv2-menu-item">Panels</span>
          <span className="rv2-menu-item">Help</span>
        </div>
        <div className="rv2-menu-right">
          <span className="rv2-menu-device"><span className="rv2-device-dot-sm" /> {currentDevice.name} ({currentDevice.ip})</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="rv2-toolbar">
        <div className="rv2-toolbar-group">
          {TOOLS.map(t => (
            <button key={t.id} className={`rv2-tool-btn ${activeTool === t.id ? 'active' : ''}`}
              onClick={() => setActiveTool(t.id)} title={t.label + (t.shortcut ? ` (${t.shortcut})` : '')}>
              <span className="rv2-tool-icon">{t.icon}</span>
              <span className="rv2-tool-label">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="rv2-toolbar-sep" />
        <div className="rv2-toolbar-group">
          <label className="rv2-auto-check">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} /> Auto Refresh
          </label>
          <button className="rv2-tool-btn" onClick={() => { scanTopics(); scanNodes(); loadServices(); loadParams(); setStatusMsg('Refreshed'); }}
            disabled={loading} title="Refresh All">{loading ? '⏳' : '🔄'} Refresh</button>
        </div>
      </div>

      {/* Main Area */}
      <div className="rv2-main">
        <div className="rv2-left">
          <div className="rv2-panel-tabs">
            {(['displays','topics','nodes','services','params'] as PanelTab[]).map(k => (
              <button key={k} className={`rv2-ptab ${leftTab === k ? 'active' : ''}`}
                onClick={() => setLeftTab(k)}>{k.charAt(0).toUpperCase() + k.slice(1)}</button>
            ))}
          </div>
          <div className="rv2-left-body">
            {leftTab === 'displays' && <DisplaysPanel displays={displays} toggleDisplay={toggleDisplay} toggleExpand={toggleExpand} />}
            {leftTab === 'topics' && <TopicListPanel topics={topics} selectedTopic={selectedTopic} echoTopic={echoTopic} loading={loading} />}
            {leftTab === 'nodes' && <NodeListPanel nodes={nodes} />}
            {leftTab === 'services' && <ServiceListPanel services={services} deviceId={deviceId} pw={pw} />}
            {leftTab === 'params' && <ParamListPanel params={params} />}
          </div>
        </div>

        <div className="rv2-center">
          <Viewport3D gridVisible={gridVisible} tfVisible={tfVisible} topics={topics} nodes={nodes} activeTool={activeTool} selectedTopic={selectedTopic} />
          {showTerminal && (
            <div className="rv2-terminal-drawer">
              <div className="rv2-terminal-head">
                <span>{selectedTopic ? `Echo: ${selectedTopic}` : 'Terminal Output'}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="rv2-term-btn" onClick={() => setEchoLines([])}>Clear</button>
                  <button className="rv2-term-btn" onClick={() => setShowTerminal(false)}>✕</button>
                </div>
              </div>
              <pre className="rv2-terminal-body" ref={echoRef}>{echoLines.length > 0 ? echoLines.join('\n') : cmdOutput || '# Ready'}</pre>
              <div className="rv2-cmd-row">
                <span className="rv2-cmd-prompt">$</span>
                <input className="rv2-cmd-input" placeholder="ros2 topic list ..." value={customCmd}
                  onChange={e => setCustomCmd(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runCustom(); }} />
                <button className="rv2-cmd-run" onClick={runCustom}>Run</button>
              </div>
            </div>
          )}
        </div>

        {showViews && (
          <div className="rv2-right">
            <div className="rv2-panel-head-bar">
              <span className="rv2-panel-label">Views</span>
              <button className="rv2-panel-close" onClick={() => setShowViews(false)}>✕</button>
            </div>
            <ViewsPanel />
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="rv2-statusbar" role="status">
        <div className="rv2-status-left">
          <span className="rv2-status-item">{statusMsg}</span>
          <span className="rv2-status-sep">|</span>
          <span className="rv2-status-item">Topics: {topics.length}</span>
          <span className="rv2-status-sep">|</span>
          <span className="rv2-status-item">Nodes: {nodes.length}</span>
          <span className="rv2-status-sep">|</span>
          <span className="rv2-status-item"><span className="rv2-status-dot connected" /> ROS2</span>
        </div>
        <div className="rv2-status-right">
          <button className="rv2-status-toggle" onClick={() => setShowTerminal(t => !t)}>{showTerminal ? '▼' : '▲'} Terminal</button>
          <span className="rv2-status-sep">|</span>
          <span className="rv2-status-item rv2-time-label">ROS Time:</span>
          <span className="rv2-status-item rv2-time-val">{rosTime}</span>
          <span className="rv2-status-sep">|</span>
          <span className="rv2-status-item rv2-time-label">Wall Time:</span>
          <span className="rv2-status-item rv2-time-val">{wallTime}</span>
        </div>
      </div>
    </div>
  );
}
