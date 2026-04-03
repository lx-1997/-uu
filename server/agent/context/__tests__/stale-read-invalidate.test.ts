import { describe, it, expect } from "vitest";
import type { Message, ContentBlock } from "../../session.js";
import {
  invalidateStaleReadToolResults,
  STALE_READ_PLACEHOLDER,
} from "../stale-read-invalidate.js";

describe("invalidateStaleReadToolResults", () => {
  it("replaces read result when same path is later written (workspace)", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "1", name: "read", input: { file_path: "src/a.ts" } },
        ],
        timestamp: 1,
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "1", name: "read", content: "BIG".repeat(100) }],
        timestamp: 2,
      },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "2", name: "write", input: { file_path: "src/a.ts", content: "x" } },
        ],
        timestamp: 3,
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "2", name: "write", content: "ok" }],
        timestamp: 4,
      },
    ];
    const r = invalidateStaleReadToolResults(messages);
    expect(r.invalidatedCount).toBe(1);
    expect(r.savedChars).toBeGreaterThan(0);
    const u = r.messages[1];
    expect(typeof u.content).not.toBe("string");
    const blocks = u.content as ContentBlock[];
    expect(blocks[0].content).toBe(STALE_READ_PLACEHOLDER);
  });

  it("does not touch read when no later mutate on same path", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "1", name: "read", input: { file_path: "a.ts" } }],
        timestamp: 1,
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "1", name: "read", content: "keep-me" }],
        timestamp: 2,
      },
    ];
    const r = invalidateStaleReadToolResults(messages);
    expect(r.invalidatedCount).toBe(0);
    expect(r.messages).toBe(messages);
  });
});
