/**
 * Skill Loader — Parses SKILL.md files and provides them to the system.
 *
 * Responsibilities:
 *   1. Scan skills/ directory for .md files
 *   2. Parse YAML frontmatter + markdown body
 *   3. Extract API descriptions from markdown
 *   4. Build agent system prompt context from loaded skills
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SkillAPI {
  name: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: string;
  response?: string;
  caution?: string;
}

export interface SkillManifest {
  name: string;
  description: string;
  version: string;
  metadata: Record<string, any>;
  body: string;
  apis: SkillAPI[];
  clientActions: string[];
  filePath: string;
}

const SKILLS_DIR = path.join(process.cwd(), 'skills');

function collectSkillFiles(dir: string, isRoot = true): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSkillFiles(full, false));
      continue;
    }
    if (!entry.isFile()) continue;
    if (isRoot && entry.name.endsWith('.md')) {
      out.push(full);
      continue;
    }
    if (!isRoot && entry.name.toUpperCase() === 'SKILL.MD') {
      out.push(full);
    }
  }
  return out;
}

function parseFrontmatter(raw: string): { frontmatter: Record<string, any>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const fm: Record<string, any> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val: any = line.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith('{')) {
      try { val = JSON.parse(val); } catch { /* keep as string */ }
    }
    fm[key] = val;
  }
  return { frontmatter: fm, body: match[2] };
}

function extractAPIs(body: string): SkillAPI[] {
  const apis: SkillAPI[] = [];
  const blocks = body.split(/^### /m).slice(1);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const name = lines[0]?.trim() || '';
    let method: SkillAPI['method'] = 'GET';
    let apiPath = '';
    let bodyDesc: string | undefined;
    let responseDesc: string | undefined;
    let caution: string | undefined;

    let inCodeBlock = false;
    for (const line of lines.slice(1)) {
      if (line.trim() === '```') {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock || line.trim().startsWith('```')) continue;

      const methodMatch = line.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/\S+)/);
      if (methodMatch) {
        method = methodMatch[1] as SkillAPI['method'];
        apiPath = methodMatch[2];
        continue;
      }

      if (line.startsWith('Body:')) {
        bodyDesc = line.slice(5).trim();
      } else if (line.startsWith('Response:')) {
        responseDesc = line.slice(9).trim();
      } else if (line.startsWith('CAUTION:')) {
        caution = line.slice(8).trim();
      }
    }

    if (apiPath) {
      apis.push({ name, method, path: apiPath, body: bodyDesc, response: responseDesc, caution });
    }
  }

  return apis;
}

function extractClientActions(body: string): string[] {
  const actions: string[] = [];
  const actionSection = body.match(/## Client Actions\r?\n([\s\S]*?)(?=\n## |\n---|\n$)/);
  if (!actionSection) return actions;

  for (const line of actionSection[1].split(/\r?\n/)) {
    const match = line.match(/`([^`]+)`/);
    if (match) actions.push(match[1]);
  }
  return actions;
}

export function loadSkill(filePath: string): SkillManifest | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(raw);
    if (!frontmatter.name) return null;

    return {
      name: frontmatter.name,
      description: frontmatter.description || '',
      version: frontmatter.version || '1.0.0',
      metadata: typeof frontmatter.metadata === 'object' ? frontmatter.metadata : {},
      body,
      apis: extractAPIs(body),
      clientActions: extractClientActions(body),
      filePath,
    };
  } catch (err) {
    console.error(`[SkillLoader] failed to load ${filePath}:`, err);
    return null;
  }
}

export function loadAllSkills(): SkillManifest[] {
  const skills: SkillManifest[] = [];
  if (!fs.existsSync(SKILLS_DIR)) {
    console.warn(`[SkillLoader] skills directory not found: ${SKILLS_DIR}`);
    return skills;
  }

  for (const filePath of collectSkillFiles(SKILLS_DIR, true)) {
    const skill = loadSkill(filePath);
    if (skill) skills.push(skill);
  }

  console.log(`[SkillLoader] loaded ${skills.length} skills`);
  return skills;
}

export function getSkillByName(skills: SkillManifest[], name: string): SkillManifest | undefined {
  return skills.find(s => s.name === name);
}

export function getRawSkillMd(name: string): string | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  const files = collectSkillFiles(SKILLS_DIR, true);
  for (const filePath of files) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { frontmatter } = parseFrontmatter(raw);
      const fmName = String(frontmatter.name || '').trim().toLowerCase();
      const baseName = path.basename(filePath, path.extname(filePath)).toLowerCase();
      const dirName = path.basename(path.dirname(filePath)).toLowerCase();
      if (fmName === normalized || baseName === normalized || dirName === normalized) {
        return raw;
      }
    } catch {
      // ignore file read parse errors
    }
  }
  return null;
}

/**
 * Convert an EcoSkill from the ecosystem registry into a SkillManifest.
 * This bridges ecosystem packages into the unified skill system.
 */
export function bridgeEcoSkill(eco: {
  id: string;
  name: string;
  description: string;
  source: string;
  category: string;
  tags: string[];
  platforms: string[];
  installCmd?: string;
  runCmd?: string;
  stopCmd?: string;
  routingKeywords: string[];
}): SkillManifest {
  const apis: SkillAPI[] = [];
  const safeId = eco.id.replace(/\./g, '-');

  apis.push({
    name: '安装',
    method: 'POST',
    path: `/api/ecosystem/skills/${eco.id}/install`,
    body: '{ deviceId: string }',
  });
  if (eco.runCmd) {
    apis.push({
      name: '运行',
      method: 'POST',
      path: `/api/ecosystem/skills/${eco.id}/run`,
      body: '{ deviceId: string }',
    });
  }
  if (eco.stopCmd) {
    apis.push({
      name: '停止',
      method: 'POST',
      path: `/api/ecosystem/skills/${eco.id}/stop`,
      body: '{ deviceId: string }',
    });
  }

  return {
    name: `eco-${safeId}`,
    description: `[${eco.source}] ${eco.description} Tags: ${eco.tags.join(', ')}.`,
    version: '1.0.0',
    metadata: {
      rdkstudio: {
        category: eco.category,
        source: eco.source,
        originalId: eco.id,
        platforms: eco.platforms,
      },
    },
    body: '',
    apis,
    clientActions: [],
    filePath: `ecosystem:${eco.id}`,
  };
}

/**
 * Build system prompt from loaded skills + personality.
 * Merges the tuned "RDK Studio Claw" personality with skill-based routing.
 */
export function buildSkillContext(
  skills: SkillManifest[],
  deviceName?: string,
  deviceIp?: string,
): string {
  const builtinSkills = skills.filter(s => !s.name.startsWith('eco-'));

  const skillSummary = builtinSkills.map(s => {
    const apis = s.apis.map(a => {
      const caution = a.caution ? ' (⚠️需确认)' : '';
      return `  - ${a.method} ${a.path} — ${a.name}${caution}`;
    }).join('\n');
    return `### ${s.name}\n${s.description.split('.')[0]}.\n${apis}`;
  }).join('\n\n');

  return `你是「RDK Studio Claw」，RDK Studio 的 AI 助手。你是软件端 Agent，通过调用技能来帮助用户操作 RDK 开发板。板端 OpenClaw 只是一个可调用技能，不是你的主体身份。

身份：经验丰富的嵌入式 AI 工程师朋友，精通 RDK X3/X5、BPU、ROS2 开发。说话自然简洁。

当前设备：${deviceName ?? '未知'} (${deviceIp ?? '未知'})

## 可用技能

${skillSummary}

## 标签格式（每条回复末尾最多包含一个）

执行命令:
[[skill:rdk-terminal/exec|{"command":"完整shell命令"}]]

导航页面:
[[action:navigate|tab名]]

需确认的危险操作:
[[confirm:rdk-flash/execute|{"imageUrl":"..."}]]

旧格式（仍支持）:
[[intent:terminal_cmd|命令]]
[[intent:hardware_check]]

## 关键规则

1. 中文回复，2-6句，不超过150字。不要markdown格式
2. 用户要执行命令时，必须生成完整的 shell 命令放入标签，不要省略
3. 多步骤任务：用 && 串联命令，或用 heredoc 写文件
4. 每条回复只附一个标签，放末尾
5. 说"帮你执行""这就来"等自然语气，不要机械

## 示例

用户: "帮我查一下板子温度"
→ 没问题，帮你读取芯片温度和 BPU 负载。X5 正常工作 45-75°C。[[skill:rdk-hardware/diagnose]]

用户: "执行一下 ls /userdata"
→ 好的，帮你看看 userdata 目录。[[skill:rdk-terminal/exec|{"command":"ls -la /userdata"}]]

用户: "帮我创建一个文件夹test然后写个hello world"
→ 这就帮你创建并运行。[[skill:rdk-terminal/exec|{"command":"mkdir -p ~/test && cat > ~/test/hello.py << 'EOF'\\nprint('Hello World!')\\nEOF\\npython3 ~/test/hello.py"}]]

用户: "帮我看看有哪些ROS话题"
→ 开始扫描 ROS2 话题。[[skill:rdk-ros/topics]]

用户: "打开终端"
→ 这就帮你打开终端。[[action:navigate|terminal]]

用户: "帮我连远程桌面"
→ 好的，正在连接 VNC。[[action:navigate|vnc]]

用户: "烧录 Ubuntu 22.04"
→ 准备烧录，确认后开始。[[confirm:rdk-flash/execute|{"imageUrl":"ubuntu22.04"}]]

用户: "你好"
→ 你好！我是 RDK Studio Claw，你的 RDK 开发助手。有什么可以帮你的？

用户: "BPU是什么"
→ RDK X5 用的是贝叶斯架构 BPU，专为边缘 AI 优化，INT8 下 10 TOPS。ONNX 模型通过 hb_mapper 转换后高效执行。`;
}
