export function executorLabel(executor: string) {
  return executor === 'board_openclaw' ? '板端 OpenClaw' : 'RDK Studio Claw';
}

/** 委派/对话工具返回中，分隔 OpenClaw 正文与 RDKClaw 追加说明（\n---\n[RDKClaw 提示…） */
export function splitOpenClawCollaborationResult(result: string): { body: string; rdkHint: string | null } {
  const sep = '\n---\n';
  const idx = result.indexOf(sep);
  if (idx >= 0 && /\[RDKClaw 提示/.test(result.slice(idx))) {
    return {
      body: result.slice(0, idx).trim(),
      rdkHint: result.slice(idx + sep.length).trim(),
    };
  }
  return { body: result, rdkHint: null };
}

/** 从 OpenClaw 正文中拆出 [NEED_RDKCLAW]…[/NEED_RDKCLAW]，用于单独展示「板端向本机求助」 */
export function extractNeedRdkclawBlocks(text: string): { cleaned: string; extracts: string[] } {
  const extracts: string[] = [];
  const re = /\[\s*NEED_RDKCLAW\s*\]([\s\S]*?)\[\s*\/\s*NEED_RDKCLAW\s*\]/gi;
  let m: RegExpExecArray | null;
  const src = text || '';
  while ((m = re.exec(src)) !== null) {
    const inner = (m[1] || '').trim();
    if (inner) extracts.push(inner);
  }
  const cleaned = src
    .replace(/\[\s*NEED_RDKCLAW\s*\]([\s\S]*?)\[\s*\/\s*NEED_RDKCLAW\s*\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { cleaned, extracts };
}

/** 需要在对话区展示 Studio ↔ 板端 OpenClaw 协作气泡的工具 */
export function isBoardOpenClawCollabTool(toolName: string): boolean {
  return (
    toolName === 'board_openclaw_delegate'
    || toolName === 'board_openclaw_chat'
    || toolName === 'board_openclaw_assess'
    || toolName === 'fleet_board_delegate'
    || toolName === 'fleet_board_broadcast'
  );
}

/**
 * 凡经板端 OpenClaw 网关的工具（与 server/rdkclaw/event-mapper resolveExecutor 对齐）。
 * 快速回答模式下也要在对话区展示这些步骤与输出，不能只显示 delegate/chat/assess。
 */
export function isBoardOpenClawExecutorTool(toolName: string): boolean {
  if (!toolName) return false;
  return (
    toolName.startsWith('board_openclaw_')
    || toolName === 'fleet_board_delegate'
    || toolName === 'fleet_board_broadcast'
  );
}

/**
 * 板端桥接对每条工具事件都打 `[TOOL:phase] name`（见 OpenClawDeploymentManager onLine）；
 * 长 `exec` 往往无 detail，流式会刷成百条相同行。折叠连续重复，保留 ×N。
 */
export function collapseRepeatedBoardToolNotifyLines(lines: string[]): string[] {
  const out: string[] = [];
  let runLine: string | null = null;
  let runCount = 0;
  const flush = () => {
    if (runLine && runCount > 0) {
      out.push(runCount === 1 ? runLine : `${runLine} ×${runCount}`);
    }
    runLine = null;
    runCount = 0;
  };
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) {
      if (runLine == null) out.push(raw);
      continue;
    }
    if (t.startsWith('[TOOL:')) {
      if (t === runLine) {
        runCount += 1;
      } else {
        flush();
        runLine = t;
        runCount = 1;
      }
      continue;
    }
    flush();
    out.push(raw);
  }
  flush();
  return out;
}

/** 从 tool_start 参数生成「发给板端 OpenClaw」的展示行（LLM 填写的委派/对话内容） */
export function formatBoardOutboundLines(toolName: string, args: Record<string, unknown> | undefined): string[] {
  if (!args) return [];
  const lines: string[] = [];
  if (toolName === 'board_openclaw_delegate') {
    const task = String(args.task ?? '').trim();
    if (task) lines.push(`task:\n${task}`);
    const intent = String(args.intent ?? '').trim();
    if (intent) lines.push(`intent: ${intent}`);
    const context = String(args.context ?? '').trim();
    if (context) lines.push(`context:\n${context}`);
    const guidance = String(args.guidance ?? '').trim();
    if (guidance) lines.push(`guidance (RDKClaw → OpenClaw):\n${guidance}`);
    if (typeof args.encourageSkills === 'boolean') {
      lines.push(`encourage_skills: ${args.encourageSkills}`);
    }
    const sid = String(args.sessionId ?? '').trim();
    if (sid) lines.push(`session_id: ${sid}`);
  } else if (toolName === 'board_openclaw_chat') {
    const message = String(args.message ?? '').trim();
    if (message) lines.push(`message:\n${message}`);
    const context = String(args.context ?? '').trim();
    if (context) lines.push(`context:\n${context}`);
  } else if (toolName === 'board_openclaw_assess') {
    const task = String(args.task ?? '').trim();
    if (task) lines.push(`task:\n${task}`);
    const context = String(args.context ?? '').trim();
    if (context) lines.push(`context:\n${context}`);
    const sid = String(args.sessionId ?? '').trim();
    if (sid) lines.push(`session_id: ${sid}`);
  } else if (toolName === 'fleet_board_delegate') {
    const target = String(args.targetDeviceId ?? '').trim();
    if (target) lines.push(`target_device_id: ${target}`);
    const task = String(args.task ?? '').trim();
    if (task) lines.push(`task:\n${task}`);
    const guidance = String(args.guidance ?? '').trim();
    if (guidance) lines.push(`guidance:\n${guidance}`);
    const role = String(args.role ?? '').trim();
    if (role) lines.push(`role: ${role}`);
    const sid = String(args.sessionId ?? '').trim();
    if (sid) lines.push(`session_id: ${sid}`);
  } else if (toolName === 'fleet_board_broadcast') {
    const task = String(args.task ?? '').trim();
    if (task) lines.push(`task:\n${task}`);
    const guidance = String(args.guidance ?? '').trim();
    if (guidance) lines.push(`guidance:\n${guidance}`);
    const mode = String(args.collectMode ?? '').trim();
    if (mode) lines.push(`collect_mode: ${mode}`);
    const ids = args.targetDeviceIds;
    if (Array.isArray(ids) && ids.length > 0) {
      lines.push(`target_device_ids: ${ids.map((x) => String(x)).join(', ')}`);
    }
  }
  return lines;
}

export function resolveToolName(data: Record<string, unknown>) {
  return String(data.toolName || data.name || 'unknown_tool');
}

export function resolveToolId(data: Record<string, unknown>) {
  return String(data.toolCallId || '');
}

export function resolvePhase(phase: unknown) {
  if (phase === 'start') return '准备中';
  if (phase === 'running') return '执行中';
  if (phase === 'end') return '已完成';
  if (phase === 'error') return '失败';
  return '执行中';
}

export function resolveDecisionSourceLabel(source: string) {
  if (source === 'user_mode') return '用户指定';
  if (source === 'skill_policy') return '技能策略';
  if (source === 'task_analysis') return '任务可完成性判断';
  if (source === 'policy_rule') return '规则命中';
  if (source === 'persona') return '人格/策略配置';
  return '默认策略';
}

/**
 * RDKClaw / 本机 write / OpenClaw delegate·chat 等：对话区须能看到完整入参（长脚本、task、message），
 * 勿只显示 <N chars> 或 [object]。
 */
const TOOL_ARG_CONTENT_PREVIEW_MAX = 48 * 1024;

/** 通常为短标量/ID，单行展示即可；若值异常长仍走全文块 */
const TOOL_ARG_SHORT_KEYS = new Set([
  'sessionId',
  'session_id',
  'targetDeviceId',
  'target_device_id',
  'deviceId',
  'device_id',
  'screen',
  'port',
  'timeout',
  'timeoutMs',
  'limit',
  'encourageSkills',
  'cleanup',
  'collectMode',
  'collect_mode',
  'mode',
  'role',
  'op',
  'page',
  'size',
  'offset',
  'width',
  'height',
  'count',
  'index',
  'version',
  'revision',
  'phase',
  'status',
  'state',
  'dryRun',
  'force',
  'skip',
]);

/** 明确按「长文本」展示（与 RDKClaw / OpenClaw / 本机编辑 等工具字段对齐） */
const TOOL_ARG_FULL_TEXT_KEYS = new Set([
  'content',
  'old_string',
  'new_string',
  'message',
  'task',
  'context',
  'guidance',
  'intent',
  'prompt',
  'query',
  'body',
  'text',
  'html',
  'description',
  'markdown',
  'instructions',
  'notes',
  'feedback',
  'reason',
  'explanation',
  'summary',
  'input',
  'output',
  'stdin',
  'stdout',
  'stderr',
  'payload',
  'answer',
  'transcript',
  'speech',
  'search',
  'filter',
  'pattern',
  'command',
  'shell',
  'shell_command',
  'bash',
  'line',
  'diff',
  'patch',
  'snippet',
  'code',
  'script',
  'email',
  'letter',
  'report',
  'xml',
  'json',
  'source',
  'data',
  'variables',
  'env',
  'extra',
  'metadata',
  'comment',
  'subtitle',
  'title',
  'caption',
  'hint',
  'details',
  'help',
  'error',
  'suggestion',
  'label',
]);

function argKeySortOrder(key: string): number {
  if (key === 'path' || key === 'file_path' || key === 'target_path' || key === 'filePath') return 0;
  if (key === 'command' || key === 'shell' || key === 'shell_command' || key === 'uri' || key === 'url') {
    return 1;
  }
  if (TOOL_ARG_SHORT_KEYS.has(key)) return 2;
  if (
    TOOL_ARG_FULL_TEXT_KEYS.has(key)
    || key === 'content'
    || key === 'old_string'
    || key === 'new_string'
    || key === 'message'
    || key === 'task'
    || key === 'context'
    || key === 'guidance'
  ) {
    return 5;
  }
  return 3;
}

const PATH_LIKE_KEYS = new Set([
  'path',
  'file_path',
  'target_path',
  'filePath',
  'uri',
  'url',
]);

function formatFullTextBlock(key: string, v: string): string {
  if (v.length <= TOOL_ARG_CONTENT_PREVIEW_MAX) {
    return `${key}:\n${v}`;
  }
  return `${key}:\n${v.slice(0, TOOL_ARG_CONTENT_PREVIEW_MAX)}\n\n…（共 ${v.length} 字符，已截断；完整内容以工具执行结果为准）`;
}

function shouldShowFullString(key: string, v: string): boolean {
  if (PATH_LIKE_KEYS.has(key)) return false;
  if (TOOL_ARG_SHORT_KEYS.has(key) && v.length <= 400) return false;
  if (TOOL_ARG_FULL_TEXT_KEYS.has(key)) return true;
  if (key === 'command' || key === 'shell' || key === 'shell_command') return true;
  return v.length >= 180;
}

function formatStringArgForToolSummary(key: string, v: string): string {
  if (PATH_LIKE_KEYS.has(key)) {
    return `${key}: ${v.replace(/\s+/g, ' ').trim()}`;
  }
  if (shouldShowFullString(key, v)) {
    return formatFullTextBlock(key, v);
  }
  const compact = v.replace(/\s+/g, ' ').trim();
  return `${key}: ${compact.slice(0, 200)}${compact.length > 200 ? '...' : ''}`;
}

function formatNonStringArgForToolSummary(key: string, v: unknown): string {
  if (v == null) return `${key}: ${String(v)}`;
  if (typeof v === 'boolean' || typeof v === 'number') return `${key}: ${String(v)}`;
  try {
    const s = JSON.stringify(v, null, 2);
    if (s.length <= TOOL_ARG_CONTENT_PREVIEW_MAX) {
      return `${key}:\n${s}`;
    }
    return `${key}:\n${s.slice(0, TOOL_ARG_CONTENT_PREVIEW_MAX)}\n\n…（JSON 已截断，共约 ${s.length} 字符）`;
  } catch {
    return `${key}: ${String(v)}`;
  }
}

export function summarizeToolArgs(args: Record<string, unknown>) {
  const entries = Object.entries(args || {});
  if (entries.length === 0) return '无参数';
  entries.sort((a, b) => {
    const d = argKeySortOrder(a[0]) - argKeySortOrder(b[0]);
    return d !== 0 ? d : a[0].localeCompare(b[0]);
  });
  return entries.map(([k, v]) => {
    if (typeof v === 'string') {
      return formatStringArgForToolSummary(k, v);
    }
    return formatNonStringArgForToolSummary(k, v);
  }).join('\n\n');
}

/** 用于状态卡片标题：优先文件路径、命令等，避免只显示工具名 */
export function primaryToolArgSummary(args: Record<string, unknown>) {
  const a = args || {};
  const pathKeys = ['file_path', 'path', 'target_path', 'filePath', 'uri', 'url'] as const;
  for (const k of pathKeys) {
    const v = a[k as string];
    if (typeof v === 'string' && v.trim()) return v.replace(/\s+/g, ' ').trim().slice(0, 220);
  }
  if (typeof a.command === 'string' && a.command.trim()) {
    return a.command.replace(/\s+/g, ' ').trim().slice(0, 140);
  }
  if (typeof a.pattern === 'string' && a.pattern.trim()) {
    return `pattern: ${a.pattern.replace(/\s+/g, ' ').trim().slice(0, 100)}`;
  }
  const full = summarizeToolArgs(a);
  if (full === '无参数') return '';
  return full.slice(0, 200);
}

/** 展示用短路径：尾部路径 + 省略前缀 */
function shortDisplayPath(p: string, max = 56): string {
  const t = p.replace(/\\/g, '/').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= max) return t;
  return `…${t.slice(-(max - 1))}`;
}

function shortCommand(cmd: string, max = 72): string {
  const t = cmd.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** 板端协作类：从参数里取一句人话，避免标题只有动词 */
function boardIntentLine(args: Record<string, unknown>): string {
  const task = typeof args.task === 'string' ? args.task.replace(/\s+/g, ' ').trim() : '';
  if (task) return task.length > 96 ? `${task.slice(0, 93)}…` : task;
  const message = typeof args.message === 'string' ? args.message.replace(/\s+/g, ' ').trim() : '';
  if (message) return message.length > 96 ? `${message.slice(0, 93)}…` : message;
  const intent = typeof args.intent === 'string' ? args.intent.replace(/\s+/g, ' ').trim() : '';
  if (intent) return intent.length > 96 ? `${intent.slice(0, 93)}…` : intent;
  return '';
}

/** 无映射工具：只展示目标摘要，绝不拼接内部工具名 */
function footprintFallback(args: Record<string, unknown>): string {
  const t = primaryToolArgSummary(args);
  if (!t) return 'Working…';
  return t.length > 88 ? `${t.slice(0, 85)}…` : t;
}

/**
 * 单行工具标题：仅「简单动词 + 目标」，不暴露内部工具名（与对话区轻量足迹一致）。
 */
export function formatToolFootprintTitle(toolName: string, args: Record<string, unknown>): string {
  const n = (toolName || '').trim();
  const a = args || {};
  const rawPath =
    typeof a.file_path === 'string' ? a.file_path
    : typeof a.path === 'string' ? a.path
    : typeof a.target_path === 'string' ? a.target_path
    : typeof (a as { filePath?: string }).filePath === 'string' ? (a as { filePath: string }).filePath
    : '';
  const pathShort = rawPath ? shortDisplayPath(rawPath) : '';

  if (n === 'read' || n === 'read_file' || n === 'attachment_read') {
    return pathShort ? `Read ${pathShort}` : 'Read';
  }
  if (n === 'write' || n === 'write_file') {
    return pathShort ? `Write ${pathShort}` : 'Write';
  }
  if (n === 'edit' || n === 'search_replace' || n === 'edit_file') {
    return pathShort ? `Edit ${pathShort}` : 'Edit';
  }
  if (n === 'list' || n === 'list_dir' || n === 'glob' || n === 'glob_file_search') {
    return pathShort ? `Explored ${pathShort}` : 'Explored';
  }
  if (n === 'grep' || n === 'ripgrep' || n === 'rg' || n === 'grep_search') {
    const pat = typeof a.pattern === 'string' ? a.pattern.replace(/\s+/g, ' ').trim().slice(0, 36) : '';
    if (pathShort && pat) return `Grepped "${pat}" · ${pathShort}`;
    if (pat) return `Grepped "${pat}"`;
    if (pathShort) return `Grepped ${pathShort}`;
    return 'Grepped';
  }
  if (n === 'exec') {
    const cmd = typeof a.command === 'string' ? shortCommand(a.command, 80) : '';
    return cmd ? `Ran ${cmd}` : 'Ran command';
  }
  if (n === 'device_exec' || n === 'device_shell' || n === 'ssh_exec') {
    const cmd = typeof a.command === 'string' ? shortCommand(a.command, 80) : '';
    return cmd ? `Ran on device · ${cmd}` : 'Ran on device';
  }
  if (n === 'device_file_read') {
    const dp = pathShort || (typeof a.path === 'string' ? shortDisplayPath(a.path) : '');
    return dp ? `Read ${dp}` : 'Read on device';
  }
  if (n === 'device_file_write') {
    const dp = pathShort || (typeof a.path === 'string' ? shortDisplayPath(a.path) : '');
    return dp ? `Write ${dp}` : 'Write on device';
  }
  if (n === 'device_file_list') {
    const dp = pathShort || (typeof a.path === 'string' ? shortDisplayPath(a.path) : '');
    return dp ? `Explored ${dp}` : 'Explored on device';
  }
  if (n === 'device_file_download_to_local') {
    const dp = typeof a.path === 'string' ? shortDisplayPath(a.path) : pathShort;
    return dp ? `Pulled ${dp}` : 'Pulled from device';
  }
  if (n === 'device_file_upload_from_local') {
    const dp = typeof a.path === 'string' ? shortDisplayPath(a.path) : pathShort;
    return dp ? `Pushed ${dp}` : 'Pushed to device';
  }
  if (n === 'device_diagnose') {
    return 'Diagnosed device';
  }
  if (n === 'memory_search') {
    return 'Searched memory';
  }
  if (n === 'memory_get') {
    return 'Opened memory';
  }
  if (n === 'memory_save') {
    return 'Saved memory';
  }
  if (n === 'attachment_list') {
    return 'Listed attachments';
  }
  if (n === 'attachment_describe_image' || n === 'attachment_get_audio_transcript') {
    return 'Read attachment';
  }
  if (n === 'web_search') {
    const q = typeof a.query === 'string' ? a.query.replace(/\s+/g, ' ').trim().slice(0, 64) : '';
    return q ? `Searched "${q}"` : 'Searched web';
  }
  if (n === 'web_fetch' || n === 'fetch_url' || n === 'mcp_web_fetch' || n === 'web_extract') {
    const u = typeof a.url === 'string' ? a.url.replace(/\s+/g, ' ').trim().slice(0, 64) : '';
    return u ? `Fetched ${u}` : 'Fetched page';
  }
  if (n === 'web_browser_fetch') {
    return 'Opened in browser';
  }
  if (n === 'create_plan' || n === 'update_plan') {
    return 'Updated plan';
  }
  if (n === 'sessions_spawn') {
    return 'Started session';
  }
  if (n === 'ros_topics') {
    return 'Listed ROS topics';
  }
  if (n === 'ros_nodes') {
    return 'Listed ROS nodes';
  }
  if (n === 'vnc_start') {
    return 'Started VNC';
  }
  if (n === 'vnc_stop') {
    return 'Stopped VNC';
  }
  if (n === 'vnc_status') {
    return 'Checked VNC';
  }
  if (n === 'flash_check') {
    return 'Checked flash';
  }
  if (n === 'text_to_speech' || n === 'sherpa_tts') {
    return 'Spoke text';
  }
  if (n === 'speech_to_text' || n === 'sherpa_stt') {
    return 'Transcribed audio';
  }
  if (n === 'sherpa_setup') {
    return 'Voice setup';
  }
  if (n.startsWith('sherpa_')) {
    return 'Voice tool';
  }
  if (n === 'device_list_all') {
    return 'Listed devices';
  }
  if (n === 'device_scan_network') {
    return 'Scanned network';
  }
  if (n === 'device_connect_ssh' || n === 'device_quick_connect_qr') {
    return 'Connected device';
  }
  if (n === 'device_remove' || n === 'switch_device') {
    return 'Switched device';
  }
  if (n === 'weixin_bind_qrcode') {
    return 'WeChat setup';
  }
  if (n.startsWith('forum_')) {
    return 'Forum';
  }

  if (n.startsWith('board_openclaw') || n.startsWith('fleet_board')) {
    const sub = n.replace(/^board_openclaw_/, '').replace(/^fleet_board_/, '');
    const intent = boardIntentLine(a);
    const withIntent = (label: string) => (intent ? `${label} · ${intent}` : label);

    if (n.startsWith('fleet_board')) {
      if (sub === 'delegate') return withIntent('Delegated');
      if (sub === 'broadcast') return withIntent('Broadcast');
    }
    if (sub === 'delegate') return withIntent('Delegated to device');
    if (sub === 'chat') return withIntent('Messaged device');
    if (sub === 'assess') return withIntent('Assessed on device');
    if (sub === 'status' || sub === 'health' || sub === 'check') return 'Checked device';
    if (sub === 'doctor' || sub === 'model_test') return 'Checked device';
    if (sub === 'logs') return 'Fetched device logs';
    if (sub === 'install' || sub === 'upgrade' || sub === 'uninstall') return 'Updated device gateway';
    if (sub === 'restart_gateway') return 'Restarted gateway';
    if (sub === 'read_config') return 'Opened device config';
    if (sub === 'skills_list' || sub === 'skill_install' || sub === 'write_skill' || sub === 'ensure_find_skills') {
      return 'Managed device skills';
    }
    if (sub.startsWith('pairing') || sub === 'gateway_pair') return 'Managed pairing';
    if (sub === 'feishu_config' || sub === 'weixin_config') return 'Updated channel config';
    if (sub === 'model_switch') return 'Switched device model';
    if (intent) return `Device · ${intent}`;
    return 'Device';
  }

  return footprintFallback(a);
}

/** 卡片主标题（与足迹一致，避免「工具名 · 长参数」割裂感） */
export function formatToolStatusTitle(toolName: string, args: Record<string, unknown>) {
  return formatToolFootprintTitle(toolName, args);
}
