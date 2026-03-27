/**
 * AI Orchestrator Module
 *
 * Architecture (Skill-driven):
 *   User Input → AI API (with SKILL.md context) → Tag Parser
 *                                ↓
 *   [[skill:...]] → API Call    |  [[action:...]] → Client Dispatch
 *   [[intent:...]] → Legacy Handler (backward compat)
 */

// Types
export type { IntentId, IntentResult, Capability, CapabilityPhase } from './types';
export type { Task, TaskStatus, TaskStep } from './types';
export type { AppActions, OrchestratorOutput } from './types';
export type { ParsedTag, ParsedAIResult } from './types';

// Capabilities (legacy, kept for backward compat)
export { CAPABILITIES, getCapability, getCapabilityDisplayLabel, matchCapabilityByKeyword } from './capabilities';

// Intent
export { parseAIResponse, parseAIResponseV2, detectIntentByKeyword } from './intent';

// Executor
export { createTask, transitionTask, requireConfirmation, advanceStep, completeTask, failTask, cancelTask, runTaskSteps } from './executor';

// Orchestrator
export { orchestrate } from './orchestrator';
export type { OrchestrateParams } from './orchestrator';
