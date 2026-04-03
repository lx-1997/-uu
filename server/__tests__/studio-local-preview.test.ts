import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveStudioLocalPreviewPath, STUDIO_LOCAL_PREVIEW_EXTENSIONS } from "../studio-local-preview.js";
import type { ToolContext } from "../agent/tools/types.js";

describe("resolveStudioLocalPreviewPath", () => {
  let tmp: string;
  let outside: string;
  let ctx: ToolContext;

  beforeEach(async () => {
    tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rdk-prev-"));
    outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rdk-out-"));
    ctx = {
      workspaceDir: tmp,
      sessionKey: "test",
    };
  });

  afterEach(async () => {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(outside, { recursive: true, force: true }).catch(() => {});
  });

  it("resolves relative path under workspace", async () => {
    const img = path.join(tmp, "a.png");
    await fs.promises.writeFile(img, Buffer.from("x"));
    const resolved = await resolveStudioLocalPreviewPath("a.png", ctx);
    expect(resolved).toBe(await fs.promises.realpath(img));
  });

  it("rejects path outside workspace", async () => {
    const img = path.join(outside, "x.png");
    await fs.promises.writeFile(img, Buffer.from("x"));
    await expect(resolveStudioLocalPreviewPath(img, ctx)).rejects.toThrow(/允许的工作区根目录/);
  });

  it("rejects traversal", async () => {
    const img = path.join(outside, "x.png");
    await fs.promises.writeFile(img, Buffer.from("x"));
    const rel = path.join("..", path.basename(outside), "x.png");
    await expect(resolveStudioLocalPreviewPath(rel, ctx)).rejects.toThrow();
  });

  it("rejects non-image extension", async () => {
    const f = path.join(tmp, "a.txt");
    await fs.promises.writeFile(f, "hi");
    await expect(resolveStudioLocalPreviewPath("a.txt", ctx)).rejects.toThrow(/不支持/);
  });

  it("allows extraAllowedRoots", async () => {
    const other = path.join(tmp, "extra");
    await fs.promises.mkdir(other, { recursive: true });
    const img = path.join(other, "b.jpg");
    await fs.promises.writeFile(img, Buffer.from("x"));
    const resolved = await resolveStudioLocalPreviewPath(img, {
      ...ctx,
      extraAllowedRoots: [other],
    });
    expect(resolved).toContain("b.jpg");
  });
});

describe("STUDIO_LOCAL_PREVIEW_EXTENSIONS", () => {
  it("includes common raster formats", () => {
    expect(STUDIO_LOCAL_PREVIEW_EXTENSIONS.has(".png")).toBe(true);
    expect(STUDIO_LOCAL_PREVIEW_EXTENSIONS.has(".jpg")).toBe(true);
  });
});
