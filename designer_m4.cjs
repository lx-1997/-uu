const fs = require('fs');
let indexHtml = fs.readFileSync('index.html', 'utf8');
if (!indexHtml.includes('Material+Symbols+Outlined')) {
  const insertIndex = indexHtml.indexOf('<title>RDK Studio</title>');
  const linkString = '<link href=\"https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200\" rel=\"stylesheet\" />\n    ';
  indexHtml = indexHtml.slice(0, insertIndex) + linkString + indexHtml.slice(insertIndex);
  fs.writeFileSync('index.html', indexHtml);
}
console.log('Material Symbols Added.');
