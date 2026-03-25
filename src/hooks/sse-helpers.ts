export function executorLabel(executor: string) {
  return executor === 'board_openclaw' ? '板端 OpenClaw' : 'RDK Studio Claw';
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
