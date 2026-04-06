/**
 * 工具延迟加载策略：核心集常驻，其余按需 load_tools 注入（对齐 claude-code ToolSearch 思路）
 */

/** 元工具本身 */
export const LOAD_TOOLS_META_NAME = "load_tools";

/**
 * 始终下发给模型的工具（覆盖常见本机读写与编排）
 * 套件端 / 联网 / Studio 任务类等默认延迟，减少首轮 tool schema token
 */
export const LAZY_LOAD_CORE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "read",
  "list",
  "grep",
  "write",
  "edit",
  "exec",
  LOAD_TOOLS_META_NAME,
  "find_skills",
  "memory_search",
  "memory_get",
  "memory_save",
  "sessions_spawn",
  /** 首轮可见：避免模型把「打开网页」误判为 SkillHub 技能缺口而乱检索 */
  "studio_open_url",
  "studio_embedded_browser_capture",
  /** 工作区内图片：系统默认应用预览（非 http） */
  "studio_open_local_preview",
]);

/** 工具数低于此阈值时不做延迟加载（收益小） */
export const LAZY_LOAD_MIN_TOOL_COUNT = 16;

/** query 匹配时最多自动加入几条 */
export const LAZY_LOAD_MAX_QUERY_MATCHES = 28;

/** load_all / names 批量上限 */
export const LAZY_LOAD_MAX_BATCH = 96;

export function toolLazyLoadDisabledByEnv(): boolean {
  const v = String(process.env.RDKCLAW_TOOL_LAZY_LOAD ?? "").trim().toLowerCase();
  return v === "0" || v === "false" || v === "off";
}

export function isLazyCoreToolName(name: string): boolean {
  return LAZY_LOAD_CORE_TOOL_NAMES.has(name);
}

/**
 * Studio 已选板卡时：首轮即预登记这些延迟工具，避免「load_tools → 下一轮才能 device_exec」多耗一轮模型。
 * 仍保留 web/附件等延迟工具以控制首轮 schema 体积。
 */
export function shouldPreloadDeferrableWithStudioDevice(name: string): boolean {
  if (name === "switch_device") return true;
  if (name.startsWith("device_")) return true;
  if (name.startsWith("board_openclaw_")) return true;
  if (name.startsWith("fleet_board_")) return true;
  /** 已选板卡时几乎必查 rdk_doc / 联网；预载避免首轮「load_tools → 同回合 web_fetch」仍报未知工具 */
  if (name === "web_fetch" || name === "web_search") return true;
  return false;
}
