import { describe, it, expect } from "vitest";
import { inferShortLogPeekDefaultTimeoutMs } from "../rdk-tools.js";

describe("inferShortLogPeekDefaultTimeoutMs", () => {
  it("matches sleep && tail | grep (user screenshot case)", () => {
    expect(
      inferShortLogPeekDefaultTimeoutMs(
        `sleep 5 && tail -30 /tmp/rdkstudio-bg-129762.log | grep -E "usb|camera|cam|ERROR|启动成功"`,
      ),
    ).toBe(60_000);
  });

  it("respects existing timeout prefix", () => {
    expect(inferShortLogPeekDefaultTimeoutMs(`timeout 30s tail -20 /tmp/x.log | grep a`)).toBeUndefined();
  });

  it("does not match tail -f", () => {
    expect(inferShortLogPeekDefaultTimeoutMs("tail -f /tmp/x.log | grep a")).toBeUndefined();
  });

  it("does not match ros2 launch", () => {
    expect(inferShortLogPeekDefaultTimeoutMs("source x && ros2 launch pkg a.launch.py")).toBeUndefined();
  });

  it("matches tail -n alone", () => {
    expect(inferShortLogPeekDefaultTimeoutMs("tail -n 40 /tmp/a.log")).toBe(60_000);
  });
});
