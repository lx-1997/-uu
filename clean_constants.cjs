const fs = require('fs');

const path = 'src/constants.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/⚙️/g, '');
content = content.replace(/📦/g, '');
content = content.replace(//g, ''); // Fix garbled characters
content = content.replace(/💬/g, '');
content = content.replace(/🔑/g, '');
content = content.replace(/📋/g, '');
content = content.replace(/👁️/g, '');
content = content.replace(/🖐️/g, '');
content = content.replace(/📡/g, '');
content = content.replace(/🧩/g, '');
content = content.replace(/⬇️/g, '');
content = content.replace(/🔄/g, '');

// If there are other emojis, strip them out entirely from titles to make it clean
content = content.replace(/title: '.*?(OpenClaws Gateway|ROS|模型仓库|应用示例).*?'/g, (match, p1) => {
  return `title: '${p1}'`;
});

fs.writeFileSync(path, content);
console.log('Constants cleaned');
