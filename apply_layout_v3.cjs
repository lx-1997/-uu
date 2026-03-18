const fs = require('fs');

const layoutPath = 'src/styles/layout.css';
const layoutCss = `
/* "Wow" Level Google/Material Layout */

.canvas-shell {
  display: flex;
  height: 100vh;
  position: relative;
  background-color: var(--bg-app);
  color: var(--text-primary);
  overflow: hidden;
}

/* Base geometric background pattern for that "futuristic" touch */
.canvas-shell::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  pointer-events: none;
  background-image: radial-gradient(var(--border) 1px, transparent 1px);
  background-size: 24px 24px;
  opacity: 0.4;
  z-index: 0;
}

.layout-container {
  display: flex;
  width: 100%;
  height: 100%;
  z-index: 10;
  position: relative;
}

/* Sidebar styling */
.app-sidebar {
  width: 250px;
  background-color: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-right: 1px solid rgba(0,0,0,0.06);
  display: flex;
  flex-direction: column;
  padding: 24px 16px;
  z-index: 20;
  transition: all 0.3s ease;
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px 32px;
  font-weight: 700;
  letter-spacing: -0.5px;
  font-size: 1.3rem;
  color: #000;
}
.sidebar-header img {
  width: 28px;
  height: 28px;
  border-radius: 6px;
}

.section-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 16px 0 8px 12px;
}

.device-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-radius: 12px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all var(--transition-standard);
  background: white;
  border: 1px solid var(--border);
  box-shadow: var(--elevation-1);
}
.device-item:hover {
  box-shadow: var(--elevation-2);
  transform: translateY(-1px);
}
.device-item.active {
  border-color: var(--brand-primary);
  box-shadow: 0 0 0 1px var(--brand-primary), var(--elevation-2);
}

.device-icon {
  margin-right: 12px;
  color: var(--brand-primary);
  display: flex;
}
.device-info {
  flex: 1;
}
.device-name {
  margin: 0 0 2px 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
}
.device-status {
  display: flex;
  align-items: center;
  font-size: 0.75rem;
  color: var(--text-secondary);
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #34a853;
  margin-right: 6px;
  box-shadow: 0 0 0 2px rgba(52, 168, 83, 0.2);
}
.status-dot.offline {
  background-color: var(--text-muted);
  box-shadow: none;
}
.device-delete-btn {
  background: none; border: none; color: var(--text-muted); cursor: pointer;
  padding: 4px; display: flex; opacity: 0; transition: 0.2s;
}
.device-item:hover .device-delete-btn { opacity: 1; }
.device-delete-btn:hover { color: #ea4335; }

.tool-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 4px;
  border-radius: 12px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.2s ease;
  font-weight: 500;
  font-size: 0.95rem;
  background: transparent;
  border: none;
  width: 100%;
}
.tool-btn:hover {
  background-color: rgba(0,0,0,0.03);
  color: var(--text-primary);
}
.tool-btn.active {
  background-color: var(--brand-dim);
  color: var(--brand-primary);
  font-weight: 600;
}
.tool-icon {
  display: flex;
  color: inherit;
  opacity: 0.8;
}
.tool-btn.active .tool-icon {
  opacity: 1;
}

.sidebar-spacer { flex: 1; }

.sidebar-footer {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid rgba(0,0,0,0.06);
}

/* App Viewport */
.app-viewport {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  background-color: transparent;
}

/* Top Toolbar */
.top-toolbar {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 32px;
  background-color: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(0,0,0,0.04);
  z-index: 10;
}
.tt-center {
  display: flex;
  align-items: center;
  gap: 12px;
}
.tt-title {
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.2px;
}
.tt-sep {
  color: var(--text-muted);
}
.tt-device {
  font-size: 0.85rem;
  color: var(--text-secondary);
  background: white;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  box-shadow: var(--elevation-1);
}

.icon-btn {
  background: white;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: var(--elevation-0);
}
.icon-btn:hover {
  background-color: #f8f9fa;
  color: var(--text-primary);
  box-shadow: var(--elevation-1);
  transform: translateY(-1px);
}

/* View Content */
.view-content {
  flex: 1;
  overflow: auto;
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 24px 32px;
}

/* Overriding any leftover defaults */
button.outline-btn {
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-weight: 600;
  cursor: pointer;
  border-radius: 8px;
  transition: 0.2s;
}
button.outline-btn:hover {
  border-color: var(--brand-primary);
  color: var(--brand-primary);
  background: var(--brand-dim);
}
`;

fs.writeFileSync(layoutPath, layoutCss);
console.log('Layout upgraded to premium Glassmorphism Material Level.');
