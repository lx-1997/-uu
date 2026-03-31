/**
 * Agent 主循环
 *
 * 对应 OpenClaw: pi-agent-core → agent-loop.ts — runLoop()
 *
 * 从 Agent 类中提取的纯函数: 接收所有依赖，不访问 Agent 实例状态。
 *
 * 架构对齐（EventStream 模式）:
 * - 同步返回 EventStream<MiniAgentEvent, MiniAgentResult>
 * - 内部 IIFE 异步执行循环，通过 stream.push() 推送类型化事件
 * - 消费方用 for-await 迭代 stream，或用 stream.result() 获取最终结果
 *
 * 双层循环结构 (对齐 openclaw):
 *
 * OUTER LOOP (follow-ups)
 * ├─ INNER LOOP (tools + steering)
 * │  ├─ 注入 pendingMessages（steering 或 follow-up）
 * │  ├─ LLM 流式调用
 * │  ├─ 执行工具（每执行一个后检查 steering）
 * │  ├─ 若 steering: 跳过剩余工具（每个被跳过的工具生成 skipToolCall 结果）
 * │  └─ 循环条件: hasMoreToolCalls || pendingMessages.length > 0
 * ├─ 检查 follow-up 消息
 * └─ 若有 follow-up: 继续外层循环
 */

import type { EventStream } from "@mariozechner/pi-ai";
import type { Tool, ToolContext } from "./tools/types.js";
import type { Message, ContentBlock } from "./session.js";
import type {
  Model,
  StreamFunction,
  SimpleStreamOptions,
  Context as PiContext,
  ThinkingLevel,
} from "@mariozechner/pi-ai";
import {
  retryAsync,
  isContextOverflowError,
  isRateLimitError,
  describeError,
} from "./provider/errors.js";
import { pruneContextMessages } from "./context/index.js";
import { microcompact } from "./context/microcompact.js";
import { createMiniAgentStream, type MiniAgentEvent, type MiniAgentResult } from "./agent-events.js";
import { abortable } from "./tools/abort.js";
import { convertMessagesToPi } from "./message-convert.js";
import type { ToolHookRegistry } from "./tool-hooks.js";

// ============== 类型定义 ==============

export interface AgentLoopParams {
  runId: string;
  sessionKey: string;
  agentId: string;
  /** 可变: 循环中会 push 新消息 */
  currentMessages: Message[];
  compactionSummary: Message | undefined;
  systemPrompt: string;
  toolsForRun: Tool[];
  /** 若提供，则每个 LLM 回合前重新获取工具列表（支持对话中连接设备后注入板端工具） */
  getToolsForRun?: () => Tool[];
  toolCtx: ToolContext;
  modelDef: Model<any>;
  streamFn: StreamFunction;
  apiKey?: string;
  temperature?: number;
  /** 思考级别: 传入后启用 extended thinking */
  reasoning?: ThinkingLevel;
  maxTurns: number;
  contextTokens: number;
  /**
   * 获取 steering 消息
   *
   * 对应 OpenClaw: pi-agent-core → AgentLoopConfig.getSteeringMessages
   * - 每执行完一个工具后调用
   * - 返回非空数组时跳过剩余工具，注入到下一轮
   */
  getSteeringMessages: () => Promise<Message[]>;
  /**
   * 获取 follow-up 消息
   *
   * 对应 OpenClaw: pi-agent-core → AgentLoopConfig.getFollowUpMessages
   * - 内层循环结束后（agent 本来要停下）调用
   * - 返回非空数组时继续外层循环
   */
  getFollowUpMessages?: () => Promise<Message[]>;
  /** 持久化 */
  appendMessage: (sessionKey: string, msg: Message) => Promise<void>;
  /** Compaction 触发器 */
  prepareCompaction: (params: {
    messages: Message[];
    sessionKey: string;
    runId: string;
  }) => Promise<{
    summary?: string;
    summaryMessage?: Message;
  }>;
  /**
   * 工具审批检查
   *
   * 对应 OpenClaw: bash-tools.exec.ts → requiresExecApproval() + waitForDecision()
   * - 每个工具执行前调用
   * - 返回 null: 无需审批，直接执行
   * - 返回 { approved: true }: 审批通过
   * - 返回 { approved: false }: 审批拒绝
   */
  checkToolApproval?: (call: {
    id: string;
    name: string;
    input: unknown;
  }) => Promise<{ approved: boolean; decision: string } | null>;
  /** Tool Hooks 注册表（借鉴 claude-code PreToolUse/PostToolUse） */
  toolHooks?: ToolHookRegistry;
  /** 外部 abort 信号 */
  abortSignal: AbortSignal;
}

// ============== skipToolCall (对齐 openclaw) ==============

/**
 * 为被跳过的工具生成占位结果
 *
 * 对应 OpenClaw: pi-agent-core → skipToolCall()
 * - isError: true，标记为错误结果
 * - 消息: "Skipped due to queued user message."
 * - 保持消息结构完整，便于 LLM 理解上下文
 */
function skipToolCall(call: { id: string; name: string }): ContentBlock {
  return {
    type: "tool_result",
    tool_use_id: call.id,
    name: call.name,
    content: "Skipped due to queued user message.",
  };
}

// ============== 工具并行分组 ==============

const PARALLEL_SAFE_TOOLS = new Set([
  "read", "list", "grep",
  "memory_search", "memory_get",
  "device_file_read", "device_file_list",
  "device_diagnose",
  "attachment_list", "attachment_read", "attachment_describe_image",
  "board_openclaw_assess", "board_openclaw_chat",
  "board_openclaw_status", "board_openclaw_health",
  "board_openclaw_check", "board_openclaw_logs",
  "studio_get_agent_config",
  "rdkclaw_token_usage_report",
  "forum_drobotics_latest", "forum_drobotics_topic", "forum_drobotics_auth_status",
  "web_search", "web_extract",
  "ros_topics", "ros_nodes",
  "vnc_status",
  "flash_check",
]);

interface ToolExecGroup {
  calls: { id: string; name: string; input: Record<string, unknown> }[];
  parallel: boolean;
}

function groupToolCallsForExecution(
  calls: { id: string; name: string; input: Record<string, unknown> }[],
): ToolExecGroup[] {
  if (calls.length <= 1) return [{ calls, parallel: false }];
  const groups: ToolExecGroup[] = [];
  let pending: typeof calls = [];
  for (const call of calls) {
    if (PARALLEL_SAFE_TOOLS.has(call.name)) {
      pending.push(call);
    } else {
      if (pending.length > 0) {
        groups.push({ calls: pending, parallel: true });
        pending = [];
      }
      groups.push({ calls: [call], parallel: false });
    }
  }
  if (pending.length > 0) groups.push({ calls: pending, parallel: true });
  return groups;
}

// ============== 主循环 ==============

/**
 * Agent 主循环
 *
 * 对应 pi-agent-core/agent-loop.js → agentLoop()
 * - 同步返回 EventStream（IIFE 模式）
 * - 通过 stream.push() 推送类型化事件
 * - stream.end() 在终止时调用（agent_end / agent_error）
 */
export function runAgentLoop(params: AgentLoopParams): EventStream<MiniAgentEvent, MiniAgentResult> {
  const stream = createMiniAgentStream();

  // 对应 pi-agent-core: IIFE 异步执行循环，同步返回 stream
  (async () => {
    const {
      runId,
      sessionKey,
      agentId,
      currentMessages,
      systemPrompt,
      getToolsForRun,
      toolCtx,
      modelDef,
      streamFn,
      apiKey,
      temperature,
      reasoning,
      maxTurns,
      contextTokens,
      getSteeringMessages,
      getFollowUpMessages,
      appendMessage,
      prepareCompaction,
      abortSignal,
    } = params;

    let { compactionSummary } = params;
    let turns = 0;
    let totalToolCalls = 0;
    let finalText = "";
    let overflowRecoveryLevel = 0; // 0=none, 1=microcompact, 2=llm-compact, 3=emergency-truncation

    // ── Run Metrics 追踪器（借鉴 claude-code） ──
    const runStartMs = Date.now();
    let firstTokenMs: number | null = null;
    let microcompactTotalSavedChars = 0;
    let overflowRecoveries = 0;
    let contextCompactions = 0;
    let toolErrors = 0;
    const toolCallsByName: Record<string, number> = {};

    try {
      // 对应 OpenClaw: 循环开始前检查 steering（用户可能在等待期间输入）
      let pendingMessages = await getSteeringMessages();

      // ========== 外层循环 (follow-ups) ==========
      // 对应 OpenClaw: agent-loop.js outer while(true) loop
      outerLoop: while (true) {
        let hasMoreToolCalls = true;

        // ========== 内层循环 (tools + steering) ==========
        // 对应 OpenClaw: inner while (hasMoreToolCalls || pendingMessages.length > 0)
        while (hasMoreToolCalls || pendingMessages.length > 0) {
          if (turns >= maxTurns) {
            stream.push({ type: "turn_transition", turn: turns, reason: "max_turns_reached" });
            break outerLoop;
          }
          if (abortSignal.aborted) {
            stream.push({ type: "turn_transition", turn: turns, reason: "aborted_by_user" });
            break outerLoop;
          }

          turns++;
          stream.push({ type: "turn_start", turn: turns });

          const toolsForRun = getToolsForRun ? getToolsForRun() : params.toolsForRun;

          // 注入 pending 消息（steering 或 follow-up）
          if (pendingMessages.length > 0) {
            for (const msg of pendingMessages) {
              await appendMessage(sessionKey, msg);
              currentMessages.push(msg);
            }
            pendingMessages = [];
          }

          // ===== MicroCompact: 压缩旧 tool_result（零 LLM 调用） =====
          // 借鉴 claude-code: 每轮 LLM 调用前，自动把已处理过的 tool_result
          // 替换为占位符，大幅减少 token 消耗而不丢失关键信息。
          if (turns > 1) {
            const mcResult = microcompact(currentMessages);
            if (mcResult.compressedCount > 0) {
              currentMessages.splice(0, currentMessages.length, ...mcResult.messages);
              microcompactTotalSavedChars += mcResult.savedChars;
              stream.push({
                type: "microcompact",
                compressedCount: mcResult.compressedCount,
                savedChars: mcResult.savedChars,
              });
            }
          }

          // ===== Prune: 每轮都执行 =====
          const pruneResult = pruneContextMessages({
            messages: currentMessages,
            contextWindowTokens: contextTokens,
          });
          let messagesForModel = pruneResult.messages;
          if (compactionSummary) {
            messagesForModel = [compactionSummary, ...messagesForModel];
          }

          // 构造 pi-ai Context
          const piMessages = convertMessagesToPi(messagesForModel, modelDef);
          const piTools = toolsForRun.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema as any,
          }));
          const piContext: PiContext = {
            systemPrompt,
            messages: piMessages,
            ...(piTools.length > 0 ? { tools: piTools } : {}),
          };

          // ===== 带重试的 LLM 调用 =====
          const assistantContent: ContentBlock[] = [];
          const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
          const turnTextParts: string[] = [];

          try {
            await retryAsync(
              async () => {
                assistantContent.length = 0;
                toolCalls.length = 0;
                turnTextParts.length = 0;

                const streamOpts: SimpleStreamOptions = {
                  maxTokens: modelDef.maxTokens,
                  signal: abortSignal,
                  apiKey,
                  ...(temperature !== undefined ? { temperature } : {}),
                  ...(reasoning ? { reasoning } : {}),
                };
                const eventStream = streamFn(modelDef, piContext, streamOpts);

                for await (const event of eventStream) {
                  if (abortSignal.aborted) break;

                  switch (event.type) {
                    case "thinking_delta":
                      stream.push({ type: "thinking_delta", delta: (event as any).delta });
                      break;

                    case "thinking_end":
                      // thinking 内容保存到 assistant message（对齐 pi-agent-core）
                      // 但不计入 turnTextParts（思考不是最终输出）
                      break;

                    case "text_delta":
                      if (!firstTokenMs) firstTokenMs = Date.now() - runStartMs;
                      stream.push({ type: "message_delta", delta: event.delta });
                      break;

                    case "text_end":
                      turnTextParts.push(event.content);
                      assistantContent.push({ type: "text", text: event.content });
                      break;

                    case "toolcall_start":
                      break;

                    case "toolcall_end": {
                      const tc = event.toolCall;
                      const tcArgs = tc.arguments as Record<string, unknown>;
                      assistantContent.push({
                        type: "tool_use",
                        id: tc.id,
                        name: tc.name,
                        input: tcArgs,
                      });
                      toolCalls.push({
                        id: tc.id,
                        name: tc.name,
                        input: tcArgs,
                      });
                      break;
                    }

                    // pi-ai 的 error 事件: API 错误、网络错误等
                    // AssistantMessageEventStream 将 error 事件 resolve（非 reject），
                    // 必须在这里显式抛出，否则错误被静默吞掉
                    case "error": {
                      const errObj = (event as any).error;
                      const errMsg =
                        errObj?.errorMessage ??
                        (errObj instanceof Error ? errObj.message : null) ??
                        "unknown stream error";
                      throw new Error(`LLM stream error: ${errMsg}`);
                    }
                  }
                }

                const result = eventStream.result();
                await abortable(result, abortSignal);
              },
              {
                attempts: 3,
                minDelayMs: 300,
                maxDelayMs: 30_000,
                jitter: 0.1,
                label: "llm-call",
                shouldRetry: (err) => {
                  if (abortSignal.aborted) return false;
                  return isRateLimitError(describeError(err));
                },
                onRetry: ({ attempt, delay, error }) => {
                  stream.push({ type: "retry", attempt, delay, error: describeError(error) });
                },
              },
            );
          } catch (llmError) {
            // Context overflow → 渐进式恢复（借鉴 claude-code reactive compact）
            //
            // 策略链（每次 overflow 尝试下一级）：
            //   Level 1: microcompact（压缩旧 tool_result，零 LLM 调用）
            //   Level 2: auto-compact（LLM 生成摘要）
            //   Level 3: emergency truncation（直接丢弃旧消息，保留最近 N 条）
            const errorText = describeError(llmError);
            if (isContextOverflowError(errorText) && overflowRecoveryLevel < 3) {
              overflowRecoveryLevel++;
              overflowRecoveries++;
              stream.push({
                type: "context_overflow_compact",
                error: errorText,
                recoveryLevel: overflowRecoveryLevel,
              });

              if (overflowRecoveryLevel === 1) {
                // Level 1: 激进 microcompact（保留更少的 tool_result）
                const mcResult = microcompact(currentMessages, { keepRecentResults: 2, minContentLength: 50 });
                if (mcResult.compressedCount > 0) {
                  currentMessages.splice(0, currentMessages.length, ...mcResult.messages);
                  turns--;
                  continue;
                }
                // microcompact 没效果，升级到 Level 2
                overflowRecoveryLevel = 2;
              }

              if (overflowRecoveryLevel === 2) {
                // Level 2: LLM 摘要压缩
                try {
                  const overflowPrep = await prepareCompaction({
                    messages: currentMessages,
                    sessionKey,
                    runId,
                  });
                  if (overflowPrep.summary && overflowPrep.summaryMessage) {
                    compactionSummary = overflowPrep.summaryMessage;
                    contextCompactions++;
                    turns--;
                    continue;
                  }
                } catch {
                  // LLM compact 也失败了，升级到 Level 3
                  overflowRecoveryLevel = 3;
                }
              }

              if (overflowRecoveryLevel === 3) {
                // Level 3: Emergency truncation — 直接丢弃旧消息，保留最近 6 条
                // 这是最后的兜底，确保 Agent 不会因为上下文溢出而完全崩溃
                const keepCount = Math.min(6, currentMessages.length);
                const dropped = currentMessages.length - keepCount;
                if (dropped > 0) {
                  const kept = currentMessages.slice(-keepCount);
                  currentMessages.splice(0, currentMessages.length, ...kept);
                  stream.push({
                    type: "emergency_truncation",
                    droppedMessages: dropped,
                    keptMessages: keepCount,
                  });
                  turns--;
                  continue;
                }
              }
            }
            throw llmError;
          }

          // 保存 assistant 消息
          const assistantMsg: Message = {
            role: "assistant",
            content: assistantContent,
            timestamp: Date.now(),
          };
          await appendMessage(sessionKey, assistantMsg);
          currentMessages.push(assistantMsg);

          const turnText = turnTextParts.join("");
          if (turnText) {
            stream.push({ type: "message_end", message: assistantMsg, text: turnText });
          }

          hasMoreToolCalls = toolCalls.length > 0;

          // 没有工具调用 → 内层循环结束条件之一
          if (!hasMoreToolCalls) {
            finalText = turnText;
            stream.push({ type: "turn_end", turn: turns });
            // 检查是否有 steering 消息待处理
            pendingMessages = await getSteeringMessages();
            continue;
          }

          // ===== 执行工具（分组并行 + steering 中断检测） =====
          // 只读工具组并行执行（Promise.allSettled），写/副作用工具串行 + 审批
          const toolResults: ContentBlock[] = [];
          let steeringMessages: Message[] | null = null;
          const toolGroups = groupToolCallsForExecution(toolCalls);

          for (const group of toolGroups) {
            if (steeringMessages) {
              for (const call of group.calls) {
                stream.push({ type: "tool_skipped", toolCallId: call.id, toolName: call.name });
                toolResults.push(skipToolCall(call));
              }
              continue;
            }

            if (group.parallel && group.calls.length > 1) {
              // ── 并行执行只读工具组 ──
              for (const call of group.calls) {
                stream.push({ type: "tool_execution_start", toolCallId: call.id, toolName: call.name, args: call.input });
              }
              const settled = await Promise.allSettled(
                group.calls.map(async (call) => {
                  const tool = toolsForRun.find((t) => t.name === call.name);
                  if (!tool) return { text: `未知工具: ${call.name}`, errFlag: true };

                  // PreToolUse hooks
                  if (params.toolHooks) {
                    const { decision, hookName } = await params.toolHooks.runPreHooks({
                      tool, input: call.input, ctx: toolCtx, sessionId: params.sessionKey,
                    });
                    if (decision.action === "block") {
                      return { text: `[${hookName}] ${decision.reason}`, errFlag: true };
                    }
                    if (decision.action === "modify") {
                      call.input = decision.input;
                    }
                  }

                  const startMs = Date.now();
                  let text: string;
                  let errFlag = false;
                  try {
                    text = await tool.execute(call.input, { ...toolCtx, toolCallId: call.id });
                  } catch (err) {
                    text = `执行错误: ${(err as Error).message}`;
                    errFlag = true;
                  }

                  // PostToolUse hooks
                  if (params.toolHooks) {
                    text = await params.toolHooks.runPostHooks({
                      tool, input: call.input, result: text, isError: errFlag,
                      durationMs: Date.now() - startMs, ctx: toolCtx, sessionId: params.sessionKey,
                    });
                  }
                  return { text, errFlag };
                }),
              );
              for (let j = 0; j < group.calls.length; j++) {
                const call = group.calls[j];
                const s = settled[j];
                const { text: result, errFlag: isError } = s.status === "fulfilled"
                  ? s.value
                  : { text: `执行错误: ${String((s as PromiseRejectedResult).reason)}`, errFlag: true };
                totalToolCalls++;
                toolCallsByName[call.name] = (toolCallsByName[call.name] ?? 0) + 1;
                if (isError) toolErrors++;
                stream.push({
                  type: "tool_execution_end",
                  toolCallId: call.id,
                  toolName: call.name,
                  result: result.length > 500 ? `${result.slice(0, 500)}...` : result,
                  isError,
                });
                toolResults.push({ type: "tool_result", tool_use_id: call.id, name: call.name, content: result });
              }
              const steering = await getSteeringMessages();
              if (steering.length > 0) {
                steeringMessages = steering;
                stream.push({ type: "steering", pendingCount: steering.length });
              }
            } else {
              // ── 串行执行（审批检查 + 逐个 steering 检查） ──
              for (let gi = 0; gi < group.calls.length; gi++) {
                const call = group.calls[gi];
                const tool = toolsForRun.find((t) => t.name === call.name);
                let result: string;

                stream.push({ type: "tool_execution_start", toolCallId: call.id, toolName: call.name, args: call.input });

                if (tool) {
                  if (params.checkToolApproval) {
                    const approval = await params.checkToolApproval(call);
                    if (approval !== null) {
                      const decision = approval.decision as "allow-once" | "allow-always" | "deny";
                      stream.push({ type: "tool_approval_request", toolCallId: call.id, toolName: call.name, args: call.input });
                      stream.push({ type: "tool_approval_resolved", toolCallId: call.id, toolName: call.name, decision });
                      if (!approval.approved) {
                        result = "Tool execution denied by user.";
                        totalToolCalls++;
                        stream.push({ type: "tool_execution_end", toolCallId: call.id, toolName: call.name, result, isError: true });
                        toolResults.push({ type: "tool_result", tool_use_id: call.id, name: call.name, content: result });
                        const steering = await getSteeringMessages();
                        if (steering.length > 0) {
                          steeringMessages = steering;
                          for (const skipped of group.calls.slice(gi + 1)) {
                            stream.push({ type: "tool_skipped", toolCallId: skipped.id, toolName: skipped.name });
                            toolResults.push(skipToolCall(skipped));
                          }
                          stream.push({ type: "steering", pendingCount: steering.length });
                        }
                        if (steeringMessages) break;
                        continue;
                      }
                    }
                  }
                  try {
                    // PreToolUse hooks
                    if (params.toolHooks) {
                      const { decision, hookName } = await params.toolHooks.runPreHooks({
                        tool, input: call.input, ctx: toolCtx, sessionId: params.sessionKey,
                      });
                      if (decision.action === "block") {
                        result = `[${hookName}] ${decision.reason}`;
                        totalToolCalls++;
                        toolCallsByName[call.name] = (toolCallsByName[call.name] ?? 0) + 1;
                        toolErrors++;
                        stream.push({ type: "tool_execution_end", toolCallId: call.id, toolName: call.name, result, isError: true });
                        toolResults.push({ type: "tool_result", tool_use_id: call.id, name: call.name, content: result });
                        const steering = await getSteeringMessages();
                        if (steering.length > 0) { steeringMessages = steering; pendingMessages = steering; }
                        if (steeringMessages) break;
                        continue;
                      }
                      if (decision.action === "modify") {
                        call.input = decision.input;
                      }
                    }

                    const toolStartMs = Date.now();
                    result = await tool.execute(call.input, { ...toolCtx, toolCallId: call.id });

                    // PostToolUse hooks
                    if (params.toolHooks) {
                      result = await params.toolHooks.runPostHooks({
                        tool, input: call.input, result, isError: false,
                        durationMs: Date.now() - toolStartMs, ctx: toolCtx, sessionId: params.sessionKey,
                      });
                    }
                  } catch (err) {
                    result = `执行错误: ${(err as Error).message}`;
                  }
                } else {
                  result = `未知工具: ${call.name}`;
                }

                totalToolCalls++;
                toolCallsByName[call.name] = (toolCallsByName[call.name] ?? 0) + 1;
                const isError = !tool || result.startsWith("执行错误:") || result.startsWith("未知工具:");
                if (isError) toolErrors++;
                stream.push({
                  type: "tool_execution_end",
                  toolCallId: call.id,
                  toolName: call.name,
                  result: result.length > 500 ? `${result.slice(0, 500)}...` : result,
                  isError,
                });
                toolResults.push({ type: "tool_result", tool_use_id: call.id, name: call.name, content: result });

                const steering = await getSteeringMessages();
                if (steering.length > 0) {
                  steeringMessages = steering;
                  for (const skipped of group.calls.slice(gi + 1)) {
                    stream.push({ type: "tool_skipped", toolCallId: skipped.id, toolName: skipped.name });
                    toolResults.push(skipToolCall(skipped));
                  }
                  stream.push({ type: "steering", pendingCount: steering.length });
                  break;
                }
              }
            }
          }

          // 添加工具结果（含 skip 结果）
          const resultMsg: Message = {
            role: "user",
            content: toolResults,
            timestamp: Date.now(),
          };
          await appendMessage(sessionKey, resultMsg);
          currentMessages.push(resultMsg);

          stream.push({ type: "turn_end", turn: turns });

          // 对应 OpenClaw: steering 消息设为 pendingMessages，下一轮注入
          if (steeringMessages && steeringMessages.length > 0) {
            pendingMessages = steeringMessages;
          } else {
            pendingMessages = await getSteeringMessages();
          }
        }
        // ========== 内层循环结束 ==========

        // 对应 OpenClaw: 检查 follow-up 消息
        if (getFollowUpMessages) {
          const followUp = await getFollowUpMessages();
          if (followUp.length > 0) {
            pendingMessages = followUp;
            continue;
          }
        }
        break;
      }
      // ========== 外层循环结束 ==========

      // 发射 run_metrics 事件（借鉴 claude-code run_complete）
      stream.push({
        type: "run_metrics",
        metrics: {
          runId,
          sessionKey,
          totalTurns: turns,
          totalToolCalls,
          toolCallsByName,
          toolErrors,
          microcompactSavedChars: microcompactTotalSavedChars,
          overflowRecoveries,
          totalDurationMs: Date.now() - runStartMs,
          firstTokenMs,
          contextCompactions,
        },
      });

      stream.push({ type: "agent_end", runId, messages: currentMessages });
      stream.end({ finalText, turns, totalToolCalls, messages: currentMessages });
    } catch (err) {
      stream.push({ type: "agent_error", runId, error: describeError(err) });
      stream.end({ finalText, turns, totalToolCalls, messages: currentMessages });
    }
  })();

  return stream;
}
