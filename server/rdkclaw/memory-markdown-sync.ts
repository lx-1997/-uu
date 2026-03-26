import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { MemoryManager } from "../agent/openclaw-index.js";

type SyncResult = {
  imported: number;
  projectionPath: string;
  projectionCount: number;
};

async function safeRead(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function collectMemoryMarkdownFiles(workspaceDir: string): Promise<string[]> {
  const files: string[] = [];
  const topCandidates = ["MEMORY.md", "memory.md"];
  for (const name of topCandidates) {
    const fp = path.join(workspaceDir, name);
    try {
      await fs.access(fp);
      files.push(fp);
    } catch {
      // optional
    }
  }

  const memoryDir = path.join(workspaceDir, "memory");
  try {
    const entries = await fs.readdir(memoryDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith(".md")) continue;
      if (entry.name.toLowerCase().includes("generated")) continue;
      files.push(path.join(memoryDir, entry.name));
    }
  } catch {
    // optional
  }

  return files;
}

export async function syncWorkspaceMarkdownMemory(opts: {
  workspaceDir: string;
  memory: MemoryManager;
  projectionLimit?: number;
}): Promise<SyncResult> {
  const files = await collectMemoryMarkdownFiles(opts.workspaceDir);
  let imported = 0;

  for (const filePath of files) {
    const content = await safeRead(filePath);
    if (!content || !content.trim()) continue;
    await opts.memory.add(content, "memory", filePath);
    imported += 1;
  }

  const allEntries = await opts.memory.getAll();
  const projectionCount = Math.max(1, Math.floor(opts.projectionLimit ?? 40));
  const latest = [...allEntries]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, projectionCount);

  const lines: string[] = [
    "# MEMORY.generated.md",
    "",
    "本文件由系统自动生成（结构化长期记忆投影），请勿手动编辑。",
    "如需新增长期偏好，请编辑 USER.md 或在对话中让 Agent 记住。",
    "",
  ];

  for (const entry of latest) {
    lines.push(`## ${entry.id}`);
    lines.push(`- source: ${entry.source}`);
    if (entry.path) {
      lines.push(`- path: ${entry.path}`);
    }
    lines.push(`- createdAt: ${new Date(entry.createdAt).toISOString()}`);
    lines.push("", entry.content.trim(), "");
  }

  const projectionPath = path.join(opts.workspaceDir, "memory", "MEMORY.generated.md");
  await fs.mkdir(path.dirname(projectionPath), { recursive: true });
  await fs.writeFile(projectionPath, lines.join("\n"), "utf-8");

  return {
    imported,
    projectionPath,
    projectionCount: latest.length,
  };
}
