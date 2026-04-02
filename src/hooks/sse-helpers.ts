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

export function summarizeToolArgs(args: Record<string, unknown>) {
  const entries = Object.entries(args || {});
  if (entries.length === 0) return '无参数';
  return entries.map(([k, v]) => {
    if (typeof v === 'string') {
      if (k === 'content') return `${k}: <${v.length} chars>`;
      const compact = v.replace(/\s+/g, ' ').trim();
      const limit = k === 'command' ? 120 : 80;
      return `${k}: ${compact.slice(0, limit)}${compact.length > limit ? '...' : ''}`;
    }
    if (v && typeof v === 'object') return `${k}: [object]`;
    return `${k}: ${String(v)}`;
  }).join(' | ');
}
