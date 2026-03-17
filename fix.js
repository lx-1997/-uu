const fs = require('fs');
let codeIde = fs.readFileSync('src/components/IDE.tsx', 'utf8');
let codeVnc = fs.readFileSync('src/components/Vnc.tsx', 'utf8');

// The file was written in some other encoding and read as utf8. Actually I will just replace the strings with English for now, or just provide clean safe strings.
