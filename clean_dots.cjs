const fs = require('fs');
const path = require('path');

function cleanFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  // matches anything like <div className="mac-dots">...</div>
  content = content.replace(/<div[^>]*className="[^"]*(mac-dots|window-controls|ros-topbar-dots|vnc-topbar-dots|tt-traffic-lights)[^"]*"[^>]*>[\s\S]*?<\/div>/g, '');
  
  // match raw span dots that might not be in a container
  content = content.replace(/<span[^>]*className="[^"]*(ros-dot|vnc-dot|tt-dot)[^"]*"[^>]*>\s*<\/span>/g, '');
  
  if (content !== original) {
    fs.writeFileSync(filePath, content);
    console.log(`Cleaned -> ${filePath}`);
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walkDir(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.tsx')) {
      cleanFile(fullPath);
    }
  }
}

walkDir('./src/components');
