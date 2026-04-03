import { describe, it, expect, afterEach } from "vitest";
import {
  RDKCLAW_DEFAULT_MAX_AGENT_TURNS,
  RDKCLAW_MAX_AGENT_TURNS_HARD_CAP,
  resolveRdkclawMaxAgentTurns,
  resolveToolFollowupBypassCap,
} from "../max-agent-turns.js";

describe("max-agent-turns", () => {
  const prev = process.env.RDKCLAW_MAX_AGENT_TURNS;

  afterEach(() => {
    if (prev === undefined) delete process.env.RDKCLAW_MAX_AGENT_TURNS;
    else process.env.RDKCLAW_MAX_AGENT_TURNS = prev;
  });

  it("默认 64，与长程 agent 产品量级一致", () => {
    delete process.env.RDKCLAW_MAX_AGENT_TURNS;
    expect(RDKCLAW_DEFAULT_MAX_AGENT_TURNS).toBe(64);
    expect(resolveRdkclawMaxAgentTurns()).toBe(64);
  });

  it("环境变量可上调，且不超过硬顶 256", () => {
    process.env.RDKCLAW_MAX_AGENT_TURNS = "999";
    expect(resolveRdkclawMaxAgentTurns()).toBe(RDKCLAW_MAX_AGENT_TURNS_HARD_CAP);
    process.env.RDKCLAW_MAX_AGENT_TURNS = "128";
    expect(resolveRdkclawMaxAgentTurns()).toBe(128);
  });

  it("触顶后工具收尾预算随 maxTurns 放大并有总顶", () => {
    expect(resolveToolFollowupBypassCap(64)).toBe(128); // 64+32+32
    expect(resolveToolFollowupBypassCap(256)).toBe(192); // min(192, 256+128+32)
  });
});
