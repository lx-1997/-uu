import { describe, it, expect } from "vitest";
import type { Message } from "../../session.js";
import { snipTailOversizedToolResults } from "../tail-tool-snip.js";

describe("snipTailOversizedToolResults", () => {
  it("snips only soft band before hard tail, when over maxChars", () => {
    const big = "x".repeat(13_000);
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "a", name: "read", content: big },
          { type: "tool_result", tool_use_id: "b", name: "read", content: big },
          { type: "tool_result", tool_use_id: "c", name: "read", content: "keep-c" },
          { type: "tool_result", tool_use_id: "d", name: "read", content: "keep-d" },
        ],
        timestamp: 1,
      },
    ];
    const r = snipTailOversizedToolResults(messages, {
      hardKeepLatest: 2,
      softBand: 8,
      maxChars: 12_000,
    });
    expect(r.snippedCount).toBe(2);
    expect(r.savedChars).toBeGreaterThan(0);
    const blocks = (r.messages[0] as Message).content as Array<{ content?: string }>;
    expect(blocks[0].content?.startsWith("[超长输出已省略")).toBe(true);
    expect(blocks[1].content?.startsWith("[超长输出已省略")).toBe(true);
    expect(blocks[2].content).toBe("keep-c");
    expect(blocks[3].content).toBe("keep-d");
  });
});
