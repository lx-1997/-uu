/**
 * AI Orchestrator — Task Executor (State Machine)
 *
 * Manages task lifecycle:
 *   pending → confirming → running → done / failed / cancelled
 *
 * Each task transition emits a callback so the UI can sync progress to chat.
 */

import type { Task, TaskStatus, TaskStep, IntentId } from './types';

let taskSeq = 0;

/** Create a new task in 'pending' state */
export function createTask(
  capabilityId: IntentId,
  steps: Array<{ label: string }>,
  param?: string,
): Task {
  return {
    id: `task-${++taskSeq}-${Date.now()}`,
    capabilityId,
    status: 'pending',
    steps: steps.map((s, i) => ({
      label: s.label,
      status: (i === 0 ? 'running' : 'pending') as TaskStep['status'],
    })),
    param,
    createdAt: Date.now(),
  };
}

/** Transition a task to a new status. Returns a new Task object (immutable). */
export function transitionTask(task: Task, nextStatus: TaskStatus): Task {
  return { ...task, status: nextStatus };
}

/** Mark task as needing confirmation. Returns updated task + confirmId. */
export function requireConfirmation(task: Task): Task {
  const confirmId = `confirm-${task.id}`;
  return { ...task, status: 'confirming', confirmId };
}

/** Advance task steps: mark next step as 'running', previous as 'done'. */
export function advanceStep(task: Task): { task: Task; completed: boolean } {
  const currentIndex = task.steps.findIndex((s) => s.status === 'running');
  if (currentIndex === -1) {
    // All done already
    return { task, completed: true };
  }

  const newSteps = task.steps.map((s, i) => {
    if (i < currentIndex) return { ...s, status: 'done' as const };
    if (i === currentIndex) return { ...s, status: 'done' as const };
    if (i === currentIndex + 1) return { ...s, status: 'running' as const };
    return s;
  });

  const isLast = currentIndex === task.steps.length - 1;
  const updatedTask: Task = {
    ...task,
    steps: newSteps,
    status: isLast ? 'done' : 'running',
  };

  return { task: updatedTask, completed: isLast };
}

/** Mark all steps done and set result */
export function completeTask(task: Task, title: string, detail: string): Task {
  return {
    ...task,
    status: 'done',
    steps: task.steps.map((s) => ({ ...s, status: 'done' as const })),
    result: { success: true, title, detail },
  };
}

/** Mark task as failed */
export function failTask(task: Task, title: string, detail: string): Task {
  return {
    ...task,
    status: 'failed',
    result: { success: false, title, detail },
  };
}

/** Mark task as cancelled */
export function cancelTask(task: Task): Task {
  return { ...task, status: 'cancelled' };
}

/**
 * Run a task through its steps with timed progression.
 * Calls `onProgress` each tick, `onComplete` when finished.
 * Returns a cancel function.
 */
export function runTaskSteps(
  task: Task,
  intervalMs: number,
  onProgress: (updated: Task) => void,
  onComplete: (final: Task, resultTitle: string, resultDetail: string) => void,
  resultTitle: string,
  resultDetail: string,
): () => void {
  let current = { ...task, status: 'running' as TaskStatus };
  onProgress(current);

  const iv = setInterval(() => {
    const { task: next, completed } = advanceStep(current);
    current = next;
    onProgress(current);

    if (completed) {
      clearInterval(iv);
      const final = completeTask(current, resultTitle, resultDetail);
      onComplete(final, resultTitle, resultDetail);
    }
  }, intervalMs);

  return () => clearInterval(iv);
}
