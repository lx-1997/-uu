import { describe, it, expect, vi, afterEach } from "vitest";
import { assertBrowserFetchUrlSafe, assertStudioClientOpenUrlAllowed, browserFetchDns } from "../browser-tools.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("assertStudioClientOpenUrlAllowed", () => {
  it("allows RFC1918 IPv4 for Electron client open (board dashboard)", () => {
    const u = assertStudioClientOpenUrlAllowed("http://192.168.43.164:8000/");
    expect(u.hostname).toBe("192.168.43.164");
    const u2 = assertStudioClientOpenUrlAllowed("http://10.0.0.1:8080/x");
    expect(u2.hostname).toBe("10.0.0.1");
  });

  it("allows 127.0.0.1 for local preview", () => {
    const u = assertStudioClientOpenUrlAllowed("http://127.0.0.1:3000/");
    expect(u.hostname).toBe("127.0.0.1");
  });

  it("rejects non-http URL", () => {
    expect(() => assertStudioClientOpenUrlAllowed("ftp://example.com/")).toThrow();
  });
});

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
    vi.spyOn(browserFetchDns, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const u = await assertBrowserFetchUrlSafe("https://example.com/");
    expect(u.hostname).toBe("example.com");
  });
});
