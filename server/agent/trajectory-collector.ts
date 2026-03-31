/**
 * 轨迹收集器 — 为 AgentEvolver 训练收集设备操作轨迹
 *
 * 在 agent-loop.ts 的工具执行回调中插入收集逻辑，
 * 将每次 Agent 与设备的交互记录为 AgentEvolver 可消费的 JSONL 格式。
 *
 * 数据用途：
 *   1. 直接供 evolve_no_gpu.py 的 Self-Attributing 分析
 *   2. 未来有 GPU 时，作为 PPO 训练的 seed 数据
 *   3. 供 ReMe 经验管理服务总结和检索
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface TrajectoryStep {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  timestamp: number;
}

export interface Trajectory {
  id: string;
  sessionKey: string;
  deviceId: string;
  steps: TrajectoryStep[];
  reward: number;
  userFeedback?: "good" | "bad" | null;
  startedAt: number;
  completedAt: number;
}

const TRAJECTORY_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || ".",
  ".rdkstudio",
  "trajectories",
);

export class TrajectoryCollector {
  private current = new Map<string, TrajectoryStep[]>();

  startRun(runId: string): void {
    this.current.set(runId, []);
  }

  addStep(runId: string, step: TrajectoryStep): void {
    this.current.get(runId)?.push(step);
  }

  /** 记录 assistant 消息（含可能的 tool_calls） */
  addAssistantStep(
    runId: string,
    content: string,
    toolCalls?: Array<{ name: string; input: Record<string, unknown> }>,
  ): void {
    const steps = this.current.get(runId);
    if (!steps) return;
    steps.push({
      role: "assistant",
      content,
      timestamp: Date.now(),
    });
    if (toolCalls) {
      for (const tc of toolCalls) {
        steps.push({
          role: "assistant",
          content: `[tool_call] ${tc.name}`,
          toolName: tc.name,
          toolInput: tc.input,
          timestamp: Date.now(),
        });
      }
    }
  }

  /** 记录工具执行结果 */
  addToolResult(runId: string, toolName: string, result: string): void {
    this.current.get(runId)?.push({
      role: "tool",
      content: result.slice(0, 5000), // 截断过长输出
      toolName,
      toolResult: result.slice(0, 5000),
      timestamp: Date.now(),
    });
  }

  /** 结束一次 run，持久化轨迹 */
  async endRun(
    runId: string,
    meta: {
      sessionKey: string;
      deviceId: string;
      reward?: number;
      userFeedback?: "good" | "bad" | null;
    },
  ): Promise<Trajectory | null> {
    const steps = this.current.get(runId);
    if (!steps || steps.length === 0) {
      this.current.delete(runId);
      return null;
    }
    this.current.delete(runId);

    const trajectory: Trajectory = {
      id: runId,
      sessionKey: meta.sessionKey,
      deviceId: meta.deviceId,
      steps,
      reward: meta.reward ?? 0,
      userFeedback: meta.userFeedback ?? null,
      startedAt: steps[0]?.timestamp || Date.now(),
      completedAt: Date.now(),
    };

    // 持久化为 JSONL
    try {
      await fs.promises.mkdir(TRAJECTORY_DIR, { recursive: true });
      const dateStr = new Date().toISOString().slice(0, 10);
      const file = path.join(TRAJECTORY_DIR, `${dateStr}.jsonl`);
      await fs.promises.appendFile(
        file,
        JSON.stringify(trajectory) + "\n",
        "utf-8",
      );
    } catch (err) {
      console.error("[TrajectoryCollector] 持久化失败:", err);
    }

    return trajectory;
  }

  /** 获取当前活跃的 run 数量 */
  get activeRuns(): number {
    return this.current.size;
  }
}

/** 全局单例 */
export const trajectoryCollector = new TrajectoryCollector();
