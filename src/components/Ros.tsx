import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppState } from '../hooks/useAppState';
import { executeDeviceCommand, fetchRosTopics, getRememberedDevicePassword } from '../api';

/* ═══════════════════════════════════════════════════════
   Types — 与真实 RViz2 数据结构对齐
   ═══════════════════════════════════════════════════════ */
interface RosTopic { name: string; type: string; hz?: number; }
interface RosNode { name: string; status: 'active' | 'inactive'; pkg?: string; }
interface RosService { name: string; type: string; }
interface RosParam { name: string; value: string; type: string; }
interface TfFrame { name: string; parent: string | null; x?: number; y?: number; theta?: number; }
interface LaserPoint { x: number; y: number; intensity: number; }
interface MapCell { x: number; y: number; val: number; }
interface PathPoint { x: number; y: number; }

interface PropItem {
  key: string; value: string;
  type?: 'bool' | 'string' | 'number' | 'color' | 'enum';
  options?: string[];
}

interface DisplayItem {
  id: string; name: string; enabled: boolean; type: string;
  expanded: boolean; status: 'ok' | 'warn' | 'error';
  topic?: string; properties: PropItem[];
}

type ToolId = 'interact' | 'move' | 'select' | 'focus' | 'pose' | 'goal' | 'point' | 'measure';
type RosVersion = 'ros2' | 'ros1' | 'unknown';
type LeftBottomTab = 'views' | 'time';
type RightTab = 'topics' | 'services' | 'params' | 'launch';

/* ═══════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════ */
const TOOLS: { id: ToolId; icon: string; label: string; shortcut?: string; cursor: string }[] = [
  { id: 'interact', icon: '👆', label: 'Interact', shortcut: 'I', cursor: 'pointer' },
  { id: 'move', icon: '✋', label: 'Move Camera', shortcut: 'M', cursor: 'grab' },
  { id: 'select', icon: '◻', label: 'Select', shortcut: 'S', cursor: 'default' },
  { id: 'focus', icon: '🔍', label: 'Focus Camera', shortcut: 'F', cursor: 'zoom-in' },
  { id: 'pose', icon: '📍', label: '2D Pose Estimate', shortcut: 'P', cursor: 'crosshair' },
  { id: 'goal', icon: '🎯', label: '2D Nav Goal', shortcut: 'G', cursor: 'crosshair' },
  { id: 'point', icon: '📌', label: 'Publish Point', cursor: 'crosshair' },
  { id: 'measure', icon: '📏', label: 'Measure', cursor: 'crosshair' },
];

const DISPLAY_TEMPLATES: { type: string; name: string; defaultTopic: string; props: PropItem[] }[] = [
  { type: 'rviz_default_plugins/Grid', name: 'Grid', defaultTopic: '', props: [
    { key: 'Reference Frame', value: '<Fixed Frame>' },
    { key: 'Plane Cell Count', value: '10', type: 'number' },
    { key: 'Cell Size', value: '1', type: 'number' },
    { key: 'Color', value: '160; 160; 164', type: 'color' },
    { key: 'Line Style', value: 'Lines', type: 'enum', options: ['Lines', 'Billboards'] },
    { key: 'Alpha', value: '0.5', type: 'number' },
  ]},
  { type: 'rviz_default_plugins/TF', name: 'TF', defaultTopic: '/tf', props: [
    { key: 'Show Names', value: 'true', type: 'bool' },
    { key: 'Show Axes', value: 'true', type: 'bool' },
    { key: 'Show Arrows', value: 'true', type: 'bool' },
    { key: 'Marker Scale', value: '1', type: 'number' },
  ]},
  { type: 'rviz_default_plugins/RobotModel', name: 'RobotModel', defaultTopic: '/robot_description', props: [
    { key: 'Description Source', value: 'Topic', type: 'enum', options: ['Topic', 'File'] },
    { key: 'Description Topic', value: '/robot_description' },
    { key: 'Alpha', value: '1.0', type: 'number' },
    { key: 'Visual Enabled', value: 'true', type: 'bool' },
    { key: 'Collision Enabled', value: 'false', type: 'bool' },
  ]},
  { type: 'rviz_default_plugins/LaserScan', name: 'LaserScan', defaultTopic: '/scan', props: [
    { key: 'Topic', value: '/scan' }, { key: 'Size (m)', value: '0.05', type: 'number' },
    { key: 'Color Transformer', value: 'Intensity', type: 'enum', options: ['Intensity', 'AxisColor', 'FlatColor'] },
    { key: 'Decay Time', value: '0', type: 'number' },
    { key: 'Style', value: 'Flat Squares', type: 'enum', options: ['Flat Squares', 'Points', 'Spheres'] },
  ]},
  { type: 'rviz_default_plugins/PointCloud2', name: 'PointCloud2', defaultTopic: '/points', props: [
    { key: 'Topic', value: '/points' }, { key: 'Size (m)', value: '0.01', type: 'number' },
    { key: 'Style', value: 'Flat Squares', type: 'enum', options: ['Flat Squares', 'Points', 'Spheres'] },
    { key: 'Color Transformer', value: 'Intensity', type: 'enum', options: ['Intensity', 'AxisColor', 'FlatColor', 'RGB8'] },
  ]},
  { type: 'rviz_default_plugins/Image', name: 'Image', defaultTopic: '/image_raw', props: [
    { key: 'Topic', value: '/image_raw' },
    { key: 'Transport Hint', value: 'raw', type: 'enum', options: ['raw', 'compressed', 'theora'] },
    { key: 'Queue Size', value: '2', type: 'number' },
  ]},
  { type: 'rviz_default_plugins/Map', name: 'Map', defaultTopic: '/map', props: [
    { key: 'Topic', value: '/map' }, { key: 'Alpha', value: '0.7', type: 'number' },
    { key: 'Color Scheme', value: 'map', type: 'enum', options: ['map', 'costmap', 'raw'] },
    { key: 'Draw Behind', value: 'false', type: 'bool' },
  ]},
  { type: 'rviz_default_plugins/Path', name: 'Path', defaultTopic: '/plan', props: [
    { key: 'Topic', value: '/plan' }, { key: 'Color', value: '25; 255; 0', type: 'color' },
    { key: 'Line Style', value: 'Lines', type: 'enum', options: ['Lines', 'Billboards'] },
    { key: 'Alpha', value: '1.0', type: 'number' },
  ]},
  { type: 'rviz_default_plugins/Odometry', name: 'Odometry', defaultTopic: '/odom', props: [
    { key: 'Topic', value: '/odom' }, { key: 'Keep', value: '100', type: 'number' },
    { key: 'Shape', value: 'Arrow', type: 'enum', options: ['Arrow', 'Axes'] },
  ]},
  { type: 'rviz_default_plugins/MarkerArray', name: 'MarkerArray', defaultTopic: '/visualization_marker_array', props: [
    { key: 'Topic', value: '/visualization_marker_array' },
  ]},
  { type: 'rviz_default_plugins/Pose', name: 'Pose', defaultTopic: '/pose', props: [
    { key: 'Topic', value: '/pose' }, { key: 'Shape', value: 'Arrow', type: 'enum', options: ['Arrow', 'Axes'] },
    { key: 'Color', value: '255; 25; 0', type: 'color' },
  ]},
  { type: 'rviz_default_plugins/Axes', name: 'Axes', defaultTopic: '', props: [
    { key: 'Reference Frame', value: '<Fixed Frame>' }, { key: 'Length', value: '1.0', type: 'number' },
    { key: 'Radius', value: '0.1', type: 'number' },
  ]},
  { type: 'rviz_default_plugins/Camera', name: 'Camera', defaultTopic: '/camera/image_raw', props: [
    { key: 'Topic', value: '/camera/image_raw' },
    { key: 'Transport Hint', value: 'raw', type: 'enum', options: ['raw', 'compressed'] },
    { key: 'Image Rendering', value: 'background', type: 'enum', options: ['background', 'overlay', 'both'] },
  ]},
  { type: 'rviz_default_plugins/DepthCloud', name: 'DepthCloud', defaultTopic: '/depth/image_raw', props: [
    { key: 'Depth Map Topic', value: '/depth/image_raw' },
    { key: 'Color Image Topic', value: '/color/image_raw' },
    { key: 'Queue Size', value: '5', type: 'number' },
  ]},
  { type: 'rviz_default_plugins/Imu', name: 'Imu', defaultTopic: '/imu', props: [
    { key: 'Topic', value: '/imu' },
    { key: 'Box Enabled', value: 'true', type: 'bool' },
    { key: 'Axes Enabled', value: 'true', type: 'bool' },
  ]},
];

const mkDisplay = (tplIdx: number, id: string, enabled = false, status: 'ok' | 'warn' = 'warn'): DisplayItem => {
  const t = DISPLAY_TEMPLATES[tplIdx];
  return { id, name: t.name, enabled, type: t.type, expanded: false, status, topic: t.defaultTopic || undefined, properties: t.props.map(p => ({ ...p })) };
};

const DEFAULT_DISPLAYS: DisplayItem[] = [
  { id: 'global-status', name: 'Global Status', enabled: true, type: 'rviz/GlobalStatus', expanded: false, status: 'ok', properties: [] },
  mkDisplay(0, 'grid-0', true, 'ok'),
  mkDisplay(1, 'tf-0', true, 'ok'),
  mkDisplay(2, 'robotmodel-0'),
  mkDisplay(3, 'laserscan-0'),
  mkDisplay(6, 'map-0'),
  mkDisplay(7, 'path-0'),
];

const TF_COLORS = ['#f39c12', '#3498db', '#9b59b6', '#2ecc71', '#e74c3c', '#1abc9c', '#e67e22', '#95a5a6'];

/* ═══════════════════════════════════════════════════════
   3D Viewport — Canvas 绘制（模拟 RViz2 的 3D 视口）
   支持: Grid / TF / LaserScan / Map / Path / Robot
   ═══════════════════════════════════════════════════════ */
function Viewport3D({ displays, tfFrames, laserPoints, mapCells, pathPoints, activeTool, poseArrow, goalArrow }: {
  displays: DisplayItem[]; tfFrames: TfFrame[]; laserPoints: LaserPoint[];
  mapCells: MapCell[]; pathPoints: PathPoint[]; activeTool: ToolId;
  poseArrow: { x: number; y: number; theta: number } | null;
  goalArrow: { x: number; y: number; theta: number } | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cam, setCam] = useState({ x: 0, y: 0, zoom: 1 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ x: 0, y: 0, cx: 0, cy: 0 });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const gridOn = displays.find(d => d.id === 'grid-0')?.enabled ?? true;
  const tfOn = displays.find(d => d.id === 'tf-0')?.enabled ?? true;
  const laserOn = displays.find(d => d.id === 'laserscan-0')?.enabled ?? false;
  const mapOn = displays.find(d => d.id === 'map-0')?.enabled ?? false;
  const pathOn = displays.find(d => d.id === 'path-0')?.enabled ?? false;
  const robotOn = displays.find(d => d.id === 'robotmodel-0')?.enabled ?? false;

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const r = cvs.getBoundingClientRect();
    cvs.width = r.width * dpr; cvs.height = r.height * dpr;
    ctx.scale(dpr, dpr);
    const w = r.width, h = r.height;
    const cx = w / 2 + cam.x, cy = h / 2 + cam.y;

    // 背景
    ctx.fillStyle = '#484848';
    ctx.fillRect(0, 0, w, h);

    // Map 层（最底层）
    if (mapOn && mapCells.length > 0) {
      const cellSize = Math.max(2, 4 * cam.zoom);
      mapCells.forEach(c => {
        const px = cx + c.x * cellSize, py = cy - c.y * cellSize;
        if (c.val === 100) { ctx.fillStyle = '#1a1a2e'; }
        else if (c.val === 0) { ctx.fillStyle = 'rgba(200,200,200,0.15)'; }
        else { ctx.fillStyle = 'rgba(100,100,100,0.1)'; }
        ctx.fillRect(px, py, cellSize, cellSize);
      });
    }

    // Grid
    if (gridOn) {
      const gs = 50 * cam.zoom;
      const gc = Math.ceil(Math.max(w, h) / gs) + 2;
      ctx.strokeStyle = 'rgba(120,120,120,0.3)';
      ctx.lineWidth = 0.5;
      for (let i = -gc; i <= gc; i++) {
        const px = cx + i * gs, py = cy + i * gs;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
      }
      // 坐标轴 RGB = XYZ
      const al = 100 * cam.zoom;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#cc0000'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + al, cy); ctx.stroke();
      ctx.strokeStyle = '#00cc00'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - al); ctx.stroke();
      ctx.strokeStyle = '#0000cc'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + al * 0.5, cy - al * 0.5); ctx.stroke();
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#cc0000'; ctx.fillText('X', cx + al + 4, cy + 4);
      ctx.fillStyle = '#00cc00'; ctx.fillText('Y', cx - 12, cy - al - 4);
      ctx.fillStyle = '#0000cc'; ctx.fillText('Z', cx + al * 0.5 + 4, cy - al * 0.5 - 4);
    }

    // Path 可视化
    if (pathOn && pathPoints.length > 1) {
      ctx.strokeStyle = '#19ff00';
      ctx.lineWidth = 2 * cam.zoom;
      ctx.setLineDash([]);
      ctx.beginPath();
      const scale = 50 * cam.zoom;
      pathPoints.forEach((p, i) => {
        const px = cx + p.x * scale, py = cy - p.y * scale;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }

    // LaserScan 可视化
    if (laserOn && laserPoints.length > 0) {
      const scale = 50 * cam.zoom;
      const pointSize = Math.max(1.5, 2 * cam.zoom);
      laserPoints.forEach(p => {
        const px = cx + p.x * scale, py = cy - p.y * scale;
        const intensity = Math.min(1, p.intensity);
        const r = Math.round(255 * intensity);
        const g = Math.round(255 * (1 - intensity * 0.5));
        const b = Math.round(50);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(px - pointSize / 2, py - pointSize / 2, pointSize, pointSize);
      });
    }

    // TF frames
    if (tfOn && tfFrames.length > 0) {
      const positions: Record<string, { x: number; y: number }> = {};
      const scale = 50 * cam.zoom;
      tfFrames.forEach((f, i) => {
        if (f.x !== undefined && f.y !== undefined) {
          positions[f.name] = { x: cx + f.x * scale, y: cy - f.y * scale };
        } else {
          const angle = (i / tfFrames.length) * Math.PI * 1.5 - Math.PI * 0.25;
          const radius = (f.parent ? 80 + i * 30 : 0) * cam.zoom;
          positions[f.name] = { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
        }
      });
      tfFrames.forEach((f, i) => {
        const pos = positions[f.name];
        if (f.parent && positions[f.parent]) {
          const pp = positions[f.parent];
          ctx.strokeStyle = TF_COLORS[i % TF_COLORS.length];
          ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(pp.x, pp.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
          ctx.setLineDash([]);
        }
        const s = 15 * cam.zoom;
        ctx.strokeStyle = '#cc0000'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(pos.x, pos.y); ctx.lineTo(pos.x + s, pos.y); ctx.stroke();
        ctx.strokeStyle = '#00cc00';
        ctx.beginPath(); ctx.moveTo(pos.x, pos.y); ctx.lineTo(pos.x, pos.y - s); ctx.stroke();
        ctx.font = '9px sans-serif';
        ctx.fillStyle = TF_COLORS[i % TF_COLORS.length];
        ctx.fillText(f.name, pos.x + s + 2, pos.y - 2);
      });
    }

    // Robot model（简化为三角形 + 圆形）
    if (robotOn) {
      const rs = 18 * cam.zoom;
      ctx.save();
      ctx.translate(cx, cy);
      // 机器人底盘
      ctx.fillStyle = 'rgba(52, 152, 219, 0.6)';
      ctx.beginPath(); ctx.arc(0, 0, rs, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2980b9'; ctx.lineWidth = 2; ctx.stroke();
      // 朝向箭头
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath(); ctx.moveTo(rs, 0); ctx.lineTo(rs * 0.4, -rs * 0.5); ctx.lineTo(rs * 0.4, rs * 0.5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // Pose Estimate 箭头
    const drawArrow = (arrow: { x: number; y: number; theta: number }, color: string) => {
      const scale = 50 * cam.zoom;
      const px = cx + arrow.x * scale, py = cy - arrow.y * scale;
      const len = 40 * cam.zoom;
      const ex = px + Math.cos(arrow.theta) * len, ey = py - Math.sin(arrow.theta) * len;
      ctx.strokeStyle = color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
      // 箭头头部
      const headLen = 10 * cam.zoom;
      const angle = Math.atan2(-(ey - py), ex - px);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - headLen * Math.cos(angle - 0.4), ey + headLen * Math.sin(angle - 0.4));
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - headLen * Math.cos(angle + 0.4), ey + headLen * Math.sin(angle + 0.4));
      ctx.stroke();
    };
    if (poseArrow) drawArrow(poseArrow, '#00ff00');
    if (goalArrow) drawArrow(goalArrow, '#ff4444');

    // 鼠标坐标显示
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    const mx = ((mousePos.x - cx) / (50 * cam.zoom)).toFixed(2);
    const my = (-(mousePos.y - cy) / (50 * cam.zoom)).toFixed(2);
    ctx.fillText(`(${mx}, ${my})`, 8, h - 8);
  }, [displays, tfFrames, laserPoints, mapCells, pathPoints, cam, gridOn, tfOn, laserOn, mapOn, pathOn, robotOn, poseArrow, goalArrow, mousePos]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setCam(c => ({ ...c, zoom: Math.max(0.2, Math.min(5, c.zoom + (e.deltaY > 0 ? -0.08 : 0.08))) }));
  }, []);
  const onDown = useCallback((e: React.MouseEvent) => {
    if (activeTool === 'move' || e.button === 1 || e.button === 2) {
      setDragging(true);
      dragRef.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
    }
  }, [activeTool, cam]);
  const onMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (!dragging) return;
    setCam(c => ({ ...c, x: dragRef.current.cx + e.clientX - dragRef.current.x, y: dragRef.current.cy + e.clientY - dragRef.current.y }));
  }, [dragging]);
  const onUp = useCallback(() => setDragging(false), []);

  const cursor = dragging ? 'grabbing' : (TOOLS.find(t => t.id === activeTool)?.cursor || 'default');

  return (
    <div className="rv-viewport" style={{ cursor }} onContextMenu={e => e.preventDefault()}>
      <canvas ref={canvasRef} className="rv-canvas"
        onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} />
      <div className="rv-vp-controls">
        <button className="rv-vp-btn" onClick={() => setCam({ x: 0, y: 0, zoom: 1 })} title="Reset View">⟲</button>
        <button className="rv-vp-btn" onClick={() => setCam(c => ({ ...c, zoom: Math.min(5, c.zoom + 0.2) }))} title="Zoom In">+</button>
        <button className="rv-vp-btn" onClick={() => setCam(c => ({ ...c, zoom: Math.max(0.2, c.zoom - 0.2) }))} title="Zoom Out">−</button>
        <span className="rv-vp-zoom">{Math.round(cam.zoom * 100)}%</span>
      </div>
      {/* FPS 指示器 */}
      <div className="rv-vp-fps">FPS: 30</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Displays Panel — 左侧属性树
   ═══════════════════════════════════════════════════════ */
function DisplaysPanel({ displays, fixedFrame, bgColor, toggleDisplay, toggleExpand, removeDisplay, updateProp, onAdd }: {
  displays: DisplayItem[]; fixedFrame: string; bgColor: string;
  toggleDisplay: (id: string) => void; toggleExpand: (id: string) => void;
  removeDisplay: (id: string) => void; updateProp: (displayId: string, key: string, value: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="rv-displays">
      <div className="rv-tree-section">
        <div className="rv-tree-header">Global Options</div>
        <div className="rv-prop-row"><span className="rv-prop-k">Fixed Frame</span><span className="rv-prop-v">{fixedFrame}</span></div>
        <div className="rv-prop-row"><span className="rv-prop-k">Background Color</span><span className="rv-color-chip" style={{ background: bgColor }} /></div>
        <div className="rv-prop-row"><span className="rv-prop-k">Frame Rate</span><span className="rv-prop-v">30</span></div>
        <div className="rv-prop-row"><span className="rv-prop-k">Default Light</span><span className="rv-prop-v">true</span></div>
      </div>
      <div className="rv-tree-divider" />
      {displays.map(d => (
        <div key={d.id} className={`rv-display-item ${d.enabled ? '' : 'off'}`}>
          <div className="rv-display-head" onClick={() => d.type !== 'rviz/GlobalStatus' && toggleExpand(d.id)}>
            {d.type !== 'rviz/GlobalStatus' && <span className={`rv-arrow ${d.expanded ? 'open' : ''}`}>▶</span>}
            {d.type !== 'rviz/GlobalStatus' && (
              <input type="checkbox" className="rv-check" checked={d.enabled}
                onChange={() => toggleDisplay(d.id)} onClick={e => e.stopPropagation()} />
            )}
            <span className={`rv-status-ball ${d.status}`} />
            <span className="rv-display-label">{d.name}</span>
            {d.type !== 'rviz/GlobalStatus' && (
              <button className="rv-display-del" onClick={e => { e.stopPropagation(); removeDisplay(d.id); }}>✕</button>
            )}
          </div>
          {d.expanded && d.properties.length > 0 && (
            <div className="rv-display-props">
              {d.topic && <div className="rv-prop-row sub"><span className="rv-prop-k">Topic</span><span className="rv-prop-v topic">{d.topic}</span></div>}
              {d.properties.map((p, i) => (
                <div key={i} className="rv-prop-row sub">
                  <span className="rv-prop-k">{p.key}</span>
                  {p.type === 'bool' ? (
                    <input type="checkbox" className="rv-check sm" checked={p.value === 'true'}
                      onChange={() => updateProp(d.id, p.key, p.value === 'true' ? 'false' : 'true')} />
                  ) : p.type === 'enum' && p.options ? (
                    <select className="rv-prop-select" value={p.value} onChange={e => updateProp(d.id, p.key, e.target.value)}>
                      {p.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : p.type === 'color' ? (
                    <span className="rv-color-chip" style={{ background: `rgb(${p.value})` }} title={p.value} />
                  ) : (
                    <span className="rv-prop-v">{p.value}</span>
                  )}
                </div>
              ))}
              <div className="rv-prop-row sub">
                <span className="rv-prop-k">Status</span>
                <span className={`rv-prop-v status-${d.status}`}>{d.status === 'ok' ? 'OK' : d.status === 'warn' ? 'No data received' : 'Error'}</span>
              </div>
            </div>
          )}
        </div>
      ))}
      <button className="rv-add-btn" onClick={onAdd}>+ Add Display</button>
    </div>
  );
}

/* ── Views Panel ── */
function ViewsPanel({ fixedFrame, setFixedFrame }: { fixedFrame: string; setFixedFrame: (v: string) => void }) {
  return (
    <div className="rv-views">
      <div className="rv-tree-header">Views</div>
      <div className="rv-prop-row"><span className="rv-prop-k">Type</span><span className="rv-prop-v">rviz_default_plugins/Orbit</span></div>
      <div className="rv-prop-row">
        <span className="rv-prop-k">Target Frame</span>
        <select className="rv-prop-select" value={fixedFrame} onChange={e => setFixedFrame(e.target.value)}>
          {['map', 'odom', 'base_link', 'base_footprint', 'world'].map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="rv-prop-row"><span className="rv-prop-k">Distance</span><span className="rv-prop-v">10.00</span></div>
      <div className="rv-prop-row"><span className="rv-prop-k">Yaw</span><span className="rv-prop-v">0.785</span></div>
      <div className="rv-prop-row"><span className="rv-prop-k">Pitch</span><span className="rv-prop-v">0.785</span></div>
      <div className="rv-prop-row"><span className="rv-prop-k">Focal Point</span><span className="rv-prop-v">0; 0; 0</span></div>
      <div className="rv-prop-row"><span className="rv-prop-k">Focal Shape Size</span><span className="rv-prop-v">0.05</span></div>
      <div className="rv-prop-row"><span className="rv-prop-k">Inertia</span><span className="rv-prop-v">0</span></div>
    </div>
  );
}

/* ── Echo / Terminal Drawer ── */
function EchoDrawer({ lines, topic, onClose, onClear, customCmd, setCustomCmd, onRun }: {
  lines: string[]; topic: string; onClose: () => void; onClear: () => void;
  customCmd: string; setCustomCmd: (v: string) => void; onRun: () => void;
}) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines]);
  return (
    <div className="rv-echo-drawer">
      <div className="rv-echo-head">
        <span>{topic ? `Echo: ${topic}` : 'ROS Terminal'}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="rv-echo-btn" onClick={onClear}>Clear</button>
          <button className="rv-echo-btn" onClick={onClose}>✕</button>
        </div>
      </div>
      <pre className="rv-echo-body" ref={ref}>{lines.length > 0 ? lines.join('\n') : '# ROS Terminal Ready — 输入命令或点击 Topic 查看数据'}</pre>
      <div className="rv-echo-cmd">
        <span className="rv-cmd-prompt">$</span>
        <input className="rv-input mono" placeholder="ros2 topic list / ros2 node info /node_name ..."
          value={customCmd} onChange={e => setCustomCmd(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onRun(); }} />
        <button className="rv-btn primary sm" onClick={onRun}>Run</button>
      </div>
    </div>
  );
}

/* ── Add Display Modal ── */
function AddDisplayModal({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (type: string) => void }) {
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState('');
  if (!open) return null;
  const list = DISPLAY_TEMPLATES.filter(d => d.name.toLowerCase().includes(filter.toLowerCase()) || d.type.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="rv-modal-overlay" onClick={onClose}>
      <div className="rv-modal" onClick={e => e.stopPropagation()}>
        <div className="rv-modal-head"><span>Create visualization</span><button className="rv-modal-close" onClick={onClose}>✕</button></div>
        <div className="rv-modal-search"><input className="rv-input" placeholder="Filter by display type..." value={filter} onChange={e => setFilter(e.target.value)} autoFocus /></div>
        <div className="rv-modal-list">
          {list.map(d => (
            <div key={d.type} className={`rv-modal-item ${sel === d.type ? 'sel' : ''}`}
              onClick={() => setSel(d.type)} onDoubleClick={() => { onAdd(d.type); onClose(); }}>
              <div className="rv-modal-item-name">{d.name}</div>
              <div className="rv-modal-item-type">{d.type}</div>
            </div>
          ))}
        </div>
        <div className="rv-modal-foot">
          <span className="rv-modal-desc">{sel ? DISPLAY_TEMPLATES.find(d => d.type === sel)?.type : 'Select a display type'}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="rv-btn ghost" onClick={onClose}>Cancel</button>
            <button className="rv-btn primary" disabled={!sel} onClick={() => { if (sel) { onAdd(sel); onClose(); } }}>OK</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Main Component — 真实 RDK 设备连接
   ═══════════════════════════════════════════════════════ */
export default function Ros() {
  const { currentDevice, addToast } = useAppState();
  const deviceId = currentDevice?.id ?? '';
  const pw = getRememberedDevicePassword(deviceId);

  // ROS 状态
  const [rosVersion, setRosVersion] = useState<RosVersion>('unknown');
  const [connected, setConnected] = useState(false);
  const [topics, setTopics] = useState<RosTopic[]>([]);
  const [nodes, setNodes] = useState<RosNode[]>([]);
  const [services, setServices] = useState<RosService[]>([]);
  const [params, setParams] = useState<RosParam[]>([]);
  const [tfFrames, setTfFrames] = useState<TfFrame[]>([]);
  const [laserPoints, setLaserPoints] = useState<LaserPoint[]>([]);
  const [mapCells, setMapCells] = useState<MapCell[]>([]);
  const [pathPoints, setPathPoints] = useState<PathPoint[]>([]);
  const [fixedFrame, setFixedFrame] = useState('map');

  // UI 状态
  const [displays, setDisplays] = useState<DisplayItem[]>(DEFAULT_DISPLAYS.map(d => ({ ...d, properties: d.properties.map(p => ({ ...p })) })));
  const [activeTool, setActiveTool] = useState<ToolId>('move');
  const [showAddModal, setShowAddModal] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftBottomTab>('views');
  const [rightTab, setRightTab] = useState<RightTab>('topics');
  const [showEcho, setShowEcho] = useState(true);
  const [echoLines, setEchoLines] = useState<string[]>([]);
  const [echoTopic, setEchoTopic] = useState('');
  const [customCmd, setCustomCmd] = useState('');
  const [loading, setLoading] = useState(false);
  const [poseArrow, setPoseArrow] = useState<{ x: number; y: number; theta: number } | null>(null);
  const [goalArrow, setGoalArrow] = useState<{ x: number; y: number; theta: number } | null>(null);
  const [recording, setRecording] = useState(false);
  const bgColor = '#484848';

  // 检测 ROS 版本
  const detectRos = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const r2 = await executeDeviceCommand(deviceId, 'bash -lc "which ros2 2>/dev/null && echo FOUND || echo NOTFOUND"', pw);
      if (r2.ok && r2.output.includes('FOUND')) { setRosVersion('ros2'); setConnected(true); setLoading(false); return; }
      const r1 = await executeDeviceCommand(deviceId, 'bash -lc "which roscore 2>/dev/null && echo FOUND || echo NOTFOUND"', pw);
      if (r1.ok && r1.output.includes('FOUND')) { setRosVersion('ros1'); setConnected(true); setLoading(false); return; }
      setRosVersion('unknown'); setConnected(false);
    } catch { setRosVersion('unknown'); setConnected(false); }
    setLoading(false);
  }, [deviceId, pw]);

  // 加载 topics（带频率检测）
  const loadTopics = useCallback(async () => {
    if (!deviceId || rosVersion === 'unknown') return;
    try {
      const cmd = rosVersion === 'ros2' ? 'bash -lc "ros2 topic list -t 2>/dev/null"' : 'bash -lc "rostopic list 2>/dev/null"';
      const res = await executeDeviceCommand(deviceId, cmd, pw);
      if (res.ok) {
        const parsed = res.output.split('\n').filter(Boolean).map(line => {
          const m = line.match(/^(\S+)\s+\[(.+)\]$/);
          return m ? { name: m[1], type: m[2] } : { name: line.trim(), type: 'unknown' };
        });
        setTopics(parsed);
        // 更新 display 状态
        setDisplays(ds => ds.map(d => {
          if (!d.topic) return d;
          const found = parsed.some(t => t.name === d.topic);
          return { ...d, status: d.enabled ? (found ? 'ok' : 'warn') : d.status };
        }));
      }
    } catch {}
  }, [deviceId, pw, rosVersion]);

  // 加载 nodes
  const loadNodes = useCallback(async () => {
    if (!deviceId || rosVersion === 'unknown') return;
    try {
      const cmd = rosVersion === 'ros2' ? 'bash -lc "ros2 node list 2>/dev/null"' : 'bash -lc "rosnode list 2>/dev/null"';
      const res = await executeDeviceCommand(deviceId, cmd, pw);
      if (res.ok) {
        setNodes(res.output.split('\n').filter(Boolean).map(n => ({ name: n.trim(), status: 'active' as const })));
      }
    } catch {}
  }, [deviceId, pw, rosVersion]);

  // 加载 services
  const loadServices = useCallback(async () => {
    if (!deviceId || rosVersion === 'unknown') return;
    try {
      const cmd = rosVersion === 'ros2' ? 'bash -lc "ros2 service list -t 2>/dev/null | head -50"' : 'bash -lc "rosservice list 2>/dev/null | head -50"';
      const res = await executeDeviceCommand(deviceId, cmd, pw);
      if (res.ok) {
        setServices(res.output.split('\n').filter(Boolean).map(line => {
          const m = line.match(/^(\S+)\s+\[(.+)\]$/);
          return m ? { name: m[1], type: m[2] } : { name: line.trim(), type: 'unknown' };
        }));
      }
    } catch {}
  }, [deviceId, pw, rosVersion]);

  // 加载 params
  const loadParams = useCallback(async () => {
    if (!deviceId || rosVersion === 'unknown') return;
    try {
      const cmd = rosVersion === 'ros2' ? 'bash -lc "ros2 param list 2>/dev/null | head -50"' : 'bash -lc "rosparam list 2>/dev/null | head -50"';
      const res = await executeDeviceCommand(deviceId, cmd, pw);
      if (res.ok) {
        setParams(res.output.split('\n').filter(Boolean).map(p => ({ name: p.trim(), value: '', type: 'string' })));
      }
    } catch {}
  }, [deviceId, pw, rosVersion]);

  // 加载 TF
  const loadTf = useCallback(async () => {
    if (!deviceId || rosVersion === 'unknown') return;
    try {
      const cmd = rosVersion === 'ros2'
        ? 'bash -lc "timeout 3 ros2 run tf2_tools view_frames --no-wait 2>/dev/null; ros2 topic echo /tf_static --once 2>/dev/null | head -40"'
        : 'bash -lc "timeout 3 rostopic echo /tf_static -n 1 2>/dev/null | head -40"';
      const res = await executeDeviceCommand(deviceId, cmd, pw);
      if (res.ok && res.output.trim()) {
        const frameNames = res.output.match(/(?:frame_id|child_frame_id):\s*"?(\w[\w/]*)"?/g);
        if (frameNames && frameNames.length > 0) {
          const names = [...new Set(frameNames.map(f => f.replace(/.*:\s*"?/, '').replace(/"$/, '')))];
          const frames: TfFrame[] = names.map((name, i) => ({
            name, parent: i === 0 ? null : names[Math.max(0, i - 1)],
          }));
          if (frames.length > 0) setTfFrames(frames);
        }
      }
    } catch {}
  }, [deviceId, pw, rosVersion]);

  // 加载 LaserScan 数据
  const loadLaser = useCallback(async () => {
    if (!deviceId || rosVersion === 'unknown') return;
    try {
      const cmd = rosVersion === 'ros2'
        ? 'bash -lc "timeout 2 ros2 topic echo /scan --once 2>/dev/null | head -60"'
        : 'bash -lc "timeout 2 rostopic echo /scan -n 1 2>/dev/null | head -60"';
      const res = await executeDeviceCommand(deviceId, cmd, pw);
      if (res.ok && res.output.includes('ranges:')) {
        const rangesMatch = res.output.match(/ranges:\s*\[([\s\S]*?)\]/);
        const angleMin = parseFloat(res.output.match(/angle_min:\s*([\d.-]+)/)?.[1] || '-3.14');
        const angleInc = parseFloat(res.output.match(/angle_increment:\s*([\d.-]+)/)?.[1] || '0.017');
        if (rangesMatch) {
          const ranges = rangesMatch[1].split(',').map(s => parseFloat(s.trim())).filter(v => !isNaN(v) && v > 0.1 && v < 30);
          const points: LaserPoint[] = ranges.map((r, i) => {
            const angle = angleMin + i * angleInc;
            return { x: r * Math.cos(angle), y: r * Math.sin(angle), intensity: Math.min(1, r / 10) };
          });
          setLaserPoints(points);
        }
      }
    } catch {}
  }, [deviceId, pw, rosVersion]);

  // 初始化
  useEffect(() => { if (deviceId) detectRos(); }, [deviceId, detectRos]);
  useEffect(() => {
    if (!connected) return;
    loadTopics(); loadNodes(); loadTf(); loadServices(); loadParams();
    const iv = setInterval(() => { loadTopics(); loadNodes(); }, 10000);
    return () => clearInterval(iv);
  }, [connected, loadTopics, loadNodes, loadTf, loadServices, loadParams]);

  // LaserScan 定时刷新
  useEffect(() => {
    const laserEnabled = displays.find(d => d.id === 'laserscan-0')?.enabled;
    if (!connected || !laserEnabled) return;
    loadLaser();
    const iv = setInterval(loadLaser, 5000);
    return () => clearInterval(iv);
  }, [connected, displays, loadLaser]);

  // Display 操作
  const toggleDisplay = (id: string) => setDisplays(ds => ds.map(d => d.id === id ? { ...d, enabled: !d.enabled } : d));
  const toggleExpand = (id: string) => setDisplays(ds => ds.map(d => d.id === id ? { ...d, expanded: !d.expanded } : d));
  const removeDisplay = (id: string) => setDisplays(ds => ds.filter(d => d.id !== id));
  const updateProp = (did: string, key: string, val: string) => setDisplays(ds => ds.map(d =>
    d.id === did ? { ...d, properties: d.properties.map(p => p.key === key ? { ...p, value: val } : p) } : d));
  const addDisplay = (type: string) => {
    const tpl = DISPLAY_TEMPLATES.find(t => t.type === type);
    if (!tpl) return;
    const id = `${tpl.name.toLowerCase()}-${Date.now()}`;
    setDisplays(ds => [...ds, { id, name: tpl.name, enabled: true, type, expanded: true, status: 'warn',
      topic: tpl.defaultTopic || undefined, properties: tpl.props.map(p => ({ ...p })) }]);
  };

  // 执行命令
  const runCmd = useCallback(async () => {
    if (!deviceId || !customCmd.trim()) return;
    setEchoLines(ls => [...ls, `$ ${customCmd}`]);
    try {
      const res = await executeDeviceCommand(deviceId, `bash -lc "${customCmd.replace(/"/g, '\\"')}"`, pw);
      setEchoLines(ls => [...ls, ...(res.ok ? res.output.split('\n') : [`Error: ${res.output}`])]);
    } catch (e: any) { setEchoLines(ls => [...ls, `Error: ${e.message}`]); }
    setCustomCmd('');
  }, [deviceId, pw, customCmd]);

  // Echo topic
  const echoTopicCmd = useCallback(async (topicName: string) => {
    if (!deviceId) return;
    setEchoTopic(topicName); setShowEcho(true);
    const cmd = rosVersion === 'ros2' ? `ros2 topic echo ${topicName} --once` : `rostopic echo ${topicName} -n 1`;
    setEchoLines([`$ ${cmd}`]);
    try {
      const res = await executeDeviceCommand(deviceId, `bash -lc "timeout 5 ${cmd} 2>/dev/null"`, pw);
      setEchoLines(ls => [...ls, ...(res.ok ? res.output.split('\n') : ['No data'])]);
    } catch { setEchoLines(ls => [...ls, 'Error']); }
  }, [deviceId, pw, rosVersion]);

  // Rosbag 录制
  const toggleRecording = useCallback(async () => {
    if (!deviceId) return;
    if (recording) {
      await executeDeviceCommand(deviceId, 'bash -lc "pkill -f \'ros2 bag record\' 2>/dev/null || pkill -f rosbag 2>/dev/null"', pw);
      setRecording(false);
      addToast?.('Rosbag 录制已停止', 'info');
    } else {
      const cmd = rosVersion === 'ros2' ? 'ros2 bag record -a -o /tmp/rdk_bag &' : 'rosbag record -a -O /tmp/rdk_bag &';
      await executeDeviceCommand(deviceId, `bash -lc "nohup ${cmd} >/dev/null 2>&1"`, pw);
      setRecording(true);
      addToast?.('Rosbag 开始录制', 'success');
    }
  }, [deviceId, pw, rosVersion, recording, addToast]);

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const t = TOOLS.find(t => t.shortcut?.toLowerCase() === e.key.toLowerCase());
      if (t) setActiveTool(t.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 无设备
  if (!currentDevice) {
    return (
      <div className="rv-shell">
        <div className="rv-empty">
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🤖</div>
            <div style={{ fontSize: 16, marginBottom: 8 }}>ROS 可视化工具</div>
            <div style={{ color: '#888', fontSize: 13 }}>请先在左侧连接一台 RDK 设备</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rv-shell">
      {/* ── Menu Bar ── */}
      <div className="rv-menubar">
        <div className="rv-menu-left">
          <span className="rv-menu-item">File</span><span className="rv-menu-item">Panels</span><span className="rv-menu-item">Help</span>
        </div>
        <div className="rv-menu-right">
          {recording && <span className="rv-rec-badge">● REC</span>}
          <span className={`rv-ros-badge ${rosVersion}`}>{rosVersion === 'ros2' ? 'ROS 2' : rosVersion === 'ros1' ? 'ROS 1' : 'N/A'}</span>
          <span className={`rv-conn-dot ${connected ? 'on' : 'off'}`} />
          <span className="rv-menu-device">{currentDevice.name} ({currentDevice.ip})</span>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="rv-toolbar">
        {TOOLS.map((t, i) => (
          <React.Fragment key={t.id}>
            {i === 4 && <span className="rv-toolbar-sep" />}
            <button className={`rv-tool-btn ${activeTool === t.id ? 'active' : ''}`}
              onClick={() => setActiveTool(t.id)} title={t.shortcut ? `${t.label} (${t.shortcut})` : t.label}>
              <span className="rv-tool-icon">{t.icon}</span> {t.label}
            </button>
          </React.Fragment>
        ))}
        <span className="rv-toolbar-sep" />
        <button className="rv-tool-btn" onClick={() => { loadTopics(); loadNodes(); loadTf(); loadServices(); loadLaser(); }} disabled={loading}>
          {loading ? '⟳ Scanning...' : '⟳ Refresh'}
        </button>
        <button className={`rv-tool-btn ${recording ? 'active rec' : ''}`} onClick={toggleRecording} title="Record Rosbag">
          {recording ? '⏹ Stop Bag' : '⏺ Record Bag'}
        </button>
      </div>

      {/* ── Main Area ── */}
      <div className="rv-main">
        {/* Left Panel */}
        <div className="rv-left">
          <div className="rv-left-top">
            <div className="rv-panel-title">Displays</div>
            <DisplaysPanel displays={displays} fixedFrame={fixedFrame} bgColor={bgColor}
              toggleDisplay={toggleDisplay} toggleExpand={toggleExpand} removeDisplay={removeDisplay}
              updateProp={updateProp} onAdd={() => setShowAddModal(true)} />
          </div>
          <div className="rv-left-bottom">
            <div className="rv-panel-tabs">
              <button className={`rv-ptab ${leftTab === 'views' ? 'active' : ''}`} onClick={() => setLeftTab('views')}>Views</button>
              <button className={`rv-ptab ${leftTab === 'time' ? 'active' : ''}`} onClick={() => setLeftTab('time')}>Time</button>
            </div>
            {leftTab === 'views' && <ViewsPanel fixedFrame={fixedFrame} setFixedFrame={setFixedFrame} />}
            {leftTab === 'time' && (
              <div className="rv-views">
                <div className="rv-prop-row"><span className="rv-prop-k">ROS Time</span><span className="rv-prop-v">{connected ? new Date().toISOString() : '--'}</span></div>
                <div className="rv-prop-row"><span className="rv-prop-k">Topics</span><span className="rv-prop-v">{topics.length}</span></div>
                <div className="rv-prop-row"><span className="rv-prop-k">Nodes</span><span className="rv-prop-v">{nodes.length}</span></div>
                <div className="rv-prop-row"><span className="rv-prop-k">TF Frames</span><span className="rv-prop-v">{tfFrames.length}</span></div>
                <div className="rv-prop-row"><span className="rv-prop-k">Services</span><span className="rv-prop-v">{services.length}</span></div>
              </div>
            )}
          </div>
        </div>

        {/* Center: 3D Viewport + Echo */}
        <div className="rv-center">
          <Viewport3D displays={displays} tfFrames={tfFrames} laserPoints={laserPoints}
            mapCells={mapCells} pathPoints={pathPoints} activeTool={activeTool}
            poseArrow={poseArrow} goalArrow={goalArrow} />
          {showEcho && (
            <EchoDrawer lines={echoLines} topic={echoTopic}
              onClose={() => setShowEcho(false)} onClear={() => setEchoLines([])}
              customCmd={customCmd} setCustomCmd={setCustomCmd} onRun={runCmd} />
          )}
        </div>

        {/* Right Panel — 多 Tab */}
        <div className="rv-right">
          <div className="rv-right-tabs">
            {(['topics', 'services', 'params'] as RightTab[]).map(t => (
              <button key={t} className={`rv-ptab ${rightTab === t ? 'active' : ''}`} onClick={() => setRightTab(t)}>
                {t === 'topics' ? `Topics (${topics.length})` : t === 'services' ? `Svc (${services.length})` : `Params (${params.length})`}
              </button>
            ))}
          </div>

          {rightTab === 'topics' && (
            <>
              <div className="rv-topic-list">
                {topics.length === 0 && <div className="rv-empty-sm">{connected ? 'No topics found' : 'Not connected'}</div>}
                {topics.map(t => (
                  <div key={t.name} className="rv-topic-item" onClick={() => echoTopicCmd(t.name)}>
                    <div className="rv-topic-name">{t.name}</div>
                    <div className="rv-topic-type">{t.type}</div>
                  </div>
                ))}
              </div>
              <div className="rv-panel-title" style={{ marginTop: 4 }}>Nodes ({nodes.length})</div>
              <div className="rv-topic-list">
                {nodes.map(n => (
                  <div key={n.name} className="rv-topic-item" onClick={() => {
                    const cmd = rosVersion === 'ros2' ? `ros2 node info ${n.name}` : `rosnode info ${n.name}`;
                    setCustomCmd(cmd); setShowEcho(true);
                  }}>
                    <span className={`rv-node-dot ${n.status}`} />
                    <div className="rv-topic-name">{n.name}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {rightTab === 'services' && (
            <div className="rv-topic-list">
              {services.length === 0 && <div className="rv-empty-sm">{connected ? 'No services' : 'Not connected'}</div>}
              {services.map(s => (
                <div key={s.name} className="rv-topic-item" onClick={() => {
                  const cmd = rosVersion === 'ros2' ? `ros2 service type ${s.name}` : `rosservice type ${s.name}`;
                  setEchoLines(ls => [...ls, `$ ${cmd}`]);
                  setShowEcho(true);
                  executeDeviceCommand(deviceId, `bash -lc "${cmd} 2>/dev/null"`, pw)
                    .then(r => setEchoLines(ls => [...ls, ...(r.ok ? r.output.split('\n') : ['Error'])]))
                    .catch(() => {});
                }}>
                  <div className="rv-topic-name">{s.name}</div>
                  <div className="rv-topic-type">{s.type}</div>
                </div>
              ))}
            </div>
          )}

          {rightTab === 'params' && (
            <div className="rv-topic-list">
              {params.length === 0 && <div className="rv-empty-sm">{connected ? 'No params' : 'Not connected'}</div>}
              {params.map(p => (
                <div key={p.name} className="rv-topic-item" onClick={() => {
                  const cmd = rosVersion === 'ros2' ? `ros2 param get ${p.name.split('/').slice(0, 2).join('/')} ${p.name.split('/').slice(2).join('/')}` : `rosparam get ${p.name}`;
                  setCustomCmd(cmd); setShowEcho(true);
                }}>
                  <div className="rv-topic-name">{p.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Status Bar ── */}
      <div className="rv-statusbar">
        <div className="rv-status-left">
          <span className={`rv-status-dot ${connected ? 'on' : 'off'}`} />
          <span>{connected ? 'Connected' : 'Disconnected'}</span>
          <span className="rv-status-sep">|</span>
          <span>Fixed Frame: {fixedFrame}</span>
          <span className="rv-status-sep">|</span>
          <span>Topics: {topics.length} · Nodes: {nodes.length} · TF: {tfFrames.length} · Svc: {services.length}</span>
        </div>
        <div className="rv-status-right">
          <span>{rosVersion === 'ros2' ? 'ROS 2 Humble' : rosVersion === 'ros1' ? 'ROS 1 Noetic' : '--'}</span>
          <span className="rv-status-sep">|</span>
          <button className="rv-status-toggle" onClick={() => setShowEcho(!showEcho)}>{showEcho ? '▼ Terminal' : '▲ Terminal'}</button>
        </div>
      </div>

      <AddDisplayModal open={showAddModal} onClose={() => setShowAddModal(false)} onAdd={addDisplay} />
    </div>
  );
}
