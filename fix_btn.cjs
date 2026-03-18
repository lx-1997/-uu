const fs = require('fs');
const path = require('path');
const cssDir = path.resolve(__dirname, 'src/styles');

function processFile(file) {
  if (!file.endsWith('.css')) return;
  const filePath = path.join(cssDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;
  
  // Find cases where background is orange (#ff6b00) but text is var(--text-primary)
  content = content.replace(/background:\s*#ff6b00;\s*color:\s*var\(--text-primary\)/gi, 'background: #ff6b00; color: #ffffff');
  
  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed orange button text in', file);
  }
}
fs.readdirSync(cssDir).forEach(processFile);
