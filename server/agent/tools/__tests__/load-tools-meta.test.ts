import { describe, it, expect } from "vitest";
import type { Tool, ToolContext } from "../types.js";
import { createLoadToolsTool } from "../load-tools-meta.js";
import { isLazyCoreToolName } from "../lazy-tool-policy.js";

describe("createLoadToolsTool", () => {
  it("activates deferrable tools by name", async () => {
    const loadedBySession = new Map<string, Set<string>>();
    const catalog: Tool[] = [
      { name: "read", description: "x", inputSchema: { type: "object" }, execute: async () => "" },
      { name: "device_exec", description: "ssh", inputSchema: { type: "object" }, execute: async () => "" },
    ];
    const tool = createLoadToolsTool({
      getDeferrableCatalog: () => catalog.filter((t) => !isLazyCoreToolName(t.name)),
      getLoadedSet: (sk) => {
        let s = loadedBySession.get(sk);
        if (!s) {
          s = new Set();
          loadedBySession.set(sk, s);
        }
        return s;
      },
    });
    const ctx = { sessionKey: "s1", workspaceDir: "/" } as ToolContext;
    const out = await tool.execute({ names: ["device_exec"] }, ctx);
    expect(out).toMatch(/登记完成/u);
    expect(out).not.toMatch(/device_exec/);
    expect(loadedBySession.get("s1")?.has("device_exec")).toBe(true);
  });

  it("matches query case-insensitively", async () => {
    const loadedBySession = new Map<string, Set<string>>();
    const tool = createLoadToolsTool({
      getDeferrableCatalog: () => [
        { name: "web_search", description: "Search the web", inputSchema: { type: "object" }, execute: async () => "" },
      ],
      getLoadedSet: (sk) => {
        let s = loadedBySession.get(sk);
        if (!s) {
          s = new Set();
          loadedBySession.set(sk, s);
        }
        return s;
      },
    });
    await tool.execute({ query: "WEB" }, { sessionKey: "s2", workspaceDir: "/" } as ToolContext);
    expect(loadedBySession.get("s2")?.has("web_search")).toBe(true);
  });

  it("multi-word query matches if any token hits tool name (e.g. device camera)", async () => {
    const loadedBySession = new Map<string, Set<string>>();
    const tool = createLoadToolsTool({
      getDeferrableCatalog: () => [
        {
          name: "device_exec",
          description: "在设备上执行 shell",
          inputSchema: { type: "object" },
          execute: async () => "",
        },
      ],
      getLoadedSet: (sk) => {
        let s = loadedBySession.get(sk);
        if (!s) {
          s = new Set();
          loadedBySession.set(sk, s);
        }
        return s;
      },
    });
    await tool.execute(
      { query: "device camera photo" },
      { sessionKey: "s3", workspaceDir: "/" } as ToolContext,
    );
    expect(loadedBySession.get("s3")?.has("device_exec")).toBe(true);
  });

  it("query hitting already-loaded deferrable tells model to call tool directly", async () => {
    const loadedBySession = new Map<string, Set<string>>();
    loadedBySession.set(
      "s4",
      new Set(["device_exec"]),
    );
    const tool = createLoadToolsTool({
      getDeferrableCatalog: () => [
        {
          name: "device_exec",
          description: "在设备上执行 shell",
          inputSchema: { type: "object" },
          execute: async () => "",
        },
      ],
      getLoadedSet: (sk) => loadedBySession.get(sk)!,
    });
    const out = await tool.execute(
      { query: "device camera" },
      { sessionKey: "s4", workspaceDir: "/" } as ToolContext,
    );
    expect(out).toMatch(/已在当前会话中/u);
    expect(out).toMatch(/无需 load_tools/u);
    expect(loadedBySession.get("s4")!.size).toBe(1);
  });
});
