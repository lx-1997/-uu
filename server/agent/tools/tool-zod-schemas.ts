/**
 * 高频工具的 Zod 入参模式（在 JSON Schema 浅校验之后执行）
 * - 约束类型/coerce 数字/非空字符串，减少无效工具往返
 */

import { z } from "zod";

const nonEmptyString = z.string().trim().min(1, "不能为空");

export const readToolInputZod = z.object({
  file_path: nonEmptyString,
  limit: z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? undefined : v),
    z.coerce.number().int().positive().max(500_000).optional(),
  ),
});

export const writeToolInputZod = z.object({
  file_path: nonEmptyString,
  content: z.string(),
});

export const editToolInputZod = z.object({
  file_path: nonEmptyString,
  old_string: z.string(),
  new_string: z.string(),
});

export const execToolInputZod = z.object({
  command: nonEmptyString,
  timeout: z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? undefined : v),
    z.coerce.number().finite().positive().max(3_600_000).optional(),
  ),
});

export const listToolInputZod = z.object({
  path: z.string().optional(),
  limit: z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? undefined : v),
    z.coerce.number().int().positive().max(50_000).optional(),
  ),
});

export const grepToolInputZod = z.object({
  pattern: nonEmptyString,
  path: z.string().optional(),
});

export const memorySearchToolInputZod = z.object({
  query: nonEmptyString,
  limit: z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? undefined : v),
    z.coerce.number().int().positive().max(100).optional(),
  ),
});

export const memoryGetToolInputZod = z.object({
  id: nonEmptyString,
});

export const memorySaveToolInputZod = z.object({
  content: z.string(),
});

const spawnScopeZod = z.enum([
  "read-only",
  "device-read",
  "explore",
  "plan",
  "verify",
  "full",
]);

export const sessionsSpawnToolInputZod = z.object({
  task: nonEmptyString,
  label: z.string().optional(),
  cleanup: z.enum(["keep", "delete"]).optional(),
  toolScope: spawnScopeZod.optional(),
});

export const deviceExecToolInputZod = z.object({
  command: nonEmptyString,
  /** 与 device_exec 工具描述一致：5s～120min；execute 内仍会 clamp */
  timeoutMs: z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? undefined : v),
    z.coerce.number().finite().min(5000).max(7_200_000).optional(),
  ),
});

export const deviceFileReadToolInputZod = z.object({
  path: nonEmptyString,
});

export const deviceFileWriteToolInputZod = z.object({
  path: nonEmptyString,
  content: z.string(),
});

export const deviceFileUploadFromLocalInputZod = z.object({
  localPath: nonEmptyString,
  remotePath: nonEmptyString,
});
