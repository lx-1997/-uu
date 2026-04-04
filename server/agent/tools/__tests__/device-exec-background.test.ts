import { describe, it, expect } from "vitest";
import { inferDeviceExecBackgroundIntent } from "../rdk-tools.js";

describe("inferDeviceExecBackgroundIntent", () => {
  it("short timeout ros2 launch stays foreground (diagnostic)", () => {
    expect(
      inferDeviceExecBackgroundIntent(
        "source /opt/tros/humble/setup.bash && timeout 5 ros2 launch dnn_node_example dnn_node_example.launch.py",
        undefined,
      ),
    ).toBe(false);
  });

  it("explicit background true overrides timeout heuristic", () => {
    expect(
      inferDeviceExecBackgroundIntent(
        "timeout 5 ros2 launch foo",
        true,
      ),
    ).toBe(true);
  });

  it("bare ros2 launch still auto-backgrounds", () => {
    expect(inferDeviceExecBackgroundIntent("source x && ros2 launch pkg a.launch.py", undefined)).toBe(true);
  });

  it("long timeout ros2 launch still auto-backgrounds", () => {
    expect(inferDeviceExecBackgroundIntent("timeout 400 ros2 launch pkg a.launch.py", undefined)).toBe(true);
  });
});
