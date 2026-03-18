const fs = require('fs');

const path = 'src/styles/base.css';
let content = fs.readFileSync(path, 'utf8');

const newRoot = `:root {
  /* Google Material Colors */
  --brand-primary: #ff6b00;
  --brand-hover: #e66000;
  --brand-dim: rgba(255, 107, 0, 0.08);
  
  /* Text Colors */
  --text-primary: #202124;  /* Google deep grey */
  --text-secondary: #5f6368; /* Google mid grey */
  --text-muted: #80868b;
  
  /* Backgrounds */
  --bg-app: #f8f9fa; /* Google light app background */
  --bg-surface: #f1f3f4; /* Secondary surface */
  --bg-card: #ffffff;
  
  /* Borders */
  --border: #dadce0; 
  
  /* Material Elevations (Shadows) */
  --elevation-0: none;
  --elevation-1: 0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15);
  --elevation-2: 0 1px 2px 0 rgba(60,64,67,0.3), 0 2px 6px 2px rgba(60,64,67,0.15);
  --elevation-3: 0 1px 3px 0 rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15);
  
  /* Shapes */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 16px;
  --radius-pill: 9999px;

  /* Animation */
  --transition-standard: 250ms cubic-bezier(0.4, 0, 0.2, 1);
}`;

content = content.replace(/:root\s*\{[\s\S]*?\}/, newRoot);

// replace body font
content = content.replace(/font-family:.*?;/, 'font-family: "Google Sans", "Inter", Roboto, "Helvetica Neue", sans-serif;');
content = content.replace(/background-color:.*?;/, 'background-color: var(--bg-app);');
content = content.replace(/color:.*?;/, 'color: var(--text-primary);');

// add base button styles globally if not already present
if (!content.includes('button {') && !content.includes('.btn-primary')) {
  content += `

button {
  transition: all var(--transition-standard);
  border-radius: var(--radius-pill); 
  font-family: inherit;
  font-weight: 500;
  letter-spacing: 0.25px;
  cursor: pointer;
}
.btn-primary {
  background-color: var(--brand-primary);
  color: white;
  border: none;
  box-shadow: var(--elevation-1);
}
.btn-primary:hover {
  background-color: var(--brand-hover);
  box-shadow: var(--elevation-2);
}
`;
}

fs.writeFileSync(path, content);
console.log('Base CSS cleanly updated!');
