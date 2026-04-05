/**
 * Lists t()/tf() keys in src/ that are missing from the merged EN table
 * (en.ts + en-extras + onboard/openclaw/skill-browser/sidebar partials).
 * Keys must use dotted segments; camelCase segments (e.g. dock.attach.audioHint) are matched.
 * Run: node scripts/audit-i18n-keys.mjs
 * Expect: "Missing EN entries: 0" when translations are complete.
 */
import fs from 'fs';
import path from 'path';

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(ent.name)) continue;
      walk(p, acc);
    } else if (/\.(tsx|ts|jsx|js)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

const srcRoot = path.join(process.cwd(), 'src');
const files = walk(srcRoot);
const keyRe = /\b(?:t|tf)\(\s*['"]([^'"]+)['"]/g;
const used = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = keyRe.exec(s))) used.add(m[1]);
}

const i18nDir = path.join(srcRoot, 'i18n');
const enParts = [
  'en.ts',
  'en-extras.ts',
  'onboard-en-partial.ts',
  'openclaw-en-partial.ts',
  'skill-browser-en-partial.ts',
  'sidebar-en-partial.ts',
];
let enText = '';
for (const name of enParts) {
  const p = path.join(i18nDir, name);
  if (fs.existsSync(p)) enText += `\n${fs.readFileSync(p, 'utf8')}`;
}
/** 至少两段；segment 允许 camelCase（如 dock.attach.audioHint） */
const defRe = /['"]([a-zA-Z][a-zA-Z0-9_.-]*(?:\.[a-zA-Z0-9_-]+)+)['"]\s*:/g;
const defined = new Set();
let mm;
while ((mm = defRe.exec(enText))) defined.add(mm[1]);

const withDot = [...used].filter((k) => k.includes('.'));
const missing = withDot.filter((k) => !defined.has(k)).sort();

console.log('Files scanned:', files.length);
console.log('Defined keys (regex):', defined.size);
console.log('t/tf keys (dotted):', withDot.length);
console.log('Missing EN entries:', missing.length);
console.log('Sample check dock.attach.audioHint:', defined.has('dock.attach.audioHint'));
if (missing.length) console.log('\n' + missing.join('\n'));
