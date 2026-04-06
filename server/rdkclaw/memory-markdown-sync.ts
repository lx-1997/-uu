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
    "长期记忆真源为 memory_search / memory_save 对应的结构化索引；MEMORY.md 仅作为人工摘要输入。",
    "daily memory 保留会话轨迹，不再作为长期检索真源反复回灌。",
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
