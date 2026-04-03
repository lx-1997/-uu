/**
 * studio_open_local_preview：在桌面端用系统默认应用打开工作区内的图片（不走 http）。
 * 路径必须在 ToolContext.workspaceDir / bootstrapDir / extraAllowedRoots 之下，经 realpath 校验防逃逸。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { Tool, ToolContext } from "./agent/tools/types.js";
import { isFileUnderLocalFilesServeRoots } from "./local-files-roots.js";

/** 与主进程 IPC 白名单对齐 */
export const STUDIO_LOCAL_PREVIEW_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
  ".avif",
]);

function collectAllowedRoots(ctx: ToolContext): string[] {
  const seen = new Set<string>();
  const add = (p: string | undefined) => {
    if (!p?.trim()) return;
    const abs = path.resolve(p.trim());
    seen.add(abs);
  };
  add(ctx.workspaceDir);
  add(ctx.bootstrapDir);
  for (const r of ctx.extraAllowedRoots ?? []) add(r);
  return [...seen];
}

function isPathInsideRoot(fileReal: string, rootReal: string): boolean {
  if (fileReal === rootReal) return true;
  const rel = path.relative(rootReal, fileReal);
  if (!rel || rel.startsWith("..")) return false;
  return !path.isAbsolute(rel);
}

/**
 * 解析并校验路径；返回规范化后的绝对路径（realpath）。
 * @throws Error 越界、非文件、扩展名不允许、不存在等
 */
export async function resolveStudioLocalPreviewPath(rawPath: string, ctx: ToolContext): Promise<string> {
  const raw = String(rawPath || "").trim();
  if (!raw) throw new Error("path 不能为空");
  if (raw.length > 4096) throw new Error("path 过长");
  if (raw.includes("\0")) throw new Error("path 含非法字符");

  const workspaceDir = path.resolve(String(ctx.workspaceDir || "").trim() || ".");
  const absoluteInput = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(workspaceDir, raw);

  let real: string;
  try {
    real = await fs.promises.realpath(absoluteInput);
  } catch {
    throw new Error("文件不存在或无法解析路径（请确认已保存且路径相对工作区正确）");
  }

  const stat = await fs.promises.stat(real);
  if (!stat.isFile()) throw new Error("路径不是常规文件");

  const ext = path.extname(real).toLowerCase();
  if (!STUDIO_LOCAL_PREVIEW_EXTENSIONS.has(ext)) {
    throw new Error(
      `不支持的预览类型 ${ext || "（无扩展名）"}；允许: ${[...STUDIO_LOCAL_PREVIEW_EXTENSIONS].sort().join(", ")}`,
    );
  }

  const roots = collectAllowedRoots(ctx);
  let allowed = false;
  for (const root of roots) {
    let rootReal: string;
    try {
      rootReal = await fs.promises.realpath(root);
    } catch {
      continue;
    }
    if (isPathInsideRoot(real, rootReal)) {
      allowed = true;
      break;
    }
  }
  if (!allowed) {
    throw new Error("路径不在当前会话允许的工作区根目录内（workspaceDir / bootstrap / extraAllowedRoots）");
  }

  return real;
}

export function buildStudioOpenLocalPreviewTool(emit: (absPath: string) => void): Tool<{ path: string }> {
  return {
    name: "studio_open_local_preview",
    description:
      "【仅 RDK Studio 桌面端有效】用**系统默认应用**打开**当前会话工作区内已存在的图片**，同时若文件落在 **`~/.rdkstudio/agent-downloads`**、项目 `downloads/` 或 `workspace/downloads/` 下，**聊天气泡内会自动出现预览**（无需对用户说「对话框不能显示图」）。传入相对路径或允许根下的绝对路径；**禁止**打开 http(s)（用 `studio_open_url`）。允许扩展名：" +
      [...STUDIO_LOCAL_PREVIEW_EXTENSIONS].sort().join(", ") +
      "。若用户要「在对话里直接看到图」，请先把图存到上述目录（默认 Agent 下载为 `~/.rdkstudio/agent-downloads`）再调用本工具；也可用 Markdown `![说明](/api/local-files/文件名)` 辅助展示。",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "工作区内图片路径（相对 workspace 根，或已在允许根下的绝对路径）",
        },
      },
      required: ["path"],
    },
    async execute(input, ctx) {
      try {
        const abs = await resolveStudioLocalPreviewPath(String(input.path || ""), ctx);
        emit(abs);
        const base = path.basename(abs);
        const servable = isFileUnderLocalFilesServeRoots(abs);
        const payload: Record<string, unknown> = {
          __type: "studio_local_preview",
          ok: true,
          path: abs,
          fileName: base,
          message: servable
            ? `已请求系统看图打开 ${abs}；对话内将显示同一图片预览。`
            : `已请求系统看图打开 ${abs}。若还需聊天气泡内嵌预览，请将图片保存到 ~/.rdkstudio/agent-downloads/ 或项目 downloads/、workspace/downloads/ 后再调用本工具或回复中附 ![desc](/api/local-files/${encodeURIComponent(base)})（basename 须一致）。`,
        };
        if (servable) {
          payload.imageUrl = `/api/local-files/${encodeURIComponent(base)}`;
        }
        return JSON.stringify(payload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return `studio_open_local_preview 失败：${msg}`;
      }
    },
  };
}
