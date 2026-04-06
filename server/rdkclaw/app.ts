import * as crypto from "node:crypto";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  Agent,
  builtinTools,
  type Tool,
  type ToolContext,
} from "../agent/openclaw-index.js";
import {
  buildModelDef,
  buildStreamFn,
  getApiKey,
  getBaseUrl,
  loadProviderConfigForStudioLane,
  warmupModelCapabilities,
  rdkclawShouldStreamThinking,
  resolveRdkclawAgentReasoning,
  resolveSamplingTemperature,
  resolveSamplingTopP,
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
import { createSkillhubTools } from "../agent/tools/skillhub-tools.js";
import { initRdkDocCache, stopRefreshTimer } from "./rdk-doc-local-cache.js";
import { createSkillDiscoveryTools } from "../agent/tools/skill-discovery-tools.js";
import { OpenClawDeploymentManager } from "../managers/OpenClawDeploymentManager.js";
import { readDevices } from "../storage.js";
import { DEFAULT_SSH_PASSWORD } from "../constants.js";
import { CONVERSATION_SCHEMA, recordConversationTurn } from "../conversation-log.js";
import type { ConversationOutcome } from "../conversation-types.js";
import { resolveRdkclawMaxAgentTurns } from "./max-agent-turns.js";
import { abortable, combineAbortSignals } from "../agent/tools/abort.js";

/** 长任务「仍在处理」心跳间隔。可用 RDKCLAW_RUN_PROGRESS_INTERVAL_MS 覆盖（毫秒，3s–300s）。 */
function resolveRdkclawRunProgressIntervalMs(): number {
  const raw = process.env.RDKCLAW_RUN_PROGRESS_INTERVAL_MS;
  if (raw) {
    const n = Number.parseInt(String(raw).trim(), 10);
    if (Number.isFinite(n)) return Math.min(300_000, Math.max(3_000, n));
  }
  return 12_000;
}

import { estimateTextTokens, recordTokenUsage } from "../monitoring/token-usage.js";
import { boardOpenClawAssessTool } from "./tools/board-openclaw-assess.js";
import { boardOpenClawChatTool } from "./tools/board-openclaw-chat.js";
import { boardOpenClawDelegateTool } from "./tools/board-openclaw-delegate.js";
import { fleetBoardListTool, fleetBoardDelegateTool, fleetBoardBroadcastTool } from "./tools/fleet-dispatch.js";
import { planTools } from "../agent/tools/plan-tool.js";
import { getDeviceProfile } from "../board/device-profiles.js";
import { getEffectiveContextWindowTokens } from "../agent/context/index.js";
import type { RdkPlatform } from "../../shared/board-types.js";
import { PersonaStore } from "./persona-store.js";
import { SkillRegistry } from "./skills/registry.js";
import { RDKClawPolicyStore } from "./policy-store.js";
import { UserWorkspaceStore, type ResolvedWorkspace } from "./workspace-store.js";
import { DeviceQueue } from "./device-queue.js";
import type {
  ApprovalDecisionMode,
  ChannelSource,
  PersonaProfile,
  RDKClawChatRequest,
  RDKClawEvent,
  RDKClawPolicy,
  RDKClawSkillMeta,
  UserProfile,
} from "./types.js";
import {
  getExternalChannelPolicy,
  validateExecCommand,
} from "./channel-safety.js";
import { getAgentMediaDownloadDir } from "../local-files-roots.js";
import { evaluatePermissionGuard, type SandboxGuardContext } from "./permission-guard.js";
import { mapMiniEvent, resolveExecutor } from "./event-mapper.js";
import { sanitizeSecrets } from "./secret-sanitizer.js";
import { TextDeltaSmoother } from "./text-delta-smoother.js";
import { getRdkclawTextSmootherOpts } from "../streaming-by-channel.js";
import { buildQueueStatusPayload } from "./queue-status-format.js";
import { rdkclawRunTrace } from "./run-trace-log.js";
import {
  classifyModelTier,
  type BoardSnapshot,
  type BoardSkillDetail,
  type ModelTier,
} from "./system-prompt-builder.js";
import { buildRdkclawSystemPromptBundle } from "./system-prompt-layers.js";
import { hashSystemPromptLayers, hashStableDynamicSystemPrompt } from "./system-prompt-telemetry.js";
import { parseAtRefs, hasAtRefs } from "./at-ref-parser.js";
import { BotStore } from "./bot-store.js";
import { KnowledgeSpaceStore } from "./knowledge-space-store.js";
import { KnowledgeRouter } from "./knowledge-router.js";
import { CompactHookRegistry } from "../agent/compact-hooks.js";
import { buildRdkClawToolHookRegistry } from "../agent/rdkclaw-tool-hooks.js";
import {
  selectDelegateDecision,
  resolveDelegationModeText,
  resolveDelegationExpectationText,
  type DelegateDecision,
} from "./delegation.js";
import { appendSecurityAuditLog, listSecurityAuditLogs } from "./security-audit-store.js";
import { buildStudioAgentSessionKey, createRdkclawDebugExportZip } from "./session-debug-export.js";
import { appendUtf8WithTailCap, DEFAULT_STREAM_OUTPUT_CHAR_LIMIT } from "../utils/stream-output-limit.js";
import { syncWorkspaceMarkdownMemory } from "./memory-markdown-sync.js";
import { runDevicePingProbe } from "./device-ping-probe.js";
import type { Device } from "../../shared/types.js";
import { execOnDevice } from "../agent/tools/rdk-ssh-helper.js";
import { normalizeUrl, stripHtml, truncate } from "../agent/tools/web-text-utils.js";

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

/** 无 ~/.rdkstudio/agent-config.json 且无 bootstrap 条目时的兜底；与 `config/rdkclaw-provider.defaults.json` 对齐（provider 为 openai-compatible，端点仍为方舟） */
const DEFAULT_CONFIG: ProviderConfig = {
  provider: "openai-compatible",
  model: "doubao-seed-2.0-pro",
  apiKey: "",
  baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
};

function resolveProviderConfigForLane(lane: "thinking" | "quick"): ProviderConfig {
  const config = loadProviderConfigForStudioLane(lane);
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
  const persisted = String(device.password ?? "").trim();
  return persisted || process.env.RDK_SSH_PASSWORD?.trim() || DEFAULT_SSH_PASSWORD;
}

/**
 * 明显寒暄/试探：无附件时可跳过每轮 Markdown→主存全量同步，缩短首包前耗时。
 * 若必须在本轮注入 WORKSPACE 的 MEMORY.md/USER.md，请发非寒暄句或带附件。
 */
function isTrivialStudioChatMessage(message: string): boolean {
  const t = message.trim();
  if (t.length === 0 || t.length > 48) return false;
  if (/[\n\r`#[\](){}\/\\]|附件|设备|ssh|ros|板|部署|错误|log|api|http/i.test(t)) return false;
  return /^(你好|您好|嗨|hi|hello|hey|在吗|在么|早上好|晚上好|谢谢|多谢|哈喽|hallo)(?:[!！。.?？~～\s]*)$/i.test(t);
}

/**
 * 板端公网探测脚本（与常见 `curl -sI http(s)://…` 手测一致）：
 * 1) 依次 HTTP(S) HEAD：百度 HTTP/HTTPS、npm registry（任一成功即 READY）
 * 2) wget spider 兜底
 * 3) ICMP ping 仅作补充（避免「仅 ICMP 被拦」误判为不可达）
 * 输出须含 NETWORK_READY 或 NETWORK_OFFLINE 之一。
 */
const DEVICE_PUBLIC_NETWORK_PROBE_SCRIPT = [
  'net_ok=0',
  'for u in http://www.baidu.com https://www.baidu.com https://registry.npmjs.org; do',
  '  if curl -sI --connect-timeout 3 --max-time 8 "$u" >/dev/null 2>&1; then net_ok=1; break; fi',
  'done',
  'if [ "$net_ok" != "1" ]; then',
  '  for u in http://www.baidu.com https://www.baidu.com; do',
  '    if wget -q --spider --timeout=8 "$u" 2>/dev/null; then net_ok=1; break; fi',
  '  done',
  'fi',
  'if [ "$net_ok" != "1" ]; then',
  '  if ping -c 1 -W 2 223.5.5.5 >/dev/null 2>&1 || ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1; then net_ok=1; fi',
  'fi',
  'if [ "$net_ok" = "1" ]; then echo NETWORK_READY; else echo NETWORK_OFFLINE; fi',
].join('\n');

type RuntimeHealthReport = {
  safeMode: boolean;
  reasons: string[];
  missingRequiredFiles: string[];
  enabledSkills: number;
  totalSkills: number;
};

type DeviceConnectivitySnapshot = {
  reachable: boolean;
  status: "connected" | "offline" | "unknown" | "not_selected";
  detail: string;
  publicNetworkReady: boolean | null;
  publicNetworkDetail: string;
  fromFailCache?: boolean;
};

type InstantUrlContent = {
  url: string;
  title?: string;
  content: string;
};

function resolveRuntimePersona(
  base: PersonaProfile,
  override?: import("./bot-store.js").RoboBot["persona"],
): PersonaProfile {
  if (!override) return base;
  return {
    ...base,
    systemPromptOverride: override.systemPromptOverride?.trim() || base.systemPromptOverride,
    extraInstructions: [base.extraInstructions, override.extraInstructions].filter(Boolean).join("\n"),
    delegationBias: override.delegationBias || base.delegationBias,
    autonomyLevel: override.autonomyLevel || base.autonomyLevel,
    riskLevel: override.riskLevel || base.riskLevel,
  };
}

async function fetchInstantUrlContents(
  urls: string[],
  signal?: AbortSignal,
): Promise<InstantUrlContent[]> {
  const uniqueUrls = [...new Set(urls.map((item) => item.trim()).filter(Boolean))].slice(0, 3);
  const outputs = await Promise.all(uniqueUrls.map(async (rawUrl) => {
    try {
      const url = normalizeUrl(rawUrl);
      const res = await fetch(url, {
        method: "GET",
        signal,
        redirect: "follow",
        headers: {
          "User-Agent": "RDKStudio/1.0 (+knowledge-router)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        },
      });
      if (!res.ok) return null;
      const text = await res.text();
      const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const content = truncate(stripHtml(text), 12_000);
      if (!content.trim()) return null;
      const result: InstantUrlContent = {
        url,
        title: titleMatch?.[1]?.replace(/\s+/g, " ").trim() || undefined,
        content,
      };
      return result;
    } catch {
      return null;
    }
  }));
  return outputs.filter((item): item is InstantUrlContent => item !== null);
}

export class RDKClawApp {
  private readonly workspaceDir: string;
  private readonly openClawManager: OpenClawDeploymentManager;
  private readonly personaStore: PersonaStore;
  private readonly skills: SkillRegistry;
  private readonly policyStore: RDKClawPolicyStore;
  private readonly workspaceStore: UserWorkspaceStore;
  private readonly botStore: BotStore;
  private readonly knowledgeSpaceStore: KnowledgeSpaceStore;
  private readonly knowledgeRouter: KnowledgeRouter;
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
  private devicePublicNetworkCache = new Map<string, {
    expiresAt: number;
    value: { ready: boolean; detail: string };
  }>();
  private modelCapWarmedUp = new Set<string>();
  private static readonly BOARD_SNAPSHOT_TTL_MS = 60_000;
  /** 公网探测成功后的短缓存；探测策略已与 HTTP 手测对齐，仅减轻同轮连发时的 SSH 压力 */
  private static readonly DEVICE_PUBLIC_NETWORK_TTL_MS = 12_000;
  private readonly deviceQueue = new DeviceQueue();
  private cancelQueuedBeforeTs = 0;
  /**
   * 与「全部停止」联动：合并进每条 stream 的 abortSignal，使排队中 / setup 阶段尚未注册 runAgents 的请求也能被掐断并释放 device lane。
   * 每次 cancelAllRuns 先 abort 再换新实例，避免波及取消之后新发起的对话。
   */
  private cancelAllWave = new AbortController();
  private switchDeviceCallback?: (deviceId: string) => void;
  private pendingMapsCleanupInterval: ReturnType<typeof setInterval> | null = null;
  /** 贯穿 compaction 生命周期的 hooks（RDKClaw 默认可为空注册表，便于后续注入） */
  private readonly rdkCompactHooks = new CompactHookRegistry();

  private async getBoardSkillSnapshot(
    deviceId?: string,
    opts?: { timeoutMs?: number; cacheOnly?: boolean },
  ): Promise<BoardSnapshot> {
    if (!deviceId) return { skills: [], skillDetails: [], plugins: [] };
    const cached = this.boardSkillSnapshotCache.get(deviceId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    /** 快速模式：不 SSH，仅用有效 TTL 缓存；冷启动为空以换首字时间 */
    if (opts?.cacheOnly) {
      return { skills: [], skillDetails: [], plugins: [] };
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
    /** 快速模式缩短等待，避免 SSH 拉技能清单占满首字前的 9s 预算 */
    const timeoutMs = Math.max(1500, Math.min(9000, opts?.timeoutMs ?? 9000));
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
          try {
            const r = appendUtf8WithTailCap(output, chunk, DEFAULT_STREAM_OUTPUT_CHAR_LIMIT);
            output = r.value;
          } catch {
            /* 流式回调异常不阻塞 Promise，由超时兜底 */
          }
        },
        () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try {
            const skillDetails: BoardSkillDetail[] = [];
            const plugins: string[] = [];
            let section = "";
            for (const line of output.split("\n")) {
              const trimmed = line.trim();
              if (trimmed === "===SKILLS===") { section = "skills"; continue; }
              if (trimmed === "===CLAWHUB===") { section = "clawhub"; continue; }
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
              } else if (section === "clawhub") {
                if (/no installed skills/i.test(trimmed)) continue;
                const slug = trimmed.split(/\s+/)[0]?.trim() ?? "";
                if (!slug || !/^[\w.-]+$/.test(slug)) continue;
                const rest = trimmed.slice(slug.length).trim();
                const verLabel = rest || "latest";
                skillDetails.push({
                  name: slug,
                  path: "clawhub",
                  description: `ClawHub 已安装 (${verLabel})`,
                  trigger: "",
                });
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
          } catch {
            const empty: BoardSnapshot = { skills: [], skillDetails: [], plugins: [] };
            this.boardSkillSnapshotCache.set(deviceId, { value: empty, expiresAt: Date.now() + RDKClawApp.BOARD_SNAPSHOT_TTL_MS });
            resolve(empty);
          }
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
    this.botStore = new BotStore();
    this.knowledgeSpaceStore = new KnowledgeSpaceStore();
    this.knowledgeRouter = new KnowledgeRouter(this.knowledgeSpaceStore);
    this.pendingMapsCleanupInterval = setInterval(() => this.cleanupStalePendingMaps(), 60_000);

    initRdkDocCache().catch((err) => {
      console.warn('[RDKClawApp] rdk-doc 本地缓存初始化失败（不影响正常功能）:', err);
    });
  }

  /** 释放定时器等资源，用于热重载和测试场景 */
  destroy() {
    if (this.pendingMapsCleanupInterval) {
      clearInterval(this.pendingMapsCleanupInterval);
      this.pendingMapsCleanupInterval = null;
    }
    stopRefreshTimer();
    this.sessionAutoApprove.clear();
    this.boardSkillSnapshotCache.clear();
    this.pendingApprovals.clear();
    this.pendingRecommendations.clear();
  }

  /**
   * 防止客户端断连后 pending 条目永久占用 Map（审批另有 5min 定时器，此为兜底）。
   */
  private cleanupStalePendingMaps() {
    const now = Date.now();
    const approvalStaleMs = 10 * 60 * 1000;
    const recommendationStaleMs = 30 * 60 * 1000;
    const sessionAutoApproveStaleMs = 60 * 60 * 1000; // 1h TTL for session auto-approve
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

    // 清理过期的 sessionAutoApprove 条目（防止内存泄漏）
    // 没有时间戳，用 size 上限兜底：超过 200 个时淘汰最早的
    if (this.sessionAutoApprove.size > 200) {
      const toDelete = this.sessionAutoApprove.size - 100;
      let deleted = 0;
      for (const key of this.sessionAutoApprove.keys()) {
        if (deleted >= toDelete) break;
        this.sessionAutoApprove.delete(key);
        deleted++;
      }
    }

    // 清理过期的 boardSkillSnapshotCache 条目
    for (const [id, entry] of this.boardSkillSnapshotCache) {
      if (now > entry.expiresAt) {
        this.boardSkillSnapshotCache.delete(id);
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

  /**
   * 将 SKILL.md 写入当前 Studio 用户对应的 RDKClaw 工作区 `skills/<skillId>/`（与对话侧技能热加载一致）。
   * 路径见 rdk-skill-authoring-guide：~/.rdkstudio/rdkclaw-workspaces/&lt;profile&gt;/skills/ 或自定义 workspaceRoot。
   */
  /**
   * 打包当前对话的运行诊断材料（本机会话 JSONL、可选设备侧日志、界面快照、安全审计）。
   */
  async exportDebugSessionBundle(input: {
    userId?: string;
    sessionId: string;
    deviceId?: string;
    includeBoardLogs?: boolean;
    uiSnapshot?: unknown;
  }): Promise<Buffer> {
    const sessionId = String(input.sessionId || "").trim();
    if (!sessionId) {
      throw new Error("sessionId 不能为空");
    }
    const deviceId = String(input.deviceId || "").trim() || undefined;
    const userProfile = input.userId ? this.personaStore.getUser(input.userId) : null;
    const ws = await this.workspaceStore.getOrInit(input.userId, userProfile);
    const sessionKey = buildStudioAgentSessionKey(deviceId, sessionId);
    const includeBoard =
      input.includeBoardLogs !== false && Boolean(deviceId);
    const audit = listSecurityAuditLogs(80);
    return createRdkclawDebugExportZip({
      sessionDir: ws.sessionDir,
      sessionKey,
      deviceId,
      includeBoardLogs: includeBoard,
      uiSnapshot: input.uiSnapshot,
      securityAudit: audit.length > 0 ? audit : undefined,
    });
  }

  async writeLocalSkill(userId: string | undefined, skillId: string, content: string): Promise<{ path: string }> {
    const name = String(skillId || '').trim();
    const md = String(content || '').trim();
    if (!name || !md) {
      throw new Error('skillId 和 content 不能为空');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error('skillId 只能包含字母、数字、下划线和横线');
    }
    const userProfile = userId ? this.personaStore.getUser(userId) : null;
    const ws = await this.workspaceStore.getOrInit(userId, userProfile);
    const skillDir = path.join(ws.workspaceDir, 'skills', name);
    await fs.promises.mkdir(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, 'SKILL.md');
    await fs.promises.writeFile(skillPath, md, 'utf-8');
    if (ws.workspaceDir !== this.workspaceDir) {
      this.skills.addExtraDir(path.join(ws.workspaceDir, 'skills'));
    }
    return { path: skillPath };
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
    this.cancelAllWave.abort();
    this.cancelAllWave = new AbortController();
    let count = 0;
    for (const [_id, agent] of this.runAgents) {
      try { agent.abort(); count++; } catch { /* ignore */ }
    }
    return count;
  }

  getActiveRunIds(): string[] {
    return Array.from(this.runAgents.keys());
  }

  /** setup 阶段被「全部停止」等掐断时，统一输出 run_complete 并结束 generator */
  private *yieldSetupAbortedRun(
    req: RDKClawChatRequest,
    runId: string,
    sessionKey: string,
    traceChannel: string,
    runStartedAt: number,
  ): Generator<RDKClawEvent, void, void> {
    recordConversationTurnFromReq(req, {
      outcome: "cancelled",
      assistantMessage: "",
      toolsUsed: [],
      errorDetail: "setup_aborted",
    });
    rdkclawRunTrace("run_done", {
      runId,
      sessionId: sessionKey,
      channel: traceChannel,
      outcome: "cancelled",
      tool_calls: 0,
    });
    const elapsedMs = Date.now() - runStartedAt;
    yield {
      type: "run_complete",
      data: {
        runId,
        sessionId: sessionKey,
        channel: traceChannel,
        message: "已取消",
        cancelled: true,
        elapsed_ms: elapsedMs,
        elapsed_display: `${Math.max(1, Math.round(elapsedMs / 1000))} 秒`,
        tool_calls: 0,
      },
    };
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
    sandbox: SandboxGuardContext,
    isPackagedDesktop: boolean,
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
          sandbox,
          isPackagedDesktop,
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
    boardSnapshot: BoardSnapshot | undefined,
    deviceReachable: boolean,
    /** true=探测到公网可用；false=明确不可达；null=未知（勿按「不可达」拦截仅 SSH 可执行的命令） */
    devicePublicNetworkReady: boolean | null,
    sandbox: SandboxGuardContext,
    isPackagedDesktop: boolean,
  ): Tool[] {
    const tools: Tool[] = [
      ...builtinTools,
      ...createStudioTools(this.autonomyRuntime),
      ...createAttachmentTools(sessionAttachments, providerConfig, base.sessionId),
      ...createDeviceManagerTools(this.switchDeviceCallback),
      ...createSkillDiscoveryTools({
        matchLocal: (query) => this.skills.matchByText(query).slice(0, 12),
        remoteEnabled: policy.network.enabled,
        afterSkillFilesMaterialized: () => {
          this.reloadSkills();
        },
      }),
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
        ...createSkillhubTools(),
      );
    }
    if (req.deviceId && deviceReachable) {
      const deviceTools = createRdkTools(req.deviceId, {
        openClawManager: this.openClawManager,
        onMediaDownloaded: (info) => {
          registerToolDownloadedAttachment(base.sessionId, sessionAttachments, {
            localPath: info.localPath,
            fileName: info.fileName,
            bytes: info.bytes,
          }).catch(() => {});
        },
        onDeviceExecProgress: ({ chunk, toolCallId }) => {
          emitEvent({
            type: "tool_progress",
            data: {
              ...base,
              toolName: "device_exec",
              name: "device_exec",
              toolCallId: toolCallId ?? "",
              phase: "running",
              executor: "rdkclaw_local",
              chunk,
              progressSource: "device_ssh",
            },
          });
        },
      });
      const gatedDeviceTools = deviceTools.map((tool) => {
        if (tool.name !== "device_exec" || devicePublicNetworkReady !== false) return tool;
        return {
          ...tool,
          execute: async (input: unknown, ctx: ToolContext) => {
            const cmd = String((input as { command?: unknown })?.command ?? "").trim();
            const needsInternet = /\b(apt(?:-get)?\s+(?:update|upgrade|install)|pip(?:3)?\s+install|npm\s+(?:install|update)|pnpm\s+(?:add|install|update)|yarn\s+add|uv\s+pip\s+install|git\s+clone|curl\s+https?:\/\/|wget\s+https?:\/\/)/i.test(cmd);
            if (needsInternet) {
              return "公网不可达：已拦截在线更新/拉包命令。请先恢复设备外网（DNS/网关）后再执行 update/install。";
            }
            return tool.execute(input, ctx);
          },
        };
      });
      tools.push(...gatedDeviceTools);
      if (devicePublicNetworkReady) {
      const skillsForBoard = boardSnapshot?.skillDetails.map((s) => ({
        name: s.name,
        path: s.path,
        description: s.description,
      }));
      tools.push(
        boardOpenClawAssessTool(req.deviceId, this.openClawManager, base.sessionId, skillsForBoard, (chunk, toolCallId) => {
          emitEvent({
            type: "tool_progress",
            data: {
              ...base,
              toolName: "board_openclaw_assess",
              name: "board_openclaw_assess",
              toolCallId: toolCallId ?? "",
              phase: "running",
              executor: "board_openclaw",
              chunk,
            },
          });
        }),
      );
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
            executor: 'board_openclaw',
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
            executor: 'board_openclaw',
            chunk,
          },
        });
      }));
      }
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
      return filtered.map((tool) =>
        this.wrapToolWithApproval(tool, policy, emitEvent, base, channel, sandbox, isPackagedDesktop),
      );
    }

    const channel = req.channel || "studio";
    return tools.map((tool) =>
      this.wrapToolWithApproval(tool, policy, emitEvent, base, channel, sandbox, isPackagedDesktop),
    );
  }

  private async probeDevicePublicNetwork(
    deviceId: string,
  ): Promise<{ ready: boolean | null; detail: string; fromCache: boolean }> {
    const cached = this.devicePublicNetworkCache.get(deviceId);
    if (cached && cached.expiresAt > Date.now()) {
      return { ready: cached.value.ready, detail: cached.value.detail, fromCache: true };
    }

    const probeCmd = `bash -lc ${JSON.stringify(DEVICE_PUBLIC_NETWORK_PROBE_SCRIPT)}`;

    try {
      const output = await execOnDevice(
        deviceId,
        [probeCmd],
        {
          timeoutMs: 22_000,
          rejectOnNonZeroExit: false,
        },
      );
      const upper = String(output || '').toUpperCase();
      let ready: boolean | null = null;
      if (upper.includes('NETWORK_READY')) {
        ready = true;
      } else if (upper.includes('NETWORK_OFFLINE')) {
        ready = false;
      } else {
        return { ready: null, detail: '公网探测结果无法解析', fromCache: false };
      }
      const detail = ready ? '公网可达（HTTP/HTTPS 探测）' : '公网不可达';
      this.devicePublicNetworkCache.set(deviceId, {
        expiresAt: Date.now() + RDKClawApp.DEVICE_PUBLIC_NETWORK_TTL_MS,
        value: { ready, detail },
      });
      return { ready, detail, fromCache: false };
    } catch {
      return { ready: null, detail: '公网探测异常', fromCache: false };
    }
  }

  private async resolveDeviceConnectivity(req: RDKClawChatRequest): Promise<DeviceConnectivitySnapshot> {
    const deviceId = String(req.deviceId || "").trim();
    if (!deviceId) {
      return {
        reachable: false,
        status: "not_selected",
        detail: "未选择设备",
        publicNetworkReady: null,
        publicNetworkDetail: "未选择设备",
      };
    }
    const devices = await readDevices();
    const device = devices.find((item) => item.id === deviceId);
    if (!device) {
      return {
        reachable: false,
        status: "unknown",
        detail: "设备不存在或已被移除",
        publicNetworkReady: null,
        publicNetworkDetail: "设备不存在或已被移除",
      };
    }
    try {
      const ping = await runDevicePingProbe(
        deviceId,
        device as Device,
        String(req.requestHeaderPassword || ""),
      );
      if (!ping.ok) {
        return {
          reachable: false,
          status: "offline",
          detail: "SSH 握手失败或无可用凭据",
          publicNetworkReady: null,
          publicNetworkDetail: "SSH 不可达，无法探测公网",
          fromFailCache: ping.fromFailCache,
        };
      }
      const net = await this.probeDevicePublicNetwork(deviceId);
      return {
        reachable: true,
        status: "connected",
        detail: "SSH 握手成功",
        publicNetworkReady: net.ready,
        publicNetworkDetail: net.detail,
        fromFailCache: ping.fromFailCache,
      };
    } catch {
      return {
        reachable: false,
        status: "unknown",
        detail: "在线探测异常",
        publicNetworkReady: null,
        publicNetworkDetail: "在线探测异常",
      };
    }
  }

  /**
   * Agent 磁盘会话隔离：必须带 Studio 客户端 sessionId，否则多窗口/副屏会共用 device: 键导致上下文串台。
   */
  private studioAgentSessionKey(req: RDKClawChatRequest): string {
    const sid = req.sessionId?.trim();
    const did = req.deviceId?.trim();
    if (did && sid) return `device:${did}:studio:${sid}`;
    if (did) return `device:${did}`;
    if (sid) return `local:studio:${sid}`;
    return "local";
  }

  async *streamChat(req: RDKClawChatRequest): AsyncGenerator<RDKClawEvent> {
    const mergedAbort = combineAbortSignals(req.abortSignal, this.cancelAllWave.signal);
    if (mergedAbort) {
      req = { ...req, abortSignal: mergedAbort };
    }
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
    const lane = req.studioResponseMode === "quick" ? "quick" : "thinking";

    const rawProviderConfig = resolveProviderConfigForLane(lane);
    if (!rawProviderConfig.apiKey) {
      recordConversationTurnFromReq(req, {
        outcome: "error",
        assistantMessage: "",
        toolsUsed: [],
        errorDetail: "no_api_key",
      });
      throw new Error("未配置 AI 模型 API Key，请先在设置中配置。");
    }
    /** 深度 / 快速各用 registry 中对应条目的模型与参数；不在运行时二次覆盖采样与思考档位 */
    const providerConfig = rawProviderConfig;

    const deviceLane = this.deviceQueue.getLane(req.deviceId);
    const sessionKey = this.studioAgentSessionKey(req);

    const queueStatus = this.deviceQueue.getStatus(deviceLane);
    if (queueStatus.running) {
      const pos = queueStatus.pendingCount + 1;
      rdkclawRunTrace("queue_wait", {
        deviceLane,
        position: pos,
        currentChannel: queueStatus.running.channel,
        currentTask: queueStatus.running.messageSummary,
        runningRunId: queueStatus.running.runId,
      });
      yield {
        type: "queue_status" as const,
        data: buildQueueStatusPayload({
          deviceLane,
          position: pos,
          currentTask: queueStatus.running.messageSummary,
          currentChannel: queueStatus.running.channel,
          runningRunId: queueStatus.running.runId,
        }),
      };
    }

    const channel: import("./types.js").ChannelSource = req.channel || "studio";
    const enqueuedAt = Date.now();
    const slotPromise = this.deviceQueue.acquireSlot(
      deviceLane,
      {
        channel,
        messageSummary: String(req.message || "").slice(0, 60),
      },
      externalAbortSignal,
    );

    let lastQueuePulse = Date.now();
    let slot: { release: () => void } | null = null;
    for (;;) {
      if (externalAbortSignal?.aborted) {
        abortedByClient = true;
        recordConversationTurnFromReq(req, {
          outcome: "cancelled",
          assistantMessage: "",
          toolsUsed: [],
          errorDetail: "aborted_waiting_device_slot",
        });
        return;
      }
      const got = await Promise.race([
        slotPromise,
        new Promise<null>((r) => setTimeout(() => r(null), 500)),
      ]);
      if (got) {
        if (externalAbortSignal?.aborted) {
          got.release();
          abortedByClient = true;
          recordConversationTurnFromReq(req, {
            outcome: "cancelled",
            assistantMessage: "",
            toolsUsed: [],
            errorDetail: "aborted_waiting_device_slot",
          });
          return;
        }
        slot = got;
        break;
      }
      if (Date.now() - lastQueuePulse >= 5000) {
        lastQueuePulse = Date.now();
        const waitSec = Math.round((Date.now() - enqueuedAt) / 1000);
        const curStatus = this.deviceQueue.getStatus(deviceLane);
        const curRunInfo = curStatus.running;
        const curElapsed = curRunInfo ? Math.round((Date.now() - curRunInfo.startedAt) / 1000) : 0;
        const curElapsedMin = Math.floor(curElapsed / 60);
        const curElapsedHuman = curElapsedMin > 0 ? `${curElapsedMin}分${curElapsed % 60}秒` : `${curElapsed}秒`;
        const curSummary = curRunInfo
          ? `当前任务: "${curRunInfo.messageSummary}" (${curRunInfo.channel}，已运行 ${curElapsedHuman})`
          : "";
        yield {
          type: "run_progress" as const,
          data: {
            message:
              `排队等待中 (已等 ${waitSec}s)。${curSummary}` +
              "\n可选操作：点「结束当前」取消上一任务；或等待其完成后自动执行。",
            queue_wait: true,
            queue_wait_sec: waitSec,
            running_task_elapsed_sec: curElapsed,
            running_task_channel: curRunInfo?.channel,
            running_run_id: curRunInfo?.runId,
          },
        };
      }
    }

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
      yield* this._executeChat(req, sessionKey, providerConfig, slot!, deviceLane);
    } finally {
      slot?.release();
    }
  }

  private async *_executeChat(
    req: RDKClawChatRequest,
    sessionKey: string,
    providerConfig: ProviderConfig,
    _slot: { release: () => void },
    deviceLane: string,
  ): AsyncGenerator<RDKClawEvent> {
    const externalAbortSignal = req.abortSignal;
    let abortedByClient = Boolean(externalAbortSignal?.aborted);

    /** 与下方 `runAgents.set` 使用同一 ID，避免首条 setup meta 与真实 run 不一致导致客户端 cancel 404 */
    const runId = crypto.randomUUID();
    const traceChannel = req.channel || "studio";
    this.deviceQueue.updateActiveRunId(deviceLane, runId);
    rdkclawRunTrace("run_start", {
      runId,
      sessionId: sessionKey,
      channel: traceChannel,
      phase: "setup",
      deviceLane,
    });
    yield {
      type: "meta",
      data: {
        runId,
        sessionId: sessionKey,
        channel: traceChannel,
        executor: "rdkclaw_local",
        phase: "setup",
        message: "正在准备上下文...",
      },
    };

    const userProfile = req.userId ? this.personaStore.getUser(req.userId) : null;
    const studioQuick = req.studioResponseMode === "quick";
    const runStartedAt = Date.now();
    const workspaceStartedAt = Date.now();
    const workspacePromise = this.workspaceStore.getOrInit(req.userId, userProfile);
    const boardSnapshotStartedAt = Date.now();
    const boardSnapshotPromise = this.getBoardSkillSnapshot(req.deviceId, {
      timeoutMs: studioQuick ? 4000 : 9000,
      cacheOnly: studioQuick,
    });
    const attachmentPrepareStartedAt = Date.now();
    const connectivityStartedAt = Date.now();
    const connectivityPromise = this.resolveDeviceConnectivity(req);
    let attachmentPrepareMs = 0;
    let attachmentState: Awaited<ReturnType<typeof prepareSessionAttachments>>;
    let boardSnapshot: BoardSnapshot;
    let workspace: ResolvedWorkspace;
    let deviceConnectivity: DeviceConnectivitySnapshot;
    try {
      attachmentState = await abortable(
        prepareSessionAttachments(sessionKey, req.attachments),
        externalAbortSignal,
      );
      attachmentPrepareMs = Date.now() - attachmentPrepareStartedAt;
      await abortable(
        ensureAudioAttachmentTranscripts(
          sessionKey,
          attachmentState.allAttachments,
          providerConfig,
          attachmentState.newAttachments.map((item) => item.id),
        ),
        externalAbortSignal,
      );
      /** 快照与 workspace 互不依赖：并行等待以压缩 setup 阶段（不改变提示词与决策输入） */
      [boardSnapshot, workspace, deviceConnectivity] = await abortable(
        Promise.all([boardSnapshotPromise, workspacePromise, connectivityPromise]),
        externalAbortSignal,
      );
    } catch (e) {
      if (externalAbortSignal?.aborted || (e instanceof Error && e.message === "操作已中止")) {
        abortedByClient = true;
        yield* this.yieldSetupAbortedRun(req, runId, sessionKey, traceChannel, runStartedAt);
        return;
      }
      throw e;
    }
    const connectivityMs = Date.now() - connectivityStartedAt;
    const boardSnapshotMs = Date.now() - boardSnapshotStartedAt;
    if (req.deviceId) {
      const devices = await readDevices();
      const d = devices.find((x) => x.id === req.deviceId);
      const bp = d?.boardPlatform;
      if (bp && getDeviceProfile(bp as RdkPlatform)) {
        (req as { platform?: RdkPlatform }).platform = bp as RdkPlatform;
      }
    }
    const workspaceInitMs = Date.now() - workspaceStartedAt;
    if (workspace.workspaceDir !== this.workspaceDir) {
      this.skills.addExtraDir(path.join(workspace.workspaceDir, "skills"));
    }
    const health = this.evaluateRuntimeHealth(workspace.workspaceDir);
    const attachmentPrompt = buildAttachmentPrompt(attachmentState.newAttachments);
    const effectiveMessage = [String(req.message || "").trim(), attachmentPrompt].filter(Boolean).join("\n\n");

    // ---- @引用解析 & 知识路由 ----
    const atRefs = hasAtRefs(effectiveMessage) ? parseAtRefs(effectiveMessage) : undefined;
    // 确定激活的 Bot：@bot > 请求体 > 存储
    let activeBot: import("./bot-store.js").RoboBot | undefined;
    if (atRefs?.hasReset) {
      this.botStore.setActiveBot(undefined);
    } else if (atRefs?.botName) {
      activeBot = this.botStore.getBotByName(atRefs.botName);
      if (activeBot) this.botStore.setActiveBot(activeBot.id);
    } else {
      const storedBotId = req.activeBotId ?? this.botStore.getActiveBotId();
      if (storedBotId) activeBot = this.botStore.getBot(storedBotId);
    }
    const knowledgeSpaceIds = [
      ...(atRefs?.docNames ?? []),
      ...(req.activeKnowledgeSpaceIds ?? []),
      ...(activeBot?.knowledgeSpaceIds ?? []),
    ];
    const persona = this.personaStore.getPersona();
    const policy = this.policyStore.getPolicy();
    const runtimePersona = resolveRuntimePersona(persona, activeBot?.persona);
    const instantUrlContents = policy.network.enabled && atRefs?.urls?.length
      ? await fetchInstantUrlContents(atRefs.urls, externalAbortSignal)
      : [];
    const knowledgeResult = this.knowledgeRouter.route({
      userMessage: atRefs?.cleanMessage ?? effectiveMessage,
      activeBot,
      activeKnowledgeSpaceIds: knowledgeSpaceIds,
      instantUrlContents,
      includeRdkOfficialDocs: activeBot?.includeRdkOfficialDocs ?? true,
      docPriority: activeBot?.docPriority ?? "merged",
    });
    const userMessageForPrompt = atRefs?.cleanMessage ?? effectiveMessage;

    const matchedSkills = this.skills
      .rankByPreferredRefs(
        this.skills.matchByText(userMessageForPrompt || req.message),
        activeBot?.skillIds ?? [],
      )
      .slice(0, 5);
    const setupElapsedMs = Date.now() - runStartedAt;
    const decision = selectDelegateDecision(req, matchedSkills, boardSnapshot, runtimePersona.delegationBias);
    const detectedPlatform = (req as { platform?: RdkPlatform }).platform as RdkPlatform | undefined;
    const deviceProfile = detectedPlatform ? getDeviceProfile(detectedPlatform) : null;
    const modelCaps = lookupModelCapabilities(providerConfig.provider, providerConfig.model);
    const modelTier = classifyModelTier(modelCaps.contextWindow, modelCaps.maxOutputTokens);
    const promptBundle = buildRdkclawSystemPromptBundle({
      persona: runtimePersona,
      modelTier,
      deviceProfile,
      deviceId: req.deviceId?.trim() || undefined,
      platform: detectedPlatform,
      boardSnapshot,
      studioUiHints: req.studioUiHints,
      allAttachments: attachmentState.allAttachments,
      policy,
      studioQuickAnswer: studioQuick,
      latestUserMessage: userMessageForPrompt,
      delegateDecision: decision,
      knowledgeContextBlock: knowledgeResult.knowledgeContextBlock || undefined,
      deviceConnectivity: req.deviceId
        ? {
            reachable: deviceConnectivity.reachable,
            status: deviceConnectivity.status,
            publicNetworkReady: deviceConnectivity.publicNetworkReady,
            detail:
              deviceConnectivity.publicNetworkReady === null
                ? `${deviceConnectivity.detail}；公网状态未知`
                : `${deviceConnectivity.detail}；公网${deviceConnectivity.publicNetworkReady ? '可达' : '不可达'}（${deviceConnectivity.publicNetworkDetail}）`,
          }
        : undefined,
    });
    const promptTelemetry = hashSystemPromptLayers(promptBundle.combined, promptBundle.layers);
    const promptStableDynamic = hashStableDynamicSystemPrompt(promptBundle.stablePrefix, promptBundle.dynamicSuffix);
    const systemPrompt = promptBundle.combined;
    const effectiveContextTokens = getEffectiveContextWindowTokens(
      modelCaps.contextWindow,
      modelCaps.maxOutputTokens,
    );
    const warmupKey = `${providerConfig.provider}:${providerConfig.model}`;
    if (!this.modelCapWarmedUp.has(warmupKey)) {
      this.modelCapWarmedUp.add(warmupKey);
      warmupModelCapabilities(providerConfig).catch(() => {});
    }
    const modelDefBase = buildModelDef(providerConfig);
    const modelDef =
      studioQuick && typeof (modelDefBase as { maxTokens?: number }).maxTokens === "number"
        ? {
            ...modelDefBase,
            maxTokens: Math.min((modelDefBase as { maxTokens: number }).maxTokens, 2048),
          }
        : modelDefBase;
    const streamFn = buildStreamFn(providerConfig);
    const apiKey = getApiKey(providerConfig);
    const baseUrl = getBaseUrl(providerConfig);

    const runtimePolicy = {
      /** 快速：只带今日日记，跳过 MEMORY.md 全文，减少预填与「再 read 一遍」的冲动 */
      dailyMemoryDays: studioQuick
        ? 1
        : Math.max(1, policy.memory.dailyMemoryDays || 2),
      mainReadsMemory: studioQuick ? false : policy.memory.mainSessionReadsMemory,
      sharedBlocksMemory: policy.memory.sharedSessionBlocksMemory,
      pruning: studioQuick
        ? {
            /** 快速：尽量压输入 token，逼近 TTFT 目标（仍保留最近 1 条助手轮） */
            maxHistoryShare: Math.min(policy.context.maxHistoryShare, 0.22),
            softTrimRatio: Math.min(policy.context.softTrimRatio, 0.22),
            hardClearRatio: Math.min(policy.context.hardClearRatio, 0.4),
            keepLastAssistants: Math.min(policy.context.keepLastAssistants, 1),
          }
        : {
            maxHistoryShare: policy.context.maxHistoryShare,
            softTrimRatio: policy.context.softTrimRatio,
            hardClearRatio: policy.context.hardClearRatio,
            keepLastAssistants: policy.context.keepLastAssistants,
          },
    };

    const base = { runId, sessionId: sessionKey, channel: traceChannel };
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
        studio_response_mode: req.studioResponseMode ?? "thinking",
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
        system_prompt_chars: promptTelemetry.combinedLength,
        system_prompt_hash_short: promptTelemetry.combinedHashShort,
        system_prompt_stable_chars: promptBundle.stablePrefix.length,
        system_prompt_dynamic_chars: promptBundle.dynamicSuffix.length,
        system_prompt_stable_hash_short: promptStableDynamic.stableHashShort,
        system_prompt_dynamic_hash_short: promptStableDynamic.dynamicHashShort,
        system_prompt_layer_count: promptBundle.layers.length,
        system_prompt_layer_hashes: promptTelemetry.layerHashes,
        effective_context_tokens: effectiveContextTokens,
        setup_elapsed_ms: setupElapsedMs,
        setup_workspace_ms: workspaceInitMs,
        setup_attachments_ms: attachmentPrepareMs,
        setup_board_snapshot_ms: boardSnapshotMs,
        setup_connectivity_ms: connectivityMs,
        device_reachable: req.deviceId ? deviceConnectivity.reachable : null,
        device_reachability_status: req.deviceId ? deviceConnectivity.status : null,
        device_reachability_detail: req.deviceId ? deviceConnectivity.detail : null,
        device_public_network_ready: req.deviceId ? deviceConnectivity.publicNetworkReady : null,
        device_public_network_detail: req.deviceId ? deviceConnectivity.publicNetworkDetail : null,
        device_ping_from_fail_cache: req.deviceId ? Boolean(deviceConnectivity.fromFailCache) : null,
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
    const extraRoots: string[] = [getAgentMediaDownloadDir()];
    if (workspace.workspaceDir !== this.workspaceDir) {
      extraRoots.push(workspace.workspaceDir);
    }

    /** 权限守卫与 read/write 使用同一套路径解析，禁止落盘/读取 Studio 安装目录 */
    const sandboxForGuard: SandboxGuardContext = {
      studioInstallRoot: this.workspaceDir,
      bootstrapDir: workspace.workspaceDir,
      extraAllowedRoots: extraRoots,
    };
    const isPackagedDesktop = process.env.RDK_PACKAGED_DESKTOP === "1";
    if (
      !isPackagedDesktop &&
      path.resolve(workspace.workspaceDir) === path.resolve(this.workspaceDir)
    ) {
      console.warn(
        "[rdkclaw] 用户工作台与 Studio 工程目录相同：开发模式下将拦截对该目录的读写；建议工作台单独使用 ~/.rdkstudio/rdkclaw-workspaces。",
      );
    }

    const sessionDeviceIdRef: { current: string | undefined } = {
      current: req.deviceId?.trim() || undefined,
    };
    let agentInstance: Agent | null = null;
    const buildSessionTools = () =>
      this.createTools(
        { ...req, deviceId: sessionDeviceIdRef.current },
        (event) => pushEvent(event),
        base,
        decision,
        policy,
        providerConfig,
        attachmentState.allAttachments,
        health.safeMode,
        boardSnapshot,
        deviceConnectivity.reachable,
        deviceConnectivity.publicNetworkReady,
        sandboxForGuard,
        isPackagedDesktop,
      );

    if (req.deviceId && !deviceConnectivity.reachable) {
      pushEvent({
        type: "meta",
        data: {
          ...base,
          executor: "rdkclaw_local",
          phase: "running",
          message: `当前设备离线（${deviceConnectivity.detail}），先执行连通性恢复，再进行 OpenClaw/更新等板端动作。`,
          device_reachability_status: deviceConnectivity.status,
        },
      });
    } else if (req.deviceId && deviceConnectivity.publicNetworkReady === false) {
      pushEvent({
        type: "meta",
        data: {
          ...base,
          executor: "rdkclaw_local",
          phase: "running",
          message: `设备已连通但公网不可达（${deviceConnectivity.publicNetworkDetail}），本轮不使用 OpenClaw/在线更新类指令，优先离线或本地方案。`,
          device_public_network_ready: false,
        },
      });
    }

    const rdkReasoning = resolveRdkclawAgentReasoning(providerConfig);
    const streamThinkingToClient = rdkclawShouldStreamThinking(providerConfig);

    const agent = new Agent({
      agentId: "rdkclaw",
      systemPrompt,
      systemPromptSplit: {
        stable: promptBundle.stablePrefix,
        dynamic: promptBundle.dynamicSuffix,
      },
      systemPromptTelemetry: {
        hashShort: promptTelemetry.combinedHashShort,
        layerCount: promptBundle.layers.length,
      },
      compactHooks: this.rdkCompactHooks,
      toolHooks: buildRdkClawToolHookRegistry(),
      tools: buildSessionTools(),
      studioDeviceIdResolver: () => sessionDeviceIdRef.current,
      toolContextExtras: {
        studioRunId: runId,
        onStudioDeviceBound: (id) => {
          sessionDeviceIdRef.current = id;
          this.switchDeviceCallback?.(id);
          agentInstance?.setTools(buildSessionTools());
        },
        onStudioDeviceRemoved: (id) => {
          if (sessionDeviceIdRef.current === id) {
            sessionDeviceIdRef.current = undefined;
          }
          agentInstance?.setTools(buildSessionTools());
        },
      },
      streamFn,
      modelDef,
      apiKey,
      provider: providerConfig.provider,
      model: providerConfig.model,
      workspaceDir: this.workspaceDir,
      bootstrapDir: workspace.workspaceDir,
      sessionDir: workspace.sessionDir,
      memoryDir: workspace.memoryDir,
      extraAllowedRoots: extraRoots,
      enableContext: true,
      /** 快速：不注入「先 read SKILL.md」链，避免首轮工具往返 */
      enableSkills: !studioQuick,
      enableMemory: true,
      enableHeartbeat: !studioQuick,
      contextBootstrapMaxChars: studioQuick ? 9000 : undefined,
      maxTurns: resolveRdkclawMaxAgentTurns(),
      temperature: resolveSamplingTemperature(providerConfig),
      topP: resolveSamplingTopP(providerConfig),
      reasoning: rdkReasoning === null ? null : rdkReasoning,
      contextTokens: Math.max(16_000, Number(policy.context.contextTokens) || modelCaps.contextWindow),
      runtimePolicy,
    });
    agentInstance = agent;

    const skipMarkdownMemorySync =
      studioQuick ||
      (attachmentState.allAttachments.length === 0 && isTrivialStudioChatMessage(String(req.message || "").trim()));
    let markdownMemorySync: { imported: number; projectionPath: string; projectionCount: number };
    try {
      markdownMemorySync = skipMarkdownMemorySync
        ? { imported: 0, projectionPath: "", projectionCount: 0 }
        : await abortable(
            syncWorkspaceMarkdownMemory({
              workspaceDir: workspace.workspaceDir,
              memory: agent.getMemory(),
            }),
            externalAbortSignal,
          );
    } catch (e) {
      if (externalAbortSignal?.aborted || (e instanceof Error && e.message === "操作已中止")) {
        abortedByClient = true;
        yield* this.yieldSetupAbortedRun(req, runId, sessionKey, traceChannel, runStartedAt);
        return;
      }
      throw e;
    }
    /** 每轮同步仍执行（见 syncWorkspaceMarkdownMemory）；不向 UI 推 meta（条数常固定，易成噪声） */
    if (markdownMemorySync.imported > 0) {
      console.debug(
        `[rdkclaw] markdown memory sync: imported=${markdownMemorySync.imported} projection=${markdownMemorySync.projectionCount} ${markdownMemorySync.projectionPath}`,
      );
    }
    let finished = false;
    let failed: unknown = null;
    /** agent-loop 在触顶或中止时推送 turn_transition，用于 run_complete 向 UI 说明「并非无故结束」 */
    let turnTransitionReason: string | null = null;
    let runResult:
      | { runId?: string; text: string; turns: number; toolCalls: number; skillTriggered?: string; memoriesUsed?: number }
      | null = null;
    this.runAgents.set(runId, agent);
    const smootherOpts = getRdkclawTextSmootherOpts(traceChannel, studioQuick);
    const textSmoother = TextDeltaSmoother.create(
      (delta) => {
        pushEvent({ type: "text", data: { delta, ...base } });
      },
      smootherOpts,
    );
    const handleExternalAbort = () => {
      abortedByClient = true;
      textSmoother.flushSync();
      agent.abort();
    };
    externalAbortSignal?.addEventListener("abort", handleExternalAbort, { once: true });

    const runProgressIntervalMs = resolveRdkclawRunProgressIntervalMs();
    const runProgressIntervalSec = Math.max(1, Math.round(runProgressIntervalMs / 1000));
    let progressTick = 0;
    let lastToolProgressNudgeAt = 0;
    const TOOL_START_NUDGE_MIN_GAP_MS = 6_000;

    const pushRunProgress = (reason: "interval" | "tool_start", activeToolName?: string) => {
      if (finished) return;
      const now = Date.now();
      if (reason === "tool_start") {
        if (now - lastToolProgressNudgeAt < TOOL_START_NUDGE_MIN_GAP_MS) return;
        lastToolProgressNudgeAt = now;
      }
      progressTick += 1;
      const elapsedMs = now - runStartedAt;
      const elapsedMin = Math.floor(elapsedMs / 60000);
      const totalCalls = runMetrics.localToolCalls + runMetrics.boardToolCalls;
      const latestTools = runMetrics.toolCallNames.slice(-3);
      const toolHint = latestTools.length > 0 ? `，最近: ${latestTools.join(" → ")}` : "";
      const elapsedHuman = elapsedMin > 0 ? `${elapsedMin} 分钟` : `${Math.floor(elapsedMs / 1000)} 秒`;
      const head =
        reason === "tool_start" && activeToolName
          ? `开始执行「${activeToolName}」`
          : "仍在处理中";
      pushEvent({
        type: "run_progress",
        data: {
          ...base,
          tick: progressTick,
          elapsed_ms: elapsedMs,
          elapsed_display: elapsedHuman,
          tool_calls: totalCalls,
          latest_tools: latestTools,
          message:
            `${head}，已运行 ${elapsedHuman}，累计 ${totalCalls} 个工具步骤${toolHint}` +
            `（约每 ${runProgressIntervalSec}s 推送一次进度；板端协作工具会额外流式输出）`,
        },
      });
    };

    let progressTimer: ReturnType<typeof setInterval> | undefined;
    let firstProgressHandle: ReturnType<typeof setTimeout> | undefined;
    /** 模型已开始向用户显示流式输出时，停止「仍在处理中」心跳，避免末尾与完成条重复 */
    let idleProgressMuted = false;
    const muteIdleProgressPolling = () => {
      if (studioQuick || idleProgressMuted) return;
      idleProgressMuted = true;
      if (firstProgressHandle) {
        clearTimeout(firstProgressHandle);
        firstProgressHandle = undefined;
      }
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = undefined;
      }
    };
    const resumeProgressPollingForLongTools = () => {
      if (studioQuick || finished || progressTimer) return;
      progressTimer = setInterval(() => pushRunProgress("interval"), runProgressIntervalMs);
    };
    if (!studioQuick) {
      progressTimer = setInterval(() => pushRunProgress("interval"), runProgressIntervalMs);
      firstProgressHandle = setTimeout(() => pushRunProgress("interval"), 5_000);
    }

    const unsubscribe = agent.subscribe((event) => {
      if (event.type === "turn_transition") {
        turnTransitionReason = event.reason;
      }
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
        resumeProgressPollingForLongTools();
        pushRunProgress("tool_start", event.toolName);
      }
      if (event.type === "message_delta") {
        muteIdleProgressPolling();
        textSmoother.push(sanitizeSecrets(event.delta));
        return;
      }
      // 扩展思考流式块：独立于正文 smoother，避免每个 token 都 flush 正文
      if (event.type === "thinking_delta") {
        if (streamThinkingToClient && String((event as { delta?: string }).delta ?? "").length > 0) {
          muteIdleProgressPolling();
        }
        if (!streamThinkingToClient) return;
        const mapped = mapMiniEvent(event, base);
        if (mapped) pushEvent(mapped);
        return;
      }
      textSmoother.flushSync();
      const mapped = mapMiniEvent(event, base);
      if (mapped) pushEvent(mapped);
    });

    agent.startHeartbeat((content, reason) => {
      pushEvent({ type: "meta", data: { ...base, executor: "rdkclaw_local", phase: "heartbeat", message: content, reason } });
    });

    const runPromise = agent
      .run(sessionKey, userMessageForPrompt || "请结合当前附件继续处理。", {
        studioRegenerate:
          Boolean(req.studioRegenerate) && (req.channel || "studio") === "studio",
      })
      .then((result) => {
        runResult = result;
      })
      .catch((error) => {
        failed = error;
      })
      .finally(() => {
        finished = true;
        if (firstProgressHandle) clearTimeout(firstProgressHandle);
        if (progressTimer) clearInterval(progressTimer);
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
        rdkclawRunTrace("run_done", {
          runId,
          sessionId: sessionKey,
          channel: traceChannel,
          outcome: "cancelled",
          tool_calls: runMetrics.localToolCalls + runMetrics.boardToolCalls,
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
      rdkclawRunTrace("run_error", {
        runId,
        sessionId: sessionKey,
        channel: traceChannel,
        error: errMsg.slice(0, 500),
        tool_calls: runMetrics.localToolCalls + runMetrics.boardToolCalls,
      });
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
    const promptText = [String(systemPrompt || ""), String(userMessageForPrompt || "")]
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
            maxHistoryShare: runtimePolicy.pruning.maxHistoryShare,
            softTrimRatio: runtimePolicy.pruning.softTrimRatio,
            hardClearRatio: runtimePolicy.pruning.hardClearRatio,
            keepLastAssistants: runtimePolicy.pruning.keepLastAssistants,
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
    rdkclawRunTrace("run_done", {
      runId,
      sessionId: sessionKey,
      channel: traceChannel,
      outcome: "ok",
      tool_calls: totalCalls,
      elapsed_ms: totalElapsedMs,
    });
    yield {
      type: "run_complete",
      data: {
        ...base,
        message: "已完成回复",
        elapsed_ms: totalElapsedMs,
        elapsed_display: elapsedDisplay,
        tool_calls: totalCalls,
        compaction_count: runMetrics.compactionCount,
        ...(turnTransitionReason === "max_turns_reached"
          ? {
              stop_reason: "max_turns_reached",
              stop_hint:
                "本轮已达推理轮次上限，若答复不完整可提高环境变量 RDKCLAW_MAX_AGENT_TURNS（≤256）后重启 Studio。",
            }
          : turnTransitionReason === "tool_followup_cap_reached"
            ? {
                stop_reason: "tool_followup_cap_reached",
                stop_hint:
                  "触顶后工具链收尾次数已达上限，若仍停在「下一步」话术可提高 RDKCLAW_MAX_AGENT_TURNS 或拆成多段对话。",
              }
            : {}),
      },
    };
  }
}
