const fs = require('fs');
const path = require('path');

function patchFile(file) {
  const filePath = path.resolve(__dirname, file);
  if (!fs.existsSync(filePath)) return;
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Containers
  content = content.replace(/height:\s*100%;\s*width:\s*100%;\s*background:\s*#1e1e1e;/g, "height: calc(100% - 32px);\n  width: calc(100% - 32px);\n  margin: 16px;\n  background: var(--bg-card);\n  box-shadow: 0 4px 16px rgba(0,0,0,0.06);\n  border: 1px solid var(--border);");
  content = content.replace(/height:\s*100%;\s*width:\s*100%;\s*background:\s*#0f0f0f;/g, "height: calc(100% - 32px);\n  width: calc(100% - 32px);\n  margin: 16px;\n  background: var(--bg-card);\n  box-shadow: 0 4px 16px rgba(0,0,0,0.06);\n  border: 1px solid var(--border);");
  
  // Topbars
  content = content.replace(/background:\s*#252526;/g, "background: var(--bg-card);");
  content = content.replace(/background:\s*#1a1a1a;/g, "background: var(--bg-card);");
  content = content.replace(/border-bottom:\s*1px solid #333;/g, "border-bottom: 1px solid var(--border);");
  content = content.replace(/border-bottom:\s*1px solid #2a2a2a;/g, "border-bottom: 1px solid var(--border);");
  content = content.replace(/border-right:\s*1px solid #333;/g, "border-right: 1px solid var(--border);");
  
  // Colors
  content = content.replace(/color:\s*#e0e0e0;/g, "color: var(--text-primary);");
  content = content.replace(/color:\s*#ccc;/g, "color: var(--text-primary);");
  content = content.replace(/color:\s*#888;/g, "color: var(--text-muted);");
  content = content.replace(/color:\s*#666;/g, "color: var(--text-secondary);");
  
  // Borders and buttons
  content = content.replace(/border:\s*1px solid #333;/g, "border: 1px solid var(--border);");
  content = content.replace(/border-color:\s*#555;/g, "border-color: #cbd5e1;");
  content = content.replace(/background:\s*#2a2a2a;/g, "background: var(--bg-surface);");
  content = content.replace(/background:\s*rgba\(10,\s*10,\s*10,\s*0\.92\);/g, "background: rgba(255,255,255,0.92);");
  
  // Specific dark backgrounds
  content = content.replace(/background:\s*#000;/g, "background: #f0f4f8;"); 
  content = content.replace(/background:\s*linear-gradient\(180deg,\s*#111\s*0%,\s*#0a0a0a\s*100%\);/g, "background: var(--bg-surface);");
  
  fs.writeFileSync(filePath, content, 'utf8');
}

['src/styles/vnc.css', 'src/styles/ide.css', 'src/styles/ros.css'].forEach(patchFile);
console.log("Patched CSS files successfully.");