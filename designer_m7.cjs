const fs = require('fs');

const path = 'src/components/TopToolbar.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/<div className="tt-traffic-lights">[\s\S]*?<\/div>/g, '');

fs.writeFileSync(path, content);
console.log('Removed duplicate top toolbar traffic lights!');
