/**
 * Mini Agent 核心
 *
 * 5 大核心子系统:
 * 1. Session Manager - 会话管理 (JSONL 持久化)
 * 2. Memory Manager - 长期记忆 (关键词搜索)
 * 3. Context Loader - 按需上下文加载 (AGENTS/SOUL/TOOLS/IDENTITY/USER/HEARTBEAT/BOOTSTRAP/MEMORY)
 * 4. Skill Manager - 可扩展技能系统
 * 5. Heartbeat Manager - 主动唤醒机制
 *
 * 核心循环 (agent-loop.ts):
 *   OUTER LOOP (follow-ups)
 *   ├─ INNER LOOP (tools + steering)
 *   │  ├─ 注入 pendingMessages（steering 或 follow-up）
 *   │  ├─ LLM 流式调用
 *   │  ├─ 执行工具（每执行一个后检查 steering）
 *   │  ├─ 若 steering: 跳过剩余工具
 *   │  └─ 循环条件: hasMoreToolCalls || pendingMessages.length > 0
 *   ├─ 检查 follow-up 消息
 *   └─ 若有 follow-up: 继续外层循环
 */

import crypto from "node:crypto";
import path from "node:path";
import type { Tool, ToolContext } from "./tools/types.js";
import { builtinTools } from "./tools/builtin.js";
import { wrapToolWithAbortSignal } from "./tools/abort.js";
import { SessionManager, type Message } from "./session.js";
import { MemoryManager, type MemorySearchResult } from "./memory.js";
import {
  ContextLoader,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  compactHistoryIfNeeded,
  estimateMessagesTokens,
  type PruneResult,
  type SummarizeFn,
} from "./context/index.js";
import {
  CONTEXT_WINDOW_HARD_MIN_TOKENS,
  CONTEXT_WINDOW_WARN_BELOW_TOKENS,
  evaluateContextWindowGuard,
  resolveContextWindowInfo,
} from "./context-window-guard.js";
import { getEffectiveContextWindowTokens } from "./context/window-economics.js";
import type { CompactHookRegistry } from "./compact-hooks.js";
import { SkillManager, type SkillMatch } from "./skills.js";
import { HeartbeatManager, type HeartbeatResult } from "./heartbeat.js";
import {
  normalizeAgentId,
  resolveAgentIdFromSessionKey,
  resolveSessionKey,
  isSubagentSessionKey,
} from "./session-key.js";
import { enqueueInLane, resolveGlobalLane, resolveSessionLane, setLaneConcurrency } from "./command-queue.js";
import { filterToolsByPolicy, type ToolPolicy } from "./tool-policy.js";
import {
  requiresApproval, AllowlistManager,
  type ApprovalConfig, type ApprovalHandler, type ApprovalDecision,
} from "./tool-approval.js";
import type { MiniAgentEvent } from "./agent-events.js";
import { runAgentLoop } from "./agent-loop.js";
import { ToolHookRegistry, createExecLikeFailureHintHook } from "./tool-hooks.js";
import { installSessionToolResultGuard } from "./session-tool-result-guard.js";
import {
  buildSubagentPromptAddon,
  resolveSpawnToolSet,
  type SpawnToolScope,
} from "./spawn-profile.js";
import type { Model, StreamFunction, ThinkingLevel } from "@mariozechner/pi-ai";
import { streamSimple, completeSimple, getModel, getEnvApiKey } from "@mariozechner/pi-ai";

// ============== 类型定义 ==============

export interface AgentConfig {
  /** API Key（不指定则通过 pi-ai getEnvApiKey 从环境变量自动获取） */
  apiKey?: string;
  /**
   * Provider 名称
   *
   * 对应 pi-ai KnownProvider，如 "anthropic" | "openai" | "google" | "groq" 等
   * 默认 "anthropic"
   */
  provider?: string;
  /** 模型 ID（需与 provider 匹配，如 "claude-sonnet-4-20250514" / "gpt-4.1" / "gemini-2.5-pro"） */
  model?: string;
  /** API Base URL（用于代理、自部署端点、Azure OpenAI 等） */
  baseUrl?: string;
  /** 自定义 HTTP headers（覆盖 pi-ai 默认的 beta headers 等，值为 null 表示移除） */
  headers?: Record<string, string | null>;
  /**
   * Provider 流式调用函数
   *
   * 对应 OpenClaw: pi-agent-core → Agent.streamFn
   * - 不指定则默认使用 pi-ai 的 streamSimple（自动路由到对应 provider）
   * - 可替换为任意自定义 StreamFunction
   */
  streamFn?: StreamFunction;
  /**
   * 模型定义
   *
   * 对应 OpenClaw: pi-ai → Model<TApi>
   * - 不指定则通过 getModel(provider, modelId) 获取
   */
  modelDef?: Model<any>;
  /** Agent ID（默认 main） */
  agentId?: string;
  /** 系统提示 */
  systemPrompt?: string;
  /** 工具列表 */
  tools?: Tool[];
  /** 工具策略（allow/deny） */
  toolPolicy?: ToolPolicy;
  /**
   * 工具审批配置
   *
   * 对应 OpenClaw: exec-approvals.ts → ExecSecurity + ExecAsk
   * - 运行时拦截敏感工具执行，等待用户审批
   * - 与 toolPolicy 互补: policy 是静态过滤，approval 是运行时拦截
   */
  approval?: ApprovalConfig;
  /**
   * 审批处理器
   *
   * 对应 OpenClaw: exec-approval-manager.ts → waitForDecision()
   * - CLI 模式: readline 提示用户
   * - Gateway 模式: 广播到客户端等待响应
   */
  onApprovalRequest?: ApprovalHandler;
  /** 沙箱设置（示意版，仅控制工具可用性） */
  sandbox?: {
    enabled?: boolean;
    allowExec?: boolean;
    allowWrite?: boolean;
  };
  /** 温度参数（0-1，对应 OpenClaw: agents.defaults.models[provider/model].params.temperature） */
  temperature?: number;
  /** nucleus top_p（0–1），经 agent-loop onPayload 注入 */
  topP?: number;
  /** 思考级别: minimal / low / medium / high / xhigh；`null` 关闭扩展思考（不传给上游） */
  reasoning?: ThinkingLevel | null;
  /** 最大循环次数 */
  maxTurns?: number;
  /** 会话存储目录 */
  sessionDir?: string;
  /** 工作目录 */
  workspaceDir?: string;
  /** Bootstrap 目录（AGENTS/SOUL/USER/MEMORY 所在目录） */
  bootstrapDir?: string;
  /** 记忆存储目录 */
  memoryDir?: string;
  /** 是否启用记忆 */
  enableMemory?: boolean;
  /** 是否启用上下文加载 */
  enableContext?: boolean;
  /** 是否启用技能 */
  enableSkills?: boolean;
  /** 是否启用主动唤醒 */
  enableHeartbeat?: boolean;
  /** Heartbeat 检查间隔 (毫秒) */
  heartbeatInterval?: number;
  /** 上下文窗口大小（token 估算） */
  contextTokens?: number;
  /**
   * Global lane 最大并发数（跨 session 的总并行度）
   *
   * 对应 OpenClaw: gateway/server-lanes.ts → resolveAgentMaxConcurrent()
   * - session lane 固定 maxConcurrent=1（同一 session 内串行）
   * - global lane 控制不同 session 间可同时跑几个（默认 2）
   */
  maxConcurrentRuns?: number;
  /** 额外允许读写的根目录（打包后用户工作区等） */
  extraAllowedRoots?: string[];
  /** 合并进每次工具执行的 ToolContext（如 RDK Studio 的设备绑定回调） */
  toolContextExtras?: Partial<ToolContext>;
  /** RDK Studio：每轮解析当前绑定设备 ID，写入 ToolContext.studioDeviceId（供板端技能内化等） */
  studioDeviceIdResolver?: () => string | undefined;
  /**
   * 运行级策略参数（替代 process.env.RDKCLAW_* 写入）
   *
   * 直接传入 Agent 构造，避免全局 env 在并发请求间竞态。
   */
  runtimePolicy?: {
    dailyMemoryDays?: number;
    mainReadsMemory?: boolean;
    sharedBlocksMemory?: boolean;
    pruning?: {
      maxHistoryShare?: number;
      softTrimRatio?: number;
      hardClearRatio?: number;
      keepLastAssistants?: number;
    };
  };
  /** Compaction 生命周期 hooks（Pre/Post compact） */
  compactHooks?: CompactHookRegistry;
  /** 系统提示遥测（RDKClaw 分层构建时传入 hash 与层数） */
  systemPromptTelemetry?: { hashShort: string; layerCount: number };
  /**
   * 工具 Pre/Post/Failure 钩子；不传则使用内置 Registry（含 exec/device_exec 失败恢复提示）。
   * 若自行传入，请视需要调用 `createExecLikeFailureHintHook()` 注册失败提示。
   */
  toolHooks?: ToolHookRegistry;
}

export interface RunResult {
  /** 本次运行 ID */
  runId?: string;
  /** 最终文本 */
  text: string;
  /** 总轮次 */
  turns: number;
  /** 工具调用次数 */
  toolCalls: number;
  /** 是否触发了技能 */
  skillTriggered?: string;
  /** 记忆检索结果数（memory_search 返回的条数） */
  memoriesUsed?: number;
}

// ============== 默认系统提示 ==============

const DEFAULT_SYSTEM_PROMPT = `你是一个编程助手 Agent。

## 可用工具
- read: 读取文件内容
- write: 写入文件
- edit: 编辑文件 (字符串替换)
- exec: 执行 shell 命令
- list: 列出目录
- grep: 搜索文件内容

## 原则
1. 修改代码前必须先读取文件
2. 使用 edit 进行小范围修改
3. 保持简洁，不要过度解释
4. 遇到错误时分析原因并重试

## 输出格式
- 简洁的语言
- 代码使用 markdown 格式`;

// ============== Agent 核心类 ==============

export class Agent {
  /**
   * Provider 流式调用函数
   *
   * 对应 OpenClaw: pi-agent-core/agent.d.ts → Agent.streamFn
   * - 可在运行时替换（如 failover 切换 provider）
   */
  streamFn: StreamFunction;
  private modelDef: Model<any>;
  private apiKey?: string;
  private temperature?: number;
  private topP?: number;
  private reasoning?: ThinkingLevel | undefined;
  private agentId: string;
  private baseSystemPrompt: string;
  private tools: Tool[];
  private toolContextExtras?: Partial<ToolContext>;
  private studioDeviceIdResolver?: () => string | undefined;
  private maxTurns: number;
  private workspaceDir: string;
  private bootstrapDir?: string;
  private extraAllowedRoots?: string[];
  private toolPolicy?: ToolPolicy;
  private approval?: ApprovalConfig;
  private onApprovalRequest?: ApprovalHandler;
  private allowlist: AllowlistManager;
  private contextTokens: number;
  private runtimePolicy: NonNullable<AgentConfig['runtimePolicy']>;
  private toolHooks: ToolHookRegistry;
  private sandbox?: {
    enabled: boolean;
    allowExec: boolean;
    allowWrite: boolean;
  };

  // 5 大子系统
  private sessions: SessionManager;
  private memory: MemoryManager;
  private context: ContextLoader;
  private skills: SkillManager;
  private heartbeat: HeartbeatManager;

  // 功能开关
  private enableMemory: boolean;
  private enableContext: boolean;
  private enableSkills: boolean;
  private enableHeartbeat: boolean;

  /**
   * 运行中的 AbortController 映射 (runId → controller)
   *
   * 对应 OpenClaw: pi-embedded-runner/run/attempt.ts
   * - 每次 run() 创建一个 runAbortController
   * - abort() 可从外部取消指定或全部运行
   */
  private runAbortControllers = new Map<string, AbortController>();

  /**
   * Steering 消息队列 (sessionKey → messages[])
   *
   * 对应 OpenClaw: pi-agent-core → Agent.steeringQueue
   * - 用户在工具执行期间发送新消息时入队
   * - 每次工具执行完毕后检查，若非空则跳过剩余工具
   * - 队列中的消息作为下一个 user turn 处理
   */
  private steeringQueues = new Map<string, string[]>();

  /**
   * Tool Result Guard
   *
   * 对应 OpenClaw: session-tool-result-guard-wrapper.ts → guardSessionManager()
   * - 追踪 pending tool_use，自动合成缺失的 tool_result
   * - 防止 LLM API 因 tool_use/tool_result 不配对而拒绝
   */
  private toolResultGuard: ReturnType<typeof installSessionToolResultGuard>;

  /**
   * 事件订阅者
   *
   * 对应 pi-agent-core/agent.js → Agent.listeners: Set<fn>
   * - subscribe() 添加监听器，返回 unsubscribe 函数
   * - emit() 遍历 listeners 同步调用
   */
  private listeners = new Set<(event: MiniAgentEvent) => void>();

  private compactHooks?: CompactHookRegistry;
  /** 连续摘要失败（对齐 claude-code MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES） */
  private compactionFailStreakBySession = new Map<string, number>();
  private static readonly MAX_COMPACTION_FAILURE_STREAK = 3;
  private systemPromptTelemetry?: { hashShort: string; layerCount: number };

  constructor(config: AgentConfig) {
    // Provider 初始化（对应 OpenClaw: attempt.ts → activeSession.agent.streamFn）
    const provider = config.provider ?? "anthropic";
    const modelId = config.model ?? (provider === "anthropic" ? "claude-sonnet-4-20250514" : undefined);

    // 解析 Model 定义
    // 代理场景下 model ID 可能不在 pi-ai 注册表中（如 "anthropic/claude-sonnet-4.5"）
    // 此时根据 provider 构造兼容的 Model 定义
    const API_FOR_PROVIDER: Record<string, string> = {
      anthropic: "anthropic-messages",
      openai: "openai-completions",
      google: "google-generative-ai",
    };
    let modelDef: Model<any> | undefined = config.modelDef ?? getModel(provider as any, modelId as any);
    if (!modelDef && modelId) {
      const api = API_FOR_PROVIDER[provider];
      if (!api) {
        throw new Error(`未知 provider: ${provider}，请指定 modelDef。`);
      }
      modelDef = {
        id: modelId,
        name: modelId,
        api,
        provider,
        baseUrl: config.baseUrl ?? "",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 8192,
      };
    }
    if (!modelDef) {
      throw new Error(`未知模型: provider=${provider} model=${modelId}`);
    }
    // 使用代理时剥离 Anthropic SDK 和 pi-ai 添加的非标准 headers
    // 代理通常会拒绝 SDK 的 User-Agent / X-Stainless-* tracking headers
    // Anthropic SDK applyHeadersMut: null → 删除, undefined → 跳过
    if (config.baseUrl) {
      this.modelDef = {
        ...modelDef,
        baseUrl: config.baseUrl,
        headers: {
          "User-Agent": null,
          "X-Stainless-Lang": null,
          "X-Stainless-Package-Version": null,
          "X-Stainless-OS": null,
          "X-Stainless-Arch": null,
          "X-Stainless-Runtime": null,
          "X-Stainless-Runtime-Version": null,
          "anthropic-dangerous-direct-browser-access": null,
          "anthropic-beta": null,
          ...config.headers,
        } as any,
      };
    } else {
      this.modelDef = config.headers ? { ...modelDef, headers: { ...modelDef.headers, ...config.headers } as any } : modelDef;
    }
    this.streamFn = config.streamFn ?? streamSimple;
    this.agentId = normalizeAgentId(config.agentId ?? "main");
    this.baseSystemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.tools = config.tools ?? builtinTools;
    this.toolContextExtras = config.toolContextExtras;
    this.studioDeviceIdResolver = config.studioDeviceIdResolver;
    this.maxTurns = config.maxTurns ?? 20;
    this.workspaceDir = config.workspaceDir ?? process.cwd();
    this.bootstrapDir = config.bootstrapDir;
    this.extraAllowedRoots = config.extraAllowedRoots;
    this.apiKey = config.apiKey ?? getEnvApiKey(provider);
    this.temperature = config.temperature;
    this.topP = config.topP;
    if (config.reasoning === null) {
      this.reasoning = undefined;
    } else {
      this.reasoning = config.reasoning ?? "medium";
    }
    this.toolPolicy = config.toolPolicy;
    this.approval = config.approval;
    this.onApprovalRequest = config.onApprovalRequest;
    this.allowlist = new AllowlistManager();
    this.contextTokens = Math.max(
      1,
      Math.floor(config.contextTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS),
    );
    this.runtimePolicy = config.runtimePolicy ?? {};
    this.sandbox = {
      enabled: config.sandbox?.enabled ?? false,
      allowExec: config.sandbox?.allowExec ?? false,
      allowWrite: config.sandbox?.allowWrite ?? true,
    };

    // 初始化子系统
    this.sessions = new SessionManager(config.sessionDir);
    this.memory = new MemoryManager(config.memoryDir ?? "./.mini-agent/memory");
    this.context = new ContextLoader(this.workspaceDir, {
      bootstrapDir: this.bootstrapDir,
      fallbackBootstrapDir:
        this.bootstrapDir && path.resolve(this.bootstrapDir) !== path.resolve(this.workspaceDir)
          ? this.workspaceDir
          : undefined,
      memoryPolicy: {
        dailyMemoryDays: this.runtimePolicy.dailyMemoryDays,
        mainReadsMemory: this.runtimePolicy.mainReadsMemory,
        sharedBlocksMemory: this.runtimePolicy.sharedBlocksMemory,
      },
    });
    const extraSkillsDirs = this.extraAllowedRoots
      ?.map((r) => path.join(r, "skills"))
      .filter((d) => d !== path.join(this.workspaceDir, "skills"));
    this.skills = new SkillManager(
      this.workspaceDir,
      undefined,
      extraSkillsDirs && extraSkillsDirs.length > 0 ? extraSkillsDirs : undefined,
    );
    this.heartbeat = new HeartbeatManager(this.bootstrapDir ?? this.workspaceDir, {
      intervalMs: config.heartbeatInterval,
    });

    // 功能开关
    this.enableMemory = config.enableMemory ?? true;
    this.enableContext = config.enableContext ?? true;
    this.enableSkills = config.enableSkills ?? true;
    this.enableHeartbeat = config.enableHeartbeat ?? false;

    const globalLane = resolveGlobalLane();
    const envMax = Number(process.env.RDKCLAW_MAX_CONCURRENT_RUNS);
    const maxRuns = envMax > 0 ? envMax : (config.maxConcurrentRuns ?? 8);
    setLaneConcurrency(globalLane, maxRuns);

    // Tool Result Guard（对应 OpenClaw: attempt.ts → guardSessionManager()）
    this.toolResultGuard = installSessionToolResultGuard(this.sessions);
    this.compactHooks = config.compactHooks;
    this.systemPromptTelemetry = config.systemPromptTelemetry;
    this.toolHooks = config.toolHooks ?? new ToolHookRegistry();
    if (!config.toolHooks) {
      this.toolHooks.registerPostFailure(createExecLikeFailureHintHook());
    }
  }

  /** 运行时替换工具列表（如 RDK Studio 在对话中连接设备后注入板端工具） */
  setTools(tools: Tool[]) {
    this.tools = tools;
  }

  // ============== 事件订阅（对齐 pi-agent-core Agent） ==============

  /**
   * 订阅 Agent 事件
   *
   * 对应 pi-agent-core/agent.js → Agent.subscribe(fn)
   * - 返回 unsubscribe 函数
   * - 事件在 run() 中同步 emit
   */
  subscribe(fn: (event: MiniAgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * 向所有订阅者发送事件
   *
   * 对应 pi-agent-core/agent.js → Agent.emit(e)
   */
  private emit(event: MiniAgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略监听器错误，避免影响主流程
      }
    }
  }

  /**
   * 创建 SummarizeFn（用于 compaction）
   *
   * 通过 pi-ai 的 completeSimple 实现，与 Agent 当前的 model/apiKey 绑定
   */
  private createSummarizeFn(): SummarizeFn {
    const model = this.modelDef;
    const apiKey = this.apiKey;
    return async (params) => {
      const result = await completeSimple(model, {
        systemPrompt: params.system,
        messages: [{ role: "user", content: params.userPrompt, timestamp: Date.now() }],
      }, { maxTokens: params.maxTokens, apiKey });
      const text = result.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");
      return text.trim();
    };
  }

  /**
   * 上下文压缩：裁剪 + 可选摘要
   */
  private async prepareMessagesForRun(params: {
    messages: Message[];
    sessionKey: string;
    runId: string;
  }): Promise<{
    pruned: PruneResult;
    summary?: string;
    summaryMessage?: Message;
  }> {
    const effW = getEffectiveContextWindowTokens(this.contextTokens, this.modelDef.maxTokens ?? 8192);
    await this.compactHooks?.runPreHooks({
      sessionKey: params.sessionKey,
      runId: params.runId,
      messages: params.messages,
      reason: "run_start",
    });

    const streak = this.compactionFailStreakBySession.get(params.sessionKey) ?? 0;
    const skipLlm = streak >= Agent.MAX_COMPACTION_FAILURE_STREAK;

    const compacted = await compactHistoryIfNeeded({
      summarize: this.createSummarizeFn(),
      messages: params.messages,
      contextWindowTokens: effW,
      pruningSettings: this.runtimePolicy.pruning,
      skipLlmCompaction: skipLlm,
    });

    if (compacted.summary?.includes("Summary unavailable due to size limits")) {
      this.compactionFailStreakBySession.set(
        params.sessionKey,
        Math.min(streak + 1, Agent.MAX_COMPACTION_FAILURE_STREAK + 2),
      );
    } else if (compacted.summary && compacted.summary.length > 80) {
      this.compactionFailStreakBySession.set(params.sessionKey, 0);
    }

    await this.compactHooks?.runPostHooks({
      sessionKey: params.sessionKey,
      runId: params.runId,
      summaryChars: compacted.summary?.length ?? 0,
      droppedMessages: compacted.pruneResult.droppedMessages.length,
      reason: "run_start",
      success: Boolean(compacted.summary && compacted.summaryMessage),
    });

    if (compacted.summary && compacted.summaryMessage) {
      this.emit({
        type: "compaction",
        summaryChars: compacted.summary.length,
        droppedMessages: compacted.pruneResult.droppedMessages.length,
      });
    }

    return {
      pruned: compacted.pruneResult,
      summary: compacted.summary,
      summaryMessage: compacted.summaryMessage,
    };
  }

  /**
   * 根据策略/沙箱生成最终可用工具集
   */
  private resolveToolsForRun(): Tool[] {
    let tools = [...this.tools];

    if (!this.enableMemory) {
      tools = tools.filter(
        (tool) => tool.name !== "memory_search" && tool.name !== "memory_get" && tool.name !== "memory_save",
      );
    }

    // 对应 OpenClaw: isToolAllowedByPolicies() — 多策略交集（all must allow）
    const sandboxPolicy = this.buildSandboxToolPolicy();
    let filtered = filterToolsByPolicy(tools, this.toolPolicy);
    filtered = filterToolsByPolicy(filtered, sandboxPolicy);
    return filtered;
  }

  /**
   * 沙箱策略（示意版）
   */
  private buildSandboxToolPolicy(): ToolPolicy | undefined {
    if (!this.sandbox?.enabled) {
      return undefined;
    }
    const deny: string[] = [];
    if (!this.sandbox.allowExec) {
      deny.push("exec");
    }
    if (!this.sandbox.allowWrite) {
      deny.push("write", "edit");
    }
    return deny.length > 0 ? { deny } : undefined;
  }

  /**
   * 生成子代理 sessionKey
   */
  private buildSubagentSessionKey(agentId: string): string {
    const id = crypto.randomUUID();
    return `agent:${normalizeAgentId(agentId)}:subagent:${id}`;
  }

  /** 子代理工具范围（sessions_spawn.toolScope） */
  private subagentToolScopes = new Map<string, SpawnToolScope>();
  /**
   * 本会话最近一次已下发给模型的完整 system（含 Context/Skills/Memory/沙箱），用于 sessions_spawn 复用父快照。
   */
  private sessionLastBuiltSystemPrompt = new Map<string, string>();
  /**
   * 子代理冻结的 system：父会话快照 + explore/plan/verify 附加段（与 Claude fork 传递已渲染字节对齐）。
   */
  private subagentFrozenSystem = new Map<string, string>();

  /** 与会话结束时释放的 system / spawn 缓存，避免 Map 长期堆积 */
  private forgetSessionSystemCache(sessionKey: string): void {
    this.sessionLastBuiltSystemPrompt.delete(sessionKey);
    this.subagentToolScopes.delete(sessionKey);
    this.subagentFrozenSystem.delete(sessionKey);
  }

  /**
   * 启动子代理
   */
  private async spawnSubagent(params: {
    parentSessionKey: string;
    task: string;
    label?: string;
    cleanup?: "keep" | "delete";
    toolScope?: SpawnToolScope;
  }): Promise<{ runId: string; sessionKey: string }> {
    if (isSubagentSessionKey(params.parentSessionKey)) {
      throw new Error("子代理会话不能再触发子代理");
    }
    const childSessionKey = this.buildSubagentSessionKey(this.agentId);
    const scope = params.toolScope ?? "full";
    if (scope !== "full") {
      this.subagentToolScopes.set(childSessionKey, scope);
    }
    const parentSnap =
      this.sessionLastBuiltSystemPrompt.get(params.parentSessionKey)?.trim() ?? "";
    const addon = buildSubagentPromptAddon(scope);
    const frozenBody = [parentSnap, addon.trim()].filter(Boolean).join("\n\n");
    if (frozenBody) {
      this.subagentFrozenSystem.set(childSessionKey, frozenBody);
    }
    const runPromise = this.run(childSessionKey, params.task);
    runPromise
      .then(async (result) => {
        const summary = result.text.slice(0, 2000);
        this.emit({
          type: "subagent_summary",
          childSessionKey,
          label: params.label,
          task: params.task,
          summary,
        });
        const summaryMsg: Message = {
          role: "user",
          content: `[子代理摘要]\n${summary}`,
          timestamp: Date.now(),
        };
        await this.sessions.append(params.parentSessionKey, summaryMsg);
        if (params.cleanup === "delete") {
          await this.sessions.clear(childSessionKey);
        }
      })
      .catch((err) => {
        this.emit({
          type: "subagent_error",
          childSessionKey,
          label: params.label,
          task: params.task,
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        this.forgetSessionSystemCache(childSessionKey);
      });
    return {
      runId: childSessionKey,
      sessionKey: childSessionKey,
    };
  }

  /**
   * 构建完整系统提示
   */
  private async buildSystemPrompt(params?: { sessionKey?: string }): Promise<string> {
    const sk0 = params?.sessionKey;
    if (sk0) {
      const frozen = this.subagentFrozenSystem.get(sk0);
      if (frozen !== undefined && frozen.length > 0) {
        // 快照已含父会话 buildSystemPrompt 全文（含沙箱段）；勿再追加，避免重复 ## 沙箱
        return frozen;
      }
    }

    let prompt = this.baseSystemPrompt;
    const availableTools = new Set(this.resolveToolsForRun().map((t) => t.name));

    if (this.enableContext) {
      const contextPrompt = await this.context.buildContextPrompt({
        sessionKey: params?.sessionKey,
      });
      if (contextPrompt) {
        prompt += contextPrompt;
      }
    }

    if (this.enableSkills) {
      const skillsPrompt = await this.skills.buildSkillsPrompt();
      if (skillsPrompt) {
        // 对齐 OpenClaw: system-prompt.ts → buildSkillsSection()
        // 结构化行为指令，告诉模型如何使用技能
        prompt += "\n\n## Skills (mandatory)";
        prompt += "\nBefore replying: scan <available_skills> <description> entries.";
        prompt += "\n- If exactly one skill clearly applies: read its SKILL.md at <location> with `read`, then follow it.";
        prompt += "\n- If multiple could apply: choose the most specific one, then read/follow it.";
        prompt += "\n- If none clearly apply: do not read any SKILL.md.";
        prompt += "\nConstraints: never read more than one skill up front; only read after selecting.";
        prompt += skillsPrompt;
      }
    }

    if (this.enableMemory && (availableTools.has("memory_search") || availableTools.has("memory_save"))) {
      prompt += `\n\n## 记忆\n- 回答涉及历史、偏好、决定时：先用 memory_search 查找，再用 memory_get 拉取细节\n- 遇到值得长期保存的信息（用户偏好、关键决策、重要事实）：用 memory_save 写入\n- 不要保存日常闲聊或一次性查询`;
    }

    if (this.sandbox?.enabled) {
      const writeHint = this.sandbox.allowWrite ? "可写" : "只读";
      const execHint = this.sandbox.allowExec ? "允许" : "禁止";
      prompt += `\n\n## 沙箱\n当前为沙箱模式：工作区${writeHint}，命令执行${execHint}。`;
    }

    return prompt;
  }

  /**
   * 运行 Agent
   */
  async run(
    sessionIdOrKey: string,
    userMessage: string,
  ): Promise<RunResult> {
    const sessionKey = resolveSessionKey({
      agentId: this.agentId,
      sessionId: sessionIdOrKey,
      sessionKey: sessionIdOrKey,
    });
    const sessionLane = resolveSessionLane(sessionKey);
    const globalLane = resolveGlobalLane();

    return enqueueInLane(sessionLane, () =>
      enqueueInLane(globalLane, async () => {
        const runId = crypto.randomUUID();

        // AbortController: 每次 run 创建独立的 controller
        const runAbortController = new AbortController();
        this.runAbortControllers.set(runId, runAbortController);

        // 初始化 steering 队列
        if (!this.steeringQueues.has(sessionKey)) {
          this.steeringQueues.set(sessionKey, []);
        }

        this.emit({
          type: "agent_start",
          runId,
          sessionKey,
          agentId: this.agentId,
          model: this.modelDef.id,
        });

        // 标记 loop 内部已 emit 过 agent_error，避免 catch 中重复 emit
        let loopError: string | undefined;

        try {
          const ctxInfo = resolveContextWindowInfo({
            contextTokens: this.contextTokens,
            defaultTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
          });
          const ctxGuard = evaluateContextWindowGuard({
            info: ctxInfo,
            warnBelowTokens: CONTEXT_WINDOW_WARN_BELOW_TOKENS,
            hardMinTokens: CONTEXT_WINDOW_HARD_MIN_TOKENS,
          });
          if (ctxGuard.shouldWarn) {
            console.warn(
              `上下文窗口偏小: ctx=${ctxGuard.tokens} (warn<${CONTEXT_WINDOW_WARN_BELOW_TOKENS}) source=${ctxGuard.source}`,
            );
          }
          if (ctxGuard.shouldBlock) {
            throw new Error(
              `上下文窗口过小 (${ctxGuard.tokens} tokens)，最低要求 ${CONTEXT_WINDOW_HARD_MIN_TOKENS} tokens。`,
            );
          }

          // 加载历史
          const history = await this.sessions.load(sessionKey);

          let memoriesUsed = 0;
          const toolCtx: ToolContext = {
            workspaceDir: this.workspaceDir,
            bootstrapDir: this.bootstrapDir,
            extraAllowedRoots: this.extraAllowedRoots,
            sessionKey,
            sessionId: sessionIdOrKey,
            agentId: resolveAgentIdFromSessionKey(sessionKey),
            memory: this.enableMemory ? this.memory : undefined,
            abortSignal: runAbortController.signal,
            onMemorySearch: (results) => {
              memoriesUsed += results.length;
            },
            spawnSubagent: async ({ task, label, cleanup, toolScope }) =>
              this.spawnSubagent({
                parentSessionKey: sessionKey,
                task,
                label,
                cleanup,
                toolScope,
              }),
            ...this.toolContextExtras,
            studioDeviceId:
              this.studioDeviceIdResolver?.() ?? this.toolContextExtras?.studioDeviceId,
          };

          let processedMessage = userMessage;
          let skillTriggered: string | undefined;

          // 技能匹配（对应 OpenClaw: auto-reply/skill-commands.ts → model dispatch 路径）
          // /command args → 改写消息，引导模型读取对应 SKILL.md
          if (this.enableSkills) {
            const match = await this.skills.match(userMessage);
            if (match) {
              skillTriggered = match.command.skillName;
              // 对齐 OpenClaw: 改写消息告诉模型使用哪个技能
              // 模型收到后扫描 <available_skills>，找到对应 skill，
              // 通过 read 工具加载 SKILL.md 并遵循其指令
              const userInput = match.args ?? "";
              processedMessage = `Use the "${match.command.skillName}" skill for this request.\n\nUser input:\n${userInput}`;
            }
          }

          // Heartbeat: 不在此注入任务到消息
          // 对齐 openclaw: heartbeat 是独立的主动通知系统，
          // 读取 HEARTBEAT.md 并传递给 LLM，不会注入到用户消息中

          // 添加用户消息
          const userMsg: Message = {
            role: "user",
            content: processedMessage,
            timestamp: Date.now(),
          };
          await this.sessions.append(sessionKey, userMsg);

          const currentMessages = [...history, userMsg];

          // Compaction: run 开始前做一次
          const prep = await this.prepareMessagesForRun({
            messages: currentMessages,
            sessionKey,
            runId,
          });
          let compactionSummary = prep.summaryMessage;
          if (prep.summary) {
            let firstKeptEntryId: string | undefined;
            for (const msg of prep.pruned.messages) {
              const candidate = this.sessions.resolveMessageEntryId(sessionKey, msg);
              if (candidate) {
                firstKeptEntryId = candidate;
                break;
              }
            }
            if (firstKeptEntryId) {
              const tokensBefore = estimateMessagesTokens(currentMessages);
              await this.sessions.appendCompaction(
                sessionKey,
                prep.summary,
                firstKeptEntryId,
                tokensBefore,
              );
            } else {
              console.warn("无法定位 compaction 的 firstKeptEntryId，已跳过记录。");
            }
          }

          // 构建系统提示
          const systemPrompt = await this.buildSystemPrompt({ sessionKey });
          this.sessionLastBuiltSystemPrompt.set(sessionKey, systemPrompt);

          // 工具包装: 注入 run-level abort signal + 子代理范围过滤（每轮重新 resolve，避免 setTools 后仍用旧列表）
          const buildToolsForRun = () => {
            let raw = this.resolveToolsForRun();
            const scopeName = this.subagentToolScopes.get(sessionKey);
            const allowed = resolveSpawnToolSet(scopeName);
            if (allowed) {
              raw = raw.filter((t) => allowed.has(t.name));
            }
            return raw.map((t) => wrapToolWithAbortSignal(t, runAbortController.signal));
          };

          // ===== Agent Loop（EventStream 模式） =====
          // 对应 pi-agent-core: Agent._runLoop() → for await (const event of stream)
          const getSteeringMessages = async (): Promise<Message[]> => {
            const queue = this.steeringQueues.get(sessionKey);
            if (!queue || queue.length === 0) return [];
            const drained = queue.splice(0);
            return drained.map((text) => ({
              role: "user" as const,
              content: text,
              timestamp: Date.now(),
            }));
          };

          // 组合审批检查函数（对齐 openclaw: bash-tools.exec.ts → approval flow）
          const checkToolApproval =
            this.approval && this.onApprovalRequest
              ? async (call: { id: string; name: string; input: unknown }) => {
                  // deny 级别: 无条件拒绝，不提示（对齐 openclaw: ExecSecurity.deny）
                  const security =
                    this.approval!.tools?.[call.name] ?? this.approval!.security ?? "full";
                  if (security === "deny") {
                    return { approved: false, decision: "deny" };
                  }

                  const needed = requiresApproval({
                    toolName: call.name,
                    config: this.approval!,
                    allowlist: this.allowlist.getAll(),
                  });
                  if (!needed) return null;

                  const decision: ApprovalDecision = await this.onApprovalRequest!({
                    toolCallId: call.id,
                    toolName: call.name,
                    args: call.input,
                  });
                  if (decision === "allow-always") {
                    this.allowlist.add(call.name);
                  }
                  return {
                    approved: decision !== "deny",
                    decision,
                  };
                }
              : undefined;

          const stream = runAgentLoop({
            runId,
            sessionKey,
            agentId: this.agentId,
            currentMessages,
            compactionSummary,
            systemPrompt,
            toolsForRun: buildToolsForRun(),
            getToolsForRun: buildToolsForRun,
            toolCtx,
            modelDef: this.modelDef,
            streamFn: this.streamFn,
            apiKey: this.apiKey,
            temperature: this.temperature,
            topP: this.topP,
            reasoning: this.reasoning,
            maxTurns: this.maxTurns,
            contextTokens: this.contextTokens,
            maxOutputTokens: this.modelDef.maxTokens,
            compactHooks: this.compactHooks,
            systemPromptMeta: this.systemPromptTelemetry ?? {
              hashShort: crypto.createHash("sha256").update(systemPrompt).digest("hex").slice(0, 16),
              layerCount: 0,
            },
            getSteeringMessages,
            checkToolApproval,
            appendMessage: (sk, msg) => this.sessions.append(sk, msg),
            prepareCompaction: async (p) => {
              const r = await this.prepareMessagesForRun(p);
              return { summary: r.summary, summaryMessage: r.summaryMessage };
            },
            abortSignal: runAbortController.signal,
            toolHooks: this.toolHooks,
          });

          // 对应 pi-agent-core: for await (const event of stream) + emit + state update
          for await (const event of stream) {
            this.emit(event);

            if (event.type === "agent_error") {
              loopError = event.error;
            }
          }

          const loopResult = await stream.result();

          if (loopError) {
            throw new Error(loopError);
          }

          return {
            runId,
            text: loopResult.finalText,
            turns: loopResult.turns,
            toolCalls: loopResult.totalToolCalls,
            skillTriggered,
            memoriesUsed,
          };
        } catch (err) {
          // loop 内部已 emit 过 agent_error，不重复 emit
          if (!loopError) {
            this.emit({
              type: "agent_error",
              runId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          throw err;
        } finally {
          // 对应 OpenClaw: attempt.ts finally → flushPendingToolResults()
          await this.toolResultGuard.flushPendingToolResults(sessionKey);
          this.runAbortControllers.delete(runId);
        }
      }),
    );
  }

  /**
   * 中止运行
   *
   * 对应 OpenClaw: pi-embedded-runner/run/attempt.ts → abortRun()
   */
  abort(runId?: string): void {
    if (runId) {
      const controller = this.runAbortControllers.get(runId);
      if (controller) {
        controller.abort();
      }
    } else {
      for (const controller of this.runAbortControllers.values()) {
        controller.abort();
      }
    }
  }

  /**
   * 向运行中的会话注入 steering 消息
   *
   * 对应 OpenClaw: pi-agent-core → session.steer(text) / agent.steeringQueue
   */
  steer(sessionKey: string, text: string): void {
    const queue = this.steeringQueues.get(sessionKey);
    if (queue) {
      queue.push(text);
    } else {
      this.steeringQueues.set(sessionKey, [text]);
    }
  }

  /**
   * 启动 Heartbeat 监控
   *
   * 对齐 openclaw: heartbeat 是独立的主动通知系统，
   * 定时触发后会走一次后台巡检运行（独立 session），
   * 仅在检测到异常或修复动作时通过回调通知调用方。
   */
  startHeartbeat(callback?: (content: string, reason: string) => void): void {
    this.heartbeat.onHeartbeat(async (opts): Promise<{ text?: string } | null> => {
      const heartbeatSessionKey = `auto:heartbeat:${this.agentId}`;
      const prompt = [
        "这是一次后台 HEARTBEAT 巡检触发。",
        `触发原因: ${opts.reason}`,
        "请严格依据以下 HEARTBEAT.md 指令执行必要检查与修复。",
        "仅在发现异常或已采取修复动作时输出告警摘要；若一切正常请只回复 HEARTBEAT_OK。",
        "",
        opts.content,
      ].join("\n");

      try {
        const run = await this.run(heartbeatSessionKey, prompt);
        const text = (run.text || "").trim();
        if (!text || /^HEARTBEAT_OK$/i.test(text)) {
          return null;
        }
        callback?.(text, opts.reason);
        return { text };
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        callback?.(`[heartbeat failed] ${errorText}`, opts.reason);
        return { text: `[heartbeat failed] ${errorText}` };
      }
    });

    this.heartbeat.start();
  }

  /**
   * 停止 Heartbeat 监控
   */
  stopHeartbeat(): void {
    this.heartbeat.stop();
  }

  /**
   * 手动触发 Heartbeat 检查
   */
  async triggerHeartbeat(): Promise<HeartbeatResult> {
    return this.heartbeat.trigger();
  }

  /**
   * 重置会话
   */
  async reset(sessionIdOrKey: string): Promise<void> {
    const sessionKey = resolveSessionKey({
      agentId: this.agentId,
      sessionId: sessionIdOrKey,
      sessionKey: sessionIdOrKey,
    });
    await this.sessions.clear(sessionKey);
    this.forgetSessionSystemCache(sessionKey);
  }

  /**
   * 获取会话历史
   */
  getHistory(sessionIdOrKey: string): Message[] {
    const sessionKey = resolveSessionKey({
      agentId: this.agentId,
      sessionId: sessionIdOrKey,
      sessionKey: sessionIdOrKey,
    });
    return this.sessions.get(sessionKey);
  }

  /**
   * 列出会话
   */
  async listSessions(): Promise<string[]> {
    return this.sessions.list();
  }

  // ===== 子系统访问器 =====

  getMemory(): MemoryManager {
    return this.memory;
  }

  getContext(): ContextLoader {
    return this.context;
  }

  getSkills(): SkillManager {
    return this.skills;
  }

  getHeartbeat(): HeartbeatManager {
    return this.heartbeat;
  }
}
