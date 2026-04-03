import { createCompactionSummaryMessage, type Message } from "../session.js";
import {
  estimateMessageTokens,
  estimateMessagesTokens,
  CHARS_PER_TOKEN_ESTIMATE,
} from "./tokens.js";
import {
  pruneContextMessages,
  type ContextPruningSettings,
  type PruneResult,
} from "./pruning.js";

export const BASE_CHUNK_RATIO = 0.4;
export const MIN_CHUNK_RATIO = 0.15;
export const SAFETY_MARGIN = 1.2;

/**
 * Compaction 设置
 *
 * 对应 OpenClaw:
 * - pi-settings.ts → DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR = 20_000
 * - config/types.agent-defaults.ts → AgentCompactionConfig
 */
export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 20_000,
  keepRecentTokens: 20_000,
};

export const DEFAULT_SUMMARY_MAX_TOKENS = 900;
const DEFAULT_SUMMARY_FALLBACK = "No prior history.";
const DEFAULT_PARTS = 2;
/** 多段并行摘要合并：优先防「去重时把关键约束删没了」 */
const MERGE_SUMMARIES_INSTRUCTIONS = [
  "以下是同一会话在不同阶段生成的多段摘要片段，请合并为一个连贯的上下文检查点摘要。",
  "合并规则（必须遵守）：",
  "- 去重：完全重复的表述只保留一次；相近但细节不同的表述要并列保留，并在一句内说明差异或时间先后。",
  "- 禁止丢约束：任何一段里出现的「必须/不要/禁止/暂缓/待用户确认/已否决的方案」不得因合并而消失；若后文推翻前文，写清「已由用户改为…」。",
  "- 禁止用「前述/如上/已讨论」代替具体事实；路径、命令、版本号、错误码、设备标识仍须写出字面内容。",
  "- 若两段在事实层面冲突，不要二选一吞掉；在「错误与问题」或单独一句中标注「存在待核对的不一致：…」。",
  "- 输出格式：仍使用与单次摘要相同的 9 个 ## 标题结构；某段无信息则写（无）。",
].join("\n");

/**
 * 从 LLM 输出中提取 <summary> 标签内容。
 * 如果 LLM 没有使用标签格式，返回原始文本。
 */
function extractSummaryTag(raw: string): string {
  const match = raw.match(/<summary>([\s\S]*?)<\/summary>/);
  return match ? match[1].trim() : raw.trim();
}

const SUMMARIZATION_SYSTEM_PROMPT = `你是上下文摘要助手。你的任务是阅读用户与 AI 编程助手的对话，然后按照指定格式输出结构化摘要。

重要规则：
- 不要继续对话。不要回答对话中的问题。只输出结构化摘要。
- 先在 <analysis> 标签中分析对话要点（这是你的草稿区，不会出现在最终摘要中），然后在 <summary> 标签中输出最终摘要。
- 反失忆（优先级高于缩写篇幅）：用户用「必须 / 不要 / 禁止 / 暂缓 / 别动」等表述的约束，要逐条写成可执行的短句，不得概括成「用户有偏好」之类空话。
- 用户明确批准或拒绝的结论（例如同意改某路径、否决某方案）必须点名写出对象（路径/命令/工具名），不得只写「已确认」。
- 仍待用户拍板或工具链在等待的事项，单独记在对应章节，避免后续模型误当成已完成。
- 保留精确的文件路径、函数名、命令行、HTTP/API 端点、错误栈/退出码、版本号、哈希、端口号、IP——后续模型靠这些字面量继续排查。
- 对话主要使用中文时，摘要主体用中文；标识符、路径、日志片段保持原文，不要翻译。
- 对于 RDK / 嵌入式场景，优先保留：设备 ID 或别名、型号、IP/主机、SSH 是否通、板端 OpenClaw/Agent 版本或安装与否、BPU/部署相关路径与状态、最近一次失败命令或 stdout/stderr 的关键行（可截断但保留头尾特征）。`;

const SUMMARIZATION_PROMPT = `以上消息是一段对话，请生成结构化的上下文检查点摘要，供后续模型继续工作使用。

先在 <analysis> 中分析对话的关键要点，然后在 <summary> 中输出最终摘要。

<analysis>
[分析：用户核心目标与优先级；已发生的关键操作与结果；用户否决/强制的约束；待确认项；与环境/设备相关的硬事实；尚未关闭的问题。]
</analysis>

<summary>
请严格使用以下 9 段格式（每一段若无内容写「（无）」，不要用空白省略章节）：

## 1. 主要目标
[用户想要完成什么？多任务时按优先级编号]

## 2. 关键决策与约束
[偏好与架构选择；**用户原话级的禁止/必须**（写成短句）；已批准或已否决的方案（要写清对象）；合规/安全相关限制]

## 3. 已完成的工作
[已成功步骤；附关键结论或一句可验证结果，必要时保留命令或路径]

## 4. 当前进行中
[已开始但未收尾的工作；若卡在等待用户或外部，写明等待什么]

## 5. 待办事项
[已列出但尚未动手的事项]

## 6. 设备与环境状态
[设备标识、IP/主机、型号、SSH/凭据是否就绪、Agent/OpenClaw/板端服务状态、重要工作目录]

## 7. 关键文件与路径
[读写过的配置文件、模型、脚本路径；与问题直接相关的绝对路径]

## 8. 错误与问题
[错误信息/退出码/日志特征行；根因若未定论写「待查」；已知风险]

## 9. 后续工作所需上下文
[下一轮模型需要的 literal 数据：示例命令、环境变量名、接口名等；若无写「（无）」]
</summary>

写作要求：宁可多一行具体名词，也不要用「之前讨论过」类模糊指代。工具调用只需保留对后续有意义的名称与参数片段，不要把整段 JSON 原文塞进摘要。`;


const UPDATE_SUMMARIZATION_PROMPT = `以上消息是需要纳入已有摘要的新对话内容。已有摘要位于 <previous-summary> 标签中。

先在 <analysis> 中分析新对话带来了哪些变化，然后在 <summary> 中输出更新后的完整摘要。

请在保留已有摘要信息的前提下进行更新，使用相同的 9 段格式（每段无内容写「（无）」）。规则：
- 默认保留旧摘要中的约束与事实，除非新对话**明确**推翻；推翻时写「更新：…（旧：…）」，不要静默删除。
- 追加新进展、新决策、新错误；用户新增的禁止/必须句并入第 2 节对应条目。
- 已完成的事项从「当前进行中」移到「已完成的工作」；新待办写入第 5 节。
- 新错误追加到「错误与问题」；若旧错误已解决，可标注「已解决：<一句 how>」或「已过时」。
- 更新「设备与环境状态」为最新观测；状态未知写「未验证」而非臆测。
- 仅当新对话表明某旧信息明确作废时，才可删除该条；否则保留（可标「历史/可能已不适用」）。
- 保留精确的文件路径、函数名、命令与错误信息字面量。`;

type FileOps = {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
};

function createFileOps(): FileOps {
  return {
    read: new Set<string>(),
    written: new Set<string>(),
    edited: new Set<string>(),
  };
}

function extractFileOpsFromMessage(message: Message, fileOps: FileOps): void {
  if (message.role !== "assistant") {
    return;
  }
  if (!Array.isArray(message.content)) {
    return;
  }
  for (const block of message.content) {
    if (block.type !== "tool_use") {
      continue;
    }
    const args = block.input;
    if (!args || typeof args !== "object") {
      continue;
    }
    const path = typeof args.path === "string" ? args.path : undefined;
    if (!path) {
      continue;
    }
    switch (block.name) {
      case "read":
        fileOps.read.add(path);
        break;
      case "write":
        fileOps.written.add(path);
        break;
      case "edit":
        fileOps.edited.add(path);
        break;
    }
  }
}

function computeFileLists(fileOps: FileOps): { readFiles: string[]; modifiedFiles: string[] } {
  const modified = new Set<string>([...fileOps.edited, ...fileOps.written]);
  const readOnly = [...fileOps.read].filter((file) => !modified.has(file)).sort();
  const modifiedFiles = [...modified].sort();
  return { readFiles: readOnly, modifiedFiles };
}

function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string {
  const sections: string[] = [];
  if (readFiles.length > 0) {
    sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
  }
  if (modifiedFiles.length > 0) {
    sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
  }
  if (sections.length === 0) {
    return "";
  }
  return `\n\n${sections.join("\n\n")}`;
}

/**
 * 摘要生成函数签名
 *
 * 解耦 compaction 与具体 LLM SDK:
 * - 调用方通过 pi-ai 的 completeSimple 或任意 provider 实现
 */
export type SummarizeFn = (params: {
  system: string;
  userPrompt: string;
  maxTokens: number;
}) => Promise<string>;

function normalizeParts(parts: number, messageCount: number): number {
  if (!Number.isFinite(parts) || parts <= 1) {
    return 1;
  }
  return Math.min(Math.max(1, Math.floor(parts)), Math.max(1, messageCount));
}

export function computeAdaptiveChunkRatio(messages: Message[], contextWindow: number): number {
  if (messages.length === 0) {
    return BASE_CHUNK_RATIO;
  }
  const totalTokens = estimateMessagesTokens(messages);
  const avgTokens = totalTokens / messages.length;
  const safeAvgTokens = avgTokens * SAFETY_MARGIN;
  const avgRatio = safeAvgTokens / contextWindow;

  if (avgRatio > 0.1) {
    const reduction = Math.min(avgRatio * 2, BASE_CHUNK_RATIO - MIN_CHUNK_RATIO);
    return Math.max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction);
  }
  return BASE_CHUNK_RATIO;
}

export function splitMessagesByTokenShare(messages: Message[], parts = DEFAULT_PARTS): Message[][] {
  if (messages.length === 0) {
    return [];
  }
  const normalizedParts = normalizeParts(parts, messages.length);
  if (normalizedParts <= 1) {
    return [messages];
  }

  const totalTokens = estimateMessagesTokens(messages);
  const targetTokens = totalTokens / normalizedParts;
  const chunks: Message[][] = [];
  let current: Message[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const messageTokens = estimateMessageTokens(message);
    if (
      chunks.length < normalizedParts - 1 &&
      current.length > 0 &&
      currentTokens + messageTokens > targetTokens
    ) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(message);
    currentTokens += messageTokens;
  }

  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

export function chunkMessagesByMaxTokens(messages: Message[], maxTokens: number): Message[][] {
  if (messages.length === 0) {
    return [];
  }
  const chunks: Message[][] = [];
  let current: Message[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const messageTokens = estimateMessageTokens(message);
    if (current.length > 0 && currentTokens + messageTokens > maxTokens) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(message);
    currentTokens += messageTokens;

    if (messageTokens > maxTokens) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

function isOversizedForSummary(msg: Message, contextWindow: number): boolean {
  const tokens = estimateMessageTokens(msg) * SAFETY_MARGIN;
  return tokens > contextWindow * 0.5;
}

function extractUserText(content: Message["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

function serializeConversation(messages: Message[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = extractUserText(msg.content);
      if (text) {
        parts.push(`[User]: ${text}`);
      }
      if (Array.isArray(msg.content)) {
        const toolResults = msg.content
          .filter((block) => block.type === "tool_result")
          .map((block) => block.content ?? "")
          .filter(Boolean);
        for (const result of toolResults) {
          parts.push(`[Tool result]: ${result}`);
        }
      }
      continue;
    }

    if (msg.role === "assistant") {
      const textParts: string[] = [];
      const toolCalls: string[] = [];
      if (typeof msg.content === "string") {
        textParts.push(msg.content);
      } else {
        for (const block of msg.content) {
          if (block.type === "text") {
            if (block.text) {
              textParts.push(block.text);
            }
            continue;
          }
          if (block.type === "tool_use") {
            const args = block.input ?? {};
            const argsStr = Object.entries(args)
              .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
              .join(", ");
            toolCalls.push(`${block.name ?? "tool"}(${argsStr})`);
          }
        }
      }
      if (textParts.length > 0) {
        parts.push(`[Assistant]: ${textParts.join("\n")}`);
      }
      if (toolCalls.length > 0) {
        parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
      }
    }
  }
  return parts.join("\n\n");
}

async function generateSummary(params: {
  messages: Message[];
  summarize: SummarizeFn;
  maxTokens: number;
  customInstructions?: string;
  previousSummary?: string;
}): Promise<string> {
  let basePrompt = params.previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  if (params.customInstructions) {
    basePrompt = `${basePrompt}\n\nAdditional focus: ${params.customInstructions}`;
  }
  const conversationText = serializeConversation(params.messages);
  let prompt = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (params.previousSummary) {
    prompt += `<previous-summary>\n${params.previousSummary}\n</previous-summary>\n\n`;
  }
  prompt += basePrompt;

  const raw = await params.summarize({
    system: SUMMARIZATION_SYSTEM_PROMPT,
    userPrompt: prompt,
    maxTokens: params.maxTokens,
  });

  // 提取 <summary> 标签内容（如果 LLM 遵循了两段式输出格式）
  return extractSummaryTag(raw);
}

async function summarizeChunks(params: {
  messages: Message[];
  summarize: SummarizeFn;
  maxTokens: number;
  maxChunkTokens: number;
  customInstructions?: string;
  previousSummary?: string;
}): Promise<string> {
  if (params.messages.length === 0) {
    return params.previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }
  const chunks = chunkMessagesByMaxTokens(params.messages, params.maxChunkTokens);
  let summary = params.previousSummary;
  for (const chunk of chunks) {
    summary = await generateSummary({
      messages: chunk,
      summarize: params.summarize,
      maxTokens: params.maxTokens,
      customInstructions: params.customInstructions,
      previousSummary: summary,
    });
  }
  return summary ?? DEFAULT_SUMMARY_FALLBACK;
}

async function summarizeWithFallback(params: {
  messages: Message[];
  summarize: SummarizeFn;
  maxTokens: number;
  maxChunkTokens: number;
  contextWindow: number;
  customInstructions?: string;
  previousSummary?: string;
}): Promise<string> {
  if (params.messages.length === 0) {
    return params.previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  try {
    return await summarizeChunks(params);
  } catch (e) {
    console.warn('[compaction] summarizeChunks failed, falling back to smaller chunks:', e instanceof Error ? e.message : String(e));
  }

  const smallMessages: Message[] = [];
  const oversizedNotes: string[] = [];
  for (const msg of params.messages) {
    if (isOversizedForSummary(msg, params.contextWindow)) {
      const tokens = estimateMessageTokens(msg);
      oversizedNotes.push(`[Large ${msg.role} (~${Math.round(tokens / 1000)}K tokens) omitted]`);
    } else {
      smallMessages.push(msg);
    }
  }

  if (smallMessages.length > 0) {
    try {
      const partial = await summarizeChunks({
        ...params,
        messages: smallMessages,
      });
      const notes = oversizedNotes.length > 0 ? `\n\n${oversizedNotes.join("\n")}` : "";
      return partial + notes;
    } catch (e) {
      console.warn('[compaction] smaller-chunks fallback also failed:', e instanceof Error ? e.message : String(e));
    }
  }

  return `Context contained ${params.messages.length} messages. Summary unavailable due to size limits.`;
}

export async function summarizeInStages(params: {
  messages: Message[];
  summarize: SummarizeFn;
  maxTokens: number;
  maxChunkTokens: number;
  contextWindow: number;
  customInstructions?: string;
  previousSummary?: string;
  parts?: number;
  minMessagesForSplit?: number;
}): Promise<string> {
  const { messages } = params;
  if (messages.length === 0) {
    return params.previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  const minMessagesForSplit = Math.max(2, params.minMessagesForSplit ?? 4);
  const parts = normalizeParts(params.parts ?? DEFAULT_PARTS, messages.length);
  const totalTokens = estimateMessagesTokens(messages);

  if (parts <= 1 || messages.length < minMessagesForSplit || totalTokens <= params.maxChunkTokens) {
    return summarizeWithFallback(params);
  }

  const splits = splitMessagesByTokenShare(messages, parts).filter((chunk) => chunk.length > 0);
  if (splits.length <= 1) {
    return summarizeWithFallback(params);
  }

  const partialSummaries: string[] = [];
  for (const chunk of splits) {
    partialSummaries.push(
      await summarizeWithFallback({
        ...params,
        messages: chunk,
        previousSummary: undefined,
      }),
    );
  }

  if (partialSummaries.length === 1) {
    return partialSummaries[0];
  }

  const summaryMessages: Message[] = partialSummaries.map((summary) => ({
    role: "user",
    content: summary,
    timestamp: Date.now(),
  }));

  const mergeInstructions = params.customInstructions
    ? `${MERGE_SUMMARIES_INSTRUCTIONS}\n\nAdditional focus:\n${params.customInstructions}`
    : MERGE_SUMMARIES_INSTRUCTIONS;

  return summarizeWithFallback({
    ...params,
    messages: summaryMessages,
    customInstructions: mergeInstructions,
  });
}

/**
 * 是否应该触发 compaction
 *
 * 对应 OpenClaw: pi-coding-agent → shouldCompact(contextTokens, contextWindow, settings)
 * 触发条件: contextTokens > contextWindow - reserveTokens
 * （reserve-based，不是 ratio-based）
 */
export function shouldTriggerCompaction(params: {
  messages: Message[];
  contextWindowTokens: number;
  settings?: Partial<CompactionSettings>;
}): boolean {
  const settings = {
    ...DEFAULT_COMPACTION_SETTINGS,
    ...params.settings,
  };
  if (!settings.enabled) return false;
  const totalTokens = estimateMessagesTokens(params.messages);
  return totalTokens > params.contextWindowTokens - settings.reserveTokens;
}

/**
 * Proactive compaction trigger — inspired by OpenClaw 2026.3.7 ContextEngine
 * and Acon (Agent Context Optimization).
 *
 * Instead of only compacting when we exceed the hard token limit, this detects
 * natural task boundaries and compacts proactively. Benefits:
 * - Compresses at opportune moments (between tasks) rather than mid-conversation
 * - Prevents context quality degradation from accumulated stale information
 * - Keeps the working context focused on the current task
 *
 * Heuristics for task boundary detection:
 * 1. Long tool-result output just completed (> 40% of context)
 * 2. Multiple tool-use rounds completed without new user messages
 * 3. Context usage exceeds 60% of window (early warning threshold)
 */
export function shouldProactiveCompact(params: {
  messages: Message[];
  contextWindowTokens: number;
  settings?: Partial<CompactionSettings>;
}): boolean {
  const settings = { ...DEFAULT_COMPACTION_SETTINGS, ...params.settings };
  if (!settings.enabled) return false;

  const totalTokens = estimateMessagesTokens(params.messages);
  const usageRatio = totalTokens / params.contextWindowTokens;

  if (usageRatio < 0.6) return false;

  const recentMessages = params.messages.slice(-6);
  const toolOnlyRounds = recentMessages.filter(
    m => m.role === 'assistant' && Array.isArray(m.content) &&
         m.content.every(b => b.type === 'tool_use')
  ).length;

  if (toolOnlyRounds >= 3 && usageRatio > 0.65) return true;

  const lastMsg = params.messages[params.messages.length - 1];
  if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
    const toolResultTokens = lastMsg.content
      .filter(b => b.type === 'tool_result')
      .reduce((sum, b) => sum + (typeof b.content === 'string' ? b.content.length : 0) / 4, 0);
    if (toolResultTokens > params.contextWindowTokens * 0.4) return true;
  }

  return false;
}

/**
 * 生成 compaction 摘要
 *
 * 对应 OpenClaw: pi-coding-agent → generateSummary()
 * maxTokens = floor(0.8 × reserveTokens)
 */
export async function buildCompactionSummary(params: {
  summarize: SummarizeFn;
  messages: Message[];
  contextWindowTokens: number;
  maxTokens?: number;
  reserveTokens?: number;
  customInstructions?: string;
}): Promise<string> {
  if (params.messages.length === 0) {
    return DEFAULT_SUMMARY_FALLBACK;
  }
  const adaptiveRatio = computeAdaptiveChunkRatio(params.messages, params.contextWindowTokens);
  const maxChunkTokens = Math.max(1, Math.floor(params.contextWindowTokens * adaptiveRatio));
  // 对应 OpenClaw: maxTokens = Math.floor(0.8 * reserveTokens)
  const reserveTokens = params.reserveTokens ?? DEFAULT_COMPACTION_SETTINGS.reserveTokens;
  const maxTokens = Math.max(64, Math.floor(params.maxTokens ?? (0.8 * reserveTokens)));

  return summarizeInStages({
    messages: params.messages,
    summarize: params.summarize,
    maxTokens,
    maxChunkTokens,
    contextWindow: params.contextWindowTokens,
    customInstructions: params.customInstructions,
  });
}

export async function compactHistoryIfNeeded(params: {
  summarize: SummarizeFn;
  messages: Message[];
  contextWindowTokens: number;
  pruningSettings?: Partial<ContextPruningSettings>;
  compactionSettings?: Partial<CompactionSettings>;
  maxTokens?: number;
  /** 连续压缩失败熔断：仅做 prune 切片，不调用 LLM 摘要（对齐 claude-code autoCompact circuit breaker） */
  skipLlmCompaction?: boolean;
}): Promise<{
  summary?: string;
  summaryMessage?: Message;
  pruneResult: PruneResult;
}> {
  const pruneResult = pruneContextMessages({
    messages: params.messages,
    contextWindowTokens: params.contextWindowTokens,
    settings: params.pruningSettings,
  });

  const shouldCompact = shouldTriggerCompaction({
    messages: params.messages,
    contextWindowTokens: params.contextWindowTokens,
    settings: params.compactionSettings,
  });

  if (!shouldCompact) {
    return { pruneResult };
  }

  if (pruneResult.droppedMessages.length === 0) {
    const totalTokens = estimateMessagesTokens(params.messages);
    const threshold = params.contextWindowTokens * 0.7;
    if (totalTokens <= threshold) {
      return { pruneResult };
    }
    const halfIdx = Math.max(1, Math.floor(params.messages.length / 3));
    pruneResult.droppedMessages.push(...params.messages.slice(0, halfIdx));
    pruneResult.messages = params.messages.slice(halfIdx);

    const recalcKept = pruneResult.messages.reduce((s, m) => s + JSON.stringify(m).length, 0);
    const recalcDropped = pruneResult.droppedMessages.reduce((s, m) => s + JSON.stringify(m).length, 0);
    pruneResult.totalChars = recalcKept + recalcDropped;
    pruneResult.keptChars = recalcKept;
    pruneResult.droppedChars = recalcDropped;
  }

  if (params.skipLlmCompaction) {
    return { pruneResult };
  }

  const resolvedSettings = { ...DEFAULT_COMPACTION_SETTINGS, ...params.compactionSettings };
  let summary = await buildCompactionSummary({
    summarize: params.summarize,
    messages: pruneResult.droppedMessages,
    contextWindowTokens: params.contextWindowTokens,
    maxTokens: params.maxTokens,
    reserveTokens: resolvedSettings.reserveTokens,
  });
  const fileOps = createFileOps();
  for (const message of pruneResult.droppedMessages) {
    extractFileOpsFromMessage(message, fileOps);
  }
  const { readFiles, modifiedFiles } = computeFileLists(fileOps);
  summary += formatFileOperations(readFiles, modifiedFiles);

  const summaryMessage: Message = createCompactionSummaryMessage(summary, Date.now());

  return {
    summary,
    summaryMessage,
    pruneResult,
  };
}

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
export const DEFAULT_HISTORY_SHARE = 0.5;
export const DEFAULT_CONTEXT_WINDOW_CHARS =
  DEFAULT_CONTEXT_WINDOW_TOKENS * CHARS_PER_TOKEN_ESTIMATE;
