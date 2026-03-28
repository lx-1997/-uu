import * as crypto from "node:crypto";
import * as path from "node:path";
import * as fs from "node:fs";
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
import { ForumAuthStore } from "./forum-auth-store.js";
import { createWebTools } from "../agent/tools/web-tools.js";
import { OpenClawDeploymentManager } from "../managers/OpenClawDeploymentManager.js";
import { readDevices } from "../storage.js";
import { CONVERSATION_SCHEMA, recordConversationTurn } from "../conversation-log.js";
import type { ConversationOutcome } from "../conversation-types.js";
import { estimateTextTokens, recordTokenUsage } from "../monitoring/token-usage.js";
import { boardOpenClawAssessTool } from "./tools/board-openclaw-assess.js";
import { boardOpenClawChatTool } from "./tools/board-openclaw-chat.js";
import { boardOpenClawDelegateTool } from "./tools/board-openclaw-delegate.js";
import { fleetBoardListTool, fleetBoardDelegateTool, fleetBoardBroadcastTool } from "./tools/fleet-dispatch.js";
import { planTools } from "../agent/tools/plan-tool.js";
import {
  getDeviceProfile,
  getResearchSeeds,
  type DeviceProfile,
} from "../board/device-profiles.js";
import type { RdkPlatform } from "../../shared/board-types.js";
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
import { sanitizeSecrets } from "./secret-sanitizer.js";
import { TextDeltaSmoother } from "./text-delta-smoother.js";
import {
  classifyModelTier,
  buildPersonaPrompt,
  buildCollaborationPrompt,
  buildStudioUiHintsPrompt,
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
import { appendUtf8WithTailCap, DEFAULT_STREAM_OUTPUT_CHAR_LIMIT } from "../utils/stream-output-limit.js";
import { syncWorkspaceMarkdownMemory } from "./memory-markdown-sync.js";

/** 与设置页「社区论坛」同源；明确用户问「用户名/密码」时的应答方式 */
function buildForumAuthContextPrompt(): string {
  const v = new ForumAuthStore().getView();
  const lines: string[] = [
    "## D-Robotics 社区论坛（Studio 本机配置快照，与「设置 → 社区论坛」一致）",
  ];
  if (v.hasApiKey) lines.push("- 已配置论坛 API Key 模式。");
  if (v.linkedFromAppSso) lines.push("- 已与主账号同步：本地存在论坛会话（Cookie/桥接）。");
  else if (v.hasCookie) lines.push("- 本地已保存论坛 Cookie。");
  if (v.hasAppSsoAccessTokenSaved) lines.push("- 已保存主应用 access_token，服务端可用其换取论坛会话。");
  if (v.hasPassword) lines.push("- 已保存论坛用户名与密码（由服务端工具使用，模型上下文**看不到**明文密码）。");
  const anyForum = v.hasApiKey || v.hasCookie || v.hasPassword || v.hasAppSsoAccessTokenSaved;
  if (!anyForum) {
    lines.push("- 当前未检测到论坛凭据；需要发帖时请引导用户在设置中配置或在对话中提供账号密码。");
  } else {
    lines.push(
      "- 涉及发帖/读帖时，必须先调用 forum_drobotics_auth_status。若返回 read_access: granted / auth_status ok，则不要要求用户再提供论坛密码。",
      "- 仅当 auth_status 明确失败或未配置时，再请用户在设置「保存并验证」、重新登录主账号，或在对话中提供凭据。",
    );
  }
  lines.push(
    "### 用户问「我的社区/论坛用户名、密码是多少」时（必须遵守）",
    "- **禁止**用「这是你的隐私我查不到」一句话打发；本机已配置的信息可以通过工具返回。",
    "- **必须先调用** forum_drobotics_auth_status；用返回里的 `studio_forum_username_masked` 告知用户当前在 Studio 中登记的**脱敏用户名**（与设置页「论坛用户」一致）。",
    "- **密码**：说明助手**不会也绝不能**在对话里复述明文密码（模型拿不到）；若已主账号同步或本机已保存凭据，说明「发帖/登录由服务端工具自动完成，无需把密码发到聊天里」。",
    "- 仅当工具显示完全未配置时，再引导去设置页或论坛找回密码。",
  );
  return lines.join("\n");
}

function recordConversationTurnFromReq(
  req: RDKClawChatRequest,
  opts: {
    outcome: ConversationOutcome;
    assistantMessage: string;
    toolsUsed: string[];
    errorDetail?: string;
  },
): void {
  recordConversationTurn({
    schema: CONVERSATION_SCHEMA,
    recordedAt: Date.now(),
    ssoUserName: req.ssoUserName,
    userMessage: String(req.message || "").trim(),
    assistantMessage: opts.assistantMessage,
    toolsUsed: opts.toolsUsed,
    channel: req.channel || "studio",
    outcome: opts.outcome,
    errorDetail: opts.errorDetail,
  });
}

/** 无 ~/.rdkstudio/agent-config.json 且无 bootstrap 条目时的兜底；与 `config/rdkclaw-provider.defaults.json` 对齐 */
const DEFAULT_CONFIG: ProviderConfig = {
  provider: "doubao-seed-2.0-lite",
  model: "doubao-seed-2.0-lite",
  apiKey: "",
  baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
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

type RuntimeHealthReport = {
  safeMode: boolean;
  reasons: string[];
  missingRequiredFiles: string[];
  enabledSkills: number;
  totalSkills: number;
};

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
  private cancelQueuedBeforeTs = 0;
  private switchDeviceCallback?: (deviceId: string) => void;
  private pendingMapsCleanupInterval: ReturnType<typeof setInterval> | null = null;

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
        (chunk) => {
          const r = appendUtf8WithTailCap(output, chunk, DEFAULT_STREAM_OUTPUT_CHAR_LIMIT);
          output = r.value;
        },
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

  constructor(workspaceDir: string, openClawManager: OpenClawDeploymentManager) {
    this.workspaceDir = workspaceDir;
    this.openClawManager = openClawManager;
    this.personaStore = new PersonaStore();
    this.skills = new SkillRegistry({ workspaceDir });
    this.policyStore = new RDKClawPolicyStore();
    this.workspaceStore = new UserWorkspaceStore(workspaceDir);
    this.pendingMapsCleanupInterval = setInterval(() => this.cleanupStalePendingMaps(), 60_000);
  }

  /**
   * 防止客户端断连后 pending 条目永久占用 Map（审批另有 5min 定时器，此为兜底）。
   */
  private cleanupStalePendingMaps() {
    const now = Date.now();
    const approvalStaleMs = 10 * 60 * 1000;
    const recommendationStaleMs = 30 * 60 * 1000;
    const staleApprovalIds: string[] = [];
    for (const [id, p] of this.pendingApprovals) {
      if (now - p.createdAt > approvalStaleMs) staleApprovalIds.push(id);
    }
    for (const id of staleApprovalIds) {
      const p = this.pendingApprovals.get(id);
      if (!p) continue;
      this.pendingApprovals.delete(id);
      try {
        p.reject(new Error("审批已过期（服务端清理）"));
      } catch {
        /* ignore double-reject */
      }
    }
    const staleRecIds: string[] = [];
    for (const [id, p] of this.pendingRecommendations) {
      if (now - p.createdAt > recommendationStaleMs) staleRecIds.push(id);
    }
    for (const id of staleRecIds) {
      const p = this.pendingRecommendations.get(id);
      if (!p) continue;
      this.pendingRecommendations.delete(id);
      try {
        p.resolve({ choiceId: "__expired__", autoExecute: false });
      } catch {
        /* ignore */
      }
    }
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
    this.cancelQueuedBeforeTs = Date.now();
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
    if (policy.approval.mode === "auto") return false;
    if (policy.approval.mode === "always") return true;
    return this.isRiskAtLeast(risk, policy.approval.riskThreshold);
  }

  private evaluateRuntimeHealth(workspaceDir: string): RuntimeHealthReport {
    const requiredFiles = ["AGENTS.md", "USER.md", "HEARTBEAT.md"];
    const missingRequiredFiles = requiredFiles.filter((name) => !fs.existsSync(path.join(workspaceDir, name)));
    const allSkills = this.skills.list();
    const enabledSkills = allSkills.filter((s) => s.enabled).length;
    const reasons: string[] = [];

    if (missingRequiredFiles.length > 0) {
      reasons.push(`missing_required_files:${missingRequiredFiles.join(",")}`);
    }
    if (allSkills.length > 0 && enabledSkills === 0) {
      reasons.push("all_skills_disabled");
    }

    return {
      safeMode: reasons.length > 0,
      reasons,
      missingRequiredFiles,
      enabledSkills,
      totalSkills: allSkills.length,
    };
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
        let forceApprovalByChannel = false;
        if (tool.name.startsWith("web_") && !policy.network.enabled) {
          throw new Error("联网工具已禁用，请在策略面板中开启网络能力。");
        }

        const isExternal = channel !== "studio";

        if (isExternal) {
          const chanPolicy = getExternalChannelPolicy(tool.name);
          if (chanPolicy === "block") {
            throw new Error(`安全限制：外部通道(${channel})禁止使用工具 ${tool.name}`);
          }
          forceApprovalByChannel = chanPolicy === "force_approval";

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
        const needApproval = forceApprovalByChannel
          ? true
          : this.shouldRequireApproval(policy, risk, base.sessionId, tool.name, channel);
        if (!needApproval) {
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
    safeMode: boolean,
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
      tools.push(
        boardOpenClawChatTool(req.deviceId, this.openClawManager, base.sessionId, (chunk, toolCallId, meta) => {
          emitEvent({
            type: "tool_progress",
            data: {
              ...base,
              toolName: "board_openclaw_chat",
              name: "board_openclaw_chat",
              toolCallId: toolCallId ?? "",
              phase: "running",
              executor: "board_openclaw",
              chunk,
              progressSource: meta?.progressSource ?? "board",
            },
          });
        }),
      );
      tools.push(
        boardOpenClawDelegateTool(req.deviceId, this.openClawManager, (chunk, toolCallId) => {
          emitEvent({
            type: "tool_progress",
            data: {
              ...base,
              toolName: "board_openclaw_delegate",
              name: "board_openclaw_delegate",
              toolCallId: toolCallId ?? "",
              phase: "running",
              executor: "board_openclaw",
              chunk,
            },
          });
        }, base.sessionId, skillsForBoard),
      );
      tools.push(fleetBoardListTool(req.deviceId, this.openClawManager));
      tools.push(fleetBoardDelegateTool(req.deviceId, this.openClawManager, (chunk, toolCallId) => {
        emitEvent({
          type: 'tool_progress',
          data: {
            ...base,
            toolName: 'fleet_board_delegate',
            name: 'fleet_board_delegate',
            toolCallId: toolCallId ?? '',
            phase: 'running',
            executor: 'fleet',
            chunk,
          },
        });
      }));
      tools.push(fleetBoardBroadcastTool(req.deviceId, this.openClawManager, (chunk, toolCallId) => {
        emitEvent({
          type: 'tool_progress',
          data: {
            ...base,
            toolName: 'fleet_board_broadcast',
            name: 'fleet_board_broadcast',
            toolCallId: toolCallId ?? '',
            phase: 'running',
            executor: 'fleet',
            chunk,
          },
        });
      }));
    }
    tools.push(...planTools);

    if (safeMode) {
      const blockPatterns = [
        /^exec$/i,
        /^device_exec$/i,
        /^write$/i,
        /^edit$/i,
        /flash/i,
        /delegate/i,
        /remove|delete/i,
        /restart|reboot/i,
        /soul_update/i,
      ];
      const filtered = tools.filter((tool) => !blockPatterns.some((pattern) => pattern.test(tool.name)));
      const channel = req.channel || "studio";
      return filtered.map((tool) => this.wrapToolWithApproval(tool, policy, emitEvent, base, channel));
    }

    const channel = req.channel || "studio";
    return tools.map((tool) => this.wrapToolWithApproval(tool, policy, emitEvent, base, channel));
  }

  async *streamChat(req: RDKClawChatRequest): AsyncGenerator<RDKClawEvent> {
    const externalAbortSignal = req.abortSignal;
    let abortedByClient = Boolean(externalAbortSignal?.aborted);
    if (abortedByClient) {
      recordConversationTurnFromReq(req, {
        outcome: "cancelled",
        assistantMessage: "",
        toolsUsed: [],
        errorDetail: "aborted_before_start",
      });
      return;
    }
    const providerConfig = resolveProviderConfig();
    if (!providerConfig.apiKey) {
      recordConversationTurnFromReq(req, {
        outcome: "error",
        assistantMessage: "",
        toolsUsed: [],
        errorDetail: "no_api_key",
      });
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
    const enqueuedAt = Date.now();
    const slot = await this.deviceQueue.acquireSlot(deviceLane, {
      channel,
      messageSummary: String(req.message || "").slice(0, 60),
    });

    try {
      if (enqueuedAt <= this.cancelQueuedBeforeTs) {
        recordConversationTurnFromReq(req, {
          outcome: "queued_cancelled",
          assistantMessage: "",
          toolsUsed: [],
          errorDetail: "queue_cancelled_before_run",
        });
        yield {
          type: "run_complete",
          data: {
            runId: crypto.randomUUID(),
            sessionId: sessionKey,
            message: "任务在队列中被取消",
            cancelled: true,
            elapsed_ms: 0,
            elapsed_display: "0 秒",
            tool_calls: 0,
          },
        };
        return;
      }
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
    if (req.deviceId) {
      const devices = await readDevices();
      const d = devices.find((x) => x.id === req.deviceId);
      const bp = d?.boardPlatform;
      if (bp && getDeviceProfile(bp as RdkPlatform)) {
        (req as { platform?: RdkPlatform }).platform = bp as RdkPlatform;
      }
    }
    const workspace = await workspacePromise;
    const workspaceInitMs = Date.now() - workspaceStartedAt;
    if (workspace.workspaceDir !== this.workspaceDir) {
      this.skills.addExtraDir(path.join(workspace.workspaceDir, "skills"));
    }
    const health = this.evaluateRuntimeHealth(workspace.workspaceDir);
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
      req.deviceId
        ? [
            "## 资料与命令来源（无本地生态注册表）",
            "需要官方安装步骤、示例或硬件说明时：用 web_search / web_fetch，优先 D-Robotics 文档与 GitHub（developer.d-robotics.cc/rdk_doc、github.com/D-Robotics），可检索 rdk_dock 等关键词。",
            (() => {
              const plat = (req as { platform?: RdkPlatform }).platform;
              return plat
                ? "当前板型已识别，建议 web_fetch 入口：" + getResearchSeeds(plat).join(" | ")
                : "若尚未识别板型：请先 device_diagnose 或让用户执行 POST /api/devices/:id/board/detect?persist=1。";
            })(),
            "确认命令后再 device_exec；板端多步编排用 board_openclaw_assess / delegate。",
          ].join("\n")
        : "",
      req.deviceId
        ? ""
        : "当前无 RDK 设备连接。板端功能（SSH 命令、OpenClaw 委派、设备监控等）暂不可用。用户可通过对话提供设备 IP 来连接设备。",
      req.deviceId && boardSnapshot.plugins.length > 0
        ? `当前板端允许插件: ${boardSnapshot.plugins.join(", ")}`
        : "",
      req.deviceId ? buildStudioUiHintsPrompt(req.studioUiHints) : "",
      attachmentState.allAttachments.length > 0
        ? attachmentState.allAttachments.some((a) => a.type === "image")
          ? `当前会话已有 ${attachmentState.allAttachments.length} 个附件（含图片: ${attachmentState.allAttachments.filter((a) => a.type === "image").map((a) => `[${a.id}] ${a.name}`).join("、")}）。用户提及图片/照片时，请先调用 attachment_describe_image 分析后再回复。`
          : `当前会话已有 ${attachmentState.allAttachments.length} 个附件可供使用；如需深入读取，请调用 attachment_* 工具。`
        : "",
      req.deviceId ? buildCollaborationPrompt(boardSnapshot, modelTier) : "",
      modelTier === 'small'
        ? "记住：发现用户偏好→memory_save；重复场景→创建技能。"
        : "## 用户理解\n对话中注意捕捉用户偏好和习惯，用 memory_save 保存重要信息，用 memory_search 回顾历史。发现反复出现的操作模式时主动创建技能。",
      buildForumAuthContextPrompt(),
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
        studio_ui_hints_age_ms:
          req.studioUiHints?.capturedAt != null
            ? Math.max(0, Date.now() - req.studioUiHints.capturedAt)
            : null,
        runtime_health: {
          safe_mode: health.safeMode,
          reasons: health.reasons,
          missing_required_files: health.missingRequiredFiles,
          enabled_skills: health.enabledSkills,
          total_skills: health.totalSkills,
        },
      },
    });
    const extraRoots: string[] = [];
    if (workspace.workspaceDir !== this.workspaceDir) {
      extraRoots.push(workspace.workspaceDir);
    }
    const agent = new Agent({
      agentId: "rdkclaw",
      systemPrompt,
      tools: this.createTools(req, (event) => pushEvent(event), base, decision, policy, providerConfig, attachmentState.allAttachments, health.safeMode, boardSnapshot),
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

    const markdownMemorySync = await syncWorkspaceMarkdownMemory({
      workspaceDir: workspace.workspaceDir,
      memory: agent.getMemory(),
    });
    if (markdownMemorySync.imported > 0) {
      pushEvent({
        type: "meta",
        data: {
          ...base,
          executor: "rdkclaw_local",
          phase: "memory_sync",
          message: `已同步 ${markdownMemorySync.imported} 条 Markdown 记忆到结构化主存`,
          projection_path: markdownMemorySync.projectionPath,
          projection_count: markdownMemorySync.projectionCount,
        },
      });
    }
    let finished = false;
    let failed: unknown = null;
    let runResult:
      | { runId?: string; text: string; turns: number; toolCalls: number; skillTriggered?: string; memoriesUsed?: number }
      | null = null;
    this.runAgents.set(runId, agent);
    const textSmoother = TextDeltaSmoother.create(
      (delta) => {
        pushEvent({ type: "text", data: { delta, ...base } });
      },
      { tickMs: 8, minPerTick: 1 },
    );
    const handleExternalAbort = () => {
      abortedByClient = true;
      textSmoother.flushSync();
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
      if (event.type === "message_delta") {
        textSmoother.push(sanitizeSecrets(event.delta));
        return;
      }
      textSmoother.flushSync();
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
        textSmoother.dispose();
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
      const toolsUsedFail = [...new Set(runMetrics.toolCallNames)];
      if (abortedByClient) {
        recordConversationTurnFromReq(req, {
          outcome: "cancelled",
          assistantMessage: "",
          toolsUsed: toolsUsedFail,
          errorDetail: "run_aborted",
        });
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
      const errMsg = failed instanceof Error ? failed.message : String(failed);
      recordConversationTurnFromReq(req, {
        outcome: "error",
        assistantMessage: "",
        toolsUsed: toolsUsedFail,
        errorDetail: errMsg.slice(0, 2000),
      });
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
    const toolsUsed = [...new Set(runMetrics.toolCallNames)];
    recordConversationTurn({
      schema: CONVERSATION_SCHEMA,
      recordedAt: runFinishedAt,
      ssoUserName: req.ssoUserName,
      userMessage: String(req.message || "").trim(),
      assistantMessage: completionText,
      toolsUsed,
      channel: req.channel || "studio",
      outcome: "completed",
    });
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
