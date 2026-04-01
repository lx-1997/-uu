/**
 * 工具输出智能截断
 *
 * 借鉴 claude-code 的设计：工具输出过长时，保留 head + tail，丢弃中间部分。
 * 这比简单截断更好，因为：
 * 1. head 通常包含命令输出的关键信息（如错误信息、状态码）
 * 2. tail 通常包含最终结果（如命令的最后几行输出）
 * 3. 中间部分通常是重复的日志或数据
 */

/** 不同工具类型的截断阈值 */
const TOOL_OUTPUT_LIMITS: Record<string, number> = {
  // 板端命令输出可能很长（编译日志、apt 安装等）
  device_exec: 30_000,
  // 文件内容
  device_file_read: 50_000,
  read: 50_000,
  // 搜索结果
  web_search: 10_000,
  web_fetch: 40_000,
  // OpenClaw 交互
  board_openclaw_delegate: 20_000,
  board_openclaw_chat: 15_000,
  board_openclaw_assess: 10_000,
  // 诊断输出
  device_diagnose: 15_000,
};

const DEFAULT_LIMIT = 20_000;

/**
 * 智能截断工具输出：保留 head + tail，丢弃中间
 */
export function truncateToolOutput(toolName: string, output: string): string {
  const limit = TOOL_OUTPUT_LIMITS[toolName] ?? DEFAULT_LIMIT;

  if (output.length <= limit) return output;

  // 保留 60% head + 40% tail
  const headRatio = 0.6;
  const headLen = Math.floor(limit * headRatio);
  const tailLen = limit - headLen;

  const head = output.slice(0, headLen);
  const tail = output.slice(-tailLen);
  const droppedChars = output.length - headLen - tailLen;
  const droppedLines = output.slice(headLen, -tailLen).split("\n").length;

  return `${head}\n\n[... 省略 ${droppedChars} 字符 / ~${droppedLines} 行 ...]\n\n${tail}`;
}
