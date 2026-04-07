import { describe, expect, it } from "vitest";

import { createForumTools } from "../forum-tools.js";

describe("forum_drobotics_search tool", () => {
  it("registers the forum search tool", () => {
    const tools = createForumTools();
    expect(tools.some((tool) => tool.name === "forum_drobotics_search")).toBe(true);
  });

  it("registers create_post and create_topic alias", () => {
    const tools = createForumTools();
    expect(tools.some((t) => t.name === "forum_drobotics_create_post")).toBe(true);
    expect(tools.some((t) => t.name === "forum_drobotics_create_topic")).toBe(true);
  });
});