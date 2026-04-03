import { describe, it, expect } from "vitest";
import { ambiguousSoleWebSearchQueryReason } from "../web-tools.js";

describe("ambiguousSoleWebSearchQueryReason", () => {
  it("rejects sole 泡泡", () => {
    expect(ambiguousSoleWebSearchQueryReason("泡泡")).toContain("泡泡玛特");
    expect(ambiguousSoleWebSearchQueryReason(' "泡泡" ')).toContain("泡泡玛特");
  });

  it("rejects sole pop (any case)", () => {
    expect(ambiguousSoleWebSearchQueryReason("pop")).toContain("Pop Mart");
    expect(ambiguousSoleWebSearchQueryReason("POP")).toContain("Pop Mart");
  });

  it("allows multi-token queries", () => {
    expect(ambiguousSoleWebSearchQueryReason("pop music")).toBeNull();
    expect(ambiguousSoleWebSearchQueryReason("泡泡玛特 回购")).toBeNull();
    expect(ambiguousSoleWebSearchQueryReason("Pop Mart 09992")).toBeNull();
  });

  it("allows full brand name single token", () => {
    expect(ambiguousSoleWebSearchQueryReason("泡泡玛特")).toBeNull();
    expect(ambiguousSoleWebSearchQueryReason("泡泡战士")).toBeNull();
  });
});
