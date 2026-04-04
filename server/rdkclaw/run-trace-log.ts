/**
 * RDKClaw 结构化日志（runId + channel + phase），便于 grep 串联全链路。
 */
export function rdkclawRunTrace(
  kind: 'queue_wait' | 'run_start' | 'run_done' | 'run_error',
  fields: Record<string, unknown>,
): void {
  console.info(`[rdkclaw][trace][${kind}] ${JSON.stringify(fields)}`);
}
