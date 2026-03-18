const fs = require('fs');

const baseCssPath = 'src/styles/base.css';
let baseCss = fs.readFileSync(baseCssPath, 'utf8');

const newRoot = :root {
  /* Google Material Colors */
  --brand: #1a73e8; /* Default Material Blue, wait, our brand is orange #ff6b00, let's stick to brand but use Material logic */
  --brand-primary: #ff6b00;
  --brand-hover: #e66000;
  --brand-dim: rgba(255, 107, 0, 0.08);
  
  --text-primary: #202124;  /* Google deep grey */
  --text-secondary: #5f6368; /* Google mid grey */
  --text-muted: #80868b;
  
  --bg-app: #f8f9fa; /* Google background */
  --bg-surface: #f1f3f4; /* Google search box / secondary surface */
  --bg-card: #ffffff;
  
  --border: #dadce0; /* Google border */
  
  /* Material Elevation (Shadows) */
  --elevation-0: none;
  --elevation-1: 0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15);
  --elevation-2: 0 1px 2px 0 rgba(60,64,67,0.3), 0 2px 6px 2px rgba(60,64,67,0.15);
  --elevation-3: 0 1px 3px 0 rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15);
  --elevation-4: 0 2px 3px 0 rgba(60,64,67,0.3), 0 6px 10px 4px rgba(60,64,67,0.15);
  --elevation-dialog: 0 24px 38px 3px rgba(0,0,0,0.14), 0 9px 46px 8px rgba(0,0,0,0.12), 0 11px 15px -7px rgba(0,0,0,0.2);

  /* Shape */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 16px;
  --radius-pill: 9999px;

  /* Animation */
  --transition-standard: 250ms cubic-bezier(0.4, 0, 0.2, 1);
};

baseCss = baseCss.replace(/:root\s*\{[\s\S]*?\}/, newRoot);

// Change font and body background
baseCss = baseCss.replace(/background-color:.*?;/, 'background-color: var(--bg-app);');
baseCss = baseCss.replace(/color:.*?;/, 'color: var(--text-primary);');
baseCss = baseCss.replace(/font-family:.*?;/, 'font-family: "Google Sans", Roboto, Arial, sans-serif;');

// Standardize button styles right in base or component
baseCss += \

/* ---- Material Global Components ---- */
button {
  transition: all var(--transition-standard);
  border-radius: var(--radius-pill); /* Google uses pill or 4px usually, newer Google is pill */
  font-family: inherit;
  font-weight: 500;
  letter-spacing: 0.25px;
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
\;

fs.writeFileSync(baseCssPath, baseCss);
console.log('Base CSS rewritten to Google UI specs.');
