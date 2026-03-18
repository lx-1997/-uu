const fs = require('fs');

const baseCssP = 'src/styles/base.css';
let baseCss = fs.readFileSync(baseCssP, 'utf8');

// Ensure root variables are correct.
const layoutCssP = 'src/styles/layout.css';
let layoutCss = fs.readFileSync(layoutCssP, 'utf8');

layoutCss = \
.canvas-shell {
  display: flex;
  height: 100vh;
  position: relative;
  background-color: var(--bg-app);
  color: var(--text-primary);
  overflow: hidden;
}

.layout-container {
  display: flex;
  width: 100%;
  height: 100%;
  z-index: 10;
}

/* Sidebar */
.app-sidebar {
  width: 260px;
  background-color: var(--bg-card);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
  z-index: 20;
}
.sidebar-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px 24px;
  font-weight: 600;
  font-size: 1.1rem;
  color: var(--text-primary);
}
.header-icon {
  font-size: 24px;
  color: var(--brand-primary);
  font-variation-settings: 'FILL' 1;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  margin-bottom: 4px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.2s ease;
  font-weight: 500;
  font-size: 0.95rem;
}
.nav-item:hover {
  background-color: var(--brand-dim);
  color: var(--brand-primary);
}
.nav-item.active {
  background-color: rgba(255, 107, 0, 0.12); /* Soft brand */
  color: var(--brand-primary);
  font-weight: 600;
}
.nav-icon {
  font-size: 22px;
}

.sidebar-spacer { flex: 1; }

.bottom-nav {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  margin-top: 12px;
}

/* App Viewport */
.app-viewport {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  background-color: var(--bg-app);
}

/* Top Toolbar */
.top-toolbar {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background-color: var(--bg-app);
  border-bottom: 1px solid transparent; 
  /* Minimal topbar, no heavy lines */
}
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}
.toolbar-title {
  font-size: 1.1rem;
  font-weight: 500;
  color: var(--text-primary);
}
.device-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background-color: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  font-size: 0.85rem;
  color: var(--text-secondary);
  box-shadow: var(--elevation-0);
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #34a853; /* Google Green */
  box-shadow: 0 0 0 3px rgba(52, 168, 83, 0.2);
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.icon-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}
.icon-btn:hover {
  background-color: rgba(32, 33, 36, 0.06);
  color: var(--text-primary);
}

/* View Content */
.view-content {
  flex: 1;
  overflow: auto;
  position: relative;
  display: flex;
  flex-direction: column;
}
\;

fs.writeFileSync(layoutCssP, layoutCss);
console.log('layout.css rewritten to Google UI.');
