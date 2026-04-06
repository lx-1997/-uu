import { describe, it, expect } from "vitest";
import { buildDelegationRuntimePrompt, selectDelegateDecision } from "../delegation.js";
import type { RDKClawChatRequest } from "../types.js";
import type { BoardSnapshot } from "../system-prompt-builder.js";

const emptyBoard: BoardSnapshot = {
  skills: [],
  skillDetails: [],
  plugins: [],
};

const boardWithSkills: BoardSnapshot = {
  skills: ["test-skill"],
  skillDetails: [{ name: "test-skill", description: "d", path: "/x", trigger: "" }],
  plugins: [],
};

describe("selectDelegateDecision", () => {
  it("local-first + board skills + generic request → local_only", () => {
    const req = { deviceId: "dev-1", message: "hi" } as RDKClawChatRequest;
    const d = selectDelegateDecision(req, [], boardWithSkills, "local-first");
    expect(d.path).toBe("local_only");
    expect(d.needsBoardCollaboration).toBe(false);
  });

  it("local-first + no board skills → local_only", () => {
    const req = { deviceId: "dev-1", message: "hi" } as RDKClawChatRequest;
    const d = selectDelegateDecision(req, [], emptyBoard, "local-first");
    expect(d.path).toBe("local_only");
    expect(d.needsBoardCollaboration).toBe(false);
  });

  it("local-first + no board skills + ROS2 execution task → local_only", () => {
    const req = {
      deviceId: "dev-1",
      message: "帮我在板子上跑 ros2 launch 并把相机检测结果发布出来",
    } as RDKClawChatRequest;
    const d = selectDelegateDecision(req, [], emptyBoard, "local-first");
    expect(d.path).toBe("local_only");
    expect(d.needsBoardCollaboration).toBe(false);
  });

  it("docs-only task still keeps local_only", () => {
    const req = {
      deviceId: "dev-1",
      message: "请帮我查 RDK 的 API 文档并整理主要参数",
    } as RDKClawChatRequest;
    const d = selectDelegateDecision(req, [], emptyBoard, "local-first");
    expect(d.path).toBe("local_only");
    expect(d.needsBoardCollaboration).toBe(false);
  });

  it("local-first + consultative task → collaborative", () => {
    const req = {
      deviceId: "dev-1",
      message: "先帮我评估一下这个机器人方案可行性和风险",
    } as RDKClawChatRequest;
    const d = selectDelegateDecision(req, [], emptyBoard, "local-first");
    expect(d.path).toBe("collaborative");
    expect(d.needsBoardCollaboration).toBe(true);
    expect(d.source).toBe("task_analysis");
  });

  it("local-first + long-running task → collaborative", () => {
    const req = {
      deviceId: "dev-1",
      message: "做一个7x24持续监控并自动恢复的守护任务",
    } as RDKClawChatRequest;
    const d = selectDelegateDecision(req, [], emptyBoard, "local-first");
    expect(d.path).toBe("collaborative");
    expect(d.needsBoardCollaboration).toBe(true);
    expect(d.source).toBe("task_analysis");
  });

  it("balanced + generic request → local_only", () => {
    const req = { deviceId: "dev-1", message: "帮我看下这个问题" } as RDKClawChatRequest;
    const d = selectDelegateDecision(req, [], boardWithSkills, "balanced");
    expect(d.path).toBe("local_only");
    expect(d.needsBoardCollaboration).toBe(false);
  });

  it("balanced + robotics execution + board skills → collaborative", () => {
    const req = {
      deviceId: "dev-1",
      message: "请在板端跑 ros2 launch 做相机目标检测",
    } as RDKClawChatRequest;
    const d = selectDelegateDecision(req, [], boardWithSkills, "balanced");
    expect(d.path).toBe("collaborative");
    expect(d.needsBoardCollaboration).toBe(true);
  });
});

describe("buildDelegationRuntimePrompt", () => {
  it("includes mode and OpenClaw line when collaboration expected", () => {
    const text = buildDelegationRuntimePrompt(
      {
        path: "collaborative",
        canLocalComplete: true,
        needsBoardCollaboration: true,
        source: "default",
        reason: "test",
        confidence: 0.9,
      },
      2,
    );
    expect(text).toContain("本地 + 套件端协同");
    expect(text).toContain("双伙伴共探");
    expect(text).toContain("assess→delegate");
  });
});
