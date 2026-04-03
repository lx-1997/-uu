import { describe, it, expect } from "vitest";
import {
  LAZY_LOAD_CORE_TOOL_NAMES,
  isLazyCoreToolName,
  shouldPreloadDeferrableWithStudioDevice,
} from "../lazy-tool-policy.js";

describe("lazy-tool-policy", () => {
  it("studio browser tools stay in core set (regression)", () => {
    expect(LAZY_LOAD_CORE_TOOL_NAMES.has("studio_open_url")).toBe(true);
    expect(LAZY_LOAD_CORE_TOOL_NAMES.has("studio_embedded_browser_capture")).toBe(true);
    expect(LAZY_LOAD_CORE_TOOL_NAMES.has("studio_open_local_preview")).toBe(true);
    expect(isLazyCoreToolName("studio_open_url")).toBe(true);
  });

  it("load_tools meta remains core", () => {
    expect(isLazyCoreToolName("load_tools")).toBe(true);
  });

  it("shouldPreloadDeferrableWithStudioDevice matches device/board prefixes", () => {
    expect(shouldPreloadDeferrableWithStudioDevice("device_exec")).toBe(true);
    expect(shouldPreloadDeferrableWithStudioDevice("board_openclaw_health")).toBe(true);
    expect(shouldPreloadDeferrableWithStudioDevice("fleet_board_list")).toBe(true);
    expect(shouldPreloadDeferrableWithStudioDevice("switch_device")).toBe(true);
    expect(shouldPreloadDeferrableWithStudioDevice("web_search")).toBe(false);
  });
});
