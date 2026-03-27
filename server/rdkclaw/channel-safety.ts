export type ChannelSource = "studio" | "weixin" | "feishu" | "autonomy";

export interface ChannelSafetyResult {
  blocked: boolean;
  reason?: string;
}

const DANGEROUS_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?.*\/(rdkclaw|openclaw|rdkstudio|\.ssh|\.config|\/etc)/i, reason: "禁止删除关键系统/项目目录" },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+[\/~]/i, reason: "禁止递归删除根目录或用户目录" },
  { pattern: /\bmkfs\b|\bformat\b|\bfdisk\b/i, reason: "禁止格式化磁盘操作" },
  { pattern: /\bdd\s+.*of=\/dev\//i, reason: "禁止直接写入设备" },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: "禁止关机/重启本机" },
  { pattern: /\bchmod\s+777\s+\//i, reason: "禁止修改根目录权限" },
  { pattern: /\bcurl\b.*\|\s*(sh|bash)\b/i, reason: "禁止从网络管道执行脚本" },
  { pattern: /\bwget\b.*\|\s*(sh|bash)\b/i, reason: "禁止从网络管道执行脚本" },
  { pattern: /\bnpm\s+(un)?publish\b/i, reason: "禁止外部通道发布/撤回 npm 包" },
  { pattern: /\bgit\s+push\s+.*--force\b/i, reason: "禁止强制推送" },
];

const PROTECTED_PATH_KEYWORDS = [
  "/rdkclaw", "/openclaw", "/rdkstudio",
  "/node_modules", "/system32", "/windows",
  "/.ssh", "/.gnupg", "/.cursor",
  "/.env", "/credentials", "/apikey",
  "/secret", "/token.json",
];

export function isCommandDangerous(command: string): ChannelSafetyResult {
  for (const { pattern, reason } of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return { blocked: true, reason };
    }
  }
  return { blocked: false };
}

export function isPathProtected(targetPath: string): boolean {
  const lower = targetPath.toLowerCase().replace(/\\/g, "/");
  return PROTECTED_PATH_KEYWORDS.some((kw) => lower.includes(kw));
}

const EXTERNAL_BLOCKED_TOOLS = new Set([
  "sessions_spawn",
]);

const EXTERNAL_ALWAYS_APPROVE_TOOLS = new Set([
  "exec",
  "write",
  "edit",
  "device_exec",
  "device_file_upload",
  "device_restart_service",
  "device_flash",
  "board_openclaw_delegate",
]);

export function getExternalChannelPolicy(toolName: string): "block" | "force_approval" | "allow" {
  if (EXTERNAL_BLOCKED_TOOLS.has(toolName)) return "block";
  if (EXTERNAL_ALWAYS_APPROVE_TOOLS.has(toolName)) return "force_approval";
  if (/write|exec|restart|flash|upload|set_|delete|remove|connect_ssh/i.test(toolName)) return "force_approval";
  return "allow";
}

export function validateExecCommand(command: string, channel: ChannelSource): ChannelSafetyResult {
  if (channel === "studio") return { blocked: false };

  const check = isCommandDangerous(command);
  if (check.blocked) return check;

  const words = command.toLowerCase().split(/\s+/);
  if (words.some((w) => w === "rm" || w === "del" || w === "rmdir")) {
    const hasProtected = PROTECTED_PATH_KEYWORDS.some((kw) =>
      command.toLowerCase().replace(/\\/g, "/").includes(kw),
    );
    if (hasProtected) {
      return { blocked: true, reason: "外部通道禁止删除受保护路径" };
    }
  }

  return { blocked: false };
}

const APPROVAL_KEYWORDS_ALLOW: string[] = [
  "允许", "同意", "好的", "可以", "确认", "批准", "ok", "yes", "approve", "通过",
  "行", "没问题", "继续", "执行吧", "go",
];

const APPROVAL_KEYWORDS_DENY: string[] = [
  "拒绝", "不行", "不要", "取消", "停止", "不", "no", "deny", "reject", "算了",
  "别执行", "不允许", "不同意", "stop", "cancel",
];

export type TextApprovalResult =
  | { matched: true; decision: "allow_once" | "deny" }
  | { matched: false };

export function matchTextApproval(text: string): TextApprovalResult {
  const trimmed = text.trim().toLowerCase();
  if (APPROVAL_KEYWORDS_ALLOW.some((kw) => trimmed === kw || trimmed.startsWith(kw))) {
    return { matched: true, decision: "allow_once" };
  }
  if (APPROVAL_KEYWORDS_DENY.some((kw) => trimmed === kw || trimmed.startsWith(kw))) {
    return { matched: true, decision: "deny" };
  }
  return { matched: false };
}

const DOC_EXT_SET = new Set([
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf",
  "csv", "txt", "md", "zip", "rar", "7z", "tar", "gz",
]);

export function classifyFileKind(filePath: string): "image" | "video" | "document" | null {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const IMG = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp"]);
  const VID = new Set(["mp4", "webm", "avi", "mov", "mkv"]);
  if (IMG.has(ext)) return "image";
  if (VID.has(ext)) return "video";
  if (DOC_EXT_SET.has(ext)) return "document";
  return null;
}
