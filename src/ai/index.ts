/**
 * AI Orchestrator Module
 *
 * Architecture:
 *   User Input → AI API → Intent Parser → Capability Registry
 *                                ↓
 *                         Orchestrator → Task Executor → App Actions
 *                                ↓
 *                         Chat Blocks + Progress Sync
 */

// Types
export type { IntentId, IntentResult, Capability, CapabilityPhase } from './types';
export type { Task, TaskStatus, TaskStep } from './types';
export type { AppActions, OrchestratorOutput } from './types';

// Capabilities
export { CAPABILITIES, getCapability, matchCapabilityByKeyword } from './capabilities';

// Intent
export { parseAIResponse, detectIntentByKeyword } from './intent';

// Executor
export { createTask, transitionTask, requireConfirmation, advanceStep, completeTask, failTask, cancelTask, runTaskSteps } from './executor';

// Orchestrator
export { orchestrate } from './orchestrator';
export type { OrchestrateParams } from './orchestrator';
