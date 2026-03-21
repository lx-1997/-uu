export type RDKClawExecutionMode =
  | "auto"
  | "local"
  | "board"
  | "board-preferred";

export interface RDKClawChatRequest {
  message: string;
  deviceId?: string;
  sessionId?: string;
  userId?: string;
  mode?: RDKClawExecutionMode;
}

export type RDKClawEventType =
  | "text"
  | "tool_start"
  | "tool_progress"
  | "tool_result"
  | "approval_required"
  | "approval_decision"
  | "turn_start"
  | "turn_end"
  | "message_end"
  | "done"
  | "error"
  | "retry"
  | "meta";

export interface RDKClawEvent {
  type: RDKClawEventType;
  data: Record<string, unknown>;
}

export type ApprovalMode = "always" | "risk-based" | "auto";
export type RiskLevel = "low" | "medium" | "high";
export type ApprovalDecisionMode =
  | "allow_once"
  | "allow_session_auto"
  | "allow_global_auto"
  | "deny";

export interface RDKClawPolicy {
  approval: {
    mode: ApprovalMode;
    riskThreshold: RiskLevel;
  };
  delegation: {
    strategy: "local-first" | "board-first" | "hybrid";
    allowBoardAuto: boolean;
  };
  memory: {
    mainSessionReadsMemory: boolean;
    sharedSessionBlocksMemory: boolean;
    dailyMemoryDays: number;
  };
  scheduler: {
    defaultChannel: "chat" | "feishu";
    allowSecondInterval: boolean;
  };
}

export interface ExecutorSelection {
  executor: "local" | "board";
  reason: string;
}

export interface PersonaProfile {
  name: string;
  tone: "professional" | "friendly" | "concise" | "mentor";
  stylePrompt: string;
  riskLevel: "conservative" | "balanced" | "aggressive";
  boardDelegationBias: "low" | "medium" | "high";
  delegationBias: "local-first" | "balanced" | "board-first";
  autonomyLevel: "manual" | "assisted" | "autonomous";
  riskBoundary: "strict" | "moderate" | "relaxed";
  notifyStyle: "compact" | "detailed";
}

export interface UserProfile {
  userId: string;
  preferredExecutor: "auto" | "local" | "board";
  preferredLanguage: string;
  notes: string;
}

export interface SkillPermission {
  workspaceRead?: boolean;
  workspaceWrite?: boolean;
  deviceExec?: boolean;
  network?: boolean;
}

export interface SkillRuntimePolicy {
  delegatePreference?: "local" | "board" | "hybrid";
  requiresBoard?: boolean;
  approvalLevel?: "none" | "confirm" | "strict";
  cooldownSeconds?: number;
  schedulerTemplate?: string;
}

export interface RDKClawSkillMeta {
  name: string;
  description: string;
  sourcePath: string;
  version: string;
  tags: string[];
  trigger: string[];
  risk: "low" | "medium" | "high";
  permissions: SkillPermission;
  runtimePolicy?: SkillRuntimePolicy;
  enabled: boolean;
  updatedAt: number;
}

