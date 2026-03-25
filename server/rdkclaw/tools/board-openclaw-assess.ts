import type { Tool } from "../../agent/tools/types.js";
import { readDevices } from "../../storage.js";
import { OpenClawDeploymentManager } from "../../managers/OpenClawDeploymentManager.js";
import type { Device } from "../../../shared/types.js";

function resolveDevicePassword(device: Device) {
  const persisted = (device as Device & { password?: string }).password ?? "";
  const envPwd = process.env.RDK_SSH_PASSWORD ?? "";
  return persisted || envPwd || device.username;
}

function toBoardDevice(device: Device) {
  return {
    ip: device.host,
    userName: device.username,
    id: device.id,
    password: resolveDevicePassword(device),
  };
}

function parseBoardError(raw: string): string {
  const text = (raw || "").trim();
  if (!text) return "板端 OpenClaw 未返回结果";
  if (/__OPENCLAW_HTTP_FAILED__/i.test(text)) {
    return text.replace(/__OPENCLAW_HTTP_FAILED__/gi, "").trim() || "板端 OpenClaw 网关调用失败";
  }
  if (/plugins\.allow is empty/i.test(text)) {
    return "板端 OpenClaw 插件策略阻止执行（plugins.allow 为空）";
  }
  return text;
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

function normalizeAssessment(raw: string, fallbackReason?: string) {
  const obj = extractJsonObject(raw);
  const can =
    asBool(obj?.canHandle) ??
    asBool(obj?.can_do) ??
    asBool(obj?.canDo) ??
    asBool(obj?.capable);
  let canHandle = can ?? false;
  const lower = (raw || "").toLowerCase();
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
  return {
    canHandle,
    confidence,
    reason,
  };
}

export function boardOpenClawAssessTool(
  deviceId: string,
  manager: OpenClawDeploymentManager,
): Tool<{
  task: string;
  context?: string;
  sessionId?: string;
}> {
  return {
    name: "board_openclaw_assess",
    description:
      "向板端 OpenClaw 咨询：某个任务是否适合由板端执行（只评估不执行）。" +
      "典型使用场景：1) 任务需要板端专长（复杂板端操作、OpenClaw 技能链、板端应用开发）；" +
      "2) 你的本地能力受限想让 OpenClaw 协助（如你的模型不支持视觉，可咨询 OpenClaw 是否能处理图片）。" +
      "搜索、文档处理、知识问答等你能直接完成的任务无需咨询。返回 canHandle/confidence/reason。",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "待评估任务描述" },
        context: { type: "string", description: "可选上下文，例如环境约束、期望产物" },
        sessionId: { type: "string", description: "可选会话 ID" },
      },
      required: ["task"],
    },
    async execute(input) {
      const devices = await readDevices();
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        return JSON.stringify({
          canHandle: false,
          confidence: 0,
          reason: "设备不存在，无法进行板端能力评估",
        }, null, 2);
      }

      const boardDevice = toBoardDevice(device);
      const prompt = [
        "你是板端 OpenClaw 的任务评估器，只做可行性评估，不执行任务。",
        "请严格返回 JSON（不要 markdown，不要代码块）：",
        '{"canHandle": true|false, "confidence": 0~1, "reason": "一句话原因", "suggestedPath": "board|local"}',
        input.context ? `context: ${input.context}` : "",
        `task: ${input.task}`,
      ].filter(Boolean).join("\n");
      const sessionId = input.sessionId?.trim() || `rdkclaw-board-assess-${Date.now()}`;

      return await new Promise<string>((resolve) => {
        let output = "";
        manager.sendAgentMessage(
          prompt,
          (chunk) => {
            output += chunk;
          },
          (success) => {
            if (!success) {
              const cleanOutput = output.replace(/__OPENCLAW_WS_FAILED__/g, "").trim();
              if (cleanOutput.length > 10) {
                const normalized = normalizeAssessment(cleanOutput, "板端连接中断，基于部分输出评估");
                resolve(JSON.stringify(normalized, null, 2));
              } else {
                const reason = parseBoardError(output);
                resolve(JSON.stringify({
                  canHandle: false,
                  confidence: 0.2,
                  reason,
                }, null, 2));
              }
              return;
            }
            const normalized = normalizeAssessment(output);
            resolve(JSON.stringify(normalized, null, 2));
          },
          sessionId,
          boardDevice,
        );
      });
    },
  };
}
