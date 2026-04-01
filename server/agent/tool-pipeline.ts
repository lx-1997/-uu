/**
 * 工具执行前置管道（对齐 Claude Code PreToolUse 钩子思想的子集）
 *
 * - 统一 schema 校验（浅层 required）
 * - 可注册 async pre-hook：可改写 input 或拒绝执行
 */

import type { Tool } from "./tools/types.js";

export type PreToolHookContext = {
  toolName: string;
  input: Record<string, unknown>;
  sessionKey: string;
};

/** hook 返回 ok:false 时，工具不执行，结果写入 tool_result */
export type PreToolHookResult =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; message: string };

export type PreToolHook = (ctx: PreToolHookContext) => Promise<PreToolHookResult>;

const preToolHooks: PreToolHook[] = [];

/**
 * 注册前置钩子；返回卸载函数。
 * （RDKClaw 或测试可挂载审计、策略改参等）
 */
export function registerPreToolHook(hook: PreToolHook): () => void {
  preToolHooks.push(hook);
  return () => {
    const i = preToolHooks.indexOf(hook);
    if (i !== -1) preToolHooks.splice(i, 1);
  };
}

/** 测试/重载用 */
export function clearPreToolHooksForTests(): void {
  preToolHooks.length = 0;
}

type JsonSchemaProperty = {
  type?: string;
  enum?: unknown[];
};

/**
 * 浅层校验：JSON Schema object、required、以及 properties.*.type（无 ajv 依赖）。
 * 未声明 type 的字段不校验；复杂组合 schema 仍由 execute 内处理。
 */
export function validateToolInputObject(
  tool: Tool,
  input: unknown,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: `${tool.name}: 工具参数必须是 JSON 对象` };
  }
  const obj = input as Record<string, unknown>;
  const schema = tool.inputSchema as {
    type?: string;
    required?: string[];
    properties?: Record<string, JsonSchemaProperty>;
  } | undefined;
  if (!schema || schema.type !== "object") {
    return { ok: true, value: obj };
  }
  const required = schema.required ?? [];
  for (const key of required) {
    if (!(key in obj) || obj[key] === undefined) {
      return { ok: false, message: `${tool.name}: 缺少必填参数 "${key}"` };
    }
  }
  const props = schema.properties;
  if (props) {
    for (const key of Object.keys(obj)) {
      const spec = props[key];
      if (!spec) continue;
      const v = obj[key];
      if (v === undefined) continue;
      if (spec.enum !== undefined && spec.enum.length > 0) {
        if (!spec.enum.some((e) => Object.is(e, v))) {
          return {
            ok: false,
            message: `${tool.name}: 参数 "${key}" 必须是 schema.enum 中某项`,
          };
        }
        continue;
      }
      if (!spec.type) continue;
      const t = spec.type;
      if (t === "string") {
        if (typeof v !== "string") {
          return { ok: false, message: `${tool.name}: 参数 "${key}" 应为 string` };
        }
      } else if (t === "number") {
        if (typeof v !== "number" || Number.isNaN(v)) {
          return { ok: false, message: `${tool.name}: 参数 "${key}" 应为 number` };
        }
      } else if (t === "integer") {
        if (typeof v !== "number" || !Number.isInteger(v)) {
          return { ok: false, message: `${tool.name}: 参数 "${key}" 应为 integer` };
        }
      } else if (t === "boolean") {
        if (typeof v !== "boolean") {
          return { ok: false, message: `${tool.name}: 参数 "${key}" 应为 boolean` };
        }
      } else if (t === "array") {
        if (!Array.isArray(v)) {
          return { ok: false, message: `${tool.name}: 参数 "${key}" 应为 array` };
        }
      } else if (t === "object") {
        if (v === null || typeof v !== "object" || Array.isArray(v)) {
          return { ok: false, message: `${tool.name}: 参数 "${key}" 应为 object` };
        }
      }
    }
  }
  return { ok: true, value: obj };
}

export async function runPreToolHookChain(
  toolName: string,
  input: Record<string, unknown>,
  sessionKey: string,
): Promise<PreToolHookResult> {
  let current: Record<string, unknown> = { ...input };
  for (const hook of preToolHooks) {
    const r = await hook({ toolName, input: current, sessionKey });
    if (!r.ok) return r;
    current = { ...r.input };
  }
  return { ok: true, input: current };
}
