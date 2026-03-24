import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { UserProfile } from "./types.js";

const CONFIG_DIR = path.join(os.homedir(), ".rdkstudio");
const WORKSPACES_DIR = path.join(CONFIG_DIR, "rdkclaw-workspaces");

const CORE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "USER.md",
  "HEARTBEAT.md",
  "MEMORY.md",
] as const;

type CoreFileName = (typeof CORE_FILES)[number];

export interface ResolvedWorkspace {
  profileId: string;
  workspaceDir: string;
  source: "shared-default" | "profile-id" | "custom-root" | "user-default";
  sessionDir: string;
  memoryDir: string;
}

function sanitizeProfileId(raw: string): string {
  const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-");
  const trimmed = normalized.replace(/^-+|-+$/g, "");
  return trimmed || "default";
}

function defaultContentFor(file: CoreFileName, userId?: string): string {
  if (file === "USER.md") {
    const who = userId?.trim() || "unknown-user";
    return `# USER.md\n\n- userId: ${who}\n- 偏好: （待补充）\n- 约束: （待补充）\n`;
  }
  if (file === "SOUL.md") {
    return [
      "# SOUL.md",
      "",
      "你叫小地瓜，是该用户的长期协作助手：有趣但克制，逻辑严密，行动优先。",
      "",
      "## 行为准则",
      "- 先结论，后依据，再给下一步动作。",
      "- 优先最小可验证路径，避免空泛建议。",
      "- 可加入轻量幽默，但每次最多一处，不能影响专业性和安全性。",
      "- 不虚构执行结果；高风险操作先确认。",
      "",
    ].join("\n");
  }
  if (file === "TOOLS.md") {
    return "# TOOLS.md\n\n记录本地可用工具、约束和最佳实践。\n";
  }
  if (file === "HEARTBEAT.md") {
    return "# HEARTBEAT.md\n\n<!-- 为空表示无需主动打扰 -->\n";
  }
  if (file === "MEMORY.md") {
    return "# MEMORY.md - 长期记忆\n\n- 仅保留长期有效结论，不写流水账。\n";
  }
  return "# AGENTS.md\n\n把这个目录当成家。会话开始前先读取 SOUL/USER/memory/MEMORY。\n";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class UserWorkspaceStore {
  private readonly defaultWorkspaceDir: string;
  private readonly defaultBootstrapRoot: string;

  constructor(defaultWorkspaceDir: string) {
    this.defaultWorkspaceDir = path.resolve(defaultWorkspaceDir);
    this.defaultBootstrapRoot = path.join(this.defaultWorkspaceDir, "agent");
  }

  private async resolveTemplate(file: CoreFileName): Promise<string> {
    const candidates = [
      path.join(this.defaultBootstrapRoot, file),
      path.join(this.defaultWorkspaceDir, file),
    ];
    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        return await fs.readFile(candidate, "utf-8");
      }
    }
    return defaultContentFor(file);
  }

  resolve(userId?: string, profile?: UserProfile | null): ResolvedWorkspace {
    const explicitRoot = profile?.workspaceRoot?.trim();
    if (explicitRoot) {
      const workspaceDir = path.resolve(explicitRoot);
      const profileId = sanitizeProfileId(profile?.workspaceProfileId || userId || "custom");
      return {
        profileId,
        workspaceDir,
        source: "custom-root",
        sessionDir: path.join(workspaceDir, ".rdkclaw-runtime", "sessions"),
        memoryDir: path.join(workspaceDir, ".rdkclaw-runtime", "memory"),
      };
    }

    const explicitId = profile?.workspaceProfileId?.trim();
    if (explicitId) {
      const profileId = sanitizeProfileId(explicitId);
      const workspaceDir = path.join(WORKSPACES_DIR, profileId);
      return {
        profileId,
        workspaceDir,
        source: "profile-id",
        sessionDir: path.join(workspaceDir, ".rdkclaw-runtime", "sessions"),
        memoryDir: path.join(workspaceDir, ".rdkclaw-runtime", "memory"),
      };
    }

    if (userId?.trim()) {
      const profileId = sanitizeProfileId(userId);
      const workspaceDir = path.join(WORKSPACES_DIR, profileId);
      return {
        profileId,
        workspaceDir,
        source: "user-default",
        sessionDir: path.join(workspaceDir, ".rdkclaw-runtime", "sessions"),
        memoryDir: path.join(workspaceDir, ".rdkclaw-runtime", "memory"),
      };
    }

    const sharedDir = path.join(WORKSPACES_DIR, "shared");
    return {
      profileId: "shared",
      workspaceDir: sharedDir,
      source: "shared-default",
      sessionDir: path.join(sharedDir, ".rdkclaw-runtime", "sessions"),
      memoryDir: path.join(sharedDir, ".rdkclaw-runtime", "memory"),
    };
  }

  async ensureInitialized(target: ResolvedWorkspace, userId?: string): Promise<void> {
    await fs.mkdir(target.workspaceDir, { recursive: true });
    await fs.mkdir(path.join(target.workspaceDir, "memory"), { recursive: true });
    await fs.mkdir(target.sessionDir, { recursive: true });
    await fs.mkdir(target.memoryDir, { recursive: true });

    for (const file of CORE_FILES) {
      const filePath = path.join(target.workspaceDir, file);
      if (await fileExists(filePath)) {
        continue;
      }
      let content = await this.resolveTemplate(file);
      if (file === "USER.md" && !/userId\s*:/i.test(content)) {
        content = `${content.trimEnd()}\n\n- userId: ${userId?.trim() || "unknown-user"}\n`;
      }
      await fs.writeFile(filePath, content, "utf-8");
    }
  }

  async getOrInit(userId?: string, profile?: UserProfile | null): Promise<ResolvedWorkspace> {
    const resolved = this.resolve(userId, profile);
    await this.ensureInitialized(resolved, userId);
    return resolved;
  }
}
