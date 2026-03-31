/**
 * Tool Hooks — 工具执行拦截器框架
 *
 * 借鉴 claude-code: src/hooks/preToolUse.ts / postToolUse.ts
 *
 * 核心思想：
 * - 工具执行前后可以插入拦截器（hook），形成管道
 * - PreToolUse: 权限检查、参数校验、审计日志、危险操作拦截
 * - PostToolUse: 结果脱敏、结果缓存、执行统计
 *
 * 设计原则：
 * - hook 按优先级排序执行（数字越小越先执行）
 * - PreToolUse 可以返回 block（阻止执行）、modify（修改参数）、allow（放行）
 * - PostToolUse 可以修改结果或追加元数据
 * - hook 是可组合的：安全审计、密钥脱敏、权限检查各自独立
 */

import type { Tool, ToolContext } from "./tools/types.js";

// ============== PreToolUse ==============

export type PreToolUseDecision =
  | { action: "allow" }
  | { action: "block"; reason: string }
  | { action: "modify"; input: Record<string, unknown>; reason?: string };

export interface PreToolUseHook {
  name: string;
  priority: number;
  /** 返回 null 表示此 hook 不关心这个工具，跳过 */
  check(params: {
    tool: Tool;
    input: Record<string, unknown>;
    ctx: ToolContext;
    sessionId: string;
  }): Promise<PreToolUseDecision | null>;
}

// ============== PostToolUse ==============

export interface PostToolUseHook {
  name: string;
  priority: number;
  /** 可以修改 result 内容（如脱敏），返回 null 表示不修改 */
  process(params: {
    tool: Tool;
    input: Record<string, unknown>;
    result: string;
    isError: boolean;
    durationMs: number;
    ctx: ToolContext;
    sessionId: string;
  }): Promise<{ result: string } | null>;
}

// ============== Hook Registry ==============

export class ToolHookRegistry {
  private preHooks: PreToolUseHook[] = [];
  private postHooks: PostToolUseHook[] = [];

  registerPre(hook: PreToolUseHook): void {
    this.preHooks.push(hook);
    this.preHooks.sort((a, b) => a.priority - b.priority);
  }

  registerPost(hook: PostToolUseHook): void {
    this.postHooks.push(hook);
    this.postHooks.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 执行所有 PreToolUse hooks。
   * 遇到第一个 block 立即返回；modify 会累积应用。
   */
  async runPreHooks(params: {
    tool: Tool;
    input: Record<string, unknown>;
    ctx: ToolContext;
    sessionId: string;
  }): Promise<{ decision: PreToolUseDecision; hookName?: string }> {
    let currentInput = params.input;

    for (const hook of this.preHooks) {
      try {
        const decision = await hook.check({ ...params, input: currentInput });
        if (!decision) continue;

        if (decision.action === "block") {
          return { decision, hookName: hook.name };
        }
        if (decision.action === "modify") {
          currentInput = decision.input;
        }
      } catch (err) {
        // hook 自身出错不应阻止工具执行，记录警告继续
        process.stderr.write(
          `[tool-hooks] PreToolUse hook "${hook.name}" error: ${err instanceof Error ? err.message : err}\n`,
        );
      }
    }

    return { decision: { action: "allow" } };
  }

  /**
   * 执行所有 PostToolUse hooks。
   * 每个 hook 可以修改 result，修改会累积传递。
   */
  async runPostHooks(params: {
    tool: Tool;
    input: Record<string, unknown>;
    result: string;
    isError: boolean;
    durationMs: number;
    ctx: ToolContext;
    sessionId: string;
  }): Promise<string> {
    let currentResult = params.result;

    for (const hook of this.postHooks) {
      try {
        const modification = await hook.process({ ...params, result: currentResult });
        if (modification) {
          currentResult = modification.result;
        }
      } catch (err) {
        process.stderr.write(
          `[tool-hooks] PostToolUse hook "${hook.name}" error: ${err instanceof Error ? err.message : err}\n`,
        );
      }
    }

    return currentResult;
  }
}

// ============== 内置 Hooks ==============

/**
 * 密钥脱敏 hook — 自动脱敏工具执行结果中的 API key 等敏感信息
 */
export function createSecretSanitizerHook(
  sanitize: (text: string) => string,
): PostToolUseHook {
  return {
    name: "secret-sanitizer",
    priority: 10,
    async process({ result }) {
      const sanitized = sanitize(result);
      return sanitized !== result ? { result: sanitized } : null;
    },
  };
}

/**
 * 执行耗时统计 hook — 记录每个工具的执行时间
 */
export function createTimingHook(
  onTiming: (toolName: string, durationMs: number, isError: boolean) => void,
): PostToolUseHook {
  return {
    name: "timing",
    priority: 100,
    async process({ tool, durationMs, isError }) {
      onTiming(tool.name, durationMs, isError);
      return null;
    },
  };
}

/**
 * 只读模式 hook — 阻止所有写操作
 */
export function createReadOnlyHook(
  isWriteTool: (toolName: string) => boolean,
): PreToolUseHook {
  return {
    name: "read-only",
    priority: 1,
    async check({ tool }) {
      if (isWriteTool(tool.name)) {
        return { action: "block", reason: "当前为只读模式，不允许执行写操作" };
      }
      return null;
    },
  };
}
