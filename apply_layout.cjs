const fs = require('fs');

const layoutCssP = 'src/styles/layout.css';

const layoutCss = `
.canvas-shell {
  display: flex;
  height: 100vh;
  position: relative;
  background-color: var(--bg-app, #f8f9fa);
  color: var(--text-primary, #202124);
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
  background-color: var(--bg-card, #ffffff);
  border-right: 1px solid var(--border, #dadce0);
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
  color: var(--brand-primary, #ff6b00);
  font-variation-settings: 'FILL' 1;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  margin-bottom: 4px;
  border-radius: 9999px; /* Pill */
  cursor: pointer;
  color: var(--text-secondary, #5f6368);
  transition: all 0.2s ease;
  font-weight: 500;
  font-size: 0.95rem;
}
.nav-item:hover {
  background-color: var(--brand-dim, rgba(255,107,0,0.08));
  color: var(--brand-primary, #ff6b00);
}
.nav-item.active {
  background-color: rgba(255, 107, 0, 0.12);
  color: var(--brand-primary, #ff6b00);
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
}
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}
.toolbar-title {
  font-size: 1.2rem;
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
  border-radius: 9999px;
  font-size: 0.85rem;
  color: var(--text-secondary);
  box-shadow: 0 1px 2px 0 rgba(60,64,67,0.1);
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #34a853;
  box-shadow: 0 0 0 3px rgba(52, 168, 83, 0.2);
}
.status-dot.offline {
  background-color: #ea4335;
  box-shadow: 0 0 0 3px rgba(234, 67, 53, 0.2);
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
  background-color: rgba(32, 33, 36, 0.08); /* Google hover */
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
`;

fs.writeFileSync(layoutCssP, layoutCss.trim());
console.log('Done!');
