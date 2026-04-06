import { describe, expect, it } from "vitest";

import { createForumTools } from "../forum-tools.js";

describe("forum_drobotics_search tool", () => {
  it("registers the forum search tool", () => {
    const tools = createForumTools();
    expect(tools.some((tool) => tool.name === "forum_drobotics_search")).toBe(true);
  });
});