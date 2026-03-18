const fs = require('fs');

const path = 'src/components/TopToolbar.tsx';
let content = fs.readFileSync(path, 'utf8');

// Replace {copied ? '✅' : '📋'}
content = content.replace(/\{copied \? '.*?' : '.*?'\}/g, `
  <span className="material-symbols-outlined" style={{ fontSize: '14px', marginLeft: '4px' }}>
    {copied ? 'check' : 'content_copy'}
  </span>
`);

content = content.replace(/<button className="icon-btn" title=".*?">.*?<\/button>/g, `
  <button className="icon-btn" title="查看用户/许可证">
    <span className="material-symbols-outlined">person</span>
  </button>
`);

// The user might have a wifi emoji inside a span 
content = content.replace(/>\s*📡\s*<\/span>/g, `>
  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>wifi</span>
</span>`);

fs.writeFileSync(path, content);
console.log('TopToolbar icons replaced.');
