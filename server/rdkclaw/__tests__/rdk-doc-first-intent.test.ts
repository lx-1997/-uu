import { describe, it, expect } from "vitest";
import {
  detectRdkDocFirstIntent,
  extractRdkDocUrls,
  buildRdkDocFirstUserMessageHintBlock,
  RDK_DOC_CANONICAL,
} from "../rdk-doc-first-intent.js";

describe("detectRdkDocFirstIntent", () => {
  it("matches YOLO / 目标检测 style tasks", () => {
    expect(detectRdkDocFirstIntent("启动一个yolo目标检测任务")).toBe(true);
    expect(detectRdkDocFirstIntent("在板子上跑目标检测")).toBe(true);
  });

  it("matches when user pastes official rdk_doc URL", () => {
    expect(
      detectRdkDocFirstIntent(
        "请看 https://developer.d-robotics.cc/rdk_doc/Robot_development/boxs/detection/yolo 帮我跑",
      ),
    ).toBe(true);
  });

  it("matches official doc intent", () => {
    expect(detectRdkDocFirstIntent("按开发者文档跑通检测例程")).toBe(true);
  });

  it("does not match empty unrelated", () => {
    expect(detectRdkDocFirstIntent("今天天气怎么样")).toBe(false);
  });
});

describe("extractRdkDocUrls", () => {
  it("extracts one or more rdk_doc URLs", () => {
    const u = RDK_DOC_CANONICAL.yoloBoxDetection;
    expect(extractRdkDocUrls(`打开 ${u} 按文档做`)).toEqual([u]);
    expect(extractRdkDocUrls("无链接")).toEqual([]);
  });
});

describe("buildRdkDocFirstUserMessageHintBlock", () => {
  it("includes URL-anchored section when message contains rdk_doc link", () => {
    const u = RDK_DOC_CANONICAL.yoloBoxDetection;
    const block = buildRdkDocFirstUserMessageHintBlock(`执行 ${u}`);
    expect(block).toContain("用户已提供官方文档链接");
    expect(block).toContain(u);
    expect(block).toContain("web_fetch");
  });
});

describe("RDK_DOC_CANONICAL", () => {
  it("yolo path is under rdk_doc", () => {
    expect(RDK_DOC_CANONICAL.yoloBoxDetection).toContain("developer.d-robotics.cc/rdk_doc");
  });

  it("YOLO-World uses hobot_yolo_world slug not yolo_world", () => {
    expect(RDK_DOC_CANONICAL.yoloWorldBoxDetection).toContain(
      "/detection/hobot_yolo_world",
    );
  });
});
