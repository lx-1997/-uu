import type { MiniAgentEvent } from "../agent/openclaw-index.js";
import type { RDKClawEvent } from "./types.js";
import { sanitizeSecrets } from "./secret-sanitizer.js";

export function resolveExecutor(toolName?: string) {
  if (!toolName) return "rdkclaw_local";
  if (toolName.startsWith("board_openclaw_")) return "board_openclaw";
  // 跨板调度同样走板端 OpenClaw 网关，与 Studio 侧协作展示一致
  if (toolName === "fleet_board_delegate" || toolName === "fleet_board_broadcast") return "board_openclaw";
  return "rdkclaw_local";
}

export function mapMiniEvent(
  event: MiniAgentEvent,
  base: { runId: string; sessionId: string },
): RDKClawEvent | null {
  switch (event.type) {
    case "message_delta":
      return { type: "text", data: { delta: sanitizeSecrets(event.delta), ...base } };
    case "thinking_delta":
      return { type: "thinking_delta", data: { delta: sanitizeSecrets(event.delta), ...base } };
    case "turn_start":
      return { type: "turn_start", data: { turn: event.turn, ...base } };
    case "turn_end":
      return { type: "turn_end", data: { turn: event.turn, ...base } };
    case "message_end":
      return { type: "message_end", data: { text: sanitizeSecrets(event.text), ...base } };
    case "tool_execution_start":
      return {
        type: "tool_start",
        data: {
          ...base,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          name: event.toolName,
          args: event.args,
          phase: "start",
          executor: resolveExecutor(event.toolName),
        },
      };
    case "tool_execution_end":
      return {
        type: "tool_result",
        data: {
          ...base,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          name: event.toolName,
          result: typeof event.result === 'string' ? sanitizeSecrets(event.result) : event.result,
          isError: event.isError,
          phase: event.isError ? "error" : "end",
          executor: resolveExecutor(event.toolName),
        },
      };
    case "retry":
      return {
        type: "retry",
        data: { attempt: event.attempt, delay: event.delay, error: sanitizeSecrets(String(event.error ?? '')), ...base },
      };
    case "agent_error":
      return { type: "error", data: { error: sanitizeSecrets(String(event.error ?? '')), ...base } };
    case "compaction":
      return {
        type: "meta",
        data: {
          ...base,
          executor: "rdkclaw_local",
          phase: "running",
          message: `上下文压缩完成：收缩 ${event.droppedMessages} 条历史消息`,
          compaction_summary_chars: event.summaryChars,
          compaction_dropped_messages: event.droppedMessages,
        },
      };
    case "context_overflow_compact":
      return {
        type: "meta",
        data: {
          ...base,
          executor: "rdkclaw_local",
          phase: "running",
          message: "检测到上下文超限，已自动触发压缩重试",
          context_overflow_error: event.error,
          context_overflow_recovery_level: event.recoveryLevel,
        },
      };
    case "proactive_compaction":
      return {
        type: "meta",
        data: {
          ...base,
          executor: "rdkclaw_local",
          phase: "running",
          message: "窗口经济学：估算接近上限，已主动触发压缩",
          proactive_compaction: true,
          estimated_tokens: event.estimatedTokens,
          compact_threshold: event.threshold,
          effective_context_tokens: event.effectiveContextTokens,
        },
      };
    case "compaction_fuse":
      return {
        type: "meta",
        data: {
          ...base,
          executor: "rdkclaw_local",
          phase: "running",
          message: `LLM 摘要连续失败 ${event.failures} 次，已熔断（仅 prune）`,
          compaction_fuse_failures: event.failures,
        },
      };
    case "microcompact":
      return {
        type: "meta",
        data: {
          ...base,
          executor: "rdkclaw_local",
          phase: "running",
          message: `微压缩 ${event.compressedCount} 段，节省约 ${event.savedChars} 字符`,
          microcompact_compressed_count: event.compressedCount,
          microcompact_saved_chars: event.savedChars,
        },
      };
    case "emergency_truncation":
      return {
        type: "meta",
        data: {
          ...base,
          executor: "rdkclaw_local",
          phase: "running",
          message: `紧急截断：丢弃 ${event.droppedMessages} 条，保留 ${event.keptMessages} 条`,
          emergency_dropped_messages: event.droppedMessages,
          emergency_kept_messages: event.keptMessages,
        },
      };
    case "output_continuation":
      return {
        type: "meta",
        data: {
          ...base,
          executor: "rdkclaw_local",
          phase: "running",
          message: `输出因 max_tokens 截断，续写 ${event.attempt}/${event.maxAttempts}`,
          output_continuation_attempt: event.attempt,
          output_continuation_max_attempts: event.maxAttempts,
        },
      };
    case "run_metrics":
      return {
        type: "meta",
        data: {
          ...base,
          executor: "rdkclaw_local",
          phase: "end",
          message: "run 遥测指标",
          run_metrics: event.metrics,
        },
      };
    case "subagent_summary":
      return {
        type: "meta",
        data: {
          ...base,
          executor: "rdkclaw_local",
          phase: "end",
          message: `子代理完成: ${event.label || "task"}`,
          subagent_summary: event.summary,
        },
      };
    case "subagent_error":
      return {
        type: "error",
        data: {
          ...base,
          error: `子代理失败: ${event.error}`,
          subagent_label: event.label,
        },
      };
    case "agent_end":
      return null;
    default:
      return null;
  }
}
