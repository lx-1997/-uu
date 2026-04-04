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
  StopReason,
} from "@mariozechner/pi-ai";
import {
  retryAsync,
  isContextOverflowError,
  isRateLimitError,
  isTransientError,
  describeError,
} from "./provider/errors.js";
import { truncateToolOutput } from "./context/tool-output-truncate.js";
import { resolveToolFollowupBypassCap } from "../rdkclaw/max-agent-turns.js";
import {
  pruneContextMessages,
  invalidateStaleReadToolResults,
  snipTailOversizedToolResults,
} from "./context/index.js";
import { microcompact, type MicroCompactConfig } from "./context/microcompact.js";
import { createMiniAgentStream, type MiniAgentEvent, type MiniAgentResult } from "./agent-events.js";
import { abortable, combineAbortSignals } from "./tools/abort.js";
import { convertMessagesToPi } from "./message-convert.js";
import {
  createInlineThinkingRouter,
  splitThinkingTagsFromAssistantText,
} from "./inline-thinking-stream.js";
import type { ToolHookRegistry } from "./tool-hooks.js";
import type { CompactHookRegistry } from "./compact-hooks.js";
import {
  getEffectiveContextWindowTokens,
  getProactiveCompactThreshold,
  getContextWarningThreshold,
  shouldProactiveCompactByWindowEconomics,
} from "./context/window-economics.js";
import { estimateMessagesTokens, estimateTokensForText } from "./context/tokens.js";
import { shouldTriggerCompaction } from "./context/index.js";
import {
  runPreToolHookChain,
  validateToolInputObject,
} from "./tool-pipeline.js";
import { SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS } from "../ssh.js";
import { LOAD_TOOLS_META_NAME } from "./tools/load-tools-meta.js";

/**
 * 单次 LLM 流式调用中，若始终收不到任何流事件，则主动中止，避免无限卡住。
 * 默认关闭（0），与上游 pi-ai 行为一致；需要时再设环境变量 RDKCLAW_LLM_FIRST_CHUNK_TIMEOUT_MS（毫秒），例如 180000。
 */
function resolveLlmFirstChunkTimeoutMs(): number {
  const raw = process.env.RDKCLAW_LLM_FIRST_CHUNK_TIMEOUT_MS;
  if (!raw || !String(raw).trim()) return 0;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(3_600_000, Math.max(0, n));
}

/** 首包超时错误：不应按「瞬时故障」重试整段 LLM 调用（否则用户要等 N×超时） */
class LlmFirstChunkTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmFirstChunkTimeoutError";
  }
}

function isLlmFirstChunkTimeoutError(err: unknown): boolean {
  return err instanceof LlmFirstChunkTimeoutError;
}

/**
 * 部分厂商/模型把用户可见内容只放在 extended thinking 通道，正文 text 为空。
 * thinking_end 落盘为 `<thinking>...</thinking>`，此处抽出作 stream message_end 与 finalText，避免 Studio 主气泡空白。
 */
function extractVisibleTextFromThinkingBlocks(content: ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type !== "text" || typeof block.text !== "string") continue;
    const { thinkingBodies } = splitThinkingTagsFromAssistantText(block.text);
    for (const b of thinkingBodies) {
      const t = b.trim();
      if (t) parts.push(t);
    }
  }
  return parts.join("\n\n");
}

const MESSAGE_DELTA_CATCHUP_CHUNK = 96;

async function pushMessageDeltaCatchup(
  stream: { push: (e: MiniAgentEvent) => void },
  text: string,
  signal: AbortSignal,
): Promise<void> {
  if (!text) return;
  const step = MESSAGE_DELTA_CATCHUP_CHUNK;
  for (let i = 0; i < text.length; i += step) {
    if (signal.aborted) break;
    const delta = text.slice(i, i + step);
    if (delta) stream.push({ type: "message_delta", delta });
    if (i + step < text.length) {
      await new Promise<void>((r) => setImmediate(r));
    }
  }
}

async function pushThinkingDeltaCatchup(
  stream: { push: (e: MiniAgentEvent) => void },
  body: string,
  signal: AbortSignal,
): Promise<void> {
  if (!body || signal.aborted) return;
  const step = 72;
  for (let i = 0; i < body.length; i += step) {
    if (signal.aborted) break;
    const delta = body.slice(i, i + step);
    if (delta) stream.push({ type: "thinking_delta", delta });
    if (i + step < body.length) {
      await new Promise<void>((r) => setImmediate(r));
    }
  }
}

/**
 * 推给前端的 tool 结果预览：原先统一 500 字截断会导致 `{"__type":"image_download",...}` 解析失败，
 * 聊天气泡内嵌图片不出现；结构化 JSON 放宽上限（上下文仍用截断后的 truncatedResult）。
 */
function formatToolResultForSsePreview(truncatedResult: string, isError: boolean): string {
  if (isError) {
    return truncatedResult.length > 500 ? `${truncatedResult.slice(0, 500)}...` : truncatedResult;
  }
  const trimmed = truncatedResult.trimStart();
  if (trimmed.startsWith("{") && trimmed.includes('"__type"')) {
    const max = 12_000;
    return truncatedResult.length > max ? `${truncatedResult.slice(0, max)}...` : truncatedResult;
  }
  return truncatedResult.length > 500 ? `${truncatedResult.slice(0, 500)}...` : truncatedResult;
}

/** pi-ai 未在 SimpleStreamOptions 声明 top_p，通过 onPayload 注入 OpenAI/Anthropic 请求体 */
function chainTopPOnPayload(
  topP: number,
  existing?: SimpleStreamOptions["onPayload"],
): SimpleStreamOptions["onPayload"] {
  return (payload: unknown) => {
    if (payload && typeof payload === "object") {
      (payload as Record<string, unknown>).top_p = topP;
    }
    existing?.(payload);
  };
}

// ============== 类型定义 ==============

export interface AgentLoopParams {
  runId: string;
  sessionKey: string;
  agentId: string;
  /** 可变: 循环中会 push 新消息 */
  currentMessages: Message[];
  compactionSummary: Message | undefined;
  systemPrompt: string;
  /**
   * Anthropic：stable / dynamic 两段 system（pi-ai `systemPromptParts`），用于前缀 prompt caching。
   */
  systemPromptParts?: { stable: string; dynamic: string };
  toolsForRun: Tool[];
  /** 若提供，则每个 LLM 回合前重新获取工具列表（支持对话中连接设备后注入板端工具） */
  getToolsForRun?: () => Tool[];
  toolCtx: ToolContext;
  modelDef: Model<any>;
  streamFn: StreamFunction;
  apiKey?: string;
  temperature?: number;
  /** nucleus sampling，与 temperature 独立；经 onPayload 写入 top_p */
  topP?: number;
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
  /** 模型 max_output，用于有效上下文窗口经济学 */
  maxOutputTokens?: number;
  /** Compaction 生命周期 hooks */
  compactHooks?: CompactHookRegistry;
  /** 遥测：系统提示 hash 与分层数（由 Agent 传入） */
  systemPromptMeta?: { hashShort: string; layerCount: number };
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
  /** 可与 web_search 同轮并行拉文档+检索 */
  "web_search",
  "web_fetch",
  "web_extract",
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
  const ordered = partitionLoadToolsFirst(calls);
  if (ordered.length <= 1) return [{ calls: ordered, parallel: false }];
  const groups: ToolExecGroup[] = [];
  let pending: typeof ordered = [];
  for (const call of ordered) {
    if (call.name === LOAD_TOOLS_META_NAME) {
      if (pending.length > 0) {
        groups.push({ calls: pending, parallel: true });
        pending = [];
      }
      groups.push({ calls: [call], parallel: false });
      continue;
    }
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

/** 当前已解析的 tool_calls 前缀是否全是并行安全工具，且均已在本轮 API 的 tools 列表中（延迟加载工具未登记前不可抢先执行） */
function earlyParallelPrefixEligible(
  calls: { id: string; name: string; input: Record<string, unknown> }[],
  toolsForRun: Tool[],
): boolean {
  if (calls.length === 0) return false;
  const available = new Set(toolsForRun.map((t) => t.name));
  for (const c of calls) {
    if (!PARALLEL_SAFE_TOOLS.has(c.name)) return false;
    if (!available.has(c.name)) return false;
  }
  return true;
}

/** load_tools 登记的工具须在下一次 getToolsForRun() 后才可执行；同轮内将其固定排在最前并单独成组，避免与依赖它的工具并行竞态 */
function partitionLoadToolsFirst(
  calls: { id: string; name: string; input: Record<string, unknown> }[],
): typeof calls {
  const loads = calls.filter((c) => c.name === LOAD_TOOLS_META_NAME);
  const rest = calls.filter((c) => c.name !== LOAD_TOOLS_META_NAME);
  return [...loads, ...rest];
}

/** 单并行安全工具执行（与内层 Promise.allSettled 路径共享逻辑） */
async function runParallelSafeToolCall(
  call: { id: string; name: string; input: Record<string, unknown> },
  deps: {
    toolsForRun: Tool[];
    toolCtx: ToolContext;
    sessionKey: string;
    toolHooks?: ToolHookRegistry;
  },
): Promise<{ text: string; errFlag: boolean }> {
  const tool = deps.toolsForRun.find((t) => t.name === call.name);
  if (!tool) return { text: `未知工具: ${call.name}`, errFlag: true };

  const schemaCheck = validateToolInputObject(tool, call.input);
  if (!schemaCheck.ok) return { text: schemaCheck.message, errFlag: true };

  const hooked = await runPreToolHookChain(call.name, schemaCheck.value, deps.sessionKey);
  if (!hooked.ok) return { text: hooked.message, errFlag: true };
  call.input = hooked.input;

  if (deps.toolHooks) {
    const { decision, hookName } = await deps.toolHooks.runPreHooks({
      tool,
      input: call.input,
      ctx: deps.toolCtx,
      sessionId: deps.sessionKey,
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
  let reachedExecute = false;
  try {
    reachedExecute = true;
    text = await tool.execute(call.input, { ...deps.toolCtx, toolCallId: call.id });
  } catch (err) {
    text = `执行错误: ${(err as Error).message}`;
    errFlag = true;
  }

  if (deps.toolHooks) {
    text = await deps.toolHooks.runPostHooks({
      tool,
      input: call.input,
      result: text,
      isError: errFlag,
      durationMs: Date.now() - startMs,
      ctx: deps.toolCtx,
      sessionId: deps.sessionKey,
    });
  }
  if (errFlag && deps.toolHooks && reachedExecute) {
    text = await deps.toolHooks.runPostFailureHooks({
      tool,
      input: call.input,
      result: text,
      durationMs: Date.now() - startMs,
      ctx: deps.toolCtx,
      sessionId: deps.sessionKey,
    });
  }
  return { text, errFlag };
}

/** 上下文末尾是否为「刚写入的工具结果」user 消息，尚缺一次模型调用来读结果并回复用户 */
export function lastMessageNeedsToolFollowUpLlm(messages: Message[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return false;
  const c = last.content;
  if (!Array.isArray(c)) return false;
  return c.some((b) => b && typeof b === "object" && (b as { type?: string }).type === "tool_result");
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
      systemPromptParts,
      getToolsForRun,
      toolCtx,
      modelDef,
      streamFn,
      apiKey,
      temperature,
      topP,
      reasoning,
      maxTurns,
      contextTokens,
      getSteeringMessages,
      getFollowUpMessages,
      appendMessage,
      prepareCompaction,
      abortSignal,
      maxOutputTokens: maxOutputTokensParam,
      compactHooks,
      systemPromptMeta,
    } = params;

    let { compactionSummary } = params;
    let turns = 0;
    /** 已超过 maxTurns 后，因末尾仍有 tool_result 而额外放行的 LLM 次数（防止长工具链在触顶后突然断在「下一步」话术中间） */
    let postLimitToolFollowUpsUsed = 0;
    const toolFollowupBypassCap = resolveToolFollowupBypassCap(maxTurns);
    let totalToolCalls = 0;
    let finalText = "";
    let overflowRecoveryLevel = 0; // 0=none, 1=microcompact, 2=llm-compact, 3=emergency-truncation
    /** Level 2 的 prepareCompaction 连续失败次数 → 熔断后跳过 LLM 摘要 */
    let llmCompactionFailureStreak = 0;
    let skipLlmCompactionOnOverflow = false;

    /** max_tokens 输出截断自动续写（每 run 最多 3 次） */
    const MAX_OUTPUT_CONTINUATIONS = 3;
    let outputContinuationCount = 0;

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
        let proactiveCompactionAttempted = false;
        let hasMoreToolCalls = true;

        // ========== 内层循环 (tools + steering) ==========
        // 对应 OpenClaw: inner while (hasMoreToolCalls || pendingMessages.length > 0)
        while (hasMoreToolCalls || pendingMessages.length > 0) {
          if (turns >= maxTurns) {
            // 达到轮次上限时，若末尾仍是 tool_result 的 user 消息，必须再跑模型读结果（可能多轮：触顶后模型仍会继续 device_exec 等）。
            // 仅放行 turns===maxTurns 不够：第二轮工具后 turns 已是 maxTurns+1，会在此处被误杀，表现为正文停在「接下来要…：」且永远没有后续工具/总结。
            const needsToolFollow = lastMessageNeedsToolFollowUpLlm(currentMessages);
            if (needsToolFollow && postLimitToolFollowUpsUsed < toolFollowupBypassCap) {
              postLimitToolFollowUpsUsed += 1;
            } else {
              stream.push({
                type: "turn_transition",
                turn: turns,
                reason: needsToolFollow ? "tool_followup_cap_reached" : "max_turns_reached",
              });
              break outerLoop;
            }
          }
          if (abortSignal.aborted) {
            stream.push({ type: "turn_transition", turn: turns, reason: "aborted_by_user" });
            break outerLoop;
          }

          turns++;
          stream.push({ type: "turn_start", turn: turns });

          let toolsForRun = getToolsForRun ? getToolsForRun() : params.toolsForRun;

          // 注入 pending 消息（steering 或 follow-up）
          if (pendingMessages.length > 0) {
            for (const msg of pendingMessages) {
              await appendMessage(sessionKey, msg);
              currentMessages.push(msg);
            }
            pendingMessages = [];
          }

          const maxOut = maxOutputTokensParam ?? modelDef.maxTokens ?? 8192;
          const effectiveContextTokens = getEffectiveContextWindowTokens(contextTokens, maxOut);
          const estPromptTokens =
            estimateMessagesTokens(currentMessages) + estimateTokensForText(systemPrompt);
          const proactiveLine = getProactiveCompactThreshold(effectiveContextTokens);
          const warnLine = getContextWarningThreshold(effectiveContextTokens);

          // ===== 失效旧读取 + 尾段超长截断 + 自适应 MicroCompact（零 LLM） =====
          // 长上下文：靠近主动压缩线时加强 microcompact；预警带内对近尾超长 tool_result 先单行截断。
          if (turns > 1) {
            const staleInv = invalidateStaleReadToolResults(currentMessages);
            if (staleInv.savedChars > 0) {
              currentMessages.splice(0, currentMessages.length, ...staleInv.messages);
              microcompactTotalSavedChars += staleInv.savedChars;
              stream.push({
                type: "stale_read_invalidate",
                invalidatedCount: staleInv.invalidatedCount,
                savedChars: staleInv.savedChars,
              });
            }
            if (estPromptTokens >= warnLine) {
              const tailSnip = snipTailOversizedToolResults(currentMessages);
              if (tailSnip.savedChars > 0) {
                currentMessages.splice(0, currentMessages.length, ...tailSnip.messages);
                microcompactTotalSavedChars += tailSnip.savedChars;
                stream.push({
                  type: "tail_tool_snip",
                  snippedCount: tailSnip.snippedCount,
                  savedChars: tailSnip.savedChars,
                });
              }
            }
            const mcOpts: Partial<MicroCompactConfig> = {};
            if (estPromptTokens >= proactiveLine - 2_500) {
              mcOpts.keepRecentResults = 2;
              mcOpts.minContentLength = 50;
            } else if (estPromptTokens >= warnLine) {
              mcOpts.keepRecentResults = 4;
              mcOpts.minContentLength = 100;
            }
            const mcResult = microcompact(currentMessages, mcOpts);
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

          // ===== 主动压缩（窗口经济学）：在 API 报 overflow 前触发 LLM 摘要 =====
          if (
            !proactiveCompactionAttempted &&
            turns >= 2 &&
            !abortSignal.aborted &&
            shouldProactiveCompactByWindowEconomics({
              estimatedPromptTokens:
                estimateMessagesTokens(currentMessages) + estimateTokensForText(systemPrompt),
              effectiveContextWindowTokens: effectiveContextTokens,
            }) &&
            shouldTriggerCompaction({
              messages: currentMessages,
              contextWindowTokens: effectiveContextTokens,
            })
          ) {
            proactiveCompactionAttempted = true;
            try {
              await compactHooks?.runPreHooks({
                sessionKey,
                runId,
                messages: currentMessages,
                reason: "proactive",
              });
              const prep = await prepareCompaction({
                messages: currentMessages,
                sessionKey,
                runId,
              });
              await compactHooks?.runPostHooks({
                sessionKey,
                runId,
                summaryChars: prep.summary?.length ?? 0,
                droppedMessages: 0,
                reason: "proactive",
                success: Boolean(prep.summary && prep.summaryMessage),
              });
              if (prep.summary && prep.summaryMessage) {
                compactionSummary = prep.summaryMessage;
                contextCompactions++;
                stream.push({
                  type: "proactive_compaction",
                  estimatedTokens:
                    estimateMessagesTokens(currentMessages) + estimateTokensForText(systemPrompt),
                  threshold: getProactiveCompactThreshold(effectiveContextTokens),
                  effectiveContextTokens,
                });
                turns--;
                continue;
              }
            } catch (pe) {
              console.warn("[agent-loop] proactive compaction failed:", describeError(pe));
            }
          }

          // ===== Prune: 每轮都执行（使用有效上下文上限） =====
          const pruneResult = pruneContextMessages({
            messages: currentMessages,
            contextWindowTokens: effectiveContextTokens,
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
            ...(systemPromptParts && modelDef.api === "anthropic-messages"
              ? { systemPromptParts }
              : {}),
          };

          // ===== 带重试的 LLM 调用 =====
          const assistantContent: ContentBlock[] = [];
          const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
          const turnTextParts: string[] = [];
          let currentThinkingParts: string[] | null = null;
          /** 本轮 LLM 流结束原因（来自 pi-ai AssistantMessage.stopReason） */
          let streamStopReason: StopReason | undefined;
          /** 流式解析中与网络重叠执行的并行安全工具（claude-code StreamingToolExecutor 思路） */
          const earlyParallelPromises = new Map<string, Promise<{ text: string; errFlag: boolean }>>();

          try {
            await retryAsync(
              async () => {
                assistantContent.length = 0;
                toolCalls.length = 0;
                turnTextParts.length = 0;
                streamStopReason = undefined;
                earlyParallelPromises.clear();

                const inlineThinking = createInlineThinkingRouter();
                /** 已推给前端的「可见正文」累计；用于对比 text_end 终包，避免仅终包才有 message_delta */
                let streamedVisibleAccum = "";
                /** 是否有任何 thinking_delta 已下发（含原生通道与正文内联拆分） */
                let thinkingStreamedToClient = false;
                const markThinkingStreamed = (delta: unknown) => {
                  if (String(delta ?? "").length > 0) thinkingStreamedToClient = true;
                };

                const firstChunkBudgetMs = resolveLlmFirstChunkTimeoutMs();
                const firstChunkCtrl = new AbortController();
                let firstChunkTimer: ReturnType<typeof setTimeout> | null = null;
                let firstChunkTimedOut = false;
                const clearFirstChunkTimer = () => {
                  if (firstChunkTimer != null) {
                    clearTimeout(firstChunkTimer);
                    firstChunkTimer = null;
                  }
                };
                if (firstChunkBudgetMs > 0) {
                  firstChunkTimer = setTimeout(() => {
                    firstChunkTimedOut = true;
                    clearFirstChunkTimer();
                    try {
                      firstChunkCtrl.abort();
                    } catch {
                      /* noop */
                    }
                  }, firstChunkBudgetMs);
                }
                const streamSignal = combineAbortSignals(abortSignal, firstChunkCtrl.signal) ?? abortSignal;

                try {
                const streamOpts: SimpleStreamOptions = {
                  maxTokens: modelDef.maxTokens,
                  signal: streamSignal,
                  apiKey,
                  ...(temperature !== undefined ? { temperature } : {}),
                  ...(reasoning ? { reasoning } : {}),
                  ...(topP !== undefined ? { onPayload: chainTopPOnPayload(topP) } : {}),
                };
                const eventStream = streamFn(modelDef, piContext, streamOpts);

                for await (const event of eventStream) {
                  if (abortSignal.aborted) break;
                  // 任意流事件均视为「首包已到」：pi-ai 还会发 text_start / thinking_start / toolcall_delta 等
                  clearFirstChunkTimer();

                  switch (event.type) {
                    case "thinking_delta": {
                      const td = (event as any).delta;
                      markThinkingStreamed(td);
                      stream.push({ type: "thinking_delta", delta: td });
                      if (!currentThinkingParts) currentThinkingParts = [];
                      currentThinkingParts.push((event as any).delta);
                      break;
                    }

                    case "thinking_end":
                      // 将 thinking 内容持久化到 assistant message
                      // 这样多轮对话中 LLM 可以回顾自己之前的推理过程
                      if (currentThinkingParts && currentThinkingParts.length > 0) {
                        const thinkingText = currentThinkingParts.join("");
                        if (thinkingText.trim()) {
                          assistantContent.push({ type: "text", text: `<thinking>\n${thinkingText}\n</thinking>` });
                        }
                        currentThinkingParts = null;
                      }
                      break;

                    case "text_delta": {
                      const routed = inlineThinking.push(event.delta);
                      if (routed.thinking.length > 0 || routed.message.length > 0) {
                        if (!firstTokenMs) firstTokenMs = Date.now() - runStartMs;
                      }
                      for (const th of routed.thinking) {
                        markThinkingStreamed(th);
                        stream.push({ type: "thinking_delta", delta: th });
                        if (!currentThinkingParts) currentThinkingParts = [];
                        currentThinkingParts.push(th);
                      }
                      for (const msg of routed.message) {
                        stream.push({ type: "message_delta", delta: msg });
                        streamedVisibleAccum += msg;
                      }
                      break;
                    }

                    case "text_end": {
                      const raw = String(event.content ?? "");
                      const { thinkingBodies, visible } = splitThinkingTagsFromAssistantText(raw);

                      for (const body of thinkingBodies) {
                        assistantContent.push({
                          type: "text",
                          text: `<thinking>\n${body}\n</thinking>`,
                        });
                      }

                      if (thinkingBodies.length > 0) {
                        currentThinkingParts = null;
                      } else if (currentThinkingParts && currentThinkingParts.length > 0) {
                        const thinkingText = currentThinkingParts.join("").trim();
                        if (thinkingText) {
                          assistantContent.push({
                            type: "text",
                            text: `<thinking>\n${thinkingText}\n</thinking>`,
                          });
                        }
                        currentThinkingParts = null;
                      } else {
                        currentThinkingParts = null;
                      }

                      if (visible.trim()) {
                        assistantContent.push({ type: "text", text: visible });
                      }
                      turnTextParts.push(visible);

                      if (
                        !thinkingStreamedToClient &&
                        thinkingBodies.length > 0 &&
                        !abortSignal.aborted
                      ) {
                        for (const body of thinkingBodies) {
                          if (!body || abortSignal.aborted) continue;
                          await pushThinkingDeltaCatchup(stream, body, abortSignal);
                          thinkingStreamedToClient = true;
                        }
                      }

                      let catchUp = "";
                      if (visible === streamedVisibleAccum) {
                        catchUp = "";
                      } else if (visible.startsWith(streamedVisibleAccum)) {
                        catchUp = visible.slice(streamedVisibleAccum.length);
                      } else if (!streamedVisibleAccum.trim()) {
                        catchUp = visible;
                      }

                      if (catchUp && !abortSignal.aborted) {
                        if (!firstTokenMs) firstTokenMs = Date.now() - runStartMs;
                        await pushMessageDeltaCatchup(stream, catchUp, abortSignal);
                      }

                      streamedVisibleAccum = "";
                      inlineThinking.reset();
                      /** 下一轮正文段重新判定是否需 thinking 终包补推 */
                      thinkingStreamedToClient = false;
                      break;
                    }

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
                      if (earlyParallelPrefixEligible(toolCalls, toolsForRun)) {
                        const last = toolCalls[toolCalls.length - 1];
                        if (!earlyParallelPromises.has(last.id)) {
                          earlyParallelPromises.set(
                            last.id,
                            runParallelSafeToolCall(last, {
                              toolsForRun,
                              toolCtx,
                              sessionKey,
                              toolHooks: params.toolHooks,
                            }),
                          );
                        }
                      }
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

                const orphan = inlineThinking.end();
                for (const th of orphan.thinking) {
                  markThinkingStreamed(th);
                  stream.push({ type: "thinking_delta", delta: th });
                  if (!currentThinkingParts) currentThinkingParts = [];
                  currentThinkingParts.push(th);
                }
                for (const msg of orphan.message) {
                  if (!firstTokenMs) firstTokenMs = Date.now() - runStartMs;
                  stream.push({ type: "message_delta", delta: msg });
                  streamedVisibleAccum += msg;
                }
                if (currentThinkingParts && currentThinkingParts.length > 0) {
                  const t = currentThinkingParts.join("").trim();
                  if (t) {
                    assistantContent.push({ type: "text", text: `<thinking>\n${t}\n</thinking>` });
                  }
                  currentThinkingParts = null;
                }
                if (streamedVisibleAccum.trim()) {
                  assistantContent.push({ type: "text", text: streamedVisibleAccum });
                  turnTextParts.push(streamedVisibleAccum);
                }
                streamedVisibleAccum = "";

                clearFirstChunkTimer();
                const piAssistant = await abortable(eventStream.result(), abortSignal);
                streamStopReason = piAssistant.stopReason;
                } catch (streamErr) {
                  clearFirstChunkTimer();
                  if (firstChunkTimedOut && !abortSignal.aborted) {
                    throw new LlmFirstChunkTimeoutError(
                      `LLM 在 ${Math.round(firstChunkBudgetMs / 1000)} 秒内没有任何流式输出（含思考）。请检查网络/代理、Base URL、API Key 与模型是否可用；或尝试关闭扩展思考、更换模型后再试。`,
                    );
                  }
                  throw streamErr;
                } finally {
                  clearFirstChunkTimer();
                }
              },
              {
                attempts: 3,
                minDelayMs: 300,
                maxDelayMs: 30_000,
                jitter: 0.25,
                label: "llm-call",
                shouldRetry: (err) => {
                  if (abortSignal.aborted) return false;
                  if (isLlmFirstChunkTimeoutError(err)) return false;
                  // 借鉴 claude-code: rate_limit + timeout + 网络错误 + 5xx 都重试
                  return isTransientError(describeError(err));
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
                // Level 1: 剔除过时读取 + 激进 microcompact（零 LLM）
                let recovered = false;
                const staleOv = invalidateStaleReadToolResults(currentMessages);
                if (staleOv.savedChars > 0) {
                  currentMessages.splice(0, currentMessages.length, ...staleOv.messages);
                  microcompactTotalSavedChars += staleOv.savedChars;
                  stream.push({
                    type: "stale_read_invalidate",
                    invalidatedCount: staleOv.invalidatedCount,
                    savedChars: staleOv.savedChars,
                  });
                  recovered = true;
                }
                const mcResult = microcompact(currentMessages, {
                  keepRecentResults: 2,
                  minContentLength: 50,
                });
                if (mcResult.compressedCount > 0) {
                  currentMessages.splice(0, currentMessages.length, ...mcResult.messages);
                  microcompactTotalSavedChars += mcResult.savedChars;
                  stream.push({
                    type: "microcompact",
                    compressedCount: mcResult.compressedCount,
                    savedChars: mcResult.savedChars,
                  });
                  recovered = true;
                }
                if (recovered) {
                  turns--;
                  continue;
                }
                overflowRecoveryLevel = 2;
              }

              if (overflowRecoveryLevel === 2) {
                if (skipLlmCompactionOnOverflow) {
                  overflowRecoveryLevel = 3;
                } else {
                  // Level 2: LLM 摘要压缩
                  try {
                    await compactHooks?.runPreHooks({
                      sessionKey,
                      runId,
                      messages: currentMessages,
                      reason: "overflow",
                    });
                    const overflowPrep = await prepareCompaction({
                      messages: currentMessages,
                      sessionKey,
                      runId,
                    });
                    await compactHooks?.runPostHooks({
                      sessionKey,
                      runId,
                      summaryChars: overflowPrep.summary?.length ?? 0,
                      droppedMessages: 0,
                      reason: "overflow",
                      success: Boolean(overflowPrep.summary && overflowPrep.summaryMessage),
                    });
                    if (overflowPrep.summary && overflowPrep.summaryMessage) {
                      compactionSummary = overflowPrep.summaryMessage;
                      contextCompactions++;
                      llmCompactionFailureStreak = 0;
                      // 成功恢复后重置 level，让下次 overflow 从 Level 1 重新开始
                      overflowRecoveryLevel = 0;
                      turns--;
                      continue;
                    }
                  } catch (compactErr) {
                    llmCompactionFailureStreak++;
                    console.warn(
                      "[agent-loop] prepareCompaction failed during overflow recovery:",
                      describeError(compactErr),
                    );
                    if (llmCompactionFailureStreak >= 2) {
                      skipLlmCompactionOnOverflow = true;
                      stream.push({ type: "compaction_fuse", failures: llmCompactionFailureStreak });
                    }
                    overflowRecoveryLevel = 3;
                  }
                }
              }

              if (overflowRecoveryLevel === 3) {
                // Level 3: Emergency truncation — 先保留最近 6 条；若仍无法丢消息则收紧到 3 条/1 条
                let keepCount = Math.min(6, currentMessages.length);
                let dropped = currentMessages.length - keepCount;
                if (dropped === 0 && currentMessages.length > 3) {
                  keepCount = Math.min(3, currentMessages.length);
                  dropped = currentMessages.length - keepCount;
                }
                if (dropped === 0 && currentMessages.length > 1) {
                  keepCount = 1;
                  dropped = currentMessages.length - keepCount;
                }
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
          const turnTrim = turnText.trim();
          const thinkingFallback = turnTrim ? "" : extractVisibleTextFromThinkingBlocks(assistantContent);
          const visibleAssistantText = turnTrim || thinkingFallback;
          /** 必须始终下发 message_end，否则前端无法结束 message_end 回填逻辑（纯 thinking 流时 turnText 曾为空被跳过） */
          stream.push({ type: "message_end", message: assistantMsg, text: visibleAssistantText });

          // max_tokens 截断续写（pi-ai stopReason === "length"，纯文本无工具调用）
          if (
            streamStopReason === "length" &&
            toolCalls.length === 0 &&
            outputContinuationCount < MAX_OUTPUT_CONTINUATIONS &&
            !abortSignal.aborted
          ) {
            const steer = await getSteeringMessages();
            if (steer.length === 0) {
              outputContinuationCount++;
              stream.push({
                type: "output_continuation",
                attempt: outputContinuationCount,
                maxAttempts: MAX_OUTPUT_CONTINUATIONS,
              });
              pendingMessages = [{
                role: "user",
                content: [{
                  type: "text",
                  text: "[系统提示] 你的上一次回复因输出长度上限（max_tokens）被截断。请从截断处继续写完，不要重复已输出的内容。",
                }],
                timestamp: Date.now(),
              }];
              stream.push({ type: "turn_end", turn: turns });
              continue;
            }
          }

          hasMoreToolCalls = toolCalls.length > 0;

          // 没有工具调用 → 内层循环结束条件之一
          if (!hasMoreToolCalls) {
            finalText = visibleAssistantText;
            // 空回复检测：LLM 没有输出任何文本也没有调用工具
            // 借鉴 claude-code: 空回复时注入提示让 LLM 重新生成
            if (!finalText.trim() && turns < maxTurns - 1) {
              pendingMessages = await getSteeringMessages();
              if (pendingMessages.length === 0) {
                // 注入一条系统提示，让 LLM 重新回答
                pendingMessages = [{
                  role: "user",
                  content: [{ type: "text", text: "[系统提示] 你的上一次回复为空。请重新回答用户的问题。" }],
                  timestamp: Date.now(),
                }];
              }
              continue;
            }
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
            if (getToolsForRun) {
              toolsForRun = getToolsForRun();
            } else {
              toolsForRun = params.toolsForRun;
            }
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
                  const pre = earlyParallelPromises.get(call.id);
                  if (pre) return pre;
                  return runParallelSafeToolCall(call, {
                    toolsForRun,
                    toolCtx,
                    sessionKey,
                    toolHooks: params.toolHooks,
                  });
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

                // 工具输出截断保护（并行路径）
                const truncatedResult = isError ? result : truncateToolOutput(call.name, result);

                stream.push({
                  type: "tool_execution_end",
                  toolCallId: call.id,
                  toolName: call.name,
                  result: formatToolResultForSsePreview(truncatedResult, isError),
                  isError,
                });
                toolResults.push({ type: "tool_result", tool_use_id: call.id, name: call.name, content: truncatedResult });
              }
              const steering = await getSteeringMessages();
              if (steering.length > 0) {
                steeringMessages = steering;
                stream.push({ type: "steering", pendingCount: steering.length });
              }
            } else {
              // ── 串行执行（审批检查 + 逐个 steering 检查） ──
              for (let gi = 0; gi < group.calls.length; gi++) {
                if (getToolsForRun) {
                  toolsForRun = getToolsForRun();
                }
                const call = group.calls[gi];
                const tool = toolsForRun.find((t) => t.name === call.name);
                let result = "";
                let errFlag = !tool;

                stream.push({ type: "tool_execution_start", toolCallId: call.id, toolName: call.name, args: call.input });

                if (tool) {
                  let pipelineBlocked = false;
                  const schemaCheck = validateToolInputObject(tool, call.input);
                  if (!schemaCheck.ok) {
                    result = schemaCheck.message;
                    errFlag = true;
                    pipelineBlocked = true;
                  } else {
                    const hooked = await runPreToolHookChain(call.name, schemaCheck.value, params.sessionKey);
                    if (!hooked.ok) {
                      result = hooked.message;
                      errFlag = true;
                      pipelineBlocked = true;
                    } else {
                      call.input = hooked.input;
                    }
                  }

                  if (!pipelineBlocked && params.checkToolApproval) {
                    const approval = await params.checkToolApproval(call);
                    if (approval !== null) {
                      const decision = approval.decision as "allow-once" | "allow-always" | "deny";
                      stream.push({ type: "tool_approval_request", toolCallId: call.id, toolName: call.name, args: call.input });
                      stream.push({ type: "tool_approval_resolved", toolCallId: call.id, toolName: call.name, decision });
                      if (!approval.approved) {
                        result = "Tool execution denied by user.";
                        errFlag = true;
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
                  if (!pipelineBlocked) {
                    const toolStartMs = Date.now();
                    let reachedExecute = false;
                    try {
                      // PreToolUse hooks
                      if (params.toolHooks) {
                        const { decision, hookName } = await params.toolHooks.runPreHooks({
                          tool, input: call.input, ctx: toolCtx, sessionId: params.sessionKey,
                        });
                        if (decision.action === "block") {
                          result = `[${hookName}] ${decision.reason}`;
                          errFlag = true;
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

                      // 工具执行超时保护；须 ≥ SSH 默认（板端长任务），否则 device_exec 会先被掐断
                      const TOOL_TIMEOUT_MS = SSH_DEFAULT_REMOTE_COMMAND_TIMEOUT_MS;
                      const toolTimeoutPromise = new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error(`工具 ${call.name} 执行超时（${TOOL_TIMEOUT_MS / 1000}s）`)), TOOL_TIMEOUT_MS),
                      );
                      reachedExecute = true;
                      result = await Promise.race([
                        tool.execute(call.input, { ...toolCtx, toolCallId: call.id }),
                        toolTimeoutPromise,
                      ]);
                    } catch (err) {
                      result = `执行错误: ${(err as Error).message}`;
                      errFlag = true;
                    }
                    if (params.toolHooks) {
                      result = await params.toolHooks.runPostHooks({
                        tool, input: call.input, result, isError: errFlag,
                        durationMs: Date.now() - toolStartMs, ctx: toolCtx, sessionId: params.sessionKey,
                      });
                    }
                    if (errFlag && params.toolHooks && reachedExecute) {
                      result = await params.toolHooks.runPostFailureHooks({
                        tool,
                        input: call.input,
                        result,
                        durationMs: Date.now() - toolStartMs,
                        ctx: toolCtx,
                        sessionId: params.sessionKey,
                      });
                    }
                  }
                } else {
                  result = `未知工具: ${call.name}`;
                }

                totalToolCalls++;
                toolCallsByName[call.name] = (toolCallsByName[call.name] ?? 0) + 1;
                const isError = errFlag;
                if (isError) toolErrors++;

                // 工具输出截断保护：防止单个工具输出占满上下文窗口
                const truncatedResult = isError ? result : truncateToolOutput(call.name, result);

                stream.push({
                  type: "tool_execution_end",
                  toolCallId: call.id,
                  toolName: call.name,
                  result: formatToolResultForSsePreview(truncatedResult, isError),
                  isError,
                });
                toolResults.push({ type: "tool_result", tool_use_id: call.id, name: call.name, content: truncatedResult });

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
      const maxOutMetrics = maxOutputTokensParam ?? modelDef.maxTokens ?? 8192;
      const effMetrics = getEffectiveContextWindowTokens(contextTokens, maxOutMetrics);
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
          systemPromptChars: systemPrompt.length,
          systemPromptHashShort: systemPromptMeta?.hashShort ?? "",
          effectiveContextTokens: effMetrics,
          llmCompactionFailureStreak,
          systemPromptLayerCount: systemPromptMeta?.layerCount ?? 0,
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
