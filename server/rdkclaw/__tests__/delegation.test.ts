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
  it("local-first + board skills → collaborative + needsBoardCollaboration", () => {
    const req = { deviceId: "dev-1", message: "hi" } as RDKClawChatRequest;
    const d = selectDelegateDecision(req, [], boardWithSkills, "local-first");
    expect(d.path).toBe("collaborative");
    expect(d.needsBoardCollaboration).toBe(true);
  });

  it("local-first + no board skills → local_only", () => {
    const req = { deviceId: "dev-1", message: "hi" } as RDKClawChatRequest;
    const d = selectDelegateDecision(req, [], emptyBoard, "local-first");
    expect(d.path).toBe("local_only");
    expect(d.needsBoardCollaboration).toBe(false);
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
    expect(text).toContain("本地 + 板端协同");
    expect(text).toContain("双伙伴共探");
    expect(text).toContain("assess→delegate");
  });
});
