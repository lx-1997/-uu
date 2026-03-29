import { describe, it, expect } from "vitest";
import { assertBrowserFetchUrlSafe } from "../browser-tools.js";

describe("assertBrowserFetchUrlSafe", () => {
  it("rejects localhost", async () => {
    await expect(assertBrowserFetchUrlSafe("http://localhost/foo")).rejects.toThrow();
  });

  it("rejects 127.0.0.1", async () => {
    await expect(assertBrowserFetchUrlSafe("http://127.0.0.1/")).rejects.toThrow();
  });

  it("rejects non-http URL", async () => {
    await expect(assertBrowserFetchUrlSafe("ftp://example.com/")).rejects.toThrow();
  });

  it("allows public https URL after DNS check", async () => {
    const u = await assertBrowserFetchUrlSafe("https://example.com/");
    expect(u.hostname).toBe("example.com");
  });
});
