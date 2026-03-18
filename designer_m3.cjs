const fs = require('fs');

const filesToClean = [
  'src/components/IDE.tsx',
  'src/components/Vnc.tsx',
  'src/components/Ros.tsx',
  'src/components/Terminal.tsx'
];

filesToClean.forEach(file => {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    
    // Explicitly remove ros-topbar-dots
    content = content.replace(/<div className="ros-topbar-dots">[\s\S]*?<\/div>/g, '');
    content = content.replace(/<div className="vnc-topbar-dots">[\s\S]*?<\/div>/g, '');
    
    fs.writeFileSync(file, content);
  }
});
console.log('Dots patched via designer_m3.');
