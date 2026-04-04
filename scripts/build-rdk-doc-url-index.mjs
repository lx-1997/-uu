/**
 * 从 server/rdkclaw/_crawl-paths.txt（由 scripts/crawl-rdk-doc-paths.mjs 生成）生成 rdk-doc-url-index.md
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = 'https://developer.d-robotics.cc';
const PATHS_FILE = join(__dirname, '..', 'server', 'rdkclaw', '_crawl-paths.txt');
const OUT_FILE = join(__dirname, '..', 'server', 'rdkclaw', 'rdk-doc-url-index.md');

/** 静态托管上无 index 的「目录」路径（侧栏有链接但打开 404），子页面仍有效 */
const BLOCKLIST_EXACT = new Set([
  '/rdk_doc/Robot_development/quick_start',
  '/rdk_doc/Robot_development/boxs',
  '/rdk_doc/Robot_development/boxs/detection',
  '/rdk_doc/rdk_s/Robot_development/quick_start',
  '/rdk_doc/rdk_s/Robot_development/boxs',
  '/rdk_doc/en/Robot_development/quick_start',
  '/rdk_doc/en/Robot_development/boxs',
  '/rdk_doc/en/Robot_development/boxs/detection',
  '/rdk_doc/en/rdk_s/Robot_development/boxs/detection',
]);

const NAME_OVERRIDES = new Map([
  ['/rdk_doc/Quick_start/hardware_introduction/rdk_x3', '1.1 硬件简介 · RDK X3'],
  ['/rdk_doc/Quick_start/hardware_introduction/rdk_x5', '1.1 硬件简介 · RDK X5'],
  ['/rdk_doc/Quick_start/hardware_introduction/rdk_ultra', '1.1 硬件简介 · RDK Ultra'],
  ['/rdk_doc/Quick_start/install_os/rdk_x3', '1.2 系统烧录 · RDK X3'],
  ['/rdk_doc/Quick_start/install_os/rdk_x5', '1.2 系统烧录 · RDK X5'],
  ['/rdk_doc/Quick_start/install_os/rdk_ultra', '1.2 系统烧录 · RDK Ultra'],
  ['/rdk_doc/Quick_start/configuration_wizard', '1.3 入门配置向导（X3 / X5 / 等）'],
  ['/rdk_doc/Quick_start/remote_login', '1.4 远程登录'],
  ['/rdk_doc/Quick_start/display_use/display_rdkx5', '1.5 显示屏使用 · RDK X5'],
  ['/rdk_doc/Quick_start/classification', '1.6 算法体验（classification）'],
  ['/rdk_doc/Quick_start/download', '1.7 下载资源汇总'],
  ['/rdk_doc/Quick_start/accessory', '1.8 配件清单'],
  ['/rdk_doc/rdk_s/Quick_start/hardware_introduction/rdk_s100', 'S100 · 1.1 硬件简介（rdk_s）'],
  ['/rdk_doc/rdk_s/Quick_start/install_os/rdk_s100/FAQ', 'S100 · 系统烧录 FAQ（rdk_s）'],
  ['/rdk_doc/rdk_s/Quick_start/configuration_wizard/configuration_wizard_s100', 'S100 · 入门配置向导（rdk_s）'],
  ['/rdk_doc/Robot_development/quick_start/preparation', 'TROS / 机器人 · 环境准备'],
  ['/rdk_doc/Robot_development/quick_start/install_tros', 'TROS / 机器人 · 安装 TROS'],
  ['/rdk_doc/Robot_development/quick_start/hello_world', 'TROS / 机器人 · Hello World'],
  ['/rdk_doc/Robot_development/quick_start/cross_compile', 'TROS / 机器人 · 交叉编译'],
  ['/rdk_doc/Robot_development/quick_start/ros_pkg', 'TROS / 机器人 · ROS 工程包'],
  ['/rdk_doc/Robot_development/quick_start/changelog', 'TROS / 机器人 · 更新日志'],
  ['/rdk_doc/Robot_development/tros', 'TROS 总览与开发（机器人）'],
  ['/rdk_doc/rdk_s/Robot_development/quick_start/preparation', 'TROS / 机器人 · 环境准备（S100 · rdk_s）'],
  ['/rdk_doc/rdk_s/Robot_development/quick_start/install_tros', 'TROS / 机器人 · 安装 TROS（S100 · rdk_s）'],
  ['/rdk_doc/rdk_s/Robot_development/quick_start/hello_world', 'TROS / 机器人 · Hello World（S100 · rdk_s）'],
  ['/rdk_doc/rdk_s/Robot_development/quick_start/cross_compile', 'TROS / 机器人 · 交叉编译（S100 · rdk_s）'],
  ['/rdk_doc/rdk_s/Robot_development/quick_start/ros_pkg', 'TROS / 机器人 · ROS 工程包（S100 · rdk_s）'],
  ['/rdk_doc/rdk_s/Robot_development/quick_start/changelog', 'TROS / 机器人 · 更新日志（S100 · rdk_s）'],
  ['/rdk_doc/rdk_s/Robot_development/tros', 'TROS 总览与开发（S100 · rdk_s）'],
  ['/rdk_doc/Robot_development/boxs/detection/yolo', '目标检测 YOLO'],
  ['/rdk_doc/Robot_development/boxs/detection/fcos', '目标检测 FCOS'],
  ['/rdk_doc/rdk_s/Robot_development/boxs/detection/yolo', '目标检测 YOLO（S100 · rdk_s）'],
  ['/rdk_doc/rdk_s/Robot_development/boxs/detection/fcos', '目标检测 FCOS（S100 · rdk_s）'],
  ['/rdk_doc/en/Robot_development/boxs/detection/yolo', '目标检测 YOLO（English）'],
  ['/rdk_doc/en/Robot_development/boxs/detection/fcos', '目标检测 FCOS（English）'],
  ['/rdk_doc/en/rdk_s/Robot_development/boxs/detection/fcos', '目标检测 FCOS（English · rdk_s）'],
]);

const SECTION_META = [
  { id: 'root', title: '文档根与顶层入口' },
  { id: 'Quick_start', title: 'Quick_start（快速开始）' },
  { id: 'System_configuration', title: 'System_configuration（系统配置）' },
  { id: 'Basic_Application', title: 'Basic_Application（基础应用）' },
  { id: 'Basic_Development', title: 'Basic_Development（基础开发）' },
  { id: 'Python_Cpp_Model', title: 'Python_development / Cpp_development / Model_deploy（索引页）' },
  { id: 'Algorithm_Application', title: 'Algorithm_Application（算法与 Model Zoo）' },
  { id: 'Robot_development', title: 'Robot_development（机器人应用 / TROS / boxs）' },
  { id: 'Application_case', title: 'Application_case（应用案例）' },
  { id: 'Advanced_development', title: 'Advanced_development（高级开发 / 工具链 / 多媒体子站）' },
  { id: 'FAQ', title: 'FAQ' },
  { id: 'Appendix', title: 'Appendix（附录与命令手册）' },
  { id: 'Release_Note', title: 'Release_Note（发行说明）' },
  { id: 'other_zh', title: '其他中文顶层（RDK / RDK Studio / 设备管理等）' },
  { id: 'openclaw', title: 'OpenClaw' },
  { id: 'en', title: '英文文档（en）' },
  { id: 'rdk_s', title: 'rdk_s（RDK S100 独立文档树）' },
];

function groupForPath(path) {
  const p = path.replace(/^\/rdk_doc\/?/, '').replace(/\/$/, '');
  if (!p) return 'root';
  if (p === 'en') return 'en';
  if (p.startsWith('en/')) return 'en';
  if (p.startsWith('rdk_s/')) return 'rdk_s';
  if (p.startsWith('Quick_start')) return 'Quick_start';
  if (p.startsWith('System_configuration')) return 'System_configuration';
  if (p.startsWith('Basic_Application') || p.startsWith('03_Basic_Application')) return 'Basic_Application';
  if (p.startsWith('Basic_Development')) return 'Basic_Development';
  if (
    p.startsWith('Python_development') ||
    p.startsWith('Cpp_development') ||
    p.startsWith('Model_deploy')
  ) {
    return 'Python_Cpp_Model';
  }
  if (p.startsWith('Algorithm_Application')) return 'Algorithm_Application';
  if (p.startsWith('Robot_development')) return 'Robot_development';
  if (p.startsWith('Application_case')) return 'Application_case';
  if (
    p.startsWith('Advanced_development') ||
    p === '03_multimedia_development' ||
    p === '04_toolchain_development'
  ) {
    return 'Advanced_development';
  }
  if (p.startsWith('FAQ')) return 'FAQ';
  if (p.startsWith('Appendix')) return 'Appendix';
  if (p.startsWith('Release_Note')) return 'Release_Note';
  if (p.startsWith('07_openclaw')) return 'openclaw';
  return 'other_zh';
}

function displayName(path) {
  const norm = path.replace(/\/$/, '');
  if (NAME_OVERRIDES.has(norm)) return NAME_OVERRIDES.get(norm);
  const rel = norm.replace(/^\/rdk_doc\/?/, '');
  const parts = rel.split('/').filter(Boolean);
  if (parts.length === 0) return '文档首页';
  return parts.join(' / ').replace(/_/g, ' ');
}

function parsePaths(raw) {
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('/rdk_doc')) continue;
    if (t.endsWith('.md')) continue;
    out.push(t.replace(/\/$/, '') || '/rdk_doc');
  }
  const merged = [...new Set(out)].filter((p) => !BLOCKLIST_EXACT.has(p));
  return merged.sort((a, b) => a.localeCompare(b));
}

const QUICK_START_TAIL_ORDER = [
  'preparation',
  'install_tros',
  'hello_world',
  'cross_compile',
  'ros_pkg',
  'changelog',
];

/** 机器人章节：TROS 入门与 tros 总览优先，便于对照官网 */
function sortRobotPaths(paths) {
  const score = (p) => {
    if (
      p === '/rdk_doc/Robot_development' ||
      p === '/rdk_doc/en/Robot_development' ||
      p === '/rdk_doc/en/rdk_s/Robot_development' ||
      p === '/rdk_doc/rdk_s/Robot_development'
    ) {
      return 5;
    }
    if (p.includes('/Robot_development/quick_start/')) return 10;
    if (p.endsWith('/Robot_development/tros')) return 20;
    if (p.includes('/Robot_development/tros_dev/')) return 30;
    if (p.includes('/Robot_development/quick_demo/')) return 40;
    if (p.includes('/Robot_development/apps/')) return 50;
    if (p.includes('/Robot_development/boxs/')) return 60;
    if (p.includes('/Robot_development/known_issues')) return 70;
    return 80;
  };
  const qsOrder = (p) => {
    const m = p.match(/\/quick_start\/([^/]+)$/);
    if (!m) return 99;
    const i = QUICK_START_TAIL_ORDER.indexOf(m[1]);
    return i === -1 ? 50 : i;
  };
  return [...paths].sort((a, b) => {
    const d = score(a) - score(b);
    if (d !== 0) return d;
    const sa = score(a);
    if (sa === 10) return qsOrder(a) - qsOrder(b);
    return a.localeCompare(b);
  });
}

function main() {
  const raw = readFileSync(PATHS_FILE, 'utf-8');
  const paths = parsePaths(raw);
  const byGroup = new Map();
  for (const id of SECTION_META.map((s) => s.id)) byGroup.set(id, []);

  for (const p of paths) {
    const g = groupForPath(p);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(p);
  }
  const rd = byGroup.get('Robot_development');
  if (rd?.length) byGroup.set('Robot_development', sortRobotPaths(rd));

  const lines = [];
  lines.push('# RDK 官方文档 URL 索引（developer.d-robotics.cc/rdk_doc）');
  lines.push('');
  lines.push(
    '本文件为 **唯一维护入口**：按站点侧栏可爬取的章节列出 **完整 URL**（由 `scripts/crawl-rdk-doc-paths.mjs` BFS 抓取生成 `_crawl-paths.txt` 后，运行 `node scripts/build-rdk-doc-url-index.mjs` 更新）。Agent 提示词从本文件加载，**请勿**在 TypeScript 中硬编码具体子链接。',
  );
  lines.push('');
  lines.push(
    '> **根地址**：`https://developer.d-robotics.cc/rdk_doc/`  ',
  );
  lines.push(
    '> **S100 独立文档区根**：`https://developer.d-robotics.cc/rdk_doc/rdk_s/`  ',
  );
  lines.push(
    '> 已过滤侧栏中无效的 `.md` 直链；并剔除 OSS 上 **无索引页** 的目录 URL（如 `.../Robot_development/quick_start`、`.../boxs` 本体，子页面仍保留）。',
  );
  lines.push('');
  lines.push('### 官网主导航与产品线（对照侧栏）');
  lines.push('');
  lines.push(
    '- **1 快速开始** → `Quick_start/`；**RDK X3 / X5 / Ultra** 硬件与烧录见其中 `hardware_introduction`、`install_os`；**RDK S100** 使用独立树 `rdk_s/Quick_start/`、`rdk_s/02_install_os/` 等。',
  );
  lines.push('- **2 系统配置** → `System_configuration/`。');
  lines.push('- **3 基础应用开发** → `Basic_Application/`（及兼容路由 `03_Basic_Application/`）。');
  lines.push('- **4 算法应用开发** → `Algorithm_Application/`。');
  lines.push(
    '- **5 机器人应用开发** → `Robot_development/`。**TROS 入门请勿使用** `.../Robot_development/quick_start`（无页面）；请用 **环境准备、安装 TROS、TROS 总览** 等子链接（见下节靠前条目）。',
  );
  lines.push('- **6 应用开发指南** → `Application_case/` 等。');
  lines.push('- **7 进阶开发** → `Advanced_development/`、`03_multimedia_development`、`04_toolchain_development`。');
  lines.push('- **8–10** → `FAQ`、`Appendix`、`Release_Note/`。');
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const { id, title } of SECTION_META) {
    const list = byGroup.get(id) || [];
    if (list.length === 0) continue;
    lines.push(`## ${title}`);
    lines.push('');
    if (id === 'Robot_development') {
      lines.push(
        '> **说明**：`https://.../Robot_development/quick_start`（仅目录）与 `.../boxs`、`.../boxs/detection` 在站点上 **404**；下列 **TROS / 机器人 · …** 与 **boxs/具体算法页** 为有效链接。',
      );
      lines.push('');
    }
    for (const p of list) {
      const url = `${ROOT}${p === '/rdk_doc' ? '/rdk_doc/' : p}`;
      const name = displayName(p);
      lines.push(`- **${name}**：${url}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  const body = lines.join('\n').replace(/\n---\n\n$/u, '\n');
  writeFileSync(OUT_FILE, body, 'utf-8');
  console.error('Wrote', OUT_FILE, 'entries', paths.length);
}

main();
