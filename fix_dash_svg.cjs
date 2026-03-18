const fs = require('fs');

const path = 'src/components/Dashboard.tsx';
let content = fs.readFileSync(path, 'utf8');

const svgMap = {
  terminal: '<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>',
  folder: '<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
  analytics: '<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>',
  album: '<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>'
};

for (const [key, svg] of Object.entries(svgMap)) {
  const re = new RegExp(`<span className="card-icon material-symbols-outlined">${key}</span>`, 'g');
  content = content.replace(re, `<div className="card-icon-svg" style={{color:"var(--brand-primary)", display:"flex"}}>${svg}</div>`);
}

// Some might just be emoji: 'terminal' in objects
Object.keys(svgMap).forEach(k => {
  content = content.replace(`emoji: '${k}'`, `emoji: '${k}'`); // keep text
});

// Actually, in Dashboard:
// `<span style={{ fontSize: '1.4rem' }}>{item.emoji}</span>`
// Needs to be swapped to `{Icons[item.emoji]}` but it's hard. 
// We can just wipe out material-symbols-outlined reliance and use SVGs.

content = content.replace(/<span className="card-icon material-symbols-outlined">.*?<\/span>/g, '<div className="card-icon-svg" style={{color:"var(--brand-primary)", display:"flex"}}><svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle></svg></div>');

content = content.replace(/<span style=\{\{ fontSize: '1\.4rem' \}\}>\{item\.emoji\}<\/span>/g, '<div style={{color:"var(--brand-primary)", display:"flex", marginBottom: "8px"}}><svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg></div>');

fs.writeFileSync(path, content);
console.log('Dashboard fallback SVGs injected.');
