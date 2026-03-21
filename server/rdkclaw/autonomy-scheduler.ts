import * as fs from "node:fs";
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
}

const CONFIG_DIR = path.join(os.homedir(), ".rdkstudio");
const TASK_FILE = path.join(CONFIG_DIR, "rdkclaw-autonomy-tasks.json");
const AUDIT_FILE = path.join(CONFIG_DIR, "rdkclaw-autonomy-audit.jsonl");

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export class AutonomyScheduler {
  private app: RDKClawApp;
  private notifications: NotificationHub;
  private tasks: AutonomyTask[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running = new Set<string>();

  constructor(app: RDKClawApp, notifications: NotificationHub) {
    this.app = app;
    this.notifications = notifications;
    this.tasks = this.readTasks();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 1000);
    void this.tick();
  }

  stop() {
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
  }): AutonomyTask {
    const now = Date.now();
    const hasCron = !!input.cron?.trim();
    const rawIntervalSeconds = Number(input.intervalSeconds ?? 0);
    const rawIntervalMinutes = Number(input.intervalMinutes ?? 0);
    const intervalSeconds = rawIntervalSeconds > 0 ? Math.max(1, Math.floor(rawIntervalSeconds)) : 0;
    const intervalMinutes = rawIntervalMinutes > 0 ? Math.max(1, Math.floor(rawIntervalMinutes)) : 0;
    const scheduleType: "interval" | "cron" = hasCron ? "cron" : "interval";
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
    const matches =
      this.cronFieldMatch(min, now.getMinutes()) &&
      this.cronFieldMatch(hour, now.getHours()) &&
      this.cronFieldMatch(day, now.getDate()) &&
      this.cronFieldMatch(month, now.getMonth() + 1) &&
      this.cronFieldMatch(week, now.getDay());
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
        mode: task.mode,
      })) {
        if (event.type === "text") {
          textOut += String(event.data.delta ?? "");
        }
        if (event.type === "error") {
          errorText = String(event.data.error ?? "autonomy-error");
        }
      }
    } catch (err) {
      errorText = err instanceof Error ? err.message : String(err);
    }

    this.tasks = this.tasks.map((t) => {
      if (t.id !== task.id) return t;
      const nextRunAt = t.scheduleType === "interval"
        ? Date.now() + ((t.intervalSeconds && t.intervalSeconds > 0) ? t.intervalSeconds * 1000 : (t.intervalMinutes ?? 1) * 60000)
        : Date.now() + 60000;
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
    });
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
  }

  private audit(item: Record<string, unknown>) {
    ensureDir();
    fs.appendFileSync(AUDIT_FILE, `${JSON.stringify({ ts: Date.now(), ...item })}\n`, "utf-8");
  }

  private readTasks(): AutonomyTask[] {
    try {
      if (!fs.existsSync(TASK_FILE)) return [];
      const raw = fs.readFileSync(TASK_FILE, "utf-8");
      const parsed = JSON.parse(raw) as AutonomyTask[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveTasks() {
    ensureDir();
    fs.writeFileSync(TASK_FILE, JSON.stringify(this.tasks, null, 2), "utf-8");
  }
}

