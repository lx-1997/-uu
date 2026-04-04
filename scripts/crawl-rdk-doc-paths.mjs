/**
 * BFS 抓取 developer.d-robotics.cc 侧栏中的 /rdk_doc/ 链接，输出到 stdout。
 * 用法：node scripts/crawl-rdk-doc-paths.mjs > server/rdkclaw/_crawl-paths.txt
 * 然后：node scripts/build-rdk-doc-url-index.mjs
 */
const base = 'https://developer.d-robotics.cc';
const seeds = [
  '/rdk_doc/',
  '/rdk_doc/Quick_start',
  '/rdk_doc/System_configuration',
  '/rdk_doc/Basic_Application',
  '/rdk_doc/Basic_Development',
  '/rdk_doc/Robot_development',
  '/rdk_doc/Application_case',
  '/rdk_doc/Advanced_development',
  '/rdk_doc/FAQ',
  '/rdk_doc/Appendix',
  '/rdk_doc/Model_deploy',
  '/rdk_doc/Python_development',
  '/rdk_doc/Cpp_development',
  '/rdk_doc/Release_Note/release_note',
  '/rdk_doc/RDK_Studio',
  '/rdk_doc/RDK',
  '/rdk_doc/rdk_s/Quick_start',
  '/rdk_doc/rdk_s/System_configuration',
  '/rdk_doc/rdk_s/Robot_development',
  '/rdk_doc/rdk_s/Basic_Application',
  '/rdk_doc/rdk_s/Basic_Development',
  '/rdk_doc/rdk_s/Application_case',
  '/rdk_doc/Robot_development/boxs',
  '/rdk_doc/Robot_development/boxs/detection',
  '/rdk_doc/Robot_development/boxs/detection/yolo',
  '/rdk_doc/Robot_development/boxs/detection/fcos',
  '/rdk_doc/Algorithm_Application/model_zoo/model_zoo_intro',
  '/rdk_doc/en/Quick_start',
  '/rdk_doc/display_use',
  '/rdk_doc/install_os',
  '/rdk_doc/hardware_introduction',
  '/rdk_doc/linux_development',
  '/rdk_doc/hardware_development',
  '/rdk_doc/03_multimedia_development',
  '/rdk_doc/04_toolchain_development',
];

const seen = new Set();
const queue = [...seeds];
const re = /href="(\/rdk_doc\/[^"#]+)"/g;
let fetched = 0;
const maxFetch = 500;

while (queue.length && fetched < maxFetch) {
  const path = queue.shift();
  if (seen.has(path)) continue;
  seen.add(path);
  const url = base + path.replace(/\/+$/, '');
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(25000) });
    const html = await r.text();
    fetched++;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(html)) !== null) {
      const p = m[1].replace(/\/+$/, '');
      if (p.includes('/assets/') || p.includes('/js/') || p.includes('/img/')) continue;
      if (!seen.has(p)) queue.push(p);
    }
  } catch (e) {
    console.error('fail', url, e.message);
  }
}

const sorted = [...seen].filter((p) => !p.includes('/assets/')).sort();
console.log('count', sorted.length, 'fetchedPages', fetched);
for (const p of sorted) console.log(p);
