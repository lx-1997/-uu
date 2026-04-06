import { describe, expect, it, vi } from "vitest";

vi.mock("../../../rdkclaw/rdk-doc-local-cache.js", () => ({
  searchRdkDocLocal: vi.fn((query: string) => {
    if (query.includes("YOLO")) {
      return [
        {
          title: "Hobot YOLO World",
          url: "https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/detection/hobot_yolo_world",
          urlPath: "Robot_development/boxs/detection/hobot_yolo_world",
          score: 17,
          section: "运行方式",
          snippet: "介绍 hobot_yolo_world 的启动命令与参数。",
        },
      ];
    }
    return [];
  }),
  tryReadRdkDocCachedWithFallback: vi.fn(() => null),
}));

describe("rdk_doc_search_local tool", async () => {
  const { createWebTools } = await import("../web-tools.js");

  it("registers the local rdk doc search tool", () => {
    const tools = createWebTools();
    expect(tools.some((tool) => tool.name === "rdk_doc_search_local")).toBe(true);
  });

  it("returns structured local doc hits with url and section", async () => {
    const tools = createWebTools();
    const tool = tools.find((item) => item.name === "rdk_doc_search_local");
    expect(tool).toBeTruthy();

    const output = await tool!.execute({ query: "RDK X5 YOLO World 示例" }, {} as never);
    expect(output).toContain("cache: local (rdk-doc-cache)");
    expect(output).toContain("Hobot YOLO World");
    expect(output).toContain("section: 运行方式");
    expect(output).toContain("https://developer.d-robotics.cc/rdk_doc/");
  });

  it("suggests fallback when the local cache has no hit", async () => {
    const tools = createWebTools();
    const tool = tools.find((item) => item.name === "rdk_doc_search_local");
    expect(tool).toBeTruthy();

    const output = await tool!.execute({ query: "完全不存在的文档关键词" }, {} as never);
    expect(output).toContain("hits: 0");
    expect(output).toContain("forum_drobotics_search");
    expect(output).toContain("web_search");
  });
});