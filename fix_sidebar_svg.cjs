const fs = require('fs');

const path = 'src/components/Sidebar.tsx';
let content = fs.readFileSync(path, 'utf8');

const svgIcons = `
const Icons: Record<string, React.ReactNode> = {
  terminal: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>,
  ide: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>,
  files: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>,
  vnc: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>,
  hardware: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>,
  flasher: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>,
  ros: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>,
  models: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
};
`;

// Inject Icons map right after "export default function Sidebar() {"
content = content.replace(/export default function Sidebar\(\) \{/, "export default function Sidebar() {\n" + svgIcons);

// Replace the array map logic in sidebar-tools
content = content.replace(/\{\(\[\s*(?:\[.*?\],\s*)*\] as const\)\.map\(\(\[tab, icon, label\]\) => \(/, 
`{([
  ['terminal', '终端'],
  ['ide', '代码编辑'],
  ['files', '文件管理'],
  ['vnc', '远程桌面'],
  ['hardware', '硬件监控'],
  ['flasher', '系统烧录'],
] as const).map(([tab, label]) => (`);

// Replace `<span className="tool-icon material-symbols-outlined.*?>{icon}</span> {label}` inside the map
content = content.replace(/<span className="tool-icon[\s\S]*?>\{icon\}<\/span>\s*\{label\}/, 
  '<span className="tool-icon" style={{display:"flex",alignItems:"center",justifyContent:"center"}}>{Icons[tab]}</span> <span style={{marginLeft:"8px"}}>{label}</span>');

content = content.replace(/<span className="device-icon material-symbols-outlined.*?>router<\/span>/, '<span className="device-icon"><svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg></span>');

fs.writeFileSync(path, content);
console.log('Sidebar perfectly fixed with inline SVGs!');
