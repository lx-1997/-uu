import { describe, it, expect, beforeEach } from "vitest";
import {
  loadRdkDocUrlIndex,
  resetRdkDocUrlIndexCacheForTests,
  buildRdkDocHintForSystemPrompt,
} from "../rdk-doc-url-index.js";

describe("rdk-doc-url-index", () => {
  beforeEach(() => {
    resetRdkDocUrlIndexCacheForTests();
  });

  it("loads entries from markdown including detection yolo/fcos", () => {
    const idx = loadRdkDocUrlIndex();
    expect(idx.root).toContain("developer.d-robotics.cc/rdk_doc");
    const urls = idx.entries.map((e) => e.url);
    expect(urls.some((u) => u.includes("/detection/yolo"))).toBe(true);
    expect(urls.some((u) => u.includes("/detection/fcos"))).toBe(true);
    expect(urls.some((u) => u.includes("/detection/hobot_yolo_world"))).toBe(true);
  });

  it("buildRdkDocHintForSystemPrompt lists detection URLs", () => {
    const h = buildRdkDocHintForSystemPrompt();
    expect(h).toContain("detection");
    expect(h).toContain("YOLO");
    expect(h).toContain("FCOS");
    expect(h).toContain("hobot_yolo_world");
    expect(h).toContain("yolo_world");
  });
});
