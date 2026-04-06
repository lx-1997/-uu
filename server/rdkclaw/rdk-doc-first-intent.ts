/**
 * 检测「应先读 developer.d-robotics.cc 再动板」的任务，用于注入动态 system 段。
 * 宁可略宽：漏检会导致盲试 shell；误判时多一次 web_fetch 成本低。
 */

import { buildRdkDocHintForSystemPrompt, loadRdkDocUrlIndex } from "./rdk-doc-url-index.js";

/** 与 rdk-doc-url-index.md 同步（勿在此处硬编码 URL） */
export const RDK_DOC_CANONICAL = {
  get root() {
    return loadRdkDocUrlIndex().root;
  },
  get yoloBoxDetection() {
    const idx = loadRdkDocUrlIndex();
    const row = idx.entries.find((e) => e.url.includes("/detection/yolo"));
    return row?.url ?? `${idx.root}Robot_development/boxs/detection/yolo`;
  },
  /** YOLO-World（开放词汇）：官网 slug 为 hobot_yolo_world，勿用 yolo_world */
  get yoloWorldBoxDetection() {
    const idx = loadRdkDocUrlIndex();
    const row = idx.entries.find((e) => e.url.includes("/detection/hobot_yolo_world"));
    return row?.url ?? `${idx.root}Robot_development/boxs/detection/hobot_yolo_world`;
  },
};

/** 用户消息里粘贴的官方文档链接（与浏览器地址栏一致即可命中） */
const RDK_DOC_PAGE_URL_RE = /https?:\/\/developer\.d-robotics\.cc\/rdk_doc[^\s)'">\]]*/gi;

/**
 * 从用户消息中提取 rdk_doc 页面 URL（去重、去尾部标点）。
 */
export function extractRdkDocUrls(text: string): string[] {
  const s = String(text || "");
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(RDK_DOC_PAGE_URL_RE.source, "gi");
  while ((m = re.exec(s)) !== null) {
    const raw = m[0];
    const u = raw.replace(/[.,;，。]+$/, "").trim();
    if (u && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

/**
 * 用户消息是否像「地平线官方文档里已有标准流程」的套件端算法/应用任务。
 */
export function detectRdkDocFirstIntent(text: string): boolean {
  const t = String(text || "");
  if (t.length > 6000) return false;
  /** 已贴官方文档 URL = 明确要以该页为执行依据 */
  if (extractRdkDocUrls(t).length > 0) return true;
  const lower = t.toLowerCase();

  const algoOrApp =
    /yolo|目标检测|物体检测|检测任务|检测例程|detection|segment|分割|跟踪|tracking|ocr|slam|vio|视觉|相机标定|深度|stereo|双目|mipi|usb\s*cam|hobot|bernoulli|bpu|模型部署|量化|infer|推理例程/i.test(
      t,
    );

  const rdkEcosystem =
    /rdk|tros|ros2|地平线|d-robotics|drobotics|旭日|开发者套件|开发板|套件端|板子|板上|在板|盒子|boxs|robot_development/i.test(
      lower,
    );

  const taskVerb = /启动|运行|部署|跑起来|跑通|跑|按官方|按文档|例程|demo|示例|教程/i.test(t);

  /** 仅「算法/视觉」或「RDK 生态 + 动作」即触发 */
  if (algoOrApp && (rdkEcosystem || taskVerb)) return true;
  if (algoOrApp && /官方|文档|rdk_doc|developer\.d-robotics/i.test(t)) return true;

  return false;
}

function buildRdkDocUrlAnchoredSection(urls: string[]): string {
  const lines = urls.slice(0, 5);
  return [
    "### 用户已提供官方文档链接（= 执行清单，优先于「凭记忆猜」）",
    `下列 **rdk_doc** URL（${lines.length} 条）即本轮**权威步骤来源**：`,
    ...lines.map((u) => `- \`${u}\``),
    "**你必须**：",
    "1. **先 `web_fetch`** 与用户任务**最直接相关**的那一条（通常是用户粘贴的第一条）；以页面正文为准整理 **source 环境、包/节点名、launch 文件、环境变量（如 CAM_TYPE）、验证命令**。",
    "2. **再**按文档顺序在板上执行；文档写死的包名/路径 **不得**用训练记忆擅自替换。",
    "3. 若文档涉及 **摄像头 / `CAM_TYPE` / 视频输入**：在 launch **之前**用 `device_exec` 做**短探测**（如 `ls /dev/video*`、`v4l2-ctl --list-devices`、`lsusb`），区分 **USB 与 MIPI** 等与文档是否一致，再设环境变量与启动命令。",
    "4. 文档若为长驻 `ros2 launch`：**`device_exec` + `background: true`** 启动，再用文档中的验收方式（`tail`、topic、Web 等）确认。",
    "5. 若正文与套件端实测不一致，说明差异并**以文档为纲、以探测为辅**调整，勿盲扫 `/opt` 替代读文档。",
    "---",
  ].join("\n");
}

/** 紧贴用户消息的动态段：强调先 web_fetch 官方页再 device_exec */
export function buildRdkDocFirstUserMessageHintBlock(latestUserMessage?: string): string {
  const urls = extractRdkDocUrls(String(latestUserMessage ?? ""));
  const anchored = urls.length > 0 ? buildRdkDocUrlAnchoredSection(urls) : "";

  const core = [
    "## 本轮用户消息 · RDK 官方文档优先（须执行）",
    "检测到任务涉及 **RDK 算法/机器人/盒子应用或标准例程**。在动 `device_exec` 做**大段试探**之前，**本回合须先** 用 **`web_fetch`** 拉取 **developer.d-robotics.cc/rdk_doc** 下与任务**对应章节**的 HTML 正文（或 `web_search` 定位到该站再 `web_fetch` 命中 URL）。",
    "**按文档**给出的包名、依赖、source 环境、`ros2 launch` 或脚本路径逐步执行；文档若写死版本/路径，**不要**凭训练记忆改写成别的包名。",
    "**相机/视觉类**：在设 `CAM_TYPE` 或等价参数前，**必须先**用少量 `device_exec` 确认当前是 **USB 还是 MIPI**（及 `/dev/video*` 节点），与文档推荐一致后再启动；勿默认 USB。",
    "**反模式**：一上来 `apt search`/`grep /opt/tros` 盲扫、或连猜多个 launch——除非文档明确让你自检环境。",
    buildRdkDocHintForSystemPrompt(),
  ].join("\n\n");

  return [anchored, core].filter(Boolean).join("\n\n");
}
