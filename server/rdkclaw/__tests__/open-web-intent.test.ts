import { describe, it, expect } from "vitest";
import {
  detectOpenWebUserIntent,
  findSkillsQueryLooksLikeOpenWebDistractor,
  buildOpenWebRouteHintBlock,
} from "../open-web-intent.js";

describe("open-web-intent", () => {
  it("detectOpenWebUserIntent: URL and 打开百度", () => {
    expect(detectOpenWebUserIntent("https://www.baidu.com")).toBe(true);
    expect(detectOpenWebUserIntent("打开百度")).toBe(true);
    expect(detectOpenWebUserIntent("帮我打开 https://example.com/foo")).toBe(true);
    expect(detectOpenWebUserIntent("看下淘宝网站")).toBe(true);
  });

  it("detectOpenWebUserIntent: not short-circuit on long unrelated text", () => {
    const long = "a".repeat(900);
    expect(detectOpenWebUserIntent(long)).toBe(false);
  });

  it("findSkillsQueryLooksLikeOpenWebDistractor", () => {
    expect(findSkillsQueryLooksLikeOpenWebDistractor("打开网页")).toBe(true);
    expect(findSkillsQueryLooksLikeOpenWebDistractor("https://a.com")).toBe(true);
    expect(findSkillsQueryLooksLikeOpenWebDistractor("ros2 诊断")).toBe(false);
  });

  it("buildOpenWebRouteHintBlock includes studio_open_url", () => {
    expect(buildOpenWebRouteHintBlock()).toContain("studio_open_url");
    expect(buildOpenWebRouteHintBlock()).toContain("find_skills");
  });
});
