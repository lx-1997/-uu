import * as crypto from "node:crypto";
import * as path from "node:path";
import {
  Agent,
  builtinTools,
  type Tool,
} from "../agent/openclaw-index.js";
import {
  buildModelDef,
  buildStreamFn,
  getApiKey,
  getBaseUrl,
  loadProviderConfig,
  warmupModelCapabilities,
  type ProviderConfig,
} from "../agent/provider-setup.js";
import { lookupModelCapabilities } from "../agent/model-registry.js";
import {
  buildAttachmentPrompt,
  createAttachmentTools,
  ensureAudioAttachmentTranscripts,
  prepareSessionAttachments,
  registerToolDownloadedAttachment,
} from "../agent/tools/attachment-tools.js";
import { createRdkTools } from "../agent/tools/rdk-tools.js";
import { createDeviceManagerTools } from "../agent/tools/device-manager-tools.js";
import { createStudioTools, type StudioAutonomyRuntime } from "../agent/tools/studio-tools.js";
import { createForumTools } from "../agent/tools/forum-tools.js";
import { createWebTools } from "../agent/tools/web-tools.js";
import { OpenClawDeploymentManager } from "../managers/OpenClawDeploymentManager.js";
import { readDevices } from "../storage.js";
import { estimateTextTokens, recordTokenUsage } from "../monitoring/token-usage.js";
import { boardOpenClawAssessTool } from "./tools/board-openclaw-assess.js";
import { boardOpenClawChatTool } from "./tools/board-openclaw-chat.js";
import { boardOpenClawDelegateTool } from "./tools/board-openclaw-delegate.js";
import { createEcosystemQueryTool } from "./tools/ecosystem-query.js";
import { createSoulUpdateTool } from "./tools/soul-update.js";
import { fleetBoardListTool, fleetBoardDelegateTool, fleetBoardBroadcastTool } from "./tools/fleet-dispatch.js";
import { planTools } from "../agent/tools/plan-tool.js";
import type { EcosystemRegistry } from "../ecosystem/registry.js";
import { getDeviceProfile, type DeviceProfile } from "../ecosystem/device-profiles.js";
import { detectPlatform } from "../ecosystem/device-profiles.js";
import type { RdkPlatform } from "../../shared/ecosystem-types.js";
import { PersonaStore } from "./persona-store.js";
import { SkillRegistry } from "./skills/registry.js";
import { RDKClawPolicyStore } from "./policy-store.js";
import { UserWorkspaceStore } from "./workspace-store.js";
import { DeviceQueue } from "./device-queue.js";
import type {
  ApprovalDecisionMode,
  ChannelSource,
  PersonaProfile,
  RDKClawChatRequest,
  RDKClawEvent,
  RDKClawPolicy,
  RDKClawSkillMeta,
  RiskLevel,
  UserProfile,
} from "./types.js";
import {
  getExternalChannelPolicy,
  validateExecCommand,
} from "./channel-safety.js";
import { evaluatePermissionGuard } from "./permission-guard.js";
import { mapMiniEvent, resolveExecutor } from "./event-mapper.js";
import {
  classifyModelTier,
  buildPersonaPrompt,
  buildCollaborationPrompt,
  type BoardSnapshot,
  type BoardSkillDetail,
  type ModelTier,
} from "./system-prompt-builder.js";
import {
  selectDelegateDecision,
  resolveDelegationModeText,
  resolveDelegationExpectationText,
  type DelegateDecision,
} from "./delegation.js";
import { appendSecurityAuditLog } from "./security-audit-store.js";

const DEFAULT_CONFIG: ProviderConfig = {
  provider: "qwen",
  model: "qwen3.5-plus",
  apiKey: "",
};

function resolveProviderConfig(): ProviderConfig {
  const config = loadProviderConfig();
  if (config) {
    return {
      ...config,
      apiKey: config.apiKey || process.env.OPENAI_API_KEY || "",
      baseUrl: config.baseUrl || process.env.OPENAI_BASE_URL || DEFAULT_CONFIG.baseUrl,
    };
  }
  return {
    ...DEFAULT_CONFIG,
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: process.env.OPENAI_BASE_URL || DEFAULT_CONFIG.baseUrl,
  };
}


function resolveBoardDevicePassword(device: { username: string; password?: string }) {
  const persisted = device.password ?? "";
  const envPwd = process.env.RDK_SSH_PASSWORD ?? "";
  return persisted || envPwd || device.username;
}

export class RDKClawApp {
  private readonly workspaceDir: string;
  private readonly openClawManager: OpenClawDeploymentManager;
  private readonly ecosystemRegistry?: EcosystemRegistry;
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
  private pendingRecommendations = new Map<string, {
    resolve: (choice: { choiceId: string; autoExecute: boolean }) => void;
    createdAt: number;
  }>();
  private runAgents = new Map<string, Agent>();
  private sessionAutoApprove = new Map<string, boolean>();
  private boardSkillSnapshotCache = new Map<string, { expiresAt: number; value: BoardSnapshot }>();
  private modelCapWarmedUp = new Set<string>();
  private static readonly BOARD_SNAPSHOT_TTL_MS = 60_000;
  private readonly deviceQueue = new DeviceQueue();
  private switchDeviceCallback?: (deviceId: string) => void;

  private async getBoardSkillSnapshot(deviceId?: string): Promise<BoardSnapshot> {
    if (!deviceId) return { skills: [], skillDetails: [], plugins: [] };
    const cached = this.boardSkillSnapshotCache.get(deviceId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const devices = await readDevices();
    const hit = devices.find((d) => d.id === deviceId);
    if (!hit) return { skills: [], skillDetails: [], plugins: [] };
    const board = {
      ip: hit.host,
      userName: hit.username,
      id: hit.id,
      password: resolveBoardDevicePassword(hit as { username: string; password?: string }),
    };
    const timeoutMs = 9000;
    return await new Promise<BoardSnapshot>((resolve) => {
      let output = "";
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        const value: BoardSnapshot = { skills: [], skillDetails: [], plugins: [] };
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
          const skillDetails: BoardSkillDetail[] = [];
          const plugins: string[] = [];
          let section = "";
          for (const line of output.split("\n")) {
            const trimmed = line.trim();
            if (trimmed === "===SKILLS===") { section = "skills"; continue; }
            if (trimmed === "===PLUGINS===") { section = "plugins"; continue; }
            if (!trimmed || trimmed.startsWith("无已安装")) continue;
            if (section === "skills") {
              const parts = trimmed.split("|");
              if (parts.length >= 3) {
                skillDetails.push({
                  name: parts[0].trim(),
                  path: parts[1].trim(),
                  description: parts[2].trim(),
                  trigger: parts[3]?.trim() || "",
                });
              } else {
                skillDetails.push({ name: trimmed, path: "", description: "", trigger: "" });
              }
            } else if (section === "plugins") {
              plugins.push(trimmed);
            }
          }
          const seen = new Set<string>();
          const deduped = skillDetails.filter((s) => {
            if (seen.has(s.name)) return false;
            seen.add(s.name);
            return true;
          });
          const value: BoardSnapshot = {
            skills: deduped.map((s) => s.name),
            skillDetails: deduped,
            plugins: Array.from(new Set(plugins)),
          };
          this.boardSkillSnapshotCache.set(deviceId, { value, expiresAt: Date.now() + RDKClawApp.BOARD_SNAPSHOT_TTL_MS });
          resolve(value);
        },
      );
    });
  }

  constructor(workspaceDir: string, openClawManager: OpenClawDeploymentManager, ecosystemRegistry?: EcosystemRegistry) {
    this.workspaceDir = workspaceDir;
    this.openClawManager = openClawManager;
    this.ecosystemRegistry = ecosystemRegistry;
    this.personaStore = new PersonaStore();
    this.skills = new SkillRegistry({ workspaceDir });
    this.policyStore = new RDKClawPolicyStore();
    this.workspaceStore = new UserWorkspaceStore(workspaceDir);
  }

  setAutonomyRuntime(runtime: StudioAutonomyRuntime) {
    this.autonomyRuntime = runtime;
  }

  setSwitchDeviceCallback(cb: (deviceId: string) => void) {
    this.switchDeviceCallback = cb;
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

  submitRecommendationChoice(recommendationId: string, choiceId: string, autoExecute: boolean) {
    const pending = this.pendingRecommendations.get(recommendationId);
    if (!pending) return false;
    this.pendingRecommendations.delete(recommendationId);
    pending.resolve({ choiceId, autoExecute });
    return true;
  }

  cancelRun(runId: string): boolean {
    const agent = this.runAgents.get(runId);
    if (!agent) return false;
    agent.abort();
    return true;
  }

  cancelAllRuns(): number {
    let count = 0;
    for (const [_id, agent] of this.runAgents) {
      try { agent.abort(); count++; } catch { /* ignore */ }
    }
    return count;
  }

  getActiveRunIds(): string[] {
    return Array.from(this.runAgents.keys());
  }

  private isRiskAtLeast(risk: RiskLevel, threshold: RiskLevel) {
    const map: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };
    return map[risk] >= map[threshold];
  }

  private shouldRequireApproval(policy: RDKClawPolicy, risk: RiskLevel, sessionId: string, toolName: string, _channel: ChannelSource): boolean {
    if (/^web_/i.test(toolName) && !policy.network.requireApproval) return false;
    if (this.sessionAutoApprove.get(sessionId)) return false;

    if (risk !== "high") return false;
    return policy.approval.mode !== "auto";
  }

  private wrapToolWithApproval(
    tool: Tool,
    policy: RDKClawPolicy,
    emitEvent: (event: RDKClawEvent) => void,
    base: { runId: string; sessionId: string },
    channel: ChannelSource = "studio",
  ): Tool {
    return {
      ...tool,
      execute: async (input, ctx) => {
        if (tool.name.startsWith("web_") && !policy.network.enabled) {
          throw new Error("联网工具已禁用，请在策略面板中开启网络能力。");
        }

        const isExternal = channel !== "studio";

        if (isExternal) {
          const chanPolicy = getExternalChannelPolicy(tool.name);
          if (chanPolicy === "block") {
            throw new Error(`安全限制：外部通道(${channel})禁止使用工具 ${tool.name}`);
          }

          if ((tool.name === "exec" || tool.name === "device_exec") && (input as any)?.command) {
            const cmdCheck = validateExecCommand(String((input as any).command), channel);
            if (cmdCheck.blocked) {
              throw new Error(`安全拦截：${cmdCheck.reason}`);
            }
          }
        }

        const guardResult = evaluatePermissionGuard({
          toolName: tool.name,
          args: input,
          workspaceDir: this.workspaceDir,
          channel,
          permission: policy.permission,
        });
        if (guardResult.blocked) {
          if (policy.permission.auditLogEnabled) {
            appendSecurityAuditLog({
              channel,
              toolName: tool.name,
              risk: guardResult.risk,
              action: "blocked",
              reason: guardResult.reason,
              runId: base.runId,
              sessionId: base.sessionId,
            });
          }
          throw new Error(`安全边界拦截：${guardResult.reason || "请求超出允许范围"}`);
        }
        const risk = guardResult.risk;
        if (!this.shouldRequireApproval(policy, risk, base.sessionId, tool.name, channel)) {
          if (policy.permission.auditLogEnabled) {
            appendSecurityAuditLog({
              channel,
              toolName: tool.name,
              risk,
              action: "auto_allow",
              runId: base.runId,
              sessionId: base.sessionId,
            });
          }
          return tool.execute(input, ctx);
        }
        const approvalId = `approval-${crypto.randomUUID()}`;
        if (policy.permission.auditLogEnabled) {
          appendSecurityAuditLog({
            channel,
            toolName: tool.name,
            risk,
            action: "approval_required",
            runId: base.runId,
            sessionId: base.sessionId,
          });
        }
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
        if (policy.permission.auditLogEnabled) {
          appendSecurityAuditLog({
            channel,
            toolName: tool.name,
            risk,
            action: "approval_decision",
            decision,
            runId: base.runId,
            sessionId: base.sessionId,
          });
        }
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
    boardSnapshot?: BoardSnapshot,
  ): Tool[] {
    const tools: Tool[] = [
      ...builtinTools,
      ...createStudioTools(this.autonomyRuntime),
      ...createAttachmentTools(sessionAttachments, providerConfig, base.sessionId),
      ...createDeviceManagerTools(this.switchDeviceCallback),
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
      const deviceTools = createRdkTools(req.deviceId, {
        onMediaDownloaded: (info) => {
          registerToolDownloadedAttachment(base.sessionId, sessionAttachments, {
            localPath: info.localPath,
            fileName: info.fileName,
            bytes: info.bytes,
          }).catch(() => {});
        },
      });
      tools.push(...deviceTools);
      const skillsForBoard = boardSnapshot?.skillDetails.map((s) => ({
        name: s.name,
        path: s.path,
        description: s.description,
      }));
      tools.push(boardOpenClawAssessTool(req.deviceId, this.openClawManager, base.sessionId, skillsForBoard));
      tools.push(boardOpenClawChatTool(req.deviceId, this.openClawManager, base.sessionId));
      tools.push(
        boardOpenClawDelegateTool(req.deviceId, this.openClawManager, (chunk) => {
          emitEvent({
            type: "tool_progress",
            data: {
              ...base,
              toolName: "board_openclaw_delegate",
              name: "board_openclaw_delegate",
              toolCallId: "board_openclaw_delegate", // TODO: 应传入真实 toolCallId，当前框架不支持 per-call callback
              phase: "running",
              executor: "board_openclaw",
              chunk,
            },
          });
        }, base.sessionId, this.ecosystemRegistry, skillsForBoard),
      );
      if (this.ecosystemRegistry) {
        const platform = (req as any).platform as RdkPlatform | undefined;
        tools.push(createEcosystemQueryTool(this.ecosystemRegistry, platform));
      }
      tools.push(fleetBoardListTool(req.deviceId, this.openClawManager));
      tools.push(fleetBoardDelegateTool(req.deviceId, this.openClawManager, (chunk) => {
        emitEvent({
          type: 'tool_progress',
          data: {
            ...base,
            toolName: 'fleet_board_delegate',
            name: 'fleet_board_delegate',
            toolCallId: 'fleet_board_delegate',
            phase: 'running',
            executor: 'fleet',
            chunk,
          },
        });
      }));
      tools.push(fleetBoardBroadcastTool(req.deviceId, this.openClawManager, (chunk) => {
        emitEvent({
          type: 'tool_progress',
          data: {
            ...base,
            toolName: 'fleet_board_broadcast',
            name: 'fleet_board_broadcast',
            toolCallId: 'fleet_board_broadcast',
            phase: 'running',
            executor: 'fleet',
            chunk,
          },
        });
      }));
    }
    tools.push(createSoulUpdateTool(emitEvent, base));
    tools.push(...planTools);
    const channel = req.channel || "studio";
    return tools.map((tool) => this.wrapToolWithApproval(tool, policy, emitEvent, base, channel));
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

    const deviceLane = this.deviceQueue.getLane(req.deviceId);
    const sessionKey = req.deviceId?.trim() ? `device:${req.deviceId.trim()}` : "local";

    const queueStatus = this.deviceQueue.getStatus(deviceLane);
    if (queueStatus.running) {
      yield {
        type: "queue_status" as const,
        data: {
          position: queueStatus.pendingCount + 1,
          currentTask: queueStatus.running.messageSummary,
          currentChannel: queueStatus.running.channel,
          deviceLane,
        },
      };
    }

    const channel: import("./types.js").ChannelSource = req.channel || "studio";
    const slot = await this.deviceQueue.acquireSlot(deviceLane, {
      channel,
      messageSummary: String(req.message || "").slice(0, 60),
    });

    try {
      yield* this._executeChat(req, sessionKey, providerConfig, slot);
    } finally {
      slot.release();
    }
  }

  private async *_executeChat(
    req: RDKClawChatRequest,
    sessionKey: string,
    providerConfig: ProviderConfig,
    _slot: { release: () => void },
  ): AsyncGenerator<RDKClawEvent> {
    const externalAbortSignal = req.abortSignal;
    let abortedByClient = Boolean(externalAbortSignal?.aborted);

    const earlyRunId = crypto.randomUUID();
    yield {
      type: "meta",
      data: {
        runId: earlyRunId,
        sessionId: sessionKey,
        executor: "rdkclaw_local",
        phase: "setup",
        message: "正在准备上下文...",
      },
    };

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
    if (workspace.workspaceDir !== this.workspaceDir) {
      this.skills.addExtraDir(path.join(workspace.workspaceDir, "skills"));
    }
    const attachmentPrompt = buildAttachmentPrompt(attachmentState.newAttachments);
    const effectiveMessage = [String(req.message || "").trim(), attachmentPrompt].filter(Boolean).join("\n\n");
    const persona = this.personaStore.getPersona();
    const policy = this.policyStore.getPolicy();
    const matchedSkills = this.skills.matchByText(effectiveMessage || req.message).slice(0, 5);
    const setupElapsedMs = Date.now() - runStartedAt;
    const decision = selectDelegateDecision(req, matchedSkills, boardSnapshot);
    const detectedPlatform = (req as any).platform as RdkPlatform | undefined;
    const deviceProfile = detectedPlatform ? getDeviceProfile(detectedPlatform) : null;
    const modelCaps = lookupModelCapabilities(providerConfig.provider, providerConfig.model);
    const modelTier = classifyModelTier(modelCaps.contextWindow, modelCaps.maxOutputTokens);
    const systemPrompt = [
      buildPersonaPrompt(persona),
      deviceProfile
        ? `当前平台: ${deviceProfile.displayName} (${deviceProfile.bpuTops}TOPS, ${deviceProfile.cpu}, ${deviceProfile.ramGb}GB RAM)。${deviceProfile.capabilityNotes?.length ? '能力: ' + deviceProfile.capabilityNotes.join('；') : ''}${deviceProfile.limitations.length ? '。限制: ' + deviceProfile.limitations.join('；') : ''}`
        : "",
      this.ecosystemRegistry
        ? (modelTier === 'small'
          ? "用 ecosystem_query 查可用模型/技能，返回的 installCmd/runCmd/stopCmd 可直接用 device_exec 执行。"
          : [
            "## 生态资源（ModelZoo / NodeHub / TROS）",
            "用 ecosystem_query 工具查询可用模型和技能。它会返回安装命令（installCmd）、运行命令（runCmd）和停止命令（stopCmd）。",
            "当用户想运行成熟的 AI 应用（目标检测、人体姿态、语音识别等）时：",
            "1. 先用 ecosystem_query 搜索匹配的模型/技能",
            "2. 用 device_exec 执行返回的 installCmd 安装（如果需要）",
            "3. 用 device_exec 执行 runCmd 启动",
            "4. 用 device_exec 执行 stopCmd 停止",
            "不要尝试手写运行脚本——生态资源库已包含经过验证的命令。",
          ].join("\n"))
        : "",
      req.deviceId
        ? ""
        : "当前无 RDK 设备连接。板端功能（SSH 命令、OpenClaw 委派、设备监控等）暂不可用。用户可通过对话提供设备 IP 来连接设备。",
      req.deviceId && boardSnapshot.plugins.length > 0
        ? `当前板端允许插件: ${boardSnapshot.plugins.join(", ")}`
        : "",
      attachmentState.allAttachments.length > 0
        ? attachmentState.allAttachments.some((a) => a.type === "image")
          ? `当前会话已有 ${attachmentState.allAttachments.length} 个附件（含图片: ${attachmentState.allAttachments.filter((a) => a.type === "image").map((a) => `[${a.id}] ${a.name}`).join("、")}）。用户提及图片/照片时，请先调用 attachment_describe_image 分析后再回复。`
          : `当前会话已有 ${attachmentState.allAttachments.length} 个附件可供使用；如需深入读取，请调用 attachment_* 工具。`
        : "",
      req.deviceId ? buildCollaborationPrompt(boardSnapshot, modelTier) : "",
      modelTier === 'small'
        ? "记住：发现用户偏好→memory_save；重复场景→创建技能。"
        : "## 用户理解\n对话中注意捕捉用户偏好和习惯，用 memory_save 保存重要信息，用 memory_search 回顾历史。发现反复出现的操作模式时主动创建技能。",
    ].filter(Boolean).join("\n");
    const warmupKey = `${providerConfig.provider}:${providerConfig.model}`;
    if (!this.modelCapWarmedUp.has(warmupKey)) {
      this.modelCapWarmedUp.add(warmupKey);
      warmupModelCapabilities(providerConfig).catch(() => {});
    }
    const modelDef = buildModelDef(providerConfig);
    const streamFn = buildStreamFn(providerConfig);
    const apiKey = getApiKey(providerConfig);
    const baseUrl = getBaseUrl(providerConfig);

    const runtimePolicy = {
      dailyMemoryDays: Math.max(1, policy.memory.dailyMemoryDays || 2),
      mainReadsMemory: policy.memory.mainSessionReadsMemory,
      sharedBlocksMemory: policy.memory.sharedSessionBlocksMemory,
      pruning: {
        maxHistoryShare: policy.context.maxHistoryShare,
        softTrimRatio: policy.context.softTrimRatio,
        hardClearRatio: policy.context.hardClearRatio,
        keepLastAssistants: policy.context.keepLastAssistants,
      },
    };

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
        model_capabilities: {
          provider: providerConfig.provider,
          model: providerConfig.model,
          contextWindow: modelCaps.contextWindow,
          maxOutputTokens: modelCaps.maxOutputTokens,
          tier: modelTier,
        },
        setup_elapsed_ms: setupElapsedMs,
        setup_workspace_ms: workspaceInitMs,
        setup_attachments_ms: attachmentPrepareMs,
        setup_board_snapshot_ms: boardSnapshotMs,
      },
    });
    const extraRoots: string[] = [];
    if (workspace.workspaceDir !== this.workspaceDir) {
      extraRoots.push(workspace.workspaceDir);
    }
    const agent = new Agent({
      agentId: "rdkclaw",
      systemPrompt,
      tools: this.createTools(req, (event) => pushEvent(event), base, decision, policy, providerConfig, attachmentState.allAttachments, boardSnapshot),
      streamFn,
      modelDef,
      apiKey,
      provider: providerConfig.provider,
      model: providerConfig.model,
      workspaceDir: this.workspaceDir,
      bootstrapDir: workspace.workspaceDir,
      sessionDir: workspace.sessionDir,
      memoryDir: workspace.memoryDir,
      extraAllowedRoots: extraRoots.length > 0 ? extraRoots : undefined,
      enableContext: true,
      enableSkills: true,
      enableMemory: true,
      enableHeartbeat: true,
      maxTurns: 12,
      temperature: 0.5,
      reasoning: "medium",
      contextTokens: Math.max(16_000, Number(policy.context.contextTokens) || modelCaps.contextWindow),
      runtimePolicy,
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
        if (runMetrics.toolCallNames.length > 50) {
          runMetrics.toolCallNames = runMetrics.toolCallNames.slice(-30);
        }
      }
      const mapped = mapMiniEvent(event, base);
      if (mapped) pushEvent(mapped);
    });

    agent.startHeartbeat((content, reason) => {
      pushEvent({ type: "meta", data: { ...base, executor: "rdkclaw_local", phase: "heartbeat", message: content, reason } });
    });

    const PROGRESS_INTERVAL_MS = 120_000;
    let progressTick = 0;
    const progressTimer = setInterval(() => {
      if (finished) return;
      progressTick++;
      const elapsedMs = Date.now() - runStartedAt;
      const elapsedMin = Math.floor(elapsedMs / 60000);
      const totalCalls = runMetrics.localToolCalls + runMetrics.boardToolCalls;
      const latestTools = runMetrics.toolCallNames.slice(-3);
      const toolHint = latestTools.length > 0 ? `，最近: ${latestTools.join(' → ')}` : '';
      pushEvent({
        type: "run_progress",
        data: {
          ...base,
          tick: progressTick,
          elapsed_ms: elapsedMs,
          elapsed_display: elapsedMin > 0 ? `${elapsedMin} 分钟` : `${Math.floor(elapsedMs / 1000)} 秒`,
          tool_calls: totalCalls,
          latest_tools: latestTools,
          message: `仍在处理中，已运行 ${elapsedMin > 0 ? `${elapsedMin} 分钟` : `${Math.floor(elapsedMs / 1000)} 秒`}，` +
            `执行了 ${totalCalls} 个工具调用${toolHint}`,
        },
      });
    }, PROGRESS_INTERVAL_MS);

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
        clearInterval(progressTimer);
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
      const failElapsedMs = Date.now() - runStartedAt;
      const failElapsedSec = Math.max(1, Math.round(failElapsedMs / 1000));
      const failElapsedDisplay = failElapsedSec >= 60
        ? `${Math.floor(failElapsedSec / 60)} 分 ${failElapsedSec % 60} 秒`
        : `${failElapsedSec} 秒`;
      if (abortedByClient) {
        yield {
          type: "run_complete",
          data: {
            ...base,
            message: "已取消",
            cancelled: true,
            elapsed_ms: failElapsedMs,
            elapsed_display: failElapsedDisplay,
            tool_calls: runMetrics.localToolCalls + runMetrics.boardToolCalls,
          },
        };
        return;
      }
      yield {
        type: "run_complete",
        data: {
          ...base,
          message: "执行出错",
          error: true,
          elapsed_ms: failElapsedMs,
          elapsed_display: failElapsedDisplay,
          tool_calls: runMetrics.localToolCalls + runMetrics.boardToolCalls,
        },
      };
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

    const totalCalls = runMetrics.localToolCalls + runMetrics.boardToolCalls;
    const elapsedSec = Math.max(1, Math.round(totalElapsedMs / 1000));
    const elapsedDisplay = elapsedSec >= 60
      ? `${Math.floor(elapsedSec / 60)} 分 ${elapsedSec % 60} 秒`
      : `${elapsedSec} 秒`;
    yield {
      type: "run_complete",
      data: {
        ...base,
        message: "已完成回复",
        elapsed_ms: totalElapsedMs,
        elapsed_display: elapsedDisplay,
        tool_calls: totalCalls,
        compaction_count: runMetrics.compactionCount,
      },
    };
  }
}
