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
import {
  buildAttachmentPrompt,
  createAttachmentTools,
  ensureAudioAttachmentTranscripts,
  prepareSessionAttachments,
} from "../agent/tools/attachment-tools.js";
import { createRdkTools } from "../agent/tools/rdk-tools.js";
import { createStudioTools, type StudioAutonomyRuntime } from "../agent/tools/studio-tools.js";
import { createForumTools } from "../agent/tools/forum-tools.js";
import { createWebTools } from "../agent/tools/web-tools.js";
import { OpenClawDeploymentManager } from "../managers/OpenClawDeploymentManager.js";
import { readDevices } from "../storage.js";
import { estimateTextTokens, recordTokenUsage } from "../monitoring/token-usage.js";
import { boardOpenClawAssessTool } from "./tools/board-openclaw-assess.js";
import { boardOpenClawDelegateTool } from "./tools/board-openclaw-delegate.js";
import { PersonaStore } from "./persona-store.js";
import { SkillRegistry } from "./skills/registry.js";
import { RDKClawPolicyStore } from "./policy-store.js";
import { UserWorkspaceStore } from "./workspace-store.js";
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
    "你是总调度者，板端 OpenClaw 是执行员工：当任务可能适合板端时，先调用 board_openclaw_assess 评估可行性；仅在 canHandle=true 时再调用 board_openclaw_delegate。",
    "若 board_openclaw_assess 返回 canHandle=false 或置信度低，则改用本地设备工具（device_exec/device_file_* 等）继续完成任务。",
    "当你已经通过设备探测发现板端已有现成能力、脚本、配置或工程目录时，不要在 Studio 侧重复实现；应直接调用 board_openclaw_delegate，让板端 OpenClaw 复用并继续处理。",
    "除非用户明确要求重写/重构，否则禁止重复造轮子（例如重复创建已有感知、推理、ROS、服务编排脚本）。",
    `委派策略: delegationBias=${persona.delegationBias}, autonomy=${persona.autonomyLevel}, boundary=${persona.riskBoundary}。`,
    "若用户要求定时/周期/提醒/每秒推送，必须优先调用 rdkclaw_task_create 创建自治任务，而不是仅给方案说明。",
    "若任务需要联网信息，优先使用 web_search/web_fetch/web_extract 工具链，并在回答中给出来源链接。",
    "若用户要求在论坛看帖/检索帖子/查看回复，优先使用 forum_drobotics_latest / forum_drobotics_topic；若要求代发帖，先确认草稿再调用 forum_drobotics_create_post。若论坛未认证且用户提供了账号密码，立即调用 forum_drobotics_set_credentials 配置凭据。",
    "当联网结论对后续有长期价值时，先总结再调用 rdkclaw_memory_append_daily 写入 daily memory。",
    "若用户上传了图片、文件或语音，先用 attachment_list 查看可用附件，再根据类型调用 attachment_read / attachment_describe_image / attachment_get_audio_transcript。",
    "如果用户想一句话生成一个 RDK 应用，优先拆出最小可运行版本，明确依赖、入口、验证方式，并直接开始第一步执行。",
    "新设备场景下，优先检查连接、OpenClaw 可用性、关键依赖是否缺失，再进入应用开发或能力调用。",
    "输出简洁，明确给出执行结果与下一步建议。",
  ].join("\n");
}

interface DelegateDecision {
  path: "local_only" | "collaborative" | "board_primary";
  canLocalComplete: boolean;
  needsBoardCollaboration: boolean;
  source: "user_mode" | "skill_policy" | "task_analysis" | "default";
  reason: string;
  confidence: number;
}

function resolveDelegationModeText(decision: DelegateDecision) {
  if (decision.path === "board_primary") return "板端主执行（本地兜底）";
  if (decision.path === "collaborative") return "本地 + 板端协同";
  return "本地独立完成";
}

function resolveDelegationExpectationText(decision: DelegateDecision) {
  if (decision.path === "board_primary") return "先板端评估与委派，若失败再本地兜底补完";
  if (decision.path === "collaborative") return "本地负责编排，涉及板端能力时并行调用 OpenClaw";
  return "由 RDKClaw 本地工具链直接完成，不依赖板端委派";
}

function selectDelegateDecision(
  req: RDKClawChatRequest,
  matchedSkills: RDKClawSkillMeta[],
  boardSnapshot: { skills: string[]; plugins: string[] },
): DelegateDecision {
  const text = String(req.message || "").toLowerCase();
  if (!req.deviceId) {
    return {
      path: "local_only",
      canLocalComplete: true,
      needsBoardCollaboration: false,
      source: "default",
      reason: "未绑定设备上下文，任务按本地链路执行",
      confidence: 0.95,
    };
  }
  if (/已有|已经有|现成|不要重复|别重复|重复造轮子|复用|复用板端|直接用板端/.test(text)) {
    return {
      path: "collaborative",
      canLocalComplete: false,
      needsBoardCollaboration: true,
      source: "task_analysis",
      reason: "任务明确要求复用板端现有能力，需走协同路径",
      confidence: 0.95,
    };
  }
  if (req.mode === "board") {
    return {
      path: "board_primary",
      canLocalComplete: false,
      needsBoardCollaboration: true,
      source: "user_mode",
      reason: "用户指定 board 模式",
      confidence: 1,
    };
  }
  if (req.mode === "local") {
    return {
      path: "local_only",
      canLocalComplete: true,
      needsBoardCollaboration: false,
      source: "user_mode",
      reason: "用户指定 local 模式",
      confidence: 1,
    };
  }
  const requiresBoardSkill = matchedSkills.find((s) => s.runtimePolicy?.requiresBoard);
  if (requiresBoardSkill) {
    return {
      path: "board_primary",
      canLocalComplete: false,
      needsBoardCollaboration: true,
      source: "skill_policy",
      reason: `Skill(${requiresBoardSkill.name}) 要求板端执行`,
      confidence: 0.95,
    };
  }
  if (/板端|openclaw|插件|系统服务|刷写|烧录|gateway|配网|升级固件|守护进程/.test(text)) {
    return {
      path: "board_primary",
      canLocalComplete: false,
      needsBoardCollaboration: true,
      source: "task_analysis",
      reason: "任务直接涉及板端能力或系统级操作，需板端主执行",
      confidence: 0.9,
    };
  }
  const boardReusable = boardSnapshot.skills.length > 0 && /(复用|已有能力|已安装|现有技能|能力链路)/.test(text);
  if (boardReusable) {
    return {
      path: "collaborative",
      canLocalComplete: false,
      needsBoardCollaboration: true,
      source: "task_analysis",
      reason: "任务命中板端可复用能力，采用协同执行更稳妥",
      confidence: 0.88,
    };
  }
  if (req.mode === "board-preferred") {
    return {
      path: "collaborative",
      canLocalComplete: false,
      needsBoardCollaboration: true,
      source: "user_mode",
      reason: "用户要求优先尝试板端协同",
      confidence: 0.85,
    };
  }
  if (/诊断|修复|部署|日志|状态|温度|负载|摄像头|ros|vnc|设备/.test(text)) {
    return {
      path: "collaborative",
      canLocalComplete: false,
      needsBoardCollaboration: true,
      source: "task_analysis",
      reason: "任务包含设备实操链路，建议本地编排 + 板端协同执行",
      confidence: 0.78,
    };
  }
  return {
    path: "local_only",
    canLocalComplete: true,
    needsBoardCollaboration: false,
    source: "default",
    reason: "任务属于通用编排/问答，本地链路可独立完成",
    confidence: 0.72,
  };
}

function resolveExecutor(toolName?: string) {
  return toolName === "board_openclaw_delegate" || toolName === "board_openclaw_assess"
    ? "board_openclaw"
    : "rdkclaw_local";
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
        },
      };
    case "subagent_summary":
      return {
        type: "meta",
        data: {
          ...base,
          executor: "rdkclaw_local",
          phase: "end",
          message: `子代理完成: ${(event as any).label || "task"}`,
          subagent_summary: (event as any).summary,
        },
      };
    case "subagent_error":
      return {
        type: "error",
        data: {
          ...base,
          error: `子代理失败: ${(event as any).error}`,
          subagent_label: (event as any).label,
        },
      };
    case "agent_end":
      return null;
    default:
      return null;
  }
}

function resolveBoardDevicePassword(device: { username: string; password?: string }) {
  const persisted = device.password ?? "";
  const envPwd = process.env.RDK_SSH_PASSWORD ?? "";
  return persisted || envPwd || device.username;
}

export class RDKClawApp {
  private readonly workspaceDir: string;
  private readonly openClawManager: OpenClawDeploymentManager;
  private readonly personaStore: PersonaStore;
  private readonly skills: SkillRegistry;
  private readonly policyStore: RDKClawPolicyStore;
  private readonly workspaceStore: UserWorkspaceStore;
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
  private boardSkillSnapshotCache = new Map<string, { expiresAt: number; value: { skills: string[]; plugins: string[] } }>();
  private static readonly BOARD_SNAPSHOT_TTL_MS = 12_000;

  private async getBoardSkillSnapshot(deviceId?: string): Promise<{ skills: string[]; plugins: string[] }> {
    if (!deviceId) return { skills: [], plugins: [] };
    const cached = this.boardSkillSnapshotCache.get(deviceId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const devices = await readDevices();
    const hit = devices.find((d) => d.id === deviceId);
    if (!hit) return { skills: [], plugins: [] };
    const board = {
      ip: hit.host,
      userName: hit.username,
      id: hit.id,
      password: resolveBoardDevicePassword(hit as { username: string; password?: string }),
    };
    const timeoutMs = 9000;
    return await new Promise<{ skills: string[]; plugins: string[] }>((resolve) => {
      let output = "";
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        const value = { skills: [], plugins: [] };
        this.boardSkillSnapshotCache.set(deviceId, { value, expiresAt: Date.now() + RDKClawApp.BOARD_SNAPSHOT_TTL_MS });
        resolve(value);
      }, timeoutMs);
      this.openClawManager.getInstalledSkills(
        board,
        (chunk) => { output += chunk; },
        () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const skills: string[] = [];
          const plugins: string[] = [];
          let section = "";
          for (const line of output.split("\n")) {
            const trimmed = line.trim();
            if (trimmed === "===SKILLS===") { section = "skills"; continue; }
            if (trimmed === "===PLUGINS===") { section = "plugins"; continue; }
            if (!trimmed || trimmed.startsWith("无已安装")) continue;
            if (section === "skills") skills.push(trimmed);
            else if (section === "plugins") plugins.push(trimmed);
          }
          const value = {
            skills: Array.from(new Set(skills)),
            plugins: Array.from(new Set(plugins)),
          };
          this.boardSkillSnapshotCache.set(deviceId, { value, expiresAt: Date.now() + RDKClawApp.BOARD_SNAPSHOT_TTL_MS });
          resolve(value);
        },
      );
    });
  }

  constructor(workspaceDir: string, openClawManager: OpenClawDeploymentManager) {
    this.workspaceDir = workspaceDir;
    this.openClawManager = openClawManager;
    this.personaStore = new PersonaStore();
    this.skills = new SkillRegistry({ workspaceDir });
    this.policyStore = new RDKClawPolicyStore();
    this.workspaceStore = new UserWorkspaceStore(workspaceDir);
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
    if (toolName === "forum_drobotics_create_post") return "high";
    if (toolName === "forum_drobotics_set_credentials") return "medium";
    if (toolName === "forum_drobotics_auth_status" || toolName === "forum_drobotics_latest" || toolName === "forum_drobotics_topic") return "low";
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
    providerConfig: ProviderConfig,
    sessionAttachments: Awaited<ReturnType<typeof prepareSessionAttachments>>["allAttachments"],
  ): Tool[] {
    const tools: Tool[] = [
      ...builtinTools,
      ...createStudioTools(this.autonomyRuntime),
      ...createAttachmentTools(sessionAttachments, providerConfig, base.sessionId),
    ];
    if (policy.network.enabled) {
      tools.push(
        ...createWebTools({
          maxFetchChars: policy.network.maxFetchChars,
          timeoutMs: 15000,
        }),
        ...createForumTools({
          maxFetchChars: policy.network.maxFetchChars,
          timeoutMs: 15000,
        }),
      );
    }
    if (req.deviceId) {
      const deviceTools = createRdkTools(req.deviceId);
      tools.push(...deviceTools);
      tools.push(boardOpenClawAssessTool(req.deviceId, this.openClawManager));
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
        }, base.sessionId),
      );
    }
    return tools.map((tool) => this.wrapToolWithApproval(tool, policy, emitEvent, base));
  }

  async *streamChat(req: RDKClawChatRequest): AsyncGenerator<RDKClawEvent> {
    const externalAbortSignal = req.abortSignal;
    let abortedByClient = Boolean(externalAbortSignal?.aborted);
    if (abortedByClient) {
      return;
    }
    const providerConfig = resolveProviderConfig();
    if (!providerConfig.apiKey) {
      throw new Error("未配置 AI 模型 API Key，请先在设置中配置。");
    }

    const sessionKey = req.sessionId?.trim() || (req.userId?.trim() ? `rdkclaw:${req.userId.trim()}` : `rdkclaw-${Date.now()}`);
    const userProfile = req.userId ? this.personaStore.getUser(req.userId) : null;
    const runStartedAt = Date.now();
    const workspaceStartedAt = Date.now();
    const workspacePromise = this.workspaceStore.getOrInit(req.userId, userProfile);
    const boardSnapshotStartedAt = Date.now();
    const boardSnapshotPromise = this.getBoardSkillSnapshot(req.deviceId);
    const attachmentPrepareStartedAt = Date.now();
    const attachmentState = await prepareSessionAttachments(sessionKey, req.attachments);
    const attachmentPrepareMs = Date.now() - attachmentPrepareStartedAt;
    await ensureAudioAttachmentTranscripts(
      sessionKey,
      attachmentState.allAttachments,
      providerConfig,
      attachmentState.newAttachments.map((item) => item.id),
    );
    const boardSnapshot = await boardSnapshotPromise;
    const boardSnapshotMs = Date.now() - boardSnapshotStartedAt;
    const workspace = await workspacePromise;
    const workspaceInitMs = Date.now() - workspaceStartedAt;
    const attachmentPrompt = buildAttachmentPrompt(attachmentState.newAttachments);
    const effectiveMessage = [String(req.message || "").trim(), attachmentPrompt].filter(Boolean).join("\n\n");
    const persona = this.personaStore.getPersona();
    const policy = this.policyStore.getPolicy();
    const matchedSkills = this.skills.matchByText(effectiveMessage || req.message).slice(0, 5);
    const setupElapsedMs = Date.now() - runStartedAt;
    const decision = selectDelegateDecision(req, matchedSkills, boardSnapshot);
    const systemPrompt = [
      buildPersonaPrompt(persona),
      req.deviceId
        ? (boardSnapshot.skills.length > 0
          ? `当前板端已安装 OpenClaw 技能（每次执行前快照）: ${boardSnapshot.skills.join(", ")}`
          : "当前板端技能快照为空（可能未安装或读取失败）。如任务匹配不到现有技能，请优先生成并下发新技能，再继续执行。")
        : "",
      req.deviceId && boardSnapshot.plugins.length > 0
        ? `当前板端允许插件: ${boardSnapshot.plugins.join(", ")}`
        : "",
      attachmentState.allAttachments.length > 0
        ? `当前会话已有 ${attachmentState.allAttachments.length} 个附件可供使用；如需深入读取，请调用 attachment_* 工具。`
        : "",
      decision.path === "board_primary"
        ? "执行路径判定：本任务需板端主执行。先调用 board_openclaw_assess，再调用 board_openclaw_delegate；若评估失败或委派失败，立刻切换本地工具兜底完成。"
        : decision.path === "collaborative"
          ? "执行路径判定：本任务需本地+板端协同。RDKClaw 负责编排，本地工具与 board_openclaw_delegate 按步骤协同完成。"
          : "执行路径判定：本任务由 RDKClaw 本地链路独立完成，除非执行中发现板端依赖才触发委派。",
    ].filter(Boolean).join("\n");
    const modelDef = buildModelDef(providerConfig);
    const streamFn = buildStreamFn(providerConfig);
    const apiKey = getApiKey(providerConfig);
    const baseUrl = getBaseUrl(providerConfig);

    process.env.OPENAI_BASE_URL = baseUrl;
    process.env.OPENAI_API_KEY = apiKey;
    process.env.RDKCLAW_DAILY_MEMORY_DAYS = String(Math.max(1, policy.memory.dailyMemoryDays || 2));
    process.env.RDKCLAW_MAIN_READS_MEMORY = policy.memory.mainSessionReadsMemory ? "1" : "0";
    process.env.RDKCLAW_SHARED_BLOCKS_MEMORY = policy.memory.sharedSessionBlocksMemory ? "1" : "0";
    process.env.RDKCLAW_CONTEXT_MAX_HISTORY_SHARE = String(policy.context.maxHistoryShare);
    process.env.RDKCLAW_CONTEXT_SOFT_TRIM_RATIO = String(policy.context.softTrimRatio);
    process.env.RDKCLAW_CONTEXT_HARD_CLEAR_RATIO = String(policy.context.hardClearRatio);
    process.env.RDKCLAW_CONTEXT_KEEP_LAST_ASSISTANTS = String(policy.context.keepLastAssistants);

    const runId = crypto.randomUUID();
    const base = { runId, sessionId: sessionKey };
    const queue: RDKClawEvent[] = [];
    let queueWaiters: Array<() => void> = [];
    const wakeQueue = () => {
      if (queueWaiters.length === 0) return;
      const waiters = queueWaiters;
      queueWaiters = [];
      for (const notify of waiters) notify();
    };
    const waitForQueue = () => new Promise<void>((resolve) => {
      queueWaiters.push(resolve);
    });
    const runMetrics = {
      compactionCount: 0,
      compactionDroppedMessages: 0,
      compactionSummaryChars: 0,
      overflowRecoveryCount: 0,
      boardToolCalls: 0,
      localToolCalls: 0,
      toolCallNames: [] as string[],
      firstEventAt: null as number | null,
      firstTextDeltaAt: null as number | null,
    };
    const pushEvent = (event: RDKClawEvent) => {
      queue.push(event);
      if (!runMetrics.firstEventAt) {
        runMetrics.firstEventAt = Date.now();
      }
      if (event.type === "text" && !runMetrics.firstTextDeltaAt) {
        runMetrics.firstTextDeltaAt = Date.now();
      }
      wakeQueue();
    };
    pushEvent({
      type: "meta",
      data: {
        ...base,
        executor: "rdkclaw_local",
        phase: "start",
        message: "RDK Studio Claw 开始编排任务",
        decision_source: decision.source,
        decision_reason: decision.reason,
        confidence: decision.confidence,
        workspace_profile_id: workspace.profileId,
        workspace_source: workspace.source,
        workspace_dir: workspace.workspaceDir,
        matched_skills: matchedSkills.map((s) => s.name),
        board_skills_count: boardSnapshot.skills.length,
        board_skills: boardSnapshot.skills,
        board_plugins_count: boardSnapshot.plugins.length,
        board_plugins: boardSnapshot.plugins,
        approval_mode: policy.approval.mode,
        network_enabled: policy.network.enabled,
        network_max_fetch_chars: policy.network.maxFetchChars,
        network_require_approval: policy.network.requireApproval,
        delegation_mode: resolveDelegationModeText(decision),
        delegation_expectation: resolveDelegationExpectationText(decision),
        can_local_complete: decision.canLocalComplete,
        needs_board_collaboration: decision.needsBoardCollaboration,
        attachments_count: attachmentState.allAttachments.length,
        new_attachments_count: attachmentState.newAttachments.length,
        attachment_types: Array.from(new Set(attachmentState.allAttachments.map((item) => item.type))),
        audio_transcript_count: attachmentState.allAttachments.filter((item) => item.type === "audio" && item.transcript).length,
        new_audio_transcript_count: attachmentState.newAttachments.filter((item) => item.type === "audio" && item.transcript).length,
        setup_elapsed_ms: setupElapsedMs,
        setup_workspace_ms: workspaceInitMs,
        setup_attachments_ms: attachmentPrepareMs,
        setup_board_snapshot_ms: boardSnapshotMs,
      },
    });
    const agent = new Agent({
      agentId: "rdkclaw",
      systemPrompt,
      tools: this.createTools(req, (event) => pushEvent(event), base, decision, policy, providerConfig, attachmentState.allAttachments),
      streamFn,
      modelDef,
      apiKey,
      provider: providerConfig.provider,
      model: providerConfig.model,
      workspaceDir: this.workspaceDir,
      bootstrapDir: workspace.workspaceDir,
      sessionDir: workspace.sessionDir,
      memoryDir: workspace.memoryDir,
      enableContext: true,
      enableSkills: true,
      enableMemory: true,
      enableHeartbeat: true,
      maxTurns: 12,
      temperature: 0.7,
      reasoning: "medium",
      contextTokens: Math.max(16_000, Number(policy.context.contextTokens || 128000)),
    });
    let finished = false;
    let failed: unknown = null;
    let runResult:
      | { runId?: string; text: string; turns: number; toolCalls: number; skillTriggered?: string; memoriesUsed?: number }
      | null = null;
    this.runAgents.set(runId, agent);
    const handleExternalAbort = () => {
      abortedByClient = true;
      agent.abort();
    };
    externalAbortSignal?.addEventListener("abort", handleExternalAbort, { once: true });
    const unsubscribe = agent.subscribe((event) => {
      if (event.type === "compaction") {
        runMetrics.compactionCount += 1;
        runMetrics.compactionDroppedMessages += Math.max(0, Number(event.droppedMessages || 0));
        runMetrics.compactionSummaryChars += Math.max(0, Number(event.summaryChars || 0));
      } else if (event.type === "context_overflow_compact") {
        runMetrics.overflowRecoveryCount += 1;
      } else if (event.type === "tool_execution_start") {
        const executor = resolveExecutor(event.toolName);
        if (executor === "board_openclaw") {
          runMetrics.boardToolCalls += 1;
        } else {
          runMetrics.localToolCalls += 1;
        }
        runMetrics.toolCallNames.push(event.toolName);
      }
      const mapped = mapMiniEvent(event, base);
      if (mapped) pushEvent(mapped);
    });

    const runPromise = agent
      .run(sessionKey, effectiveMessage || "请结合当前附件继续处理。")
      .then((result) => {
        runResult = result;
      })
      .catch((error) => {
        failed = error;
      })
      .finally(() => {
        finished = true;
        wakeQueue();
        unsubscribe();
        externalAbortSignal?.removeEventListener("abort", handleExternalAbort);
        this.runAgents.delete(runId);
      });

    while (!finished || queue.length > 0) {
      if (queue.length === 0) {
        await waitForQueue();
        continue;
      }
      yield queue.shift() as RDKClawEvent;
    }

    await runPromise;
    if (failed) {
      if (abortedByClient) {
        return;
      }
      throw failed;
    }
    const completionText = String((runResult as any)?.text || "");
    const promptText = [String(systemPrompt || ""), String(effectiveMessage || "")]
      .filter(Boolean)
      .join("\n\n");
    const promptTokens = estimateTextTokens(promptText);
    const completionTokens = estimateTextTokens(completionText);
    const totalTokens = promptTokens + completionTokens;
    const runFinishedAt = Date.now();
    const totalElapsedMs = runFinishedAt - runStartedAt;
    recordTokenUsage({
      source: "rdkclaw",
      deviceId: req.deviceId,
      sessionId: sessionKey,
      model: providerConfig.model,
      promptTokens,
      completionTokens,
      success: true,
      estimated: true,
    });
    yield {
      type: "done",
      data: {
        ok: true,
        ...base,
        model: providerConfig.model,
        token_usage: {
          promptTokens,
          completionTokens,
          totalTokens,
          estimated: true,
        },
        context: {
          compactionCount: runMetrics.compactionCount,
          droppedMessages: runMetrics.compactionDroppedMessages,
          summaryChars: runMetrics.compactionSummaryChars,
          overflowRecoveryCount: runMetrics.overflowRecoveryCount,
          policy: {
            contextTokens: policy.context.contextTokens,
            maxHistoryShare: policy.context.maxHistoryShare,
            softTrimRatio: policy.context.softTrimRatio,
            hardClearRatio: policy.context.hardClearRatio,
            keepLastAssistants: policy.context.keepLastAssistants,
          },
        },
        execution: {
          boardToolCalls: runMetrics.boardToolCalls,
          localToolCalls: runMetrics.localToolCalls,
          toolCallNames: runMetrics.toolCallNames.slice(-20),
        },
        performance: {
          setupElapsedMs,
          workspaceInitMs,
          attachmentPrepareMs,
          boardSnapshotMs,
          firstEventMs: runMetrics.firstEventAt ? runMetrics.firstEventAt - runStartedAt : null,
          firstTextDeltaMs: runMetrics.firstTextDeltaAt ? runMetrics.firstTextDeltaAt - runStartedAt : null,
          totalElapsedMs,
        },
        delegation: {
          mode: resolveDelegationModeText(decision),
          expected: resolveDelegationExpectationText(decision),
          source: decision.source,
          reason: decision.reason,
          confidence: decision.confidence,
          canLocalComplete: decision.canLocalComplete,
          needsBoardCollaboration: decision.needsBoardCollaboration,
        },
      },
    };
  }
}
