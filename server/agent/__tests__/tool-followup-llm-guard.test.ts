import { describe, it, expect } from "vitest";
import type { Message } from "../session.js";
import { lastMessageNeedsToolFollowUpLlm } from "../agent-loop.js";

describe("lastMessageNeedsToolFollowUpLlm", () => {
  it("为 true 当最后一条是含 tool_result 的 user 消息（工具刚跑完、尚需一轮模型读结果）", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "a", name: "device_exec", input: { cmd: "ls" } }],
        timestamp: 1,
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "a", name: "device_exec", content: "ok\n" },
        ],
        timestamp: 2,
      },
    ];
    expect(lastMessageNeedsToolFollowUpLlm(messages)).toBe(true);
  });

  it("为 false 当最后是 assistant（无待消费的 tool_result）", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "总结完毕。" }],
        timestamp: 1,
      },
    ];
    expect(lastMessageNeedsToolFollowUpLlm(messages)).toBe(false);
  });

  it("为 false 当最后是纯文本 user（非 tool 结果）", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [{ type: "text", text: "你好" }],
        timestamp: 1,
      },
    ];
    expect(lastMessageNeedsToolFollowUpLlm(messages)).toBe(false);
  });

  it("空列表为 false", () => {
    expect(lastMessageNeedsToolFollowUpLlm([])).toBe(false);
  });
});
