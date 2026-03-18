const fs = require('fs');

const path = 'src/components/Sidebar.tsx';
let content = fs.readFileSync(path, 'utf8');

// Replace left over emojis in sidebar footer
content = content.replace(/☁️/g, '<span className="material-symbols-outlined nav-icon" style={{fontSize:"18px"}}>cloud</span>');
content = content.replace(/☕/g, '<span className="material-symbols-outlined nav-icon" style={{fontSize:"18px"}}>group</span>');
content = content.replace(/⚙️/g, '<span className="material-symbols-outlined nav-icon" style={{fontSize:"18px"}}>settings</span>');
content = content.replace(/<span className="tool-icon"><span/g, '<span');
content = content.replace(/<\/span><\/span>/g, '</span>');

fs.writeFileSync(path, content);
console.log('Sidebar footer emojis cleaned.');
