import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { RDKClawApp } from "./app.js";
import type { RDKClawExecutionMode } from "./types.js";
import { NotificationHub } from "./notification-hub.js";

export interface AutonomyTask {
  id: string;
  name: string;
  prompt: string;
  scheduleType: "interval" | "cron";
  intervalMinutes?: number;
  intervalSeconds?: number;
  cron?: string;
  timezone?: string;
  mode: RDKClawExecutionMode;
  requiresApproval: boolean;
  approved: boolean;
  status: "active" | "paused" | "pending_approval" | "circuit_open";
  failureCount: number;
  lastRunAt?: number;
  nextRunAt: number;
  lastError?: string;
  /** 执行结束后向该微信用户推送摘要（须仍在最近会话表内，参见 weixin_recent_users） */
  notifyWeixinUserId?: string;
  /** 执行结束后向该飞书会话推送摘要；支持任意已保存的 chat_id（服务端 allowUnknown） */
  notifyFeishuChatId?: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".rdkstudio");
const TASK_FILE = path.join(CONFIG_DIR, "rdkclaw-autonomy-tasks.json");
const AUDIT_FILE = path.join(CONFIG_DIR, "rdkclaw-autonomy-audit.jsonl");

let dirEnsured = false;

/**
 * Cron 匹配用的日历分量。weekday 为 JS 惯例 0=周日 … 6=周六。
 * timezone 为 `local` / 空时使用运行环境本地时区；否则为 IANA 名（如 Asia/Shanghai、UTC）。
 */
function getCronCalendarParts(date: Date, timezone?: string): {
  minute: number;
  hour: number;
  day: number;
  month: number;
  weekday: number;
} {
  const tz = timezone?.trim();
  if (!tz || tz === "local") {
    return {
      minute: date.getMinutes(),
      hour: date.getHours(),
      day: date.getDate(),
      month: date.getMonth() + 1,
      weekday: date.getDay(),
    };
  }
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      day: "numeric",
      month: "numeric",
      weekday: "short",
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const pick = (type: Intl.DateTimeFormatPart["type"]) =>
      Number(parts.find((p) => p.type === type)?.value);
    const wd = parts.find((p) => p.type === "weekday")?.value;
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const weekday = wd !== undefined && wd in weekdayMap ? weekdayMap[wd] : date.getDay();
    return {
      minute: pick("minute"),
      hour: pick("hour"),
      day: pick("day"),
      month: pick("month"),
      weekday,
    };
  } catch {
    return {
      minute: date.getMinutes(),
      hour: date.getHours(),
      day: date.getDate(),
      month: date.getMonth() + 1,
      weekday: date.getDay(),
    };
  }
}

async function ensureDir() {
  if (dirEnsured) return;
  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  dirEnsured = true;
}

function ensureDirSync() {
  if (dirEnsured) return;
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  dirEnsured = true;
}

export type AutonomyChannelNotify = {
  notifyWeixin?: (userId: string, text: string) => Promise<boolean>;
  notifyFeishu?: (chatId: string, text: string) => Promise<boolean>;
};

export class AutonomyScheduler {
  private app: RDKClawApp;
  private notifications: NotificationHub;
  private channelNotify?: AutonomyChannelNotify;
  private tasks: AutonomyTask[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running = new Set<string>();
  private runIdByTaskId = new Map<string, string>();
  private cancelledByUser = new Set<string>();

  constructor(app: RDKClawApp, notifications: NotificationHub, channelNotify?: AutonomyChannelNotify) {
    this.app = app;
    this.notifications = notifications;
    this.channelNotify = channelNotify;
    this.tasks = this.readTasks();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 10_000);
    void this.tick();
  }

  shutdown() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  list() {
    return this.tasks;
  }

  create(input: {
    name: string;
    prompt: string;
    intervalMinutes?: number;
    intervalSeconds?: number;
    cron?: string;
    timezone?: string;
    mode?: RDKClawExecutionMode;
    requiresApproval?: boolean;
    notifyWeixinUserId?: string;
    notifyFeishuChatId?: string;
  }): AutonomyTask {
    const now = Date.now();
    const hasCron = !!input.cron?.trim();
    const rawIntervalSeconds = Number(input.intervalSeconds ?? 0);
    const rawIntervalMinutes = Number(input.intervalMinutes ?? 0);
    let intervalSeconds = rawIntervalSeconds > 0 ? Math.max(1, Math.floor(rawIntervalSeconds)) : 0;
    let intervalMinutes = rawIntervalMinutes > 0 ? Math.max(1, Math.floor(rawIntervalMinutes)) : 0;
    const scheduleType: "interval" | "cron" = hasCron ? "cron" : "interval";
    /** 未指定 cron 且间隔均为 0 时，工具仅必填 name 会造出「立即到期」任务，每 10s 重复触发 */
    if (scheduleType === "interval" && intervalSeconds === 0 && intervalMinutes === 0) {
      intervalMinutes = 1;
    }
    const task: AutonomyTask = {
      id: `task-${now}-${Math.random().toString(36).slice(2, 7)}`,
      name: input.name,
      prompt: input.prompt,
      scheduleType,
      intervalMinutes: scheduleType === "interval" && intervalMinutes > 0 ? intervalMinutes : undefined,
      intervalSeconds: scheduleType === "interval" && intervalSeconds > 0 ? intervalSeconds : undefined,
      cron: scheduleType === "cron" ? input.cron?.trim() : undefined,
      timezone: input.timezone?.trim() || "local",
      mode: input.mode || "board-preferred",
      requiresApproval: !!input.requiresApproval,
      approved: !input.requiresApproval,
      status: input.requiresApproval ? "pending_approval" : "active",
      failureCount: 0,
      nextRunAt:
        scheduleType === "interval"
          ? now + (intervalSeconds > 0 ? intervalSeconds * 1000 : intervalMinutes * 60000)
          : now + 60000,
      notifyWeixinUserId: input.notifyWeixinUserId?.trim() || undefined,
      notifyFeishuChatId: input.notifyFeishuChatId?.trim() || undefined,
    };
    this.tasks = [task, ...this.tasks];
    this.saveTasks();
    this.audit({ type: "task_create", taskId: task.id, name: task.name });
    return task;
  }

  approve(taskId: string) {
    this.tasks = this.tasks.map((t) =>
      t.id === taskId ? { ...t, approved: true, status: "active" } : t,
    );
    this.saveTasks();
    this.audit({ type: "task_approve", taskId });
  }

  pause(taskId: string) {
    this.tasks = this.tasks.map((t) => (t.id === taskId ? { ...t, status: "paused" } : t));
    this.saveTasks();
    this.audit({ type: "task_pause", taskId });
  }

  stop(taskId: string) {
    this.cancelledByUser.add(taskId);
    this.tasks = this.tasks.map((t) => (t.id === taskId ? { ...t, status: "paused" } : t));
    const runId = this.runIdByTaskId.get(taskId);
    if (runId) {
      this.app.cancelRun(runId);
    }
    this.saveTasks();
    this.audit({ type: "task_stop", taskId, runId: runId || "" });
  }

  stopAll(): { pausedTasks: number; cancelledRuns: number } {
    const activeTaskIds = this.tasks
      .filter((t) => t.status === "active" || this.running.has(t.id))
      .map((t) => t.id);
    let cancelledRuns = 0;
    for (const taskId of activeTaskIds) {
      this.cancelledByUser.add(taskId);
      const runId = this.runIdByTaskId.get(taskId);
      if (runId && this.app.cancelRun(runId)) {
        cancelledRuns += 1;
      }
    }
    if (activeTaskIds.length > 0) {
      this.tasks = this.tasks.map((t) => (
        activeTaskIds.includes(t.id)
          ? { ...t, status: "paused" }
          : t
      ));
      this.saveTasks();
    }
    this.audit({ type: "task_stop_all", pausedTasks: activeTaskIds.length, cancelledRuns });
    return { pausedTasks: activeTaskIds.length, cancelledRuns };
  }

  resume(taskId: string) {
    this.tasks = this.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const nextStatus = t.requiresApproval && !t.approved ? "pending_approval" : "active";
      const intervalMs = (t.intervalSeconds && t.intervalSeconds > 0)
        ? t.intervalSeconds * 1000
        : (t.intervalMinutes ?? 1) * 60000;
      return { ...t, status: nextStatus, nextRunAt: Date.now() + intervalMs };
    });
    this.saveTasks();
    this.audit({ type: "task_resume", taskId });
  }

  private cronFieldMatch(field: string, value: number): boolean {
    const token = field.trim();
    if (token === "*") return true;
    if (token.startsWith("*/")) {
      const n = Number(token.slice(2));
      return Number.isFinite(n) && n > 0 ? value % n === 0 : false;
    }
    if (token.includes(",")) {
      return token.split(",").some((part) => this.cronFieldMatch(part, value));
    }
    if (token.includes("-")) {
      const [s, e] = token.split("-").map((x) => Number(x.trim()));
      if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
      return value >= s && value <= e;
    }
    const n = Number(token);
    return Number.isFinite(n) && value === n;
  }

  private shouldRunCron(task: AutonomyTask, now: Date): boolean {
    if (task.scheduleType !== "cron" || !task.cron) return false;
    const parts = task.cron.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    const [min, hour, day, month, week] = parts;
    const z = getCronCalendarParts(now, task.timezone);
    const matches =
      this.cronFieldMatch(min, z.minute) &&
      this.cronFieldMatch(hour, z.hour) &&
      this.cronFieldMatch(day, z.day) &&
      this.cronFieldMatch(month, z.month) &&
      this.cronFieldMatch(week, z.weekday);
    if (!matches) return false;
    return !task.lastRunAt || now.getTime() - task.lastRunAt >= 55000;
  }

  private async tick() {
    const now = Date.now();
    const nowDate = new Date(now);
    for (const task of this.tasks) {
      if (task.status !== "active") continue;
      const dueByInterval = task.scheduleType === "interval" && task.nextRunAt <= now;
      const dueByCron = task.scheduleType === "cron" && this.shouldRunCron(task, nowDate);
      if (!dueByInterval && !dueByCron) continue;
      if (this.running.has(task.id)) continue;
      this.running.add(task.id);
      void this.runTask(task).finally(() => {
        this.running.delete(task.id);
      });
    }
  }

  private async runTask(task: AutonomyTask) {
    let errorText = "";
    let textOut = "";
    let wasCancelled = false;
    this.notifications.publish({
      type: "autonomy_start",
      title: `定时任务启动: ${task.name}`,
      message: "任务已进入执行队列。",
      taskId: task.id,
      level: "info",
      sessionId: `auto:${task.id}`,
      ts: Date.now(),
      payload: {
        scheduleType: task.scheduleType,
        intervalSeconds: task.intervalSeconds,
        intervalMinutes: task.intervalMinutes,
        cron: task.cron,
      },
    });
    try {
      for await (const event of this.app.streamChat({
        message: task.prompt,
        sessionId: `auto:${task.id}`,
        userId: "autonomy",
        ssoUserName: `定时任务:${task.name}`,
        mode: task.mode,
        channel: "autonomy",
      })) {
        if (event.type === "meta") {
          const runId = String(event.data.runId || "");
          if (runId) {
            this.runIdByTaskId.set(task.id, runId);
          }
        }
        if (event.type === "text") {
          textOut += String(event.data.delta ?? "");
        }
        if (event.type === "error") {
          errorText = String(event.data.error ?? "autonomy-error");
        }
      }
    } catch (err) {
      errorText = err instanceof Error ? err.message : String(err);
    } finally {
      this.runIdByTaskId.delete(task.id);
    }

    if (this.cancelledByUser.has(task.id)) {
      this.cancelledByUser.delete(task.id);
      wasCancelled = true;
      errorText = "";
    }

    this.tasks = this.tasks.map((t) => {
      if (t.id !== task.id) return t;
      const nextRunAt = t.scheduleType === "interval"
        ? Date.now() + ((t.intervalSeconds && t.intervalSeconds > 0) ? t.intervalSeconds * 1000 : (t.intervalMinutes ?? 1) * 60000)
        : Date.now() + 60000;
      if (wasCancelled) {
        return {
          ...t,
          failureCount: 0,
          status: "paused",
          lastError: "任务已手动停止",
          lastRunAt: Date.now(),
          nextRunAt,
        };
      }
      if (!errorText) {
        return {
          ...t,
          failureCount: 0,
          lastError: undefined,
          lastRunAt: Date.now(),
          nextRunAt,
        };
      }
      const failureCount = t.failureCount + 1;
      const status = failureCount >= 3 ? "circuit_open" : "active";
      return {
        ...t,
        failureCount,
        status,
        lastError: errorText,
        lastRunAt: Date.now(),
        nextRunAt,
      };
    });

    this.saveTasks();
    this.audit({
      type: "task_run",
      taskId: task.id,
      ok: !errorText,
      error: errorText,
      cancelled: wasCancelled,
    });
    if (wasCancelled) {
      this.notifications.publish({
        type: "autonomy_result",
        title: `定时任务已停止: ${task.name}`,
        message: "已手动停止当前执行，并将任务状态切换为 paused。",
        taskId: task.id,
        level: "info",
        sessionId: `auto:${task.id}`,
        ts: Date.now(),
      });
      return;
    }
    if (errorText) {
      this.notifications.publish({
        type: "autonomy_error",
        title: `定时任务失败: ${task.name}`,
        message: errorText,
        taskId: task.id,
        level: "error",
        sessionId: `auto:${task.id}`,
        ts: Date.now(),
      });
      await this.maybeNotifyChannels(task, false, errorText, textOut);
      return;
    }
    this.notifications.publish({
      type: "autonomy_result",
      title: `定时任务完成: ${task.name}`,
      message: (textOut || "任务已执行完成").trim().slice(0, 1200),
      taskId: task.id,
      level: "success",
      sessionId: `auto:${task.id}`,
      ts: Date.now(),
    });
    await this.maybeNotifyChannels(task, true, "", textOut);
  }

  private async maybeNotifyChannels(task: AutonomyTask, success: boolean, errorText: string, textOut: string) {
    const weixin = task.notifyWeixinUserId?.trim();
    const feishu = task.notifyFeishuChatId?.trim();
    if (!weixin && !feishu) return;
    const body = success
      ? `「${task.name}」完成\n${(textOut || "(无文本输出)").trim().slice(0, 1200)}`
      : `「${task.name}」失败\n${(errorText || "未知错误").slice(0, 800)}`;
    if (weixin && this.channelNotify?.notifyWeixin) {
      try {
        await this.channelNotify.notifyWeixin(weixin, body);
      } catch {
        /* non-fatal */
      }
    }
    if (feishu && this.channelNotify?.notifyFeishu) {
      try {
        await this.channelNotify.notifyFeishu(feishu, body);
      } catch {
        /* non-fatal */
      }
    }
  }

  /**
   * Async audit log append — non-blocking alternative to appendFileSync.
   * Fire-and-forget: audit failures are non-fatal and logged to stderr.
   */
  private audit(item: Record<string, unknown>) {
    const line = `${JSON.stringify({ ts: Date.now(), ...item })}\n`;
    void (async () => {
      try {
        await ensureDir();
        await fsp.appendFile(AUDIT_FILE, line, "utf-8");
      } catch (err) {
        process.stderr.write(`[autonomy-audit] write failed: ${err}\n`);
      }
    })();
  }

  /**
   * Sync read — only called once at construction time, so blocking is acceptable.
   */
  private readTasks(): AutonomyTask[] {
    try {
      ensureDirSync();
      if (!fs.existsSync(TASK_FILE)) return [];
      const raw = fs.readFileSync(TASK_FILE, "utf-8");
      const parsed = JSON.parse(raw) as AutonomyTask[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Async task persistence — replaces writeFileSync to avoid blocking
   * the event loop during scheduler ticks.
   */
  private saveTasks() {
    const data = JSON.stringify(this.tasks, null, 2);
    void (async () => {
      try {
        await ensureDir();
        await fsp.writeFile(TASK_FILE, data, "utf-8");
      } catch (err) {
        process.stderr.write(`[autonomy-scheduler] saveTasks failed: ${err}\n`);
      }
    })();
  }
}

