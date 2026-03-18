const fs = require('fs');

const files = [
  {
    path: 'src/styles/ide.css',
    css: `
.ide-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--bg-app);
}

.ros-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 16px;
  background-color: var(--bg-card);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 1px 2px 0 rgba(60,64,67,0.1);
  z-index: 10;
}

.ros-topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ros-topbar-title {
  font-weight: 500;
  color: var(--text-primary);
}
.ros-topbar-badge {
  font-size: 0.75rem;
  padding: 2px 8px;
  background-color: var(--brand-dim);
  color: var(--brand-primary);
  border-radius: 9999px;
  font-weight: 500;
}
.ros-topbar-device {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.ros-topbar-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.ros-topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ros-tool-btn, .ros-disconnect-btn {
  padding: 6px 16px;
  border-radius: 9999px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}
.ros-tool-btn {
  background-color: transparent;
  color: var(--text-secondary);
}
.ros-tool-btn:hover {
  background-color: rgba(32,33,36,0.06);
  color: var(--text-primary);
}
.ros-disconnect-btn {
  background-color: #ea4335;
  color: white;
}
.ros-disconnect-btn:hover {
  background-color: #d93025;
  box-shadow: 0 1px 2px 0 rgba(60,64,67,0.3);
}

.ide-iframe-wrapper {
  flex: 1;
  background-color: var(--bg-app);
  display: flex;
  position: relative;
}

.ide-iframe {
  width: 100%;
  height: 100%;
  border: none;
  box-shadow: none;
}
    `
  },
  {
    path: 'src/styles/vnc.css',
    css: `
.vnc-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--bg-app);
}

.vnc-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 16px;
  background-color: var(--bg-card);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 1px 2px 0 rgba(60,64,67,0.1);
  z-index: 10;
}

.vnc-topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.vnc-topbar-title {
  font-weight: 500;
  color: var(--text-primary);
}
.vnc-topbar-badge {
  font-size: 0.75rem;
  padding: 2px 8px;
  background-color: var(--brand-dim);
  color: var(--brand-primary);
  border-radius: 9999px;
  font-weight: 500;
}
.vnc-topbar-device {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.vnc-topbar-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.vnc-topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.vnc-tool-btn, .vnc-disconnect-btn {
  padding: 6px 16px;
  border-radius: 9999px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}
.vnc-tool-btn {
  background-color: transparent;
  color: var(--text-secondary);
}
.vnc-tool-btn:hover {
  background-color: rgba(32,33,36,0.06);
  color: var(--text-primary);
}
.vnc-disconnect-btn {
  background-color: #ea4335;
  color: white;
}
.vnc-disconnect-btn:hover {
  background-color: #d93025;
  box-shadow: 0 1px 2px 0 rgba(60,64,67,0.3);
}

.vnc-status-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--text-secondary);
}
.vnc-status-badge.live {
  color: #34a853;
}
.vnc-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #fbbc04;
}
.vnc-status-badge.live .vnc-status-dot {
  background-color: #34a853;
}

.vnc-iframe-wrapper {
  flex: 1;
  background-color: #202124; /* Keep VNC dark inside */
  display: flex;
  position: relative;
  overflow: hidden;
}

.vnc-iframe {
  width: 100%;
  height: 100%;
  border: none;
}
    `
  }
];

files.forEach(f => {
  fs.writeFileSync(f.path, f.css.trim());
});

console.log('IDE and VNC styling updated to match Google UI headers');
