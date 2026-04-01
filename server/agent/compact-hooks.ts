/**
 * Compaction 生命周期 Hooks — 对齐 claude-code executePreCompactHooks / executePostCompactHooks
 */

import type { Message } from "./session.js";

export type CompactReason = "run_start" | "overflow" | "proactive";

export interface PreCompactContext {
  sessionKey: string;
  runId: string;
  messages: Message[];
  reason: CompactReason;
}

export interface PostCompactContext {
  sessionKey: string;
  runId: string;
  summaryChars: number;
  droppedMessages: number;
  reason: CompactReason;
  success: boolean;
}

export type PreCompactHook = (ctx: PreCompactContext) => Promise<void>;
export type PostCompactHook = (ctx: PostCompactContext) => Promise<void>;

export class CompactHookRegistry {
  private preHooks: PreCompactHook[] = [];
  private postHooks: PostCompactHook[] = [];

  registerPre(hook: PreCompactHook): void {
    this.preHooks.push(hook);
  }

  registerPost(hook: PostCompactHook): void {
    this.postHooks.push(hook);
  }

  async runPreHooks(ctx: PreCompactContext): Promise<void> {
    for (const h of this.preHooks) {
      try {
        await h(ctx);
      } catch (err) {
        console.warn(
          `[compact-hooks] pre failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  async runPostHooks(ctx: PostCompactContext): Promise<void> {
    for (const h of this.postHooks) {
      try {
        await h(ctx);
      } catch (err) {
        console.warn(
          `[compact-hooks] post failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
}
