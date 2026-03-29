import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const ONE_SHOT_PROMPT_MAX_CHARS = 600;
export const ONE_SHOT_MAX_FILES = 24;
export const ONE_SHOT_MAX_FILE_CHARS = 120_000;
export const ONE_SHOT_MAX_TOTAL_CHARS = 400_000;
export const ONE_SHOT_DEPLOY_MAX_FILES = 80;
export const ONE_SHOT_DEPLOY_MAX_BYTES = 2 * 1024 * 1024;

export type OneShotGeneratedFile = {
  path: string;
  content: string;
};

export type OneShotAppPlan = {
  appName: string;
  summary: string;
  files: OneShotGeneratedFile[];
  runCommand: string;
  testCommand?: string;
};

export type OneShotValidationResult = {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
};

export type OneShotFixSuggestion = {
  title: string;
  detail: string;
  command?: string;
};

export function slugifyName(input: string) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'rdk-app';
}

export function safeRelativeFilePath(input: string) {
  const normalized = String(input || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();
  if (!normalized || normalized.includes('..')) return '';
  if (normalized.includes('\0')) return '';
  if (/^[a-zA-Z]:/.test(normalized)) return '';
  if (normalized.startsWith('.')) return '';
  return normalized;
}

export function resolveGeneratedAppsRootDir() {
  return path.join(process.cwd(), 'workspace', 'generated-apps');
}

export function isSubPath(child: string, parent: string) {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  return resolvedChild === resolvedParent || resolvedChild.startsWith(`${resolvedParent}${path.sep}`);
}

export function runProcess(command: string, args: string[], cwd: string, timeoutMs = 15_000) {
  return new Promise<{ ok: boolean; output: string; timedOut: boolean; exitCode: number | null }>((resolve) => {
    let settled = false;
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ ok: false, output: `timeout after ${timeoutMs}ms`, timedOut: true, exitCode: null });
    }, timeoutMs);

    const OUTPUT_LIMIT = 512_000;
    child.stdout.on('data', (chunk) => { if (output.length < OUTPUT_LIMIT) output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { if (output.length < OUTPUT_LIMIT) output += chunk.toString(); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, output: error.message, timedOut: false, exitCode: null });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, output: output.trim(), timedOut: false, exitCode: code });
    });
  });
}

export async function validateOneShotApp(appDir: string): Promise<OneShotValidationResult> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const requiredFiles = ['README.md', 'main.py', 'requirements.txt'];

  for (const file of requiredFiles) {
    const target = path.join(appDir, file);
    try {
      await fs.access(target);
      checks.push({ name: `exists:${file}`, ok: true, detail: 'ok' });
    } catch {
      checks.push({ name: `exists:${file}`, ok: false, detail: 'missing' });
    }
  }

  const hasMain = checks.find((c) => c.name === 'exists:main.py')?.ok;
  if (hasMain) {
    const candidates: Array<{ cmd: string; args: string[] }> = [
      { cmd: 'python', args: ['-m', 'py_compile', 'main.py'] },
      { cmd: 'python3', args: ['-m', 'py_compile', 'main.py'] },
      { cmd: 'py', args: ['-3', '-m', 'py_compile', 'main.py'] },
    ];
    let syntaxChecked = false;
    for (const candidate of candidates) {
      const result = await runProcess(candidate.cmd, candidate.args, appDir, 20_000);
      if (result.ok) {
        checks.push({ name: 'python:syntax', ok: true, detail: `${candidate.cmd} ok` });
        syntaxChecked = true;
        break;
      }
      if (!/not found|enoent/i.test(result.output)) {
        checks.push({ name: 'python:syntax', ok: false, detail: result.output || `${candidate.cmd} failed` });
        syntaxChecked = true;
        break;
      }
    }
    if (!syntaxChecked) {
      checks.push({ name: 'python:syntax', ok: false, detail: 'python runtime not found' });
    }
  }

  const ok = checks.every((item) => item.ok);
  return { ok, checks };
}

export async function collectOneShotFiles(appDir: string) {
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  let totalBytes = 0;

  const walk = async (currentDir: string) => {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(currentDir, entry.name);
      const rel = path.relative(appDir, abs).replace(/\\/g, '/');
      if (!rel || rel.startsWith('..')) continue;
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= ONE_SHOT_DEPLOY_MAX_FILES) {
        throw new Error(`文件数量超限（最多 ${ONE_SHOT_DEPLOY_MAX_FILES} 个）`);
      }
      const content = await fs.readFile(abs);
      totalBytes += content.length;
      if (totalBytes > ONE_SHOT_DEPLOY_MAX_BYTES) {
        throw new Error(`文件体积超限（最多 ${Math.floor(ONE_SHOT_DEPLOY_MAX_BYTES / 1024)}KB）`);
      }
      files.push({ relativePath: rel, content });
    }
  };

  await walk(appDir);
  return { files, totalBytes };
}

export function normalizeOneShotRunCommand(raw: unknown): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.length > 200) return '';
  if (/[\r\n]/.test(value)) return '';
  if (!/^(python|python3|py)\b/i.test(value)) return '';
  if (/[`;&|<>]/.test(value)) return '';
  return value;
}

export async function runOneShotAppSmoke(appDir: string, runCommandRaw?: string) {
  const requestedCommand = normalizeOneShotRunCommand(runCommandRaw);
  if (requestedCommand) {
    const shellRunner = process.platform === 'win32'
      ? { cmd: 'cmd', args: ['/d', '/s', '/c', requestedCommand] }
      : { cmd: 'bash', args: ['-lc', requestedCommand] };
    const customResult = await runProcess(shellRunner.cmd, shellRunner.args, appDir, 20_000);
    if (customResult.ok) {
      return { ok: true, runner: requestedCommand, output: customResult.output, timedOut: false };
    }
    if (customResult.timedOut) {
      return {
        ok: true,
        runner: requestedCommand,
        output: customResult.output || '运行超时，可能是常驻服务应用',
        timedOut: true,
      };
    }
    if (!/not found|enoent/i.test(customResult.output)) {
      return { ok: false, runner: requestedCommand, output: customResult.output, timedOut: false };
    }
  }

  const candidates: Array<{ cmd: string; args: string[] }> = [
    { cmd: 'python', args: ['main.py'] },
    { cmd: 'python3', args: ['main.py'] },
    { cmd: 'py', args: ['-3', 'main.py'] },
  ];
  let last = '';
  for (const candidate of candidates) {
    const result = await runProcess(candidate.cmd, candidate.args, appDir, 20_000);
    if (result.ok) {
      return {
        ok: true,
        runner: `${candidate.cmd} ${candidate.args.join(' ')}`,
        output: result.output,
        timedOut: false,
      };
    }
    if (result.timedOut) {
      return {
        ok: true,
        runner: `${candidate.cmd} ${candidate.args.join(' ')}`,
        output: result.output || '运行超时，可能是常驻服务应用',
        timedOut: true,
      };
    }
    if (!/not found|enoent/i.test(result.output)) {
      last = result.output;
      break;
    }
    last = result.output;
  }

  return {
    ok: false,
    runner: requestedCommand || 'python main.py',
    output: last || '未找到可用的 Python 运行时',
    timedOut: false,
  };
}

export function suggestFixesFromRunOutput(output: string): OneShotFixSuggestion[] {
  const text = String(output || '').toLowerCase();
  const suggestions: OneShotFixSuggestion[] = [];
  if (text.includes('no module named')) {
    suggestions.push({
      title: '安装依赖',
      detail: '检测到依赖缺失，建议先安装 requirements.txt',
      command: 'pip install -r requirements.txt',
    });
  }
  if (text.includes('permission denied')) {
    suggestions.push({
      title: '修复权限',
      detail: '检测到权限不足，建议修复目标目录权限',
      command: 'chmod -R u+rwX .',
    });
  }
  if (text.includes('syntaxerror')) {
    suggestions.push({
      title: '语法检查',
      detail: '检测到语法错误，建议先做语法检查定位问题',
      command: 'python -m py_compile main.py',
    });
  }
  if (text.includes('python runtime not found') || text.includes('python: not found') || text.includes('python3: not found')) {
    suggestions.push({
      title: '安装 Python',
      detail: '设备缺少 Python 运行时，请先安装 python3',
      command: 'apt-get update && apt-get install -y python3',
    });
  }
  if (suggestions.length === 0) {
    suggestions.push({
      title: '排查入口',
      detail: '建议先查看完整运行日志，再检查 requirements.txt 与 main.py 入口是否匹配',
      command: 'python main.py',
    });
  }
  return suggestions.slice(0, 3);
}

export function fallbackOneShotPlan(prompt: string): OneShotAppPlan {
  const appName = `rdk-${slugifyName(prompt.split(/\s+/).slice(0, 4).join('-') || 'app')}`;
  const summary = `由一句话需求生成的最小可运行 RDK 应用骨架：${prompt}`;
  return {
    appName,
    summary,
    runCommand: 'python main.py',
    testCommand: 'python -m py_compile main.py',
    files: [
      {
        path: 'README.md',
        content: `# ${appName}

${summary}

## 快速开始

\`\`\`bash
python main.py
\`\`\`

## 下一步建议

- 将设备指令封装到 \`app/rdk_client.py\`
- 把业务流程补充到 \`app/pipeline.py\`
- 根据场景添加依赖到 \`requirements.txt\`
`,
      },
      {
        path: 'requirements.txt',
        content: 'requests>=2.31.0\n',
      },
      {
        path: 'main.py',
        content: `from app.pipeline import run

def main():
    result = run()
    print(result)

if __name__ == "__main__":
    main()
`,
      },
      {
        path: 'app/pipeline.py',
        content: `def run():
    # TODO: 按需求补充设备调用与业务逻辑
    return "RDK app bootstrap is ready."
`,
      },
      {
        path: 'app/rdk_client.py',
        content: `class RdkClient:
    def __init__(self, host: str = "127.0.0.1", port: int = 22):
        self.host = host
        self.port = port

    def ping(self) -> bool:
        # TODO: 替换为真实设备连接检测
        return True
`,
      },
    ],
  };
}

export function tryParseJsonObject(raw: string) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export type OneShotLlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export async function generateOneShotPlan(
  prompt: string,
  llm: OneShotLlmConfig,
): Promise<{ plan: OneShotAppPlan; usedFallback: boolean }> {
  const fallback = fallbackOneShotPlan(prompt);
  if (!llm.apiKey) return { plan: fallback, usedFallback: true };

  const plannerPrompt = `你是 RDK 应用脚手架生成器。用户会给你一句话需求。

请只返回严格 JSON（不要 markdown，不要注释，不要代码块）：
{
  "appName": "仅小写字母数字和中划线",
  "summary": "一句话说明",
  "runCommand": "运行命令",
  "testCommand": "可选测试命令",
  "files": [
    { "path": "相对路径", "content": "文件内容字符串" }
  ]
}

要求：
1) files 至少包含：README.md, main.py, requirements.txt
2) 不得出现绝对路径，不得出现 .. 路径跳转
3) 输出应为可直接保存的源码内容
4) 以 Python 项目为默认栈，适配 RDK 设备应用开发`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const upstreamResponse = await fetch(`${llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${llm.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: llm.model,
        messages: [
          { role: 'system', content: plannerPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 1800,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const payload = (await upstreamResponse.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = payload.choices?.[0]?.message?.content ?? '';
    const parsed = tryParseJsonObject(text);
    if (!parsed) return { plan: fallback, usedFallback: true };

    const appName = slugifyName(String(parsed.appName || fallback.appName));
    const summary = String(parsed.summary || fallback.summary);
    const runCommand = normalizeOneShotRunCommand(parsed.runCommand) || fallback.runCommand;
    const testCommand = String(parsed.testCommand || fallback.testCommand || '');
    const rawFiles = Array.isArray(parsed.files) ? parsed.files.slice(0, ONE_SHOT_MAX_FILES) : [];
    const files: OneShotGeneratedFile[] = rawFiles
      .map((item) => {
        const obj = (item ?? {}) as Record<string, unknown>;
        const p = safeRelativeFilePath(String(obj.path || ''));
        const c = String(obj.content || '').slice(0, ONE_SHOT_MAX_FILE_CHARS);
        return { path: p, content: c };
      })
      .filter((f) => Boolean(f.path));

    const totalChars = files.reduce((sum, f) => sum + f.content.length, 0);
    if (totalChars > ONE_SHOT_MAX_TOTAL_CHARS) {
      return { plan: fallback, usedFallback: true };
    }

    const hasReadme = files.some((f) => f.path === 'README.md');
    const hasMain = files.some((f) => f.path === 'main.py');
    const hasReq = files.some((f) => f.path === 'requirements.txt');
    if (!hasReadme || !hasMain || !hasReq || files.length < 3) {
      return { plan: fallback, usedFallback: true };
    }

    return {
      plan: {
        appName,
        summary,
        runCommand,
        ...(testCommand ? { testCommand } : {}),
        files,
      },
      usedFallback: false,
    };
  } catch {
    return { plan: fallback, usedFallback: true };
  }
}
