const fs = require('fs');
const path = require('path');

const cssDir = path.resolve(__dirname, 'src/styles');

const replacements = [
  // Container Backgrounds (Dark to Light)
  { regex: /background:\s*#(0f1117|0f172a|0f0f0f|1e1e1e|1e293b|111|1a1a1a|222)/gi, replacement: 'background: var(--bg-card)' },
  { regex: /background-color:\s*#(0f1117|0f172a|0f0f0f|1e1e1e|1e293b|111|1a1a1a|222)/gi, replacement: 'background-color: var(--bg-card)' },
  // Panels/Surface
  { regex: /background:\s*#(252526|2d2d2d|333333|334155|2a2a2a)/gi, replacement: 'background: var(--bg-surface)' },
  // Borders
  { regex: /border(-[a-z]+)?:\s*1px solid #(2a2a2a|333|444|222|e2e8f0|334155|252526)/gi, replacement: 'border$1: 1px solid var(--border)' },
  // Text Colors
  { regex: /color:\s*#(f1f5f9|ffffff|e0e0e0|ccc|f8fafc)/gi, replacement: 'color: var(--text-primary)' },
  { regex: /color:\s*#(94a3b8|888|666|777)/gi, replacement: 'color: var(--text-muted)' },
  
  // Translucent Overlays for Dark mode (rgba(255,255,255, 0.x)) -> Light mode (rgba(0,0,0, 0.x))
  { regex: /rgba\(255,\s*255,\s*255,\s*0\.03\)/gi, replacement: 'rgba(0,0,0,0.02)' },
  { regex: /rgba\(255,\s*255,\s*255,\s*0\.04\)/gi, replacement: 'rgba(0,0,0,0.03)' },
  { regex: /rgba\(255,\s*255,\s*255,\s*0\.05\)/gi, replacement: 'rgba(0,0,0,0.04)' },
  { regex: /rgba\(255,\s*255,\s*255,\s*0\.06\)/gi, replacement: 'rgba(0,0,0,0.05)' },
  { regex: /rgba\(255,\s*255,\s*255,\s*0\.08\)/gi, replacement: 'rgba(0,0,0,0.06)' },
  { regex: /rgba\(255,\s*255,\s*255,\s*0\.12\)/gi, replacement: 'rgba(0,0,0,0.08)' },
  { regex: /rgba\(10,\s*10,\s*10,\s*0\.92\)/gi, replacement: 'rgba(255,255,255,0.92)' }
];

function processFile(file) {
  if (!file.endsWith('.css')) return;
  const filePath = path.join(cssDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;
  
  replacements.forEach(rep => {
    content = content.replace(rep.regex, rep.replacement);
  });
  
  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed theme in', file);
  }
}

fs.readdirSync(cssDir).forEach(processFile);
console.log('Global style unification completed.');
