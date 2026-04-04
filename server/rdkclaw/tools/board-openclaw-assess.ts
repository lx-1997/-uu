import type { Tool, ToolContext } from "../../agent/tools/types.js";
import { readDevices } from "../../storage.js";
import { OpenClawDeploymentManager } from "../../managers/OpenClawDeploymentManager.js";
import {
  logDualAgentEvent,
  recordAssessSnapshot,
} from "../board-dual-agent-orchestration.js";
import { openClawBridgeMeta, parseOpenClawBoardRpcError } from "../openclaw-bridge-meta.js";
import type { Device } from "../../../shared/types.js";
import { resolvePersistedOrDefaultSshPassword } from "../../device-ssh-credentials.js";

function resolveDevicePassword(device: Device) {
  return resolvePersistedOrDefaultSshPassword(device);
}

function toBoardDevice(device: Device) {
  return {
    ip: device.host,
    userName: device.username,
    id: device.id,
    password: resolveDevicePassword(device),
  };
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = (raw || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch (_) {}
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      const parsed = JSON.parse(fenced[1]);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch (_) {}
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const maybe = text.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(maybe);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch (_) {}
  }
  return null;
}

function asBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "yes", "y", "1", "can", "able", "ok"].includes(v)) return true;
    if (["false", "no", "n", "0", "cannot", "cant", "unable"].includes(v)) return false;
  }
  return null;
}

function normalizeSuggestedPath(value: unknown): "board" | "local" | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "board" || v === "local") return v;
  if (v === "ssh" || v === "device" || v === "studio" || v === "rdkclaw") return "local";
  return undefined;
}

function normalizeAssessment(raw: string, fallbackReason?: string) {
  const obj = extractJsonObject(raw);
  const can =
    asBool(obj?.canHandle) ??
    asBool(obj?.can_do) ??
    asBool(obj?.canDo) ??
    asBool(obj?.capable);
  let canHandle = can ?? false;
  if (can === null) {
    if (/不能|无法|做不到|失败|不支持/.test(raw)) canHandle = false;
    else if (/可以|可执行|能做|可完成/.test(raw)) canHandle = true;
  }
  const reason =
    (typeof obj?.reason === "string" && obj.reason.trim()) ||
    (typeof obj?.summary === "string" && obj.summary.trim()) ||
    (fallbackReason?.trim() || "") ||
    (canHandle ? "板端可执行该任务" : "板端不建议执行该任务");
  const confidenceRaw =
    typeof obj?.confidence === "number"
      ? obj.confidence
      : typeof obj?.score === "number"
        ? obj.score
        : canHandle
          ? 0.7
          : 0.6;
  const confidence = Math.max(0, Math.min(1, Number.isFinite(confidenceRaw) ? confidenceRaw : 0.6));
  const suggestedPath =
    normalizeSuggestedPath(obj?.suggestedPath) ??
    normalizeSuggestedPath(obj?.suggested_path) ??
    normalizeSuggestedPath(obj?.path);
  return {
    canHandle,
    confidence,
    reason,
    suggestedPath,
  };
}

export interface BoardSkillInfo {
  name: string;
  path: string;
  description: string;
}

const KNOWN_RDK_EXAMPLE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /fcos|yolo(?![\w]*\s*world)|mobilenet.*ssd|efficientnet.*det|目标检测|物体检测|检测例程/i, label: "目标检测" },
  { pattern: /yolo.?world|开放词汇.*检测|open.?vocab/i, label: "YOLO-World 开放词汇检测" },
  { pattern: /mono2d.*body|人体检测|人体识别|骨骼|body_detection/i, label: "人体检测" },
  { pattern: /body_tracking|人体跟踪|人体识别与跟踪/i, label: "人体跟踪" },
  { pattern: /hobot_usb_cam|hobot_mipi_cam|相机节点|usb_cam.*launch/i, label: "相机节点" },
  { pattern: /hobot_codec|图像编解码/i, label: "图像编解码" },
  { pattern: /hobot_stereo|双目|stereo_usb_cam/i, label: "双目相机" },
  { pattern: /hand_lmk|hand_gesture|手势识别|手部关键点/i, label: "手势识别" },
  { pattern: /parking_perception|停车区域/i, label: "停车区域检测" },
  { pattern: /elevation_net|高程网络/i, label: "高程网络" },
  { pattern: /hobot_dnn_example|bpu.*推理|dnn.*example/i, label: "BPU 推理" },
  { pattern: /slam|建图|vslam|orb.?slam|cartographer/i, label: "SLAM 建图" },
  { pattern: /导航|navigation|nav2|move_base/i, label: "自主导航" },
  { pattern: /语义分割|semantic.*seg|hobot_sem/i, label: "语义分割" },
  { pattern: /图像分类|image.*classif|mobilenet.*cls|resnet/i, label: "图像分类" },
  { pattern: /hobot_audio|语音|audio.*asr|tts|智能语音/i, label: "音频/语音" },
  { pattern: /跟踪|tracking|hobot_mot|多目标跟踪/i, label: "目标跟踪" },
  { pattern: /姿态估计|pose.*estim|人体姿态/i, label: "姿态估计" },
  { pattern: /点云|point.?cloud|lidar|雷达/i, label: "点云/LiDAR" },
  { pattern: /hobot_visualization|web.*可视化|foxglove/i, label: "可视化" },
  { pattern: /模型.*部署|hbm.*转换|bpu.*编译|model.*convert/i, label: "模型部署" },
];

function tryShortCircuitAssess(task: string): string | null {
  const hit = KNOWN_RDK_EXAMPLE_PATTERNS.find((p) => p.pattern.test(task));
  if (!hit) return null;
  return JSON.stringify({
    canHandle: true,
    confidence: 0.95,
    reason: `任务匹配 RDK 官方标准例程（${hit.label}），板端 OpenClaw 可承接`,
    suggestedPath: "board",
    shortCircuit: true,
  }, null, 2);
}

export function boardOpenClawAssessTool(
  deviceId: string,
  manager: OpenClawDeploymentManager,
  conversationId?: string,
  boardSkills?: BoardSkillInfo[],
  onProgress?: (chunk: string, toolCallId?: string) => void,
): Tool<{
  task: string;
  context?: string;
  sessionId?: string;
}> {
  return {
    name: "board_openclaw_assess",
    description:
      "读者=编排模型。与板端 OpenClaw 的**正式能力握手**：只评估不执行，但**不是可跳过的一步**——在可能 delegate 前应先 assess，避免 RDKClaw 用 SSH 把整件事包办。\n" +
      "向板端 OpenClaw 咨询：某任务是否适合由板端 Agent 承接（canHandle/confidence/reason）。\n" +
      "**短路由**：任务描述命中常见 RDK 官方例程关键词时，可能 **瞬时返回 JSON**（不连接板端 LLM），仍视为有效 assess，可与 `web_fetch` 同轮。\n\n" +
      "选用时机：\n" +
      "- 板端多步/试错/技能链/clawhub 流程；或你已预见要多轮 device_exec 试探\n" +
      "- 不确定该 SSH 硬顶还是交给板端时——先 assess 再决定\n" +
      "不适用：纯本机搜索/读文档/知识问答（与板端无关）；单条 shell 就能完成的原子命令（直接 device_exec）\n\n" +
      "规则：\n" +
      "- ALWAYS 在 board_openclaw_delegate 之前调用（同一复杂任务勿跳过）\n" +
      "- 返回 confidence < 0.5 时：倾向用本地/SSH；若 reason 指缺技能，可先装技能再 assess\n",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "待评估任务描述" },
        context: { type: "string", description: "可选上下文，例如环境约束、期望产物" },
        sessionId: { type: "string", description: "可选会话 ID" },
      },
      required: ["task"],
    },
    async execute(input, ctx: ToolContext) {
      const devices = await readDevices();
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        return JSON.stringify({
          canHandle: false,
          confidence: 0,
          reason: "设备不存在，无法进行板端能力评估",
        }, null, 2);
      }

      const shortCircuit = tryShortCircuitAssess(input.task);
      if (shortCircuit) {
        const normalized = normalizeAssessment(shortCircuit);
        recordAssessSnapshot(ctx.sessionKey, deviceId, normalized, input.task);
        return shortCircuit;
      }

      const boardDevice = toBoardDevice(device);
      const skillContext = boardSkills && boardSkills.length > 0
        ? `已装技能（${boardSkills.length}）:\n` +
          boardSkills.map((s) => `- ${s.name}: ${s.description || "无描述"} [${s.path}]`).join("\n")
        : "";
      const prompt = [
        "[assess] 仅评估是否适合由你在板端承接，不要执行 task 中的操作。",
        "若 context 中已写明 RDKClaw 已确认完整命令，reason 里注明「可按 guidance 直接执行、无需重复探测包是否安装」。",
        "只输出一个 JSON 对象，禁止 markdown/代码围栏/前后解说。Schema:",
        '{"canHandle":true|false,"confidence":0~1,"reason":"一句","suggestedPath":"board|local"}',
        skillContext,
        input.context ? `context: ${input.context}` : "",
        `task: ${input.task}`,
      ].filter(Boolean).join("\n");
      const sessionId = input.sessionId?.trim() || conversationId || `rdkclaw-board-assess-${Date.now()}`;

      return await new Promise<string>((resolve) => {
        let output = "";
        manager.sendAgentMessage(
          prompt,
          (chunk) => {
            output += chunk;
            onProgress?.(chunk, ctx.toolCallId);
          },
          (success) => {
            if (!success) {
              const cleanOutput = output.replace(/__OPENCLAW_WS_FAILED__/g, "").trim();
              if (cleanOutput.length > 10) {
                const normalized = normalizeAssessment(cleanOutput, "板端连接中断，基于部分输出评估");
                recordAssessSnapshot(ctx.sessionKey, deviceId, normalized, input.task);
                resolve(JSON.stringify(normalized, null, 2));
              } else {
                const reason = parseOpenClawBoardRpcError(output);
                logDualAgentEvent({
                  event: "assess_failed",
                  sessionKey: ctx.sessionKey,
                  deviceId,
                  reason: "short_or_empty_output",
                });
                resolve(JSON.stringify({
                  canHandle: false,
                  confidence: 0.2,
                  reason,
                }, null, 2));
              }
              return;
            }
            const normalized = normalizeAssessment(output);
            recordAssessSnapshot(ctx.sessionKey, deviceId, normalized, input.task);
            resolve(JSON.stringify(normalized, null, 2));
          },
          sessionId,
          boardDevice,
          openClawBridgeMeta(ctx),
        );
      });
    },
  };
}
