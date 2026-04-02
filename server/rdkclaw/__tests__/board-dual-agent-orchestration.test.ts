import { describe, expect, it, beforeEach } from "vitest";
import {
  applyNeedStreakPolicy,
  formatAssessInjectBlock,
  recordAssessSnapshot,
} from "../board-dual-agent-orchestration.js";

describe("board-dual-agent-orchestration", () => {
  const device = "dev-1";

  beforeEach(() => {
    process.env.RDK_DUAL_AGENT_LOG = "0";
  });

  it("injects assess block when fresh", () => {
    const session = "sess-inject";
    recordAssessSnapshot(session, device, {
      canHandle: true,
      confidence: 0.8,
      reason: "有技能",
      suggestedPath: "board",
    }, "flash 镜像");
    const block = formatAssessInjectBlock(session, device);
    expect(block).toContain("studio_last_assess");
    expect(block).toContain("suggestedPath=board");
    expect(block).toContain("flash 镜像");
  });

  it("NEED degrade after streak threshold", () => {
    const session = "sess-need";
    const body = "need\n[NEED_RDKCLAW]\ntype: x\nquery: y\nreason: z\n[/NEED_RDKCLAW]";
    const r1 = applyNeedStreakPolicy(session, device, body, { phase: "delegate" });
    expect(r1.degraded).toBe(false);
    expect(r1.needStreak).toBe(1);
    const r2 = applyNeedStreakPolicy(session, device, body, { phase: "chat" });
    expect(r2.degraded).toBe(false);
    expect(r2.needStreak).toBe(2);
    const r3 = applyNeedStreakPolicy(session, device, body, { phase: "delegate" });
    expect(r3.degraded).toBe(true);
    expect(r3.text).toContain("[Studio 策略]");
  });

  it("resets streak without NEED", () => {
    const session = "sess-reset";
    applyNeedStreakPolicy(session, device, "x [NEED_RDKCLAW] z", { phase: "delegate" });
    const r = applyNeedStreakPolicy(session, device, "done no tag", { phase: "chat" });
    expect(r.needStreak).toBe(0);
  });

  it("new assess resets need streak", () => {
    const session = "sess-reassess";
    applyNeedStreakPolicy(session, device, "[NEED_RDKCLAW][/NEED_RDKCLAW]", { phase: "delegate" });
    recordAssessSnapshot(session, device, {
      canHandle: false,
      confidence: 0.3,
      reason: "no",
    }, "t2");
    const r = applyNeedStreakPolicy(session, device, "[NEED_RDKCLAW][/NEED_RDKCLAW]", { phase: "delegate" });
    expect(r.needStreak).toBe(1);
  });
});
