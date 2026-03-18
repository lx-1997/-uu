const fs = require('fs');
const glob = require('glob');

// We need to strip out all the fake macOS window dots in headers.
// The dots are usually something like <div className="mac-dots"> <span></span><span></span><span></span> </div>
// or <div className="ros-topbar-left"> <span className="dot red"></span> ... </div>

const filesToClean = [
  'src/components/IDE.tsx',
  'src/components/Vnc.tsx',
  'src/components/Terminal.tsx',
  'src/components/Hardware.tsx',
  'src/components/Files.tsx',
  'src/components/Models.tsx',
  'src/components/Lowcode.tsx',
  'src/components/Dashboard.tsx'
];

filesToClean.forEach(file => {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    
    // Remove mac-dots divs in various forms
    content = content.replace(/<div className="[^"]*(?:dots|mac|topbar-left)[^"]*">\s*(?:<span[^>]*><\/span>\s*){3}<\/div>/g, '');
    content = content.replace(/<div className="mac-dots[^"]*">.*?<\/div>\s*/g, '');
    
    fs.writeFileSync(file, content);
  }
});

console.log('Removed redundant macOS dots from internal panels.');
