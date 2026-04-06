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
  /**
   * 为 true 时在套件端用 nohup 后台启动命令（适合 ros2 launch / ros2 run、长时间节点等），
   * SSH 仅等待启动与日志尾部；主进程在设备上持续运行。
   * 未传时若命令含 `ros2 launch`、`ros2 run` 或 `nohup`，服务端会自动按后台执行；显式 false 可强制前台。
   */
  background: z.boolean().optional(),
  /**
   * true：以 nohup 在套件端后台启动 `command`，SSH 立即返回 PID 与日志路径（用于推流/WS 服务等常驻进程）。
   * 此时代入的 timeoutMs 仅影响「启动脚手架」等待，不限制后台进程寿命。
   */
  runDetached: z.boolean().optional(),
  /** 与 runDetached 联用：后台 stdout/stderr 追加写入的绝对路径；省略则使用 /tmp 下自动命名文件（勿含空格） */
  detachedLogPath: z
    .string()
    .min(1)
    .refine((s) => !/\s/.test(s), { message: "detachedLogPath must not contain whitespace" })
    .optional(),
  /** 主命令结束后（常用于 background/runDetached 启动节点后）延迟再验收下列话题是否有数据 */
  ros2VerifyTopics: z.array(z.string().min(1)).max(24).optional(),
  /** 验收前等待毫秒（0～300000），默认 4500；冷启动慢可显式加大 */
  ros2VerifyTopicsDelayMs: z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? undefined : v),
    z.coerce.number().finite().min(0).max(300_000).optional(),
  ),
  /** 验收前 source 的 setup.bash；省略则自动尝试 /opt/tros 下各发行版 setup.bash 中第一个存在的文件 */
  ros2SetupBash: z.string().optional(),
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
