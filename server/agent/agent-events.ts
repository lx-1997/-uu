/**
 * Agent 事件类型定义
 *
 * 对应 OpenClaw:
 * - pi-agent-core/types.d.ts → AgentEvent 判别联合类型
 * - pi-ai/utils/event-stream.js → EventStream<T, R> 泛型事件流
 *
 * 架构对齐:
 * - 全局事件总线 → 已移除（原 emitAgentEvent / onAgentEvent）
 * - 替代方案: Agent 实例级 subscribe()/emit() 模式
 *   （对应 pi-agent-core Agent.listeners + Agent.emit()）
 * - EventStream 从 pi-ai 直接导入（DRY，不重新实现）
 *
 * 事件流向（三层架构）:
 *   Layer 1: agent-loop → stream.push(MiniAgentEvent) → EventStream 队列
 *   Layer 2: Agent.run() → for await (event of stream) → 消费事件
 *   Layer 3: Agent.emit(event) → listeners → 外部订阅者（CLI 等）
 */

import { EventStream } from "@mariozechner/pi-ai";
import type { Message } from "./session.js";

// ============== 事件类型（判别联合） ==============

/**
 * Agent 事件类型
 *
 * 对应 pi-agent-core AgentEvent，适配 mini 的 Message 类型:
 * - 核心生命周期: agent_start → agent_end / agent_error
 * - 轮次: turn_start → turn_end
 * - 消息: message_start → message_delta* → message_end
 * - 工具: tool_execution_start → tool_execution_end / tool_skipped
 * - mini 特有: compaction, retry, steering, subagent, context_overflow_compact
 */
export type MiniAgentEvent =
  // 核心生命周期（对齐 pi-agent-core: agent_start / agent_end）
  | { type: "agent_start"; runId: string; sessionKey: string; agentId: string; model: string }
  | { type: "agent_end"; runId: string; messages: Message[] }
  | { type: "agent_error"; runId: string; error: string }

  // 轮次（对齐 pi-agent-core: turn_start / turn_end）
  | { type: "turn_start"; turn: number }
  | { type: "turn_end"; turn: number }

  // 消息（对齐 pi-agent-core: message_start / message_update / message_end）
  | { type: "message_start"; message: Message }
  | { type: "message_delta"; delta: string }
  | { type: "message_end"; message: Message; text: string }

  // 思考（对齐 pi-agent-core: extended thinking 流式输出）
  | { type: "thinking_delta"; delta: string }

  // 工具执行（对齐 pi-agent-core: tool_execution_start / tool_execution_end）
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: string; isError: boolean }
  | { type: "tool_execution_progress"; toolCallId: string; toolName: string; elapsed_sec: number }
  | { type: "tool_skipped"; toolCallId: string; toolName: string }

  // 工具审批（对齐 openclaw: exec-approvals → approval request/resolved 事件）
  | { type: "tool_approval_request"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_approval_resolved"; toolCallId: string; toolName: string; decision: "allow-once" | "allow-always" | "deny" }

  // mini 特有事件
  | { type: "steering"; pendingCount: number }
  | { type: "compaction"; summaryChars: number; droppedMessages: number }
  | { type: "context_overflow_compact"; error: string; recoveryLevel?: number }
  | { type: "retry"; attempt: number; delay: number; error: string }
  | { type: "subagent_summary"; childSessionKey: string; label?: string; task: string; summary: string }
  | { type: "subagent_error"; childSessionKey: string; label?: string; task: string; error: string }
  | { type: "turn_transition"; turn: number; reason: string }

  // 可观测性事件（借鉴 claude-code run metrics）
  | { type: "microcompact"; compressedCount: number; savedChars: number }
  /** 文件被改写后，剔除过时 read/device_file_read 的大段 tool_result（零 LLM） */
  | { type: "stale_read_invalidate"; invalidatedCount: number; savedChars: number }
  /** 长上下文：近尾段仍保留的 tool_result 中超长条单行截断 */
  | { type: "tail_tool_snip"; snippedCount: number; savedChars: number }
  | { type: "emergency_truncation"; droppedMessages: number; keptMessages: number }
  /** 输出因 max_tokens 截断自动续写（借鉴 claude-code continuation） */
  | { type: "output_continuation"; attempt: number; maxAttempts: number }
  /** LLM 摘要压缩连续失败熔断，后续 overflow 跳过 Level 2 直走降级 */
  | { type: "compaction_fuse"; failures: number }
  /** 窗口经济学：在溢出前主动触发摘要（对齐 claude-code shouldAutoCompact） */
  | { type: "proactive_compaction"; estimatedTokens: number; threshold: number; effectiveContextTokens: number }
  | { type: "run_metrics"; metrics: RunMetrics };

/** Agent run 的完整执行统计（借鉴 claude-code） */
export interface RunMetrics {
  runId: string;
  sessionKey: string;
  totalTurns: number;
  totalToolCalls: number;
  toolCallsByName: Record<string, number>;
  toolErrors: number;
  microcompactSavedChars: number;
  overflowRecoveries: number;
  totalDurationMs: number;
  firstTokenMs: number | null;
  contextCompactions: number;
  /** 可观测性：系统提示长度与短 hash（对齐 claude-code betaSessionTracing） */
  systemPromptChars: number;
  systemPromptHashShort: string;
  /** 有效上下文上限（已扣除 max_output 预留） */
  effectiveContextTokens: number;
  /** 与 overflow 熔断一致的连续摘要失败计数 */
  llmCompactionFailureStreak: number;
  /** 系统提示分层数量 */
  systemPromptLayerCount: number;
}

// ============== 结果类型 ==============

/**
 * EventStream 的最终结果
 *
 * 当 stream 收到终止事件（agent_end / agent_error）时通过 extractResult 提取
 */
export interface MiniAgentResult {
  finalText: string;
  turns: number;
  totalToolCalls: number;
  messages: Message[];
}

// ============== 工厂函数 ==============

/**
 * 创建 Agent 事件流
 *
 * 对应 pi-agent-core/agent-loop.js → createAgentStream()
 * - isComplete: agent_end 或 agent_error 为终止事件
 * - extractResult: 从终止事件中提取 MiniAgentResult
 */
export function createMiniAgentStream(): EventStream<MiniAgentEvent, MiniAgentResult> {
  return new EventStream<MiniAgentEvent, MiniAgentResult>(
    // 不使用 isComplete 自动完成，由 agent-loop 的 stream.end() 显式传入结果
    () => false,
    () => ({ finalText: "", turns: 0, totalToolCalls: 0, messages: [] }),
  );
}
