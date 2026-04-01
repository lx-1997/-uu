export type ChannelSource = "studio" | "weixin" | "feishu" | "autonomy";

export interface ChannelSafetyResult {
  blocked: boolean;
  reason?: string;
}

/**
 * 危险命令检测规则。
 *
 * 设计思路：
 * - 管道执行脚本：不仅检测 `curl|sh`，还覆盖绝对路径 `/bin/sh`、
 *   `env bash`、命令替换 `$(curl ...)`、进程替换 `<(curl ...)` 等绕过手法。
 * - rm 递归删除：同时匹配 `-rf` 和 `-fr` 等选项组合。
 * - 每条规则附带用户可读的中文原因，前端可直接展示给用户。
 */
const DANGEROUS_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?.*\/(rdkclaw|openclaw|rdkstudio|\.ssh|\.config|\/etc)/i, reason: "禁止删除关键系统/项目目录" },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+[\/~]/i, reason: "禁止递归删除根目录或用户目录" },
  { pattern: /\bmkfs\b|\bformat\b|\bfdisk\b/i, reason: "禁止格式化磁盘操作" },
  { pattern: /\bdd\s+.*of=\/dev\//i, reason: "禁止直接写入设备" },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: "禁止关机/重启本机" },
  { pattern: /\bchmod\s+777\s+\//i, reason: "禁止修改根目录权限" },
  // 管道执行脚本 — 覆盖 sh/bash/zsh 的裸名和绝对路径，以及 env 前缀
  { pattern: /\b(curl|wget)\b.*\|\s*(env\s+)?(\/\w+\/)*\w*(sh|bash|zsh|dash)\b/i, reason: "禁止从网络管道执行脚本" },
  // 命令替换执行网络脚本: $(curl ...) 或 `curl ...`
  { pattern: /\$\(\s*(curl|wget)\b/i, reason: "禁止通过命令替换执行网络脚本" },
  { pattern: /`\s*(curl|wget)\b/i, reason: "禁止通过反引号执行网络脚本" },
  // 进程替换: bash <(curl ...)
  { pattern: /\b(sh|bash|zsh|dash)\s+<\(\s*(curl|wget)\b/i, reason: "禁止通过进程替换执行网络脚本" },
  // source / eval 执行网络内容
  { pattern: /\b(source|eval)\b.*\b(curl|wget)\b/i, reason: "禁止 source/eval 执行网络内容" },
  { pattern: /\bnpm\s+(un)?publish\b/i, reason: "禁止外部通道发布/撤回 npm 包" },
  { pattern: /\bgit\s+push\s+.*--force\b/i, reason: "禁止强制推送" },
  // python/perl/ruby 执行网络脚本
  { pattern: /\b(curl|wget)\b.*\|\s*(python|python3|perl|ruby|node)\b/i, reason: "禁止从网络管道执行脚本" },
];

const PROTECTED_PATH_KEYWORDS = [
  "/rdkclaw", "/openclaw", "/rdkstudio",
  "/node_modules", "/system32", "/windows",
  "/.ssh", "/.gnupg", "/.cursor",
  "/.env", "/credentials", "/apikey",
  "/secret", "/token.json",
];

/**
 * Shell 危险扫描只应看「由 shell 解析」的部分，不应扫描 heredoc 正文。
 * 否则源码/注释里的 shutdown、reboot、curl 等会误触发（如 ROS 示例里的 rclpy.shutdown）。
 */
export function stripShellPrefixBeforeHeredoc(command: string): string {
  const idx = command.indexOf("<<");
  if (idx === -1) return command;
  return command.slice(0, idx);
}

export function isCommandDangerous(command: string): ChannelSafetyResult {
  const shellOnly = stripShellPrefixBeforeHeredoc(command);
  for (const { pattern, reason } of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(shellOnly)) {
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

/**
 * 历史上外部通道（微信/飞书）对大量工具强制「先发 approval_required」，即使用户策略已是 auto，
 * 体验与 AI Dock（studio 通道）不一致。现默认与 studio 一致：仅 block 名单内工具，
 * 其余走全局策略 `shouldRequireApproval` + 权限守卫。
 * 若需恢复旧行为（企业强制二次确认），设置环境变量：RDK_EXTERNAL_FORCE_APPROVAL=1
 */
const EXTERNAL_FORCE_APPROVAL_PATTERN = /write|exec|restart|flash|upload|set_|delete|remove|connect_ssh/i;

const EXTERNAL_FORCE_APPROVAL_TOOLS = new Set([
  "exec",
  "write",
  "edit",
  "device_exec",
  "device_file_upload",
  "device_restart_service",
  "device_flash",
  "board_openclaw_delegate",
]);

function externalStrictApprovalEnabled(): boolean {
  const v = process.env.RDK_EXTERNAL_FORCE_APPROVAL;
  return v === "1" || v === "true" || v === "yes";
}

export function getExternalChannelPolicy(toolName: string): "block" | "force_approval" | "allow" {
  if (EXTERNAL_BLOCKED_TOOLS.has(toolName)) return "block";
  if (!externalStrictApprovalEnabled()) return "allow";
  if (EXTERNAL_FORCE_APPROVAL_TOOLS.has(toolName)) return "force_approval";
  if (EXTERNAL_FORCE_APPROVAL_PATTERN.test(toolName)) return "force_approval";
  return "allow";
}

export function validateExecCommand(command: string, channel: ChannelSource): ChannelSafetyResult {
  if (channel === "studio") return { blocked: false };

  const check = isCommandDangerous(command);
  if (check.blocked) return check;

  const words = stripShellPrefixBeforeHeredoc(command).toLowerCase().split(/\s+/);
  if (words.some((w) => w === "rm" || w === "del" || w === "rmdir")) {
    const shellForPaths = stripShellPrefixBeforeHeredoc(command).toLowerCase().replace(/\\/g, "/");
    const hasProtected = PROTECTED_PATH_KEYWORDS.some((kw) => shellForPaths.includes(kw));
    if (hasProtected) {
      return { blocked: true, reason: "外部通道禁止删除受保护路径" };
    }
  }

  return { blocked: false };
}

/**
 * 审批关键词匹配。
 *
 * 设计说明：
 * - 允许关键词优先匹配（用户说"好的"即通过，不会被后续"不"误拦）。
 * - 使用精确匹配（trimmed === kw）而非 startsWith，
 *   避免"不好意思，可以执行"被"不"误判为拒绝，
 *   或"行不行"被"行"误判为允许。
 * - 对于短消息（≤6 字符），额外支持 startsWith 以兼容"ok啊"、"好的呀"等口语。
 */
const APPROVAL_KEYWORDS_ALLOW: string[] = [
  "允许", "同意", "好的", "可以", "确认", "批准", "ok", "yes", "approve", "通过",
  "行", "没问题", "继续", "执行吧", "go", "好", "嗯", "对",
];

const APPROVAL_KEYWORDS_DENY: string[] = [
  "拒绝", "不行", "不要", "取消", "停止", "不可以", "不允许", "不同意",
  "no", "deny", "reject", "算了", "别执行", "stop", "cancel",
];

export type TextApprovalResult =
  | { matched: true; decision: "allow_once" | "deny" }
  | { matched: false };

export function matchTextApproval(text: string): TextApprovalResult {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return { matched: false };

  // 精确匹配优先
  if (APPROVAL_KEYWORDS_ALLOW.some((kw) => trimmed === kw)) {
    return { matched: true, decision: "allow_once" };
  }
  if (APPROVAL_KEYWORDS_DENY.some((kw) => trimmed === kw)) {
    return { matched: true, decision: "deny" };
  }

  // 短消息（≤6 字符）允许 startsWith 兼容口语变体（"ok啊"、"好的呀"、"不行啊"）
  if (trimmed.length <= 6) {
    if (APPROVAL_KEYWORDS_ALLOW.some((kw) => trimmed.startsWith(kw))) {
      return { matched: true, decision: "allow_once" };
    }
    if (APPROVAL_KEYWORDS_DENY.some((kw) => trimmed.startsWith(kw))) {
      return { matched: true, decision: "deny" };
    }
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
