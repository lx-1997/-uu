import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillRegistry } from "../registry.js";

describe("SkillRegistry.matchByText", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("matches hyphenated skill when query mixes Chinese with spaced English (find_skills 常见写法)", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-reg-"));
    const skillDir = path.join(tmp, "skills", "agent-browser-clawdbot");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: agent-browser
description: Headless browser automation CLI for AI agents
---
`,
      "utf-8",
    );
    const reg = new SkillRegistry({ workspaceDir: tmp });
    const hits = reg.matchByText("agent browser 自动化");
    expect(hits.map((h) => h.name)).toContain("agent-browser");
  });

  it("matches full query in description", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-reg-"));
    const dir = path.join(tmp, "skills", "pdf-kit");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---
name: pdf-kit
description: Extract and merge PDF documents
---
`,
      "utf-8",
    );
    const reg = new SkillRegistry({ workspaceDir: tmp });
    expect(reg.matchByText("merge PDF").map((h) => h.name)).toContain("pdf-kit");
  });

  it("respects trigger: query contains trigger phrase", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-reg-"));
    const dir = path.join(tmp, "skills", "feishu-hook");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---
name: feishu-hook
description: Webhooks
trigger: 飞书, lark
---
`,
      "utf-8",
    );
    const reg = new SkillRegistry({ workspaceDir: tmp });
    expect(reg.matchByText("接入飞书机器人").map((h) => h.name)).toContain("feishu-hook");
  });

  it("excludes enabled: false", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-reg-"));
    const dir = path.join(tmp, "skills", "off-skill");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---
name: off-skill
description: Should not match
enabled: false
---
`,
      "utf-8",
    );
    const reg = new SkillRegistry({ workspaceDir: tmp });
    expect(reg.matchByText("should not")).toHaveLength(0);
  });

  it("empty query yields no matches", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-reg-"));
    fs.mkdirSync(path.join(tmp, "skills", "x"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "skills", "x", "SKILL.md"),
      `---
name: x
description: test
---
`,
      "utf-8",
    );
    const reg = new SkillRegistry({ workspaceDir: tmp });
    expect(reg.matchByText("   ")).toHaveLength(0);
  });
});
