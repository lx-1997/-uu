import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import {
  Agent,
  builtinTools,
  type MiniAgentEvent,
  type Tool,
} from "../agent/openclaw-index.js";
import {
  buildModelDef,
  buildStreamFn,
  getApiKey,
  getBaseUrl,
  loadProviderConfig,
  type ProviderConfig,
} from "../agent/provider-setup.js";
import { createRdkTools } from "../agent/tools/rdk-tools.js";
import { createStudioTools, type StudioAutonomyRuntime } from "../agent/tools/studio-tools.js";
import { createWebTools } from "../agent/tools/web-tools.js";
import { OpenClawDeploymentManager } from "../managers/OpenClawDeploymentManager.js";
import { boardOpenClawDelegateTool } from "./tools/board-openclaw-delegate.js";
import { PersonaStore } from "./persona-store.js";
import { SkillRegistry } from "./skills/registry.js";
import { RDKClawPolicyStore } from "./policy-store.js";
import type {
  ApprovalDecisionMode,
  PersonaProfile,
  RDKClawChatRequest,
  RDKClawEvent,
  RDKClawPolicy,
  RDKClawSkillMeta,
  RiskLevel,
  UserProfile,
} from "./types.js";

const DEFAULT_CONFIG: ProviderConfig = {
  provider: "qwen",
  model: "qwen3.5-plus",
  apiKey: "",
};

function resolveProviderConfig(): ProviderConfig {
  const config = loadProviderConfig();
  if (config?.apiKey) {
    return config;
  }
  return {
    ...DEFAULT_CONFIG,
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: process.env.OPENAI_BASE_URL || DEFAULT_CONFIG.baseUrl,
  };
}

function buildPersonaPrompt(persona: PersonaProfile) {
  return [
    `你是 ${persona.name}。`,
    persona.stylePrompt,
    `风格: ${persona.tone}；风险偏好: ${persona.riskLevel}。`,
    "优先使用 Skill 驱动能力编排，不要在回答中暴露内部实现细节。",
    "若任务涉及真实设备操作、板端插件或板端上下文，请优先调用 board_openclaw_delegate。",
    `委派策略: delegationBias=${persona.delegationBias}, autonomy=${persona.autonomyLevel}, boundary=${persona.riskBoundary}。`,
    "若用户要求定时/周期/提醒/每秒推送，必须优先调用 rdkclaw_task_create 创建自治任务，而不是仅给方案说明。",
    "若任务需要联网信息，优先使用 web_search/web_fetch/web_extract 工具链，并在回答中给出来源链接。",
    "当联网结论对后续有长期价值时，先总结再调用 rdkclaw_memory_append_daily 写入 daily memory。",
    "输出简洁，明确给出执行结果与下一步建议。",
  ].join("\n");
}

interface DelegateDecision {
  forceBoard: boolean;
  preferBoard: boolean;
  source: "user_mode" | "skill_policy" | "policy_rule" | "persona" | "default";
  reason: string;
  confidence: number;
}

function selectDelegateDecision(
  req: RDKClawChatRequest,
  persona: PersonaProfile,
  policy: RDKClawPolicy,
  matchedSkills: RDKClawSkillMeta[],
): DelegateDecision {
  const text = req.message.toLowerCase();
  if (req.mode === "board") {
    return { forceBoard: true, preferBoard: true, source: "user_mode", reason: "用户指定 board 模式", confidence: 1 };
  }
  if (req.mode === "local") {
    return { forceBoard: false, preferBoard: false, source: "user_mode", reason: "用户指定 local 模式", confidence: 1 };
  }
  const requiresBoardSkill = matchedSkills.find((s) => s.runtimePolicy?.requiresBoard);
  if (requiresBoardSkill) {
    return {
      forceBoard: true,
      preferBoard: true,
      source: "skill_policy",
      reason: `Skill(${requiresBoardSkill.name}) 要求板端执行`,
      confidence: 0.95,
    };
  }
  if (/板端|openclaw|插件|部署|刷写|系统服务|diagnose|repair|deploy/.test(text)) {
    return {
      forceBoard: true,
      preferBoard: true,
      source: "policy_rule",
      reason: "命中板端高复杂度规则",
      confidence: 0.9,
    };
  }
  if (req.mode === "board-preferred") {
    return { forceBoard: false, preferBoard: true, source: "user_mode", reason: "用户偏好板端", confidence: 0.85 };
  }
  if (policy.delegation.strategy === "board-first") {
    return { forceBoard: false, preferBoard: true, source: "persona", reason: "策略面板配置 board-first", confidence: 0.85 };
  }
  if (policy.delegation.strategy === "local-first") {
    return { forceBoard: false, preferBoard: false, source: "persona", reason: "策略面板配置 local-first", confidence: 0.85 };
  }
  if (persona.delegationBias === "board-first" || persona.boardDelegationBias === "high") {
    return { forceBoard: false, preferBoard: true, source: "persona", reason: "人格配置偏向板端委派", confidence: 0.7 };
  }
  return { forceBoard: false, preferBoard: false, source: "default", reason: "默认本地优先，按需调用板端", confidence: 0.6 };
}

function resolveExecutor(toolName?: string) {
  return toolName === "board_openclaw_delegate" ? "board_openclaw" : "rdkclaw_local";
}

function mapMiniEvent(
  event: MiniAgentEvent,
  base: { runId: string; sessionId: string },
): RDKClawEvent | null {
  switch (event.type) {
    case "message_delta":
      return { type: "text", data: { delta: event.delta, ...base } };
    case "turn_start":
      return { type: "turn_start", data: { turn: event.turn, ...base } };
    case "turn_end":
      return { type: "turn_end", data: { turn: event.turn, ...base } };
    case "message_end":
      return { type: "message_end", data: { text: event.text, ...base } };
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
          result: event.result,
          isError: event.isError,
          phase: event.isError ? "error" : "end",
          executor: resolveExecutor(event.toolName),
        },
      };
    case "retry":
      return {
        type: "retry",
        data: { attempt: event.attempt, delay: event.delay, error: event.error, ...base },
      };
    case "agent_error":
      return { type: "error", data: { error: event.error, ...base } };
    case "agent_end":
      return { type: "done", data: { ok: true, ...base } };
    default:
      return null;
  }
}

export class RDKClawApp {
  private readonly workspaceDir: string;
  private readonly openClawManager: OpenClawDeploymentManager;
  private readonly personaStore: PersonaStore;
  private readonly skills: SkillRegistry;
  private readonly policyStore: RDKClawPolicyStore;
  private autonomyRuntime?: StudioAutonomyRuntime;
  private pendingApprovals = new Map<string, {
    resolve: (decision: ApprovalDecisionMode) => void;
    reject: (error: Error) => void;
    runId: string;
    sessionId: string;
    createdAt: number;
  }>();
  private runAgents = new Map<string, Agent>();
  private sessionAutoApprove = new Map<string, boolean>();

  constructor(workspaceDir: string, openClawManager: OpenClawDeploymentManager) {
    this.workspaceDir = workspaceDir;
    this.openClawManager = openClawManager;
    this.personaStore = new PersonaStore();
    this.skills = new SkillRegistry({ workspaceDir });
    this.policyStore = new RDKClawPolicyStore();
  }

  setAutonomyRuntime(runtime: StudioAutonomyRuntime) {
    this.autonomyRuntime = runtime;
  }

  getPersona(): PersonaProfile {
    return this.personaStore.getPersona();
  }

  updatePersona(patch: Partial<PersonaProfile>): PersonaProfile {
    return this.personaStore.savePersona(patch);
  }

  getUserProfile(userId: string): UserProfile | null {
    return this.personaStore.getUser(userId);
  }

  saveUserProfile(user: UserProfile): UserProfile {
    return this.personaStore.saveUserProfile(user);
  }

  listSkills() {
    return this.skills.list();
  }

  reloadSkills() {
    return this.skills.reload();
  }

  getPolicy(): RDKClawPolicy {
    return this.policyStore.getPolicy();
  }

  savePolicy(patch: Partial<RDKClawPolicy>): RDKClawPolicy {
    return this.policyStore.savePolicy(patch);
  }

  decideApproval(approvalId: string, decision: ApprovalDecisionMode) {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return false;
    this.pendingApprovals.delete(approvalId);
    pending.resolve(decision);
    return true;
  }

  cancelRun(runId: string): boolean {
    const agent = this.runAgents.get(runId);
    if (!agent) return false;
    agent.abort();
    return true;
  }

  private resolveToolRisk(toolName: string): RiskLevel {
    if (toolName === "web_fetch") return "high";
    if (toolName === "web_search" || toolName === "web_extract") return "medium";
    if (toolName === "board_openclaw_delegate") return "high";
    if (/write|exec|restart|flash|upload|set_/i.test(toolName)) return "high";
    if (/diagnose|status|read|list|topics|nodes/i.test(toolName)) return "low";
    return "medium";
  }

  private isRiskAtLeast(risk: RiskLevel, threshold: RiskLevel) {
    const map: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };
    return map[risk] >= map[threshold];
  }

  private shouldRequireApproval(policy: RDKClawPolicy, risk: RiskLevel, sessionId: string, toolName: string): boolean {
    if (/^web_/i.test(toolName) && !policy.network.requireApproval) return false;
    if (this.sessionAutoApprove.get(sessionId)) return false;
    if (policy.approval.mode === "auto") return false;
    if (policy.approval.mode === "always") return true;
    return this.isRiskAtLeast(risk, policy.approval.riskThreshold);
  }

  private wrapToolWithApproval(
    tool: Tool,
    policy: RDKClawPolicy,
    emitEvent: (event: RDKClawEvent) => void,
    base: { runId: string; sessionId: string },
  ): Tool {
    return {
      ...tool,
      execute: async (input, ctx) => {
        if (tool.name.startsWith("web_") && !policy.network.enabled) {
          throw new Error("联网工具已禁用，请在策略面板中开启网络能力。");
        }
        const risk = this.resolveToolRisk(tool.name);
        if (!this.shouldRequireApproval(policy, risk, base.sessionId, tool.name)) {
          return tool.execute(input, ctx);
        }
        const approvalId = `approval-${crypto.randomUUID()}`;
        emitEvent({
          type: "approval_required",
          data: {
            ...base,
            approvalId,
            toolName: tool.name,
            args: input as Record<string, unknown>,
            risk,
            executor: resolveExecutor(tool.name),
          },
        });
        const decision = await new Promise<ApprovalDecisionMode>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pendingApprovals.delete(approvalId);
            reject(new Error("审批超时，任务已取消"));
          }, 300000);
          this.pendingApprovals.set(approvalId, {
            runId: base.runId,
            sessionId: base.sessionId,
            createdAt: Date.now(),
            resolve: (nextDecision) => {
              clearTimeout(timer);
              resolve(nextDecision);
            },
            reject: (err) => {
              clearTimeout(timer);
              reject(err);
            },
          });
        });
        emitEvent({
          type: "approval_decision",
          data: {
            ...base,
            approvalId,
            toolName: tool.name,
            decision,
          },
        });
        if (decision === "allow_session_auto") {
          this.sessionAutoApprove.set(base.sessionId, true);
        } else if (decision === "allow_global_auto") {
          this.policyStore.savePolicy({
            approval: {
              mode: "auto",
              riskThreshold: policy.approval.riskThreshold,
            },
          });
        } else if (decision === "deny") {
          throw new Error(`用户拒绝执行工具 ${tool.name}`);
        }
        return tool.execute(input, ctx);
      },
    };
  }

  private createTools(
    req: RDKClawChatRequest,
    emitEvent: (event: RDKClawEvent) => void,
    base: { runId: string; sessionId: string },
    decision: DelegateDecision,
    policy: RDKClawPolicy,
  ): Tool[] {
    const tools: Tool[] = [
      ...builtinTools,
      ...createStudioTools(this.autonomyRuntime),
    ];
    if (policy.network.enabled) {
      tools.push(
        ...createWebTools({
          maxFetchChars: policy.network.maxFetchChars,
          timeoutMs: 15000,
        }),
      );
    }
    if (req.deviceId) {
      if (!decision.forceBoard) {
        tools.push(...createRdkTools(req.deviceId));
      }
      tools.push(
        boardOpenClawDelegateTool(req.deviceId, this.openClawManager, (chunk) => {
          emitEvent({
            type: "tool_progress",
            data: {
              ...base,
              toolName: "board_openclaw_delegate",
              name: "board_openclaw_delegate",
              toolCallId: "board_openclaw_delegate",
              phase: "running",
              executor: "board_openclaw",
              chunk,
            },
          });
        }),
      );
    }
    return tools.map((tool) => this.wrapToolWithApproval(tool, policy, emitEvent, base));
  }

  async *streamChat(req: RDKClawChatRequest): AsyncGenerator<RDKClawEvent> {
    const providerConfig = resolveProviderConfig();
    if (!providerConfig.apiKey) {
      throw new Error("未配置 AI 模型 API Key，请先在设置中配置。");
    }

    const persona = this.personaStore.getPersona();
    const policy = this.policyStore.getPolicy();
    const matchedSkills = this.skills.matchByText(req.message).slice(0, 5);
    const decision = selectDelegateDecision(req, persona, policy, matchedSkills);
    const systemPrompt = [
      buildPersonaPrompt(persona),
      decision.forceBoard
        ? "本次任务必须优先调用 board_openclaw_delegate，不要直接执行本地设备写操作工具。"
        : decision.preferBoard
          ? "本次任务优先考虑 board_openclaw_delegate，除非任务明显适合本地轻量工具。"
          : "本次任务默认本地优先，必要时再调用 board_openclaw_delegate。",
    ].join("\n");
    const modelDef = buildModelDef(providerConfig);
    const streamFn = buildStreamFn(providerConfig);
    const apiKey = getApiKey(providerConfig);
    const baseUrl = getBaseUrl(providerConfig);

    process.env.OPENAI_BASE_URL = baseUrl;
    process.env.OPENAI_API_KEY = apiKey;
    process.env.RDKCLAW_DAILY_MEMORY_DAYS = String(Math.max(1, policy.memory.dailyMemoryDays || 2));
    process.env.RDKCLAW_MAIN_READS_MEMORY = policy.memory.mainSessionReadsMemory ? "1" : "0";
    process.env.RDKCLAW_SHARED_BLOCKS_MEMORY = policy.memory.sharedSessionBlocksMemory ? "1" : "0";

    const sessionKey = req.sessionId?.trim() || `rdkclaw-${Date.now()}`;
    const runId = crypto.randomUUID();
    const base = { runId, sessionId: sessionKey };
    const queue: RDKClawEvent[] = [
      {
        type: "meta",
        data: {
          ...base,
          executor: "rdkclaw_local",
          phase: "start",
          message: "RDK Studio Claw 开始编排任务",
          decision_source: decision.source,
          decision_reason: decision.reason,
          confidence: decision.confidence,
          matched_skills: matchedSkills.map((s) => s.name),
          approval_mode: policy.approval.mode,
          network_enabled: policy.network.enabled,
          network_max_fetch_chars: policy.network.maxFetchChars,
          network_require_approval: policy.network.requireApproval,
        },
      },
    ];
    const agent = new Agent({
      agentId: "rdkclaw",
      systemPrompt,
      tools: this.createTools(req, (event) => queue.push(event), base, decision, policy),
      streamFn,
      modelDef,
      apiKey,
      provider: providerConfig.provider,
      model: providerConfig.model,
      workspaceDir: this.workspaceDir,
      sessionDir: path.join(os.homedir(), ".rdkstudio", "sessions"),
      memoryDir: path.join(os.homedir(), ".rdkstudio", "memory"),
      enableContext: true,
      enableSkills: true,
      enableMemory: true,
      enableHeartbeat: false,
      maxTurns: 12,
      temperature: 0.7,
      reasoning: "medium",
    });
    let finished = false;
    let failed: unknown = null;
    this.runAgents.set(runId, agent);
    const unsubscribe = agent.subscribe((event) => {
      const mapped = mapMiniEvent(event, base);
      if (mapped) queue.push(mapped);
    });

    const runPromise = agent
      .run(sessionKey, req.message)
      .catch((error) => {
        failed = error;
      })
      .finally(() => {
        finished = true;
        unsubscribe();
        this.runAgents.delete(runId);
      });

    while (!finished || queue.length > 0) {
      while (queue.length > 0) {
        yield queue.shift() as RDKClawEvent;
      }
      if (!finished) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }

    await runPromise;
    if (failed) {
      throw failed;
    }
  }
}
