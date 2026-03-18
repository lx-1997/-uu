const fs = require('fs');

const sidebarPath = 'src/components/Sidebar.tsx';
let sidebarParams = fs.readFileSync(sidebarPath, 'utf8');

// The sidebar items typically look like:
// ['ide', '', '代码编辑']
// We'll replace the emoji with a material icon name.

const emojiToIcon = {
  '': 'memory',
  '': 'code',
  '': 'terminal',
  '': 'folder',
  '': 'smart_toy',
  '': 'radar',
  '': 'schema',
  '': 'inventory_2',
  '': 'speed'
};

for (const [emoji, icon] of Object.entries(emojiToIcon)) {
  sidebarParams = sidebarParams.split(emoji).join(icon);
}

// We also need to change how the icon is rendered in Sidebar.tsx
// From <span className="nav-icon">{item[1]}</span>
// To <span className="nav-icon material-symbols-outlined">{item[1]}</span>

sidebarParams = sidebarParams.replace(/className="nav-icon"/g, 'className="nav-icon material-symbols-outlined"');
fs.writeFileSync(sidebarPath, sidebarParams);

// Do the same for Dashboard.tsx
const dashPath = 'src/components/Dashboard.tsx';
let dash = fs.readFileSync(dashPath, 'utf8');
for (const [emoji, icon] of Object.entries(emojiToIcon)) {
  dash = dash.split(emoji).join(icon);
}
dash = dash.replace(/className="card-icon"/g, 'className="card-icon material-symbols-outlined"');
dash = dash.replace(/className="action-icon"/g, 'className="action-icon material-symbols-outlined"');
fs.writeFileSync(dashPath, dash);

console.log('Sidebar and Dashboard icons updated.');
