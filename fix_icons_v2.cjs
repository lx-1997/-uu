const fs = require('fs');

function fixSidebar() {
  const path = 'src/components/Sidebar.tsx';
  let content = fs.readFileSync(path, 'utf8');

  // Replace remaining emojis in Sidebar
  content = content.replace(/'💻'/g, "'terminal'");
  content = content.replace(/'📂'/g, "'folder'");
  content = content.replace(/'📊'/g, "'analytics'");
  content = content.replace(/'💽'/g, "'album'");
  content = content.replace(/'🖧'/g, "'router'"); // For device-icon

  // Update classes so that material-symbols-outlined is applied
  content = content.replace(/className="tool-icon"/g, 'className="tool-icon material-symbols-outlined" style={{ fontSize: "20px", display: "inline-block", verticalAlign: "middle" }}');
  content = content.replace(/className="device-icon"/g, 'className="device-icon material-symbols-outlined" style={{ fontSize: "28px" }}');

  // Also replace 'terminal' for VNC because it's duplicated with Terminal
  content = content.replace(/\['vnc', 'terminal', '远程桌面'\]/, "['vnc', 'desktop_windows', '远程桌面']");

  fs.writeFileSync(path, content);
  console.log('Sidebar fixed.');
}

function fixDashboard() {
  const path = 'src/components/Dashboard.tsx';
  let content = fs.readFileSync(path, 'utf8');

  content = content.replace(/'💻'/g, "'terminal'");
  content = content.replace(/'📂'/g, "'folder'");
  content = content.replace(/'📊'/g, "'analytics'");
  content = content.replace(/'💽'/g, "'album'");
  
  // Dashboard might be using other emoji. Replace known ones.
  content = content.replace(/'⚡'/g, "'bolt'");
  content = content.replace(/'📦'/g, "'inventory_2'");
  content = content.replace(/'📡'/g, "'router'");
  content = content.replace(/'🤖'/g, "'smart_toy'");
  content = content.replace(/'🟢'/g, "'check_circle'");
  content = content.replace(/'🌡️'/g, "'device_thermostat'");
  content = content.replace(/'🧠'/g, "'memory'");

  // Ensure card-icon gets the right font
  // It might already have it from earlier but let's be sure
  if (!content.includes('className="card-icon material-symbols-outlined"')) {
    content = content.replace(/className="card-icon"/g, 'className="card-icon material-symbols-outlined"');
  }
  
  fs.writeFileSync(path, content);
  console.log('Dashboard fixed.');
}

fixSidebar();
fixDashboard();
