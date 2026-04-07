/**
 * 从 rdk-doc-url-index.md 加载 developer.d-robotics.cc/rdk_doc 章节 URL，避免在 TS 中硬编码。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
/**
 * 编译后 dist-server/server/rdkclaw/ 下可能缺失 .md 资源。
 * 优先找编译输出旁的副本；若不存在则回退到源码 server/rdkclaw/。
 */
const INDEX_FILE = (() => {
  const primary = join(MODULE_DIR, 'rdk-doc-url-index.md');
  if (existsSync(primary)) return primary;
  const fallback = resolve(MODULE_DIR, '..', '..', '..', 'server', 'rdkclaw', 'rdk-doc-url-index.md');
  if (existsSync(fallback)) return fallback;
  return primary; // 让后续 readFileSync 抛出明确错误
})();

export type RdkDocUrlEntry = {
  /** 最近一条 ## 标题 */
  sectionTitle: string;
  /** - **名称** 中的名称 */
  name: string;
  url: string;
};

export type RdkDocUrlIndex = {
  root: string;
  rdkSRoot?: string;
  entries: RdkDocUrlEntry[];
};

let cached: RdkDocUrlIndex | null = null;

function parseRdkDocUrlIndexMarkdown(content: string): RdkDocUrlIndex {
  const lines = content.split(/\r?\n/);
  let root = 'https://developer.d-robotics.cc/rdk_doc/';
  let rdkSRoot: string | undefined;
  const entries: RdkDocUrlEntry[] = [];
  let sectionTitle = '';

  for (const line of lines) {
    if (line.includes('S100 独立文档') && line.includes('http')) {
      const m = line.match(/(https:\/\/developer\.d-robotics\.cc\/rdk_doc\/rdk_s\/?)/);
      if (m) rdkSRoot = m[1];
    }
    if (line.includes('根地址') && line.includes('http')) {
      const m = line.match(/(https:\/\/developer\.d-robotics\.cc\/rdk_doc\/)/);
      if (m) root = m[1];
    }
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      sectionTitle = h2[1].trim();
      continue;
    }
    /** `- **名**：https://...` 或 `- **名**：[文字](https://...)`（后者须兼容） */
    const plain = line.match(/^\s*-\s*\*\*(.+?)\*\*\s*[：:]\s*(https?:\/\/\S+)/u);
    const mdLink = line.match(
      /^\s*-\s*\*\*(.+?)\*\*\s*[：:]\s*\[([^\]]+)\]\((https?:\/\/[^)]+)\)/u,
    );
    if (sectionTitle && (plain || mdLink)) {
      const name = (plain ?? mdLink)![1].trim();
      let url = (plain ? plain[2] : mdLink![3]).trim();
      url = url.replace(/[`）\]]+$/u, '').trim();
      entries.push({ sectionTitle, name, url });
    }
  }

  return { root, rdkSRoot, entries };
}

export function loadRdkDocUrlIndex(): RdkDocUrlIndex {
  if (cached) return cached;
  const raw = readFileSync(INDEX_FILE, 'utf-8');
  cached = parseRdkDocUrlIndexMarkdown(raw);
  return cached;
}

/** 单测或热重载时可清空缓存（一般不需要） */
export function resetRdkDocUrlIndexCacheForTests(): void {
  cached = null;
}

/** 注入 system 动态段：紧凑列出 detection 与根地址，避免整表塞满 token */
export function buildRdkDocHintForSystemPrompt(): string {
  const idx = loadRdkDocUrlIndex();
  const normalizeDetectionName = (entry: RdkDocUrlEntry): string => {
    if (entry.url.endsWith('/detection/fcos')) return 'FCOS';
    if (entry.url.endsWith('/detection/yolo')) return 'YOLO';
    if (entry.url.endsWith('/detection/hobot_yolo_world')) return 'YOLO-World';
    return entry.name;
  };
  const detection = idx.entries.filter(
    (e) =>
      e.url.includes('/Robot_development/boxs/detection/') &&
      (e.url.endsWith('/yolo') ||
        e.url.endsWith('/fcos') ||
        e.url.endsWith('/hobot_yolo_world')) &&
      !e.url.includes('/en/') &&
      !e.url.includes('/rdk_s/'),
  );
  const segmentation = idx.entries.filter(
    (e) =>
      e.url.includes('/Robot_development/boxs/segmentation/') &&
      !e.url.includes('/en/') &&
      !e.url.includes('/rdk_s/'),
  );
  const lines: string[] = [`**rdk_doc 根地址**：\`${idx.root}\``];
  if (idx.rdkSRoot) {
    lines.push(`**S100 独立文档区**：\`${idx.rdkSRoot}\``);
  }
  lines.push(
    '**易错**：YOLO-World 官方文档路径为 **`.../detection/hobot_yolo_world`**（与包名 `hobot_yolo_world` 一致）；**不要**拼成 `.../yolo_world`（会 404）。',
  );
  lines.push(
    '**目标检测（detection，未贴 URL 时按任务选一条先 web_fetch）**：',
    ...detection.map((e) => `- **${normalizeDetectionName(e)}**：\`${e.url}\``),
  );
  lines.push(
    '**图像分割（segmentation，用户说「分割一切」等时优先 MobileSAM / EdgeSAM）**：',
    ...segmentation.map((e) => `- **${e.name}**：\`${e.url}\``),
  );
  lines.push(
    '**其余分类**（跟踪/SLAM/Quick_start/Model_deploy 等）：以维护索引 `rdk-doc-url-index.md` 中的 `##` 章节为准，用 `web_fetch` 拉取对应 URL。',
  );
  return lines.join('\n');
}
